jest.mock('../src/services/http', () => ({
  httpService: {
    get: jest.fn(),
    put: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));
import { createSocialApi } from '../src/services/api/social';
import { httpService } from '../src/services/http';

describe('social session ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it('keeps a pending action bound to the account that created it', async () => {
    const put = httpService.put as jest.Mock;
    put.mockResolvedValue({ success: true, data: { following: true } });
    const firstAccount = createSocialApi('first-test-session');
    const delayedAction = () => firstAccount.follow('person-id', true);
    const secondAccount = createSocialApi('second-test-session');
    await secondAccount.follow('person-id', true);
    await delayedAction();
    expect(put.mock.calls.map(call => call[2].headers.Authorization)).toEqual([
      'Bearer second-test-session',
      'Bearer first-test-session',
    ]);
  });
  it('does not turn a rejected or incomplete response into successful data', async () => {
    const get = httpService.get as jest.Mock;
    get.mockResolvedValueOnce({ success: false, message: '授权已撤销' });
    await expect(createSocialApi('test').grants('person')).rejects.toThrow(
      '授权已撤销',
    );
    get.mockResolvedValueOnce({ success: true });
    await expect(createSocialApi('test').status()).rejects.toThrow('请求失败');
  });
});
