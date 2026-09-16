import { rankingKeys, rankingPeriod } from './ranking-period';

describe('UTC+8 ranking periods', () => {
  it('crosses the day/month/year at 16:00 UTC', () => {
    expect(rankingKeys(new Date('2026-12-31T15:59:59Z'))).toEqual({ day: '2026-12-31', month: '2026-12', year: '2026' });
    expect(rankingKeys(new Date('2026-12-31T16:00:00Z'))).toEqual({ day: '2027-01-01', month: '2027-01', year: '2027' });
  });
  it('covers leap years without a timezone conversion of database dates', () => {
    expect(rankingPeriod('month', '2028-02').end.toISOString()).toBe('2028-02-29T00:00:00.000Z');
    expect(rankingPeriod('year', '2028').end.toISOString()).toBe('2028-12-31T00:00:00.000Z');
  });
  it('rejects malformed and nonexistent dates', () => {
    for (const [kind, key] of [['day', '2026-02-29'], ['month', '2026-13'], ['year', '2026-01'], ['day', '2026-9-1']] as const) {
      expect(() => rankingPeriod(kind, key)).toThrow();
    }
  });
});
