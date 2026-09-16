import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { PieChart } from '../charts';
import { SegmentedControl } from '../ui';
import { useStyles } from '../../hooks/useStyles';
import { stylesFor } from '../../screens/social/shared';
import type { CashHistory, LedgerFacts } from '../../services/api/ledger';
const colors = ['#0052FF', '#FF6B35', '#00C853', '#FF3D00', '#7C4DFF', '#FFB300', '#00BCD4', '#E91E63'];
export default function AssetCompositionChart({ categories, dateRange, totals, title = '近 12 月分类构成' }: { title?: string; totals: LedgerFacts; categories: CashHistory['categories']; dateRange: string }) {
  const s = useStyles(stylesFor);
  const [kind, setKind] = useState('grossExpense');
  const field = kind as 'grossExpense' | 'ordinaryIncome' | 'refundInflow';
  const rows = categories.filter(c => Number(c[field]) > 0);
  return <View style={s.card}>
    <Text style={s.heading}>{title}</Text>
    <Text style={s.small}>{dateRange} · 仅含已确认人民币记录</Text>
    <SegmentedControl options={[{ key: 'grossExpense', label: '消费' }, { key: 'ordinaryIncome', label: '收入' }, { key: 'refundInflow', label: '退款' }]} selectedKey={kind} onSelect={setKind} />
    <Text style={s.text}>已确认金额 ¥{Number(totals[field]).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</Text>
    {rows.length ? <PieChart data={rows.map((r, i) => ({ value: Number(r[field]), label: r.name || '未分类', color: colors[i % colors.length] }))} size={190} innerRadius={0.58} showLabels showLegend /> : <Text style={s.muted}>本范围暂无已确认的此类金额</Text>}
    {rows.map(r => <Text key={r.categoryId ?? 'uncategorized'} style={s.muted}>{r.name || '未分类'} · ¥{Number(r[field]).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</Text>)}
    <Text style={s.small}>收入不含退款。退款按自身分类展示，不抵减原消费分类。</Text>
  </View>;
}
