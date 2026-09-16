jest.mock('../src/services/http', () => ({ httpService: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
import { httpService } from '../src/services/http';
import { createBudgetApi } from '../src/services/api/budgets';

const api = createBudgetApi('origin-session');
const config = { headers: { Authorization: 'Bearer origin-session' } };
beforeEach(() => jest.clearAllMocks());
it('does not turn a failed or malformed budget response into an empty list', async () => {
  (httpService.get as jest.Mock).mockResolvedValueOnce({ success: false, message: '加载失败' }).mockResolvedValueOnce({ success: true });
  await expect(api.progress()).rejects.toThrow('加载失败');
  await expect(api.progress()).rejects.toThrow('预算加载失败');
  expect(httpService.get).toHaveBeenCalledWith('/budgets/ledger-progress', config);
});
it('preserves explicit zero amount and clears category while pinning write authentication', async () => {
  (httpService.patch as jest.Mock).mockResolvedValue({ count: 1 });
  await api.update(9, { amount: 0, categoryId: null });
  expect(httpService.patch).toHaveBeenCalledWith('/budgets/9', { amount: 0, categoryId: null }, config);
  (httpService.post as jest.Mock).mockResolvedValue({ id: 10 });
  await api.create({ name: '零预算', amount: 0, period: 'monthly' });
  expect(httpService.post).toHaveBeenCalledWith('/budgets', { name: '零预算', amount: 0, period: 'monthly' }, config);
});
it('does not report successful update/deletion when a budget has disappeared', async () => {
  (httpService.patch as jest.Mock).mockResolvedValue({ count: 0 });
  (httpService.delete as jest.Mock).mockResolvedValue({ count: 0 });
  await expect(api.update(9, { amount: 1 })).rejects.toThrow('预算已不存在');
  await expect(api.remove(9)).rejects.toThrow('预算已不存在');
  expect(httpService.delete).toHaveBeenCalledWith('/budgets/9', config);
});
