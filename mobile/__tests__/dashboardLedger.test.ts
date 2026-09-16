jest.mock('../src/services/http', () => ({ httpService: { get: jest.fn() } }));
jest.mock('../src/services/api/ledger', () => ({ ...jest.requireActual('../src/services/api/ledger'), getLedgerAnalytics: jest.fn() }));
import { httpService } from '../src/services/http';
import { getLedgerAnalytics } from '../src/services/api/ledger';
import { fetchDashboardData } from '../src/services/api/dashboard';

beforeEach(() => { jest.clearAllMocks(); jest.useFakeTimers().setSystemTime(new Date('2026-12-31T16:30:00Z')); });
afterEach(() => jest.useRealTimers());
it('uses a full UTC+8 calendar month and server facts independent of the 100 recent raw rows', async () => {
  const facts = { date: '2027-01-01', ordinaryIncome: '1000.0000', grossExpense: '118.0000', refundInflow: '50.0000', cashSurplus: '932.0000' };
  (getLedgerAnalytics as jest.Mock).mockResolvedValue({ summary: facts, daily: [facts] });
  (httpService.get as jest.Mock).mockResolvedValue({ success: true, data: Array.from({ length: 100 }, (_, id) => ({ id, amount: 9999 })), pagination: { total: 506 } });
  const data = await fetchDashboardData('original-account');
  expect(getLedgerAnalytics).toHaveBeenCalledWith('original-account', '2027-01-01', '2027-01-31');
  expect(httpService.get).toHaveBeenCalledWith('/bills', { params: { startDate: '2027-01-01', endDate: '2027-01-31', limit: 100, page: 1, orderBy: 'date', orderDirection: 'desc' }, headers: { Authorization: 'Bearer original-account' } });
  expect(data.today.key).toBe('2027-01-01');
  expect(data.analytics.summary.cashSurplus).toBe('932.0000');
  expect(data.recentBills).toHaveLength(100);
  expect(data.recentTotal).toBe(506);
});
it('rejects failed raw bill data or missing daily facts instead of displaying false zero', async () => {
  (getLedgerAnalytics as jest.Mock).mockResolvedValue({ daily: [] });
  (httpService.get as jest.Mock).mockResolvedValueOnce({ success: false, message: '账单不可用' }).mockResolvedValueOnce({ success: true, data: [], pagination: { total: 0 } });
  await expect(fetchDashboardData('session')).rejects.toThrow('账单不可用');
  await expect(fetchDashboardData('session')).rejects.toThrow('今日账务汇总缺失');
});
