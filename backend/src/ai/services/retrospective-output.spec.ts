import { validateRetrospectiveOutput, RetrospectiveEvidence } from './retrospective-output';
import { RetrospectiveGeneratorService } from './retrospective-generator.service';

const evidence = {
  inputDigest: 'stable-input', capturedAt: '2020-02-11T00:00:00Z', sources: [{ ref: 'M1', kind: 'message', id: 123, version: '1' }],
  payload: { kind: 'day', period: '2020-02-10',
    facts: { ruleVersion: 'test', grossExpense: '25.0000', bills: [{ ref: 'B1' }] },
    feedback: [ { ref: 'M1', bill: 'B1', role: 'reviewer', author: '评价者1', text: '可减少外卖，自己做饭。' },
      { ref: 'M2', bill: 'B1', role: 'owner', author: '本人', text: '这是必要消费' } ],
    votes: [{ ref: 'V1' }], budgets: [], gaps: [],
  },
} as unknown as RetrospectiveEvidence;
const valid = () => ({ friendViews: [{ ref: 'M1', quote: '可减少外卖' }],
  analysis: [{ text: '可结合实际需要检查消费安排', citations: ['B1'] }],
  actions: [{ text: '尝试提前安排工作餐', citations: ['M1'] }] });

describe('复盘输出与只读生成', () => {
  it('财务事实来自服务器，好友观点是原文节选', () => {
    const report = validateRetrospectiveOutput(JSON.stringify(valid()), evidence);
    expect(report.facts.grossExpense).toBe('25.0000');
    expect(report.friendViews[0]).toEqual({ ref: 'M1', quote: '可减少外卖', author: '评价者1', bill: 'B1' });
    expect(report.facts).not.toHaveProperty('bills');
  });
  it.each([
    { ...valid(), grossExpense: '0.0000' },
    { ...valid(), friendViews: [{ ref: 'M1', quote: '好友说全部消费不合理' }] },
    { ...valid(), friendViews: [{ ref: 'M2', quote: '这是必要消费' }] },
    { ...valid(), friendViews: [{ ref: 'V1', quote: '不好' }] },
    { ...valid(), analysis: [{ text: '这笔消费值得检查', citations: ['B9999'] }] },
    { ...valid(), actions: Array(4).fill({ text: '检查消费', citations: ['B1'] }) },
    { ...valid(), analysis: [{ text: '花了999元', citations: ['B1'] }] },
    { ...valid(), analysis: [{ text: '花了９９９元', citations: ['B1'] }] },
    { ...valid(), analysis: [{ text: '花了九百元', citations: ['B1'] }] },
    { ...valid(), actions: [{ text: '去https://example.com付款', citations: ['B1'] }] },
    { ...valid(), analysis: [{ text: '有依据但没有引用', citations: [] }] },
  ])('拒绝越界或不符合证据的输出 %#', output => {
    expect(() => validateRetrospectiveOutput(JSON.stringify(output), evidence)).toThrow('证据校验');
  });
  it('JSON 外包裹、空内容和超长结果不当成成功', () => {
    for (const response of ['```json\n{}\n```', '', 'a'.repeat(20001)]) {
      expect(() => validateRetrospectiveOutput(response, evidence)).toThrow('证据校验');
    }
  });
  function setup() {
    const adapter = { provider: 'openai', chat: jest.fn().mockResolvedValue({ content: JSON.stringify(valid()), toolCalls: [], stopReason: 'end_turn' }) };
    const configs = { findDefault: jest.fn().mockResolvedValue({ provider: 'openai', model: 'synthetic-model', apiKey: 'test-key' }), findOneDetail: jest.fn() };
    const collector = { collect: jest.fn().mockResolvedValue(evidence) };
    const service = new RetrospectiveGeneratorService(configs as any, collector as any,
      { provider: 'claude' } as any, adapter as any, { provider: 'deepseek' } as any, { provider: 'qwen' } as any);
    return { service, adapter, collector, configs };
  }
  it('只发送模型载荷，不发送内部来源映射，不提供任何工具', async () => {
    const { service, adapter, collector } = setup();
    const result = await service.generate('owner', 'day', '2020-02-10');
    const [messages, tools, config] = adapter.chat.mock.calls[0];
    expect(tools).toEqual([]);
    expect(JSON.parse(messages[1].content)).toEqual(evidence.payload);
    expect(config.redactErrors).toBe(true);
    expect(config.signal).toBeInstanceOf(AbortSignal);
    expect(collector.collect).toHaveBeenCalledTimes(2);
    expect(result).not.toHaveProperty('apiKey');
    expect(result.provider).toBe('openai');
  });
  it.each(['tool_use', 'max_tokens'])('拒绝停止原因 %s，不执行模型要求的工具', async reason => {
    const { service, adapter } = setup();
    adapter.chat.mockResolvedValue({ content: JSON.stringify(valid()), stopReason: reason, toolCalls: [{ name: 'delete_bill' }] });
    await expect(service.generate('owner', 'day', '2020-02-10')).rejects.toThrow('有效复盘');
    expect(adapter.chat).toHaveBeenCalledTimes(1);
  });
  it('生成期间源数据或授权变化时，不接受旧输入的报告', async () => {
    const { service, collector } = setup();
    collector.collect.mockResolvedValueOnce(evidence).mockResolvedValueOnce({ ...evidence, inputDigest: 'revoked-or-hidden' });
    await expect(service.generate('owner', 'day', '2020-02-10')).rejects.toThrow('授权已变化');
  });
  it('取消时不调用模型；不向客户端暴露上游原文错误', async () => {
    const { service, adapter } = setup();
    const controller = new AbortController(); controller.abort();
    await expect(service.generate('owner', 'day', '2020-02-10', undefined, controller.signal)).rejects.toThrow('取消');
    expect(adapter.chat).not.toHaveBeenCalled();
    adapter.chat.mockRejectedValue(new Error('secret raw text from upstream'));
    await expect(service.generate('owner', 'day', '2020-02-10')).rejects.toThrow('模型暂时无法完成');
  });
  it('模型配置查询始终绑定当前用户，不接受无配置的调用', async () => {
    const { service, configs, adapter } = setup();
    configs.findOneDetail.mockRejectedValue(new Error('模型配置不存在'));
    await expect(service.generate('owner', 'day', '2020-02-10', 77)).rejects.toThrow('模型配置不存在');
    expect(configs.findOneDetail).toHaveBeenCalledWith('owner', 77);
    expect(adapter.chat).not.toHaveBeenCalled();
  });
  it('超时会中止在途请求，而不只是放弃等待', async () => {
    jest.useFakeTimers();
    try {
      const { service, adapter } = setup();
      let requestSignal: AbortSignal;
      adapter.chat.mockImplementation((_messages, _tools, config) => new Promise((_resolve, reject) => {
        requestSignal = config.signal;
        config.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }));
      const pending = expect(service.generate('owner', 'day', '2020-02-10')).rejects.toThrow('超时');
      await jest.advanceTimersByTimeAsync(120001);
      await pending;
      expect(requestSignal.aborted).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
    } finally { jest.useRealTimers(); }
  });
});
