import { httpService } from '../http';
import type { ApiResponse } from '../../types/api';
import type { SocialPerson } from './social';
export type RankingKind = 'day' | 'month' | 'year';
export type RankingScope = 'global' | 'friends';
export type FinancialKind =
  | 'ordinary'
  | 'refund'
  | 'internal_transfer'
  | 'adjustment'
  | 'ignored';
export interface RankingItem {
  user: SocialPerson;
  rank: number;
  position: number;
  effectiveDays: number;
  amount: string | null;
  amountHidden: boolean;
}
export interface RankingPage {
  items: RankingItem[];
  mine: RankingItem | null;
  myPage: number | null;
  mineStatus: string;
  myPendingCount: number;
  total: number;
  closed: boolean;
  page: number;
  pageSize: number;
}
export interface LedgerContext {
  id: number;
  amount: string;
  type: string;
  date: string;
  description: string | null;
  updatedAt: string;
  category: { name: string } | null;
  needsReview: boolean;
  canBeRefund: boolean;
  financialClassification: {
    kind: FinancialKind;
    currency: string;
    billUpdatedAt: string;
  } | null;
}
export interface PendingPage {
  items: {
    id: number;
    amount: string;
    type: string;
    date: string;
    description: string | null;
    category: string | null;
  }[];
  hasMore: boolean;
  nextAfterId: number;
}
export interface LedgerSummary {
  cashSurplus: string;
  ordinaryIncome: string;
  grossExpense: string;
  refundInflow: string;
  complete: boolean;
  counts: {
    included: number;
    needsReview: number;
    internalTransfer: number;
    adjustment: number;
    ignored: number;
  };
}
async function data<T>(request: Promise<ApiResponse<T>>) {
  const response = await request;
  if (!response.success || response.data == null)
    throw new Error(response.message || '请求失败，请重试');
  return response.data;
}
// Every request keeps the originating session, including confirmation dialogs and delayed requests.
export function createRankingApi(token: string) {
  const config = { headers: { Authorization: `Bearer ${token}` } };
  return {
    periods: (kind: RankingKind, page: number) =>
      data<{ items: { period: string; closed: boolean }[]; total: number }>(
        httpService.get(
          `/rankings/periods?kind=${kind}&page=${page}&pageSize=12`,
          config,
        ),
      ),
    ranking: (
      kind: RankingKind,
      period: string,
      scope: RankingScope,
      page: number,
    ) =>
      data<RankingPage>(
        httpService.get(
          `/rankings?kind=${kind}&period=${encodeURIComponent(
            period,
          )}&scope=${scope}&page=${page}&pageSize=20`,
          config,
        ),
      ),
    summary: (start: string, end: string) =>
      data<LedgerSummary>(
        httpService.get(
          `/ledger/summary?startDate=${start}&endDate=${end}`,
          config,
        ),
      ),
    pending: (start: string, end: string, afterId: number) =>
      data<PendingPage>(
        httpService.get(
          `/ledger/pending?startDate=${start}&endDate=${end}&afterId=${afterId}`,
          config,
        ),
      ),
    context: (id: number) =>
      data<LedgerContext>(httpService.get(`/ledger/bills/${id}`, config)),
    classify: (id: number, kind: FinancialKind, expectedUpdatedAt: string) =>
      data(
        httpService.put(
          `/ledger/bills/${id}/classification`,
          { kind, currency: 'CNY', expectedUpdatedAt },
          config,
        ),
      ),
  };
}

export function currentRankingPeriod(kind: RankingKind, now = new Date()) {
  return new Date(now.getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, kind === 'day' ? 10 : kind === 'month' ? 7 : 4);
}
export function rankingDates(kind: RankingKind, period: string) {
  const startDate =
    kind === 'day'
      ? period
      : kind === 'month'
      ? `${period}-01`
      : `${period}-01-01`;
  const next = new Date(`${startDate}T00:00:00Z`);
  if (kind === 'day') next.setUTCDate(next.getUTCDate() + 1);
  else if (kind === 'month') next.setUTCMonth(next.getUTCMonth() + 1);
  else next.setUTCFullYear(next.getUTCFullYear() + 1);
  return {
    startDate,
    endDate: new Date(next.getTime() - 86400000).toISOString().slice(0, 10),
  };
}
