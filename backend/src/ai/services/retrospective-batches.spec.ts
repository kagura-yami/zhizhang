import { evidenceBatches, encodedBytes, generateBatchedReport } from './retrospective-batches';
import type { RetrospectiveEvidence } from './retrospective-output';

function fixture(): RetrospectiveEvidence {
  return {
    inputDigest: 'complete', sources: [], capturedAt: new Date().toISOString(), payload: {
      kind: 'month', period: '2020-02', gaps: ['预算依据不足'], budgets: [], votes: [],
      facts: { ruleVersion: 'test', ordinaryIncome: '0.0000', grossExpense: '140.1400', cashSurplus: '-140.1400',
        categories: [], bills: Array.from({ length: 1400 }, (_, i) => ({ ref: `B${i + 1}`, amount: '0.1001', type: 'expense', date: '2020-02-10', category: '餐饮', description: '完整备注'.repeat(15), classification: 'ordinary', included: true })) },
      feedback: Array.from({ length: 37 }, (_, i) => ({ ref: `M${i + 1}`, bill: 'B1', author: `评价者${i + 1}`, role: 'reviewer', isMain: true, text: '请结合必要性安排消费。'.repeat(20) })),
    },
  } as unknown as RetrospectiveEvidence;
}
describe('长上下文复盘', () => {
  it('每批按 UTF-8 字节计量，完整覆盖账单和文字，不改变总额', () => {
    const input = fixture(), before = JSON.stringify(input), batches = evidenceBatches(input, 2200);
    expect(batches.length).toBeGreaterThan(100);
    expect(batches.every(b => encodedBytes(b.payload) <= 2200)).toBe(true);
    expect(batches.flatMap(b => b.payload.facts.bills).map(b => b.ref)).toEqual(input.payload.facts.bills.map(b => b.ref));
    expect(batches.flatMap(b => b.payload.feedback).map(m => m.ref)).toEqual(input.payload.feedback.map(m => m.ref));
    expect(batches.every(b => b.payload.facts.grossExpense === '140.1400')).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('多层合并保留最后一批证据并恢复完整服务端事实', async () => {
    const input = fixture(), seen = new Set<string>(); let calls = 0;
    const result = await generateBatchedReport(input, async payload => {
      calls++; expect(encodedBytes(payload)).toBeLessThanOrEqual(2200);
      if (payload.phase === 'partial') payload.facts.bills.forEach(b => seen.add(b.ref));
      const bill = payload.facts.bills.at(-1), message = payload.feedback.at(-1);
      const ref = bill?.ref ?? message?.ref;
      return JSON.stringify({ friendViews: message ? [{ ref: message.ref, quote: message.text.slice(0, 40) }] : [],
        analysis: ref ? [{ text: '建议结合必要性检查支出安排', citations: [ref] }] : [], actions: [] });
    }, 2200);
    expect(seen.size).toBe(1400);
    expect(result.generation.coveredMessages).toBe(37);
    expect(result.generation.levels).toBeGreaterThan(1);
    expect(result.generation.calls).toBe(calls);
    expect(result.report.facts.grossExpense).toBe('140.1400');
    expect(result.report.analysis[0].citations).toEqual(['B1400']);
  });
  it('任一中间输出伪造引用，整次生成失败', async () => {
    await expect(generateBatchedReport(fixture(), async () => JSON.stringify({ friendViews: [], analysis: [{ text: '检查支出', citations: ['B999999'] }], actions: [] }), 2200)).rejects.toThrow('证据校验');
  });
  it('拒绝超长单条信息，不切掉原文后冒充完整取数', () => {
    const input = fixture(); input.payload.feedback[0].text = '长'.repeat(20000);
    expect(() => evidenceBatches(input)).toThrow('单条账单备注');
  });
  it('中间模型拒绝精炼时失败，不无限循环或丢弃分批', async () => {
    const input = fixture();
    await expect(generateBatchedReport(input, async payload => JSON.stringify({ friendViews: [], analysis: [{ text: '过长解释'.repeat(40), citations: [payload.facts.bills[0].ref] }], actions: [] }), 2200)).rejects.toThrow('不够精炼');
  });
});
