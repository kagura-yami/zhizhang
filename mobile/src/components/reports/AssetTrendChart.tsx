import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { LineChart } from '../charts';
import { useStyles } from '../../hooks/useStyles';
import { stylesFor } from '../../screens/social/shared';
import { useTheme } from '../../providers';
import type { CashHistory } from '../../services/api/ledger';

export default function AssetTrendChart({ monthly }: { monthly: CashHistory['monthly'] }) {
  const s = useStyles(stylesFor), { colors } = useTheme();
  const [width, setWidth] = useState(240);
  return <View style={s.card}>
    <Text style={s.heading}>近 12 月累计结余</Text>
    <Text style={s.muted}>按当前账单与确认状态重建，包含更早历史，不是当时保存的余额快照。</Text>
    {monthly.some(m => !m.cumulativeComplete) && <Text style={s.error}>存在异常历史数据，折线仅代表已记录部分。空月份也可能继承历史异常状态。</Text>}
    <View onLayout={e => setWidth(e.nativeEvent.layout.width)}>
      <LineChart data={monthly.map(m => ({ label: m.month.slice(5), value: Number(m.cumulativeCashSurplus) }))} width={width} height={210} lineColor={colors.primary} dotColor={colors.primary} formatValue={v => `¥${v.toFixed(0)}`} />
    </View>
    <Text style={s.small}>{monthly[0]?.month} 至 {monthly[monthly.length - 1]?.month} · 横轴为月份</Text>
  </View>;
}
