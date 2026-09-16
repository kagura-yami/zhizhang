import { httpService } from '../http';
import type { ApiResponse } from '../../types/api';
export type ReviewKind = 'day' | 'month';
export function defaultReviewPeriod(kind: ReviewKind, now = new Date()) {
  const today = new Date(now.getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 10);
  const date = new Date(`${today}T00:00:00Z`);
  if (kind === 'day') date.setUTCDate(date.getUTCDate() - 1);
  else {
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() - 1);
  }
  return date.toISOString().slice(0, kind === 'day' ? 10 : 7);
}
export interface ReviewJob {
  id: string;
  kind: ReviewKind;
  period: string;
  status:
    | 'queued'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'invalidated'
    | 'deleted';
  attempts: number;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface ReviewReference {
  ref: string;
  kind: 'bill' | 'message' | 'vote';
  id: number;
  threadId?: number;
}
export interface ReviewDetail extends ReviewJob {
  sourceChanged: boolean;
  result: null | {
    generatedAt: string;
    provider: string;
    model: string;
    references: ReviewReference[];
    report: {
      facts: {
        ordinaryIncome: string;
        grossExpense: string;
        refundInflow: string;
        cashSurplus: string;
        complete: boolean;
        counts: {
          total: number;
          included: number;
          needsReview: number;
          internalTransfer: number;
          adjustment: number;
          ignored: number;
        };
      };
      gaps: string[];
      friendViews: { ref: string; quote: string; author: string }[];
      analysis: { text: string; citations: string[] }[];
      actions: { text: string; citations: string[] }[];
      budgets: {
        period: string;
        startDate: string;
        endDate: string;
        coverage: string;
        changedBudgetCount: number;
        comparisons: {
          name: string;
          amount: string;
          grossExpense: string;
          complete: boolean;
          overBudget: boolean | null;
        }[];
      }[];
    };
  };
}
export interface ReviewModel {
  id: number;
  name: string;
  model: string;
  isDefault: boolean;
}
async function data<T>(request: Promise<ApiResponse<T>>) {
  const response = await request;
  if (!response.success || response.data == null)
    throw new Error(response.message || '请求失败，请重试');
  return response.data;
}
export function createRetrospectiveApi(token: string) {
  const config = {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 70000,
  };
  return {
    list: (page: number) =>
      data<{ items: ReviewJob[]; total: number }>(
        httpService.get('/ai/retrospectives', {
          ...config,
          params: { page, pageSize: 10 },
        }),
      ),
    detail: (id: string) =>
      data<ReviewDetail>(httpService.get(`/ai/retrospectives/${id}`, config)),
    create: (body: {
      clientKey: string;
      kind: ReviewKind;
      period: string;
      configId: number;
    }) => data<ReviewJob>(httpService.post('/ai/retrospectives', body, config)),
    retry: (id: string) =>
      data<ReviewJob>(
        httpService.post(`/ai/retrospectives/${id}/retry`, {}, config),
      ),
    remove: (id: string) =>
      data<{ deleted: boolean }>(
        httpService.delete(`/ai/retrospectives/${id}`, config),
      ),
    models: () => data<ReviewModel[]>(httpService.get('/ai/configs', config)),
  };
}
