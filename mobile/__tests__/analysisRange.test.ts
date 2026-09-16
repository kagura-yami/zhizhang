import { analysisRange, expenseIncomeRatio } from '../src/services/api/analysis';

it('selects January in UTC+8 and rolls last month back into the previous year', () => {
  const now = new Date('2026-12-31T16:00:00Z');
  expect(analysisRange('month', now)).toEqual({ startDate: '2027-01-01', endDate: '2027-01-31' });
  expect(analysisRange('lastMonth', now)).toEqual({ startDate: '2026-12-01', endDate: '2026-12-31' });
});
it('uses whole quarters and leap years without overflowing February', () => {
  expect(analysisRange('lastMonth', new Date('2028-03-31T00:00:00Z'))).toEqual({ startDate: '2028-02-01', endDate: '2028-02-29' });
  expect(analysisRange('quarter', new Date('2028-11-12T00:00:00Z'))).toEqual({ startDate: '2028-10-01', endDate: '2028-12-31' });
  expect(analysisRange('year', new Date('2028-02-29T00:00:00Z'))).toEqual({ startDate: '2028-01-01', endDate: '2028-12-31' });
});
it('does not invent a denominator for zero income or compare incomplete totals', () => {
  expect(expenseIncomeRatio('0.0000', '118.0000', true)).toBeNull();
  expect(expenseIncomeRatio('1000.0000', '118.0000', false)).toBeNull();
  expect(expenseIncomeRatio('100.0000', '200.0000', true)).toBe(200);
  expect(expenseIncomeRatio('100.0000', '0.0000', true)).toBe(0);
});
