import React from 'react';
import { Text, View } from 'react-native';
import { Status, stylesFor } from '../social/shared';
import { useStyles } from '../../hooks/useStyles';
import type { LedgerFacts } from '../../services/api/ledger';
export default function LedgerNotice({ summary, error, loading, refresh }: {
  gridHint?: boolean; summary?: LedgerFacts; error: string; loading: boolean; refresh: () => void;
}) {
  const s = useStyles(stylesFor);
  return <View style={{marginHorizontal:16,gap:8}}>
    <Status error={error} loading={loading} refresh={refresh} />
    {summary && Number(summary.refundInflow)>0 && <Text style={s.muted}>本周期退款 ¥{Number(summary.refundInflow).toFixed(2)}</Text>}
  </View>;
}
