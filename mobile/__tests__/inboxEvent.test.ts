jest.mock('../src/services/http', () => ({ httpService: { get: jest.fn() } }));
import { httpService } from '../src/services/http';
import { createSocialApi } from '../src/services/api/social';
beforeEach(() => jest.clearAllMocks());
it('resolves only the event ID using the session that rendered the controls', async () => {
  const item = {
    id: 17,
    target: { type: 'review', threadId: 8, messageId: 99 },
  };
  (httpService.get as jest.Mock).mockResolvedValue({
    success: true,
    data: item,
  });
  expect(await createSocialApi('original-session').inboxEvent(17)).toEqual(
    item,
  );
  expect(httpService.get).toHaveBeenCalledWith('/social/inbox/events/17', {
    headers: { Authorization: 'Bearer original-session' },
  });
});
it('rejects inaccessible events instead of returning a cached target', async () => {
  (httpService.get as jest.Mock)
    .mockResolvedValueOnce({ success: false, message: '通知已不可访问' })
    .mockResolvedValueOnce({ success: true, data: null });
  const api = createSocialApi('session');
  await expect(api.inboxEvent(17)).rejects.toThrow('通知已不可访问');
  await expect(api.inboxEvent(17)).rejects.toThrow('请求失败');
});
