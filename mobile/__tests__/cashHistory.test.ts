jest.mock('../src/services/http', () => ({ httpService: { get: jest.fn() } }));
import { httpService } from '../src/services/http';
import { getCashHistory } from '../src/services/api/ledger';
it('binds history to the originating session and preserves server cumulative precision and incomplete history', async () => {
  const data = { summary: { cashSurplus: '870.0002', complete: false }, monthly: [{ month: '2026-09', cumulativeCashSurplus: '870.0002', cumulativeNeedsReview: 502, cumulativeComplete: false }] };
  (httpService.get as jest.Mock).mockResolvedValue({ success: true, data });
  expect(await getCashHistory('origin-account')).toEqual(data);
  expect(httpService.get).toHaveBeenCalledWith('/ledger/cash-history', { headers: { Authorization: 'Bearer origin-account' } });
});
it('rejects failed and missing history rather than reporting zero assets', async () => {
  (httpService.get as jest.Mock).mockResolvedValueOnce({ success: false, message: '历史不可用' }).mockResolvedValueOnce({ success: true });
  await expect(getCashHistory('session')).rejects.toThrow('历史不可用');
  await expect(getCashHistory('session')).rejects.toThrow('累计结余加载失败');
});
