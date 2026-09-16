import { useCallback, useMemo } from 'react';
import { useAuth } from '../providers';
import { useSocialResource } from '../screens/social/shared';
import { currentBusinessDate, getLedgerAnalytics, ledgerCell } from '../services/api/ledger';
import { httpService } from '../services/http';
import type { BillData } from '../types/bill';
import type { PaginatedResponse } from '../types/api';

export function useDailyGridData(year: number, month: number) {
  const { token } = useAuth();
  const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${lastDay}`;
  const query = useSocialResource(useCallback(() => getLedgerAnalytics(token || '', startDate, endDate), [token, startDate, endDate]));
  const dailyMap = useMemo(() => new Map(query.value?.daily.map(d => [d.date, ledgerCell(d)]) ?? []), [query.value]);
  return { dailyMap, summary: query.value?.summary, isLoading: query.loading, error: query.error, refetch: query.refresh };
}

export function useDailyBills(date: string | null) {
  const { token } = useAuth();
  const query = useSocialResource(useCallback(async () => {
    if (!date) return [];
    const bills: BillData[] = [];
    for (let page = 1; ; page++) {
      const res = await httpService.get('/bills', {
        params: { startDate: date, endDate: date, page, limit: 100, orderBy: 'date', orderDirection: 'desc' },
        headers: { Authorization: `Bearer ${token || ''}` },
      }) as PaginatedResponse<BillData>;
      if (!res.success || !res.data) throw new Error(res.message || '明细加载失败');
      if (!res.pagination || !Number.isFinite(res.pagination.totalPages)) throw new Error('明细分页信息缺失，请重试');
      bills.push(...res.data);
      if (page >= res.pagination.totalPages) return bills;
    }
  }, [token, date]));
  return { bills: query.value ?? [], isLoading: query.loading, error: query.error, refetch: query.refresh };
}

export function useMonthlyGridData(year: number) {
  const { token } = useAuth();
  const query = useSocialResource(useCallback(() => getLedgerAnalytics(token || '', `${year}-01-01`, `${year}-12-31`), [token, year]));
  const monthlyData = useMemo(() => query.value?.monthly.map(m => ({ month: Number(m.month.slice(5, 7)), ...ledgerCell(m) })) ?? [], [query.value]);
  return { monthlyData, summary: query.value?.summary, isLoading: query.loading, error: query.error, refetch: query.refresh };
}

export function useYearlyGridData() {
  const { token } = useAuth();
  const currentYear = currentBusinessDate().year;
  const query = useSocialResource(useCallback(() => Promise.all(Array.from({ length: 5 }, (_, i) => {
    const year = currentYear - 4 + i;
    return getLedgerAnalytics(token || '', `${year}-01-01`, `${year}-12-31`);
  })), [token, currentYear]));
  const yearlyData = useMemo(() => query.value?.map(r => ({ year: Number(r.summary.startDate.slice(0, 4)), ...ledgerCell(r.summary) })) ?? [], [query.value]);
  const getMonthlyDataForYear = (year: number) => query.value?.find(r => r.summary.startDate.startsWith(String(year)))?.monthly
    .map(m => ({ month: Number(m.month.slice(5, 7)), ...ledgerCell(m) })) ?? [];
  return { yearlyData, getMonthlyDataForYear, summaries: query.value?.map(r => r.summary), isLoading: query.loading, error: query.error, refetch: query.refresh };
}
