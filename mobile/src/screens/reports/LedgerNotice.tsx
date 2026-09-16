import React from 'react';
import { Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Action, Status, stylesFor } from '../social/shared';
import { useStyles } from '../../hooks/useStyles';
import type { LedgerFacts } from '../../services/api/ledger';
export default function LedgerNotice({ summary, error, loading, refresh }: {
  summary?: LedgerFacts; error: string; loading: boolean; refresh: () => void;
}) {
  const s = useStyles(stylesFor), navigation = useNavigation<any>();
  return <View style={{ margin: 16, gap: 8 }}>
    <Status error={error} loading={loading} refresh={refresh} />
    <Text style={s.muted}>已确认人民币口径：结余 = 普通收入 + 退款 − 消费。转账、调账和忽略项不计入；明细仍显示原始账单。</Text>
    {summary && <>
      <Text style={s.text}>本周期退款 ¥{Number(summary.refundInflow).toFixed(2)} · 结余 ¥{Number(summary.cashSurplus).toFixed(2)}</Text>
      <Text style={s.muted}>{summary.counts.included} 笔计入 · {summary.counts.internalTransfer} 笔内部转账 · {summary.counts.adjustment} 笔调账 · {summary.counts.ignored} 笔忽略</Text>
      {!summary.complete && <>
        <Text style={s.error}>还有 {summary.counts.needsReview} 笔待确认，当前金额不完整。格内“待”表示该周期有待确认账单。</Text>
        <Action title="核对本周期账单" onPress={() => navigation.navigate('LedgerReview', { startDate: summary.startDate, endDate: summary.endDate })} />
      </>}
    </>}
  </View>;
}
