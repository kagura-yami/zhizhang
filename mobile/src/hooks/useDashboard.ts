import { useCallback } from 'react';
import { useAuth } from '../providers';
import { useSocialResource } from '../screens/social/shared';
import { ledgerCell } from '../services/api/ledger';
import { fetchDashboardData } from '../services/api/dashboard';


export function useDashboard() {
  const { token } = useAuth();
  const r = useSocialResource(useCallback(() => fetchDashboardData(token || ''), [token]));
  const month = r.value ? ledgerCell(r.value.analytics.summary) : null;
  const day = r.value ? ledgerCell(r.value.todayFacts) : null;
  return {
    data: r.value, analytics: r.value?.analytics, todayFacts: r.value?.todayFacts,
    recentBills: r.value?.recentBills ?? [], recentTotal: r.value?.recentTotal ?? 0,
    monthIncome: month?.income ?? 0, monthExpense: month?.expense ?? 0, monthBalance: month?.balance ?? 0,
    todayIncome: day?.income ?? 0, todayExpense: day?.expense ?? 0, todayBalance: day?.balance ?? 0,
    isLoading: r.loading, isFetching: r.loading, error: r.error, refetch: r.refresh,
  };
}
