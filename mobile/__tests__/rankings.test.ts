jest.mock('../src/services/http', () => ({
  httpService: { get: jest.fn(), put: jest.fn() },
}));
import {
  createRankingApi,
  currentRankingPeriod,
  rankingDates,
} from '../src/services/api/rankings';
import { httpService } from '../src/services/http';

describe('ranking dates and confirmation ownership', () => {
  it('uses UTC+8 and includes the leap day', () => {
    expect(currentRankingPeriod('day', new Date('2026-12-31T16:00:00Z'))).toBe(
      '2027-01-01',
    );
    expect(
      currentRankingPeriod('month', new Date('2026-12-31T15:59:59Z')),
    ).toBe('2026-12');
    expect(rankingDates('month', '2028-02')).toEqual({
      startDate: '2028-02-01',
      endDate: '2028-02-29',
    });
    expect(rankingDates('year', '2028')).toEqual({
      startDate: '2028-01-01',
      endDate: '2028-12-31',
    });
  });
  it('keeps delayed classification bound to the original session and revision', async () => {
    const put = httpService.put as jest.Mock;
    put.mockResolvedValue({ success: true, data: {} });
    const first = createRankingApi('first-session'),
      second = createRankingApi('second-session');
    await second.classify(22, 'ignored', '2026-09-16T00:00:00Z');
    await first.classify(11, 'internal_transfer', '2026-09-15T00:00:00Z');
    expect(put.mock.calls[1]).toEqual([
      '/ledger/bills/11/classification',
      {
        kind: 'internal_transfer',
        currency: 'CNY',
        expectedUpdatedAt: '2026-09-15T00:00:00Z',
      },
      { headers: { Authorization: 'Bearer first-session' } },
    ]);
  });
});
