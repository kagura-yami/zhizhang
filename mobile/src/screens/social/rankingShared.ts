import { useMemo } from 'react';
import { useAuth } from '../../providers';
import { createRankingApi } from '../../services/api/rankings';
export function useRankingApi() {
  const { token } = useAuth();
  return useMemo(() => createRankingApi(token || ''), [token]);
}
export const kindLabels = { day: '日榜', month: '月榜', year: '年榜' };
export const scopeLabels = {
  none: '不参与',
  friends: '仅好友',
  global: '全站',
};
export const financialLabels = {
  ordinary: '普通收支',
  refund: '退款',
  internal_transfer: '内部转账',
  adjustment: '调账',
  ignored: '误记 / 忽略',
};
export const moneyText = (amount: string) =>
  amount.replace(/(\.\d{2})0+$/, '$1');
