jest.mock('../src/services/http', () => ({ httpService: { get: jest.fn() } }));
import { httpService } from '../src/services/http';
import { currentBusinessDate, getLedgerAnalytics, ledgerCell } from '../src/services/api/ledger';

afterEach(() => jest.useRealTimers());
it('keeps refunds separate and uses server cash surplus, not income minus expense', () => {
  const row = ledgerCell({ ordinaryIncome: '1000.0000', grossExpense: '118.0000', refundInflow: '50.0000', cashSurplus: '932.0000',
    complete: false, counts: { total: 110, included: 3, needsReview: 105, internalTransfer: 1, adjustment: 0, ignored: 1 },
    startDate: '2026-09-01', endDate: '2026-09-30', ruleVersion: 'test' });
  expect(row).toEqual({ income: 1000, expense: 118, refund: 50, balance: 932, pending: 105, total: 110 });
});
it('uses the UTC+8 business date across year boundaries', () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-12-31T16:00:00Z'));
  expect(currentBusinessDate()).toEqual({ key: '2027-01-01', year: 2027, month: 0 });
});
it('binds the request to its originating session and rejects failed payloads', async () => {
  const get = httpService.get as jest.Mock;
  get.mockResolvedValueOnce({ success: false, message: '统计不可用' });
  await expect(getLedgerAnalytics('synthetic-session', '2026-09-01', '2026-09-30')).rejects.toThrow('统计不可用');
  expect(get).toHaveBeenLastCalledWith('/ledger/analytics?startDate=2026-09-01&endDate=2026-09-30', { headers: { Authorization: 'Bearer synthetic-session' } });
});
