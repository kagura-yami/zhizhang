export type AnalysisPeriod = 'month' | 'lastMonth' | 'quarter' | 'year';
// Use UTC+8 business-calendar fields; Date.UTC handles January and leap-year rollover.
export function analysisRange(period: AnalysisPeriod, now = new Date()) {
  const local = new Date(now.getTime() + 8 * 3600000);
  const year = local.getUTCFullYear(), month = local.getUTCMonth();
  const firstMonth = period === 'year' ? 0 : period === 'quarter' ? Math.floor(month / 3) * 3 : period === 'lastMonth' ? month - 1 : month;
  const span = period === 'year' ? 12 : period === 'quarter' ? 3 : 1;
  return { startDate: new Date(Date.UTC(year, firstMonth, 1)).toISOString().slice(0, 10), endDate: new Date(Date.UTC(year, firstMonth + span, 0)).toISOString().slice(0, 10) };
}
export function expenseIncomeRatio(income: string, expense: string, complete: boolean) {
  if (!complete || Number(income) <= 0) return null;
  return Number(expense) / Number(income) * 100;
}
