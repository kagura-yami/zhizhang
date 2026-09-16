jest.mock('../src/services/http', () => ({ httpService: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
import { createRetrospectiveApi, defaultReviewPeriod } from '../src/services/api/retrospectives';
import { httpService } from '../src/services/http';
describe('复盘周期与会话边界', () => {
  it('北京时间跨年和闰年只默认选已结束周期', () => {
    expect(defaultReviewPeriod('day', new Date('2026-12-31T16:00:00Z'))).toBe('2026-12-31');
    expect(defaultReviewPeriod('month', new Date('2026-12-31T16:00:00Z'))).toBe('2026-12');
    expect(defaultReviewPeriod('day', new Date('2028-02-29T16:00:00Z'))).toBe('2028-02-29');
    expect(defaultReviewPeriod('month', new Date('2028-03-30T16:00:00Z'))).toBe('2028-02');
  });
  it('延迟删除与重试不切换成后来登录的账户', async () => {
    (httpService.delete as jest.Mock).mockResolvedValue({ success: true, data: { deleted: true } });
    (httpService.post as jest.Mock).mockResolvedValue({ success: true, data: { id: 'job' } });
    const first = createRetrospectiveApi('first'), second = createRetrospectiveApi('second');
    await second.retry('second-job'); await first.remove('first-job');
    expect((httpService.delete as jest.Mock).mock.calls[0][1].headers.Authorization).toBe('Bearer first');
    expect((httpService.post as jest.Mock).mock.calls[0][2].headers.Authorization).toBe('Bearer second');
  });
  it('失效或缺失的响应不会作为成功报告展示', async () => {
    (httpService.get as jest.Mock).mockResolvedValueOnce({ success: false, message: '报告不存在' }).mockResolvedValueOnce({ success: true });
    await expect(createRetrospectiveApi('test').detail('job')).rejects.toThrow('报告不存在');
    await expect(createRetrospectiveApi('test').detail('job')).rejects.toThrow('请求失败');
  });
});
