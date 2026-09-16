import { currentBusinessDate, getLedgerAnalytics } from './ledger';
import { httpService } from '../http';
import type { BillData } from '../../types/bill';
import type { PaginatedResponse } from '../../types/api';

export async function fetchDashboardData(token: string) {
  const today = currentBusinessDate();
  const month = today.key.slice(0, 7);
  const startDate = `${month}-01`;
  const endDate = `${month}-${new Date(Date.UTC(today.year, today.month + 1, 0)).getUTCDate()}`;
  const [analytics, response] = await Promise.all([
    getLedgerAnalytics(token, startDate, endDate),
    httpService.get('/bills', {
      params: { startDate, endDate, limit: 100, page: 1, orderBy: 'date', orderDirection: 'desc' },
      headers: { Authorization: `Bearer ${token}` },
    }) as Promise<PaginatedResponse<BillData>>,
  ]);
  if (!response.success || !Array.isArray(response.data) || !response.pagination) throw new Error(response.message || '近期账单加载失败');
  const day = analytics.daily.find(d => d.date === today.key);
  if (!day) throw new Error('今日账务汇总缺失，请重试');
  return { analytics, today, todayFacts: day, recentBills: response.data, recentTotal: response.pagination.total };
}
