import { httpService } from '../http';
import type { LedgerSummary } from './rankings';
export interface LedgerFacts extends LedgerSummary {
  startDate: string; endDate: string; ruleVersion: string;
  counts: LedgerSummary['counts'] & { total: number };
}
export interface LedgerAnalytics {
  summary: LedgerFacts;
  daily: Array<LedgerFacts & { date: string }>;
  monthly: Array<LedgerFacts & { month: string }>;
  categories: Array<LedgerFacts & { categoryId: number | null; name: string | null }>;
}
export interface LedgerCell {
  income: number; expense: number; refund: number; balance: number; pending: number; total: number;
}
// Numbers are chart coordinates/display values; aggregation remains server-side Decimal.
export const ledgerCell = (facts: LedgerFacts): LedgerCell => ({
  income: Number(facts.ordinaryIncome), expense: Number(facts.grossExpense),
  refund: Number(facts.refundInflow), balance: Number(facts.cashSurplus),
  pending: facts.counts.needsReview, total: facts.counts.total,
});
export function currentBusinessDate() {
  const key = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  return { key, year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) - 1 };
}
export async function getLedgerAnalytics(token: string, startDate: string, endDate: string) {
  const response = await httpService.get<LedgerAnalytics>(
    `/ledger/analytics?startDate=${startDate}&endDate=${endDate}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.success || !response.data) throw new Error(response.message || '统计加载失败，请重试');
  return response.data;
}
