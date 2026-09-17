import { ChatService } from './chat.service';
import { ToolExecutorService } from './tool-executor.service';
import { closedReviewPeriod } from '../../ledger/ledger-period';

describe('聊天复盘任务', () => {
  const create = jest.fn(async (_user, dto) => { closedReviewPeriod(dto.kind, dto.period); return { id: 'job', period: dto.period, status: 'queued' }; });
  const tools = new ToolExecutorService({} as any, {} as any, { create } as any);
  beforeEach(() => create.mockClear());
  it('忽略模型提供的账号与配置，绑定服务端聊天身份', async () => {
    const result = await tools.executeTool('owner', 'create_retrospective', { kind: 'month', period: '2020-01', configId: 999, userId: 'other' }, { configId: 7, turnKey: '4:8' });
    expect(result.success).toBe(true);
    expect(result.data.status).toBe('queued');
    expect(create.mock.calls[0][0]).toBe('owner');
    expect(create.mock.calls[0][1].configId).toBe(7);
  });
  it('同一轮相同周期幂等，跨轮或跨用户独立', async () => {
    const args = { kind: 'day', period: '2020-01-01' };
    for (const [user, turnKey] of [['a','1'],['a','1'],['a','2'],['b','1']]) await tools.executeTool(user, 'create_retrospective', args, { configId: 7, turnKey });
    const keys = create.mock.calls.map(call => call[1].clientKey);
    expect(keys[0]).toBe(keys[1]);
    expect(new Set(keys).size).toBe(3);
    expect(keys[0]).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
  });
  it('未提供可信聊天上下文或不支持的周期时不建任务', async () => {
    expect((await tools.executeTool('a', 'create_retrospective', { kind:'day',period:'2020-01-01' })).success).toBe(false);
    expect((await tools.executeTool('a', 'create_retrospective', { kind:'week',period:'2020-01' }, { configId:7,turnKey:'1' })).success).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
  it('未结束周期返回失败，不虚报已生成', async () => {
    const result = await tools.executeTool('a','create_retrospective',{kind:'day',period:'2999-01-01'},{configId:7,turnKey:'1'});
    expect(result.success).toBe(false);
    expect(result.message).toContain('只能复盘已结束');
  });
});

describe.each(['chat', 'stream'])('复盘对话编排 %s', mode => {
  it('工具加入上下文、使用所选模型并持久化任务回执', async () => {
    let seq = 0, calls = 0;
    const session = { aiConfigId: 7 };
    const sessions = { getSession: jest.fn(async () => session), getNextSeqNum: jest.fn(async () => ++seq), saveMessage: jest.fn(async () => {}), getContextMessages: jest.fn(async () => []), getUnsummarizedCount: jest.fn(async () => 0) };
    const config = { id: 9, provider: 'deepseek', model: 'test', apiKey: 'synthetic' };
    const configs = { getFullConfig: jest.fn(async () => config) };
    const job = { id: 'saved-job', status: 'queued', period: '2020-01' };
    const jobs = { create: jest.fn(async () => job) };
    const executor = new ToolExecutorService({} as any, {} as any, jobs as any);
    const tool = { id:'call-1',name:'create_retrospective',arguments:{kind:'month',period:'2020-01'} };
    const adapter = {
      chat: jest.fn(async (_messages, tools) => { expect(tools.some(t => t.name === 'create_retrospective')).toBe(true); return calls++ === 0 ? { content:'',stopReason:'tool_use',toolCalls:[tool] } : {content:'已创建复盘任务',stopReason:'end_turn',toolCalls:[]}; }),
      async *chatStream(_messages, tools) { expect(tools.some(t => t.name === 'create_retrospective')).toBe(true); if(calls++ === 0) { yield {type:'tool_call_start',toolCallId:tool.id,toolCallName:tool.name}; yield {type:'tool_call_delta',toolCallId:tool.id,argumentsDelta:JSON.stringify(tool.arguments)}; yield {type:'done',stopReason:'tool_use'}; } else { yield {type:'text_delta',content:'已创建复盘任务'}; yield {type:'done',stopReason:'end_turn'}; } },
    };
    const service = new ChatService(configs as any,sessions as any,executor,{findAll:async()=>[]} as any,adapter as any,adapter as any,adapter as any,adapter as any);
    const dto = {sessionId:4,configId:9,content:'请生成2020年1月复盘'};
    if(mode === 'chat') { const result = await service.chat('owner',dto); expect(result.toolResults[0].result.data.id).toBe('saved-job'); }
    else { const events = []; for await (const event of service.chatStream('owner',dto)) events.push(event); expect(events.find(e=>e.event==='tool_result').data.result.data.id).toBe('saved-job'); }
    expect(jobs.create).toHaveBeenCalledWith('owner',expect.objectContaining({configId:9,kind:'month',period:'2020-01'}));
    expect(sessions.saveMessage).toHaveBeenCalledWith(4,expect.any(Number),expect.objectContaining({role:'tool',toolName:'create_retrospective',toolResult:expect.objectContaining({success:true,data:job})}));
  });
});
