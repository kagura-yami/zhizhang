import React, { useState } from 'react';
import { View, Text, ScrollView, RefreshControl, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../providers';
import { useStyles } from '../../hooks/useStyles';
import { useAssetsData } from '../../hooks/useAssetsData';
import { Action, Status, stylesFor } from '../social/shared';
import AssetTrendChart from '../../components/reports/AssetTrendChart';
import AssetCompositionChart from '../../components/reports/AssetCompositionChart';
import type { CashHistory } from '../../services/api/ledger';
const money = (value: string) => `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

export default function AssetsTab() {
  const { token } = useAuth();
  return <AssetsContent key={token || 'signed-out'} />;
}
function AssetsContent() {
  const r = useAssetsData(), s = useStyles(stylesFor);
  return <ScrollView style={s.screen} contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={r.loading} onRefresh={r.refresh} />}>
    <Text style={s.title}>账本累计结余</Text>
    <Text style={s.muted}>累计普通收入 + 退款 − 消费。未包含期初资产和负债，不能代表真实净资产或账户余额。</Text>
    <Status loading={r.loading} error={r.error} refresh={r.refresh} />
    {r.value && <HistoryContent data={r.value} />}
  </ScrollView>;
}
function HistoryContent({ data }: { data: CashHistory }) {
  const s = useStyles(stylesFor), navigation = useNavigation<any>();
  const [expanded, setExpanded] = useState(false);
  const firstYear = Number(data.summary.startDate.slice(0, 4)), lastYear = Number(data.summary.endDate.slice(0, 4));
  const [reviewYear, setReviewYear] = useState(String(lastYear));
  const year = Number(reviewYear);
  const validYear = /^\d{4}$/.test(reviewYear) && year >= firstYear && year <= lastYear;
  const review = (startDate: string, endDate: string) => navigation.navigate('LedgerReview', { startDate, endDate });
  return <>
    <View style={[s.card, { backgroundColor: '#1D4ED8' }]}>
      <Text style={[s.heading, { color: '#FFFFFF' }]}>{data.summary.complete ? '已确认累计结余' : '已确认部分累计结余'}</Text>
      <Text selectable style={{ color: '#FFFFFF', fontSize: 30, fontWeight: '800' }}>{money(data.summary.cashSurplus)}</Text>
      <Text style={[s.small, { color: '#FFFFFF' }]}>{data.summary.startDate} 至 {data.summary.endDate} · UTC+8</Text>
      <Text style={[s.text, { color: '#FFFFFF' }]}>普通收入 {money(data.summary.ordinaryIncome)}{'\n'}退款流入 {money(data.summary.refundInflow)}{'\n'}消费 {money(data.summary.grossExpense)}</Text>
    </View>
    <Text style={s.muted}>截至本月末，包含本月已录入的未来日期；之后月份的记录不计入。内部转账、调账和忽略项排除。</Text>
    <Text style={s.small}>共 {data.summary.counts.total} 笔 · {data.summary.counts.included} 笔计入 · {data.summary.counts.internalTransfer} 笔转账 · {data.summary.counts.adjustment} 笔调账 · {data.summary.counts.ignored} 笔忽略</Text>
    {!data.summary.complete && <View style={s.card}>
      <Text style={s.error}>{data.summary.counts.needsReview} 笔待核对，累计结余不完整。</Text>
      <Text style={s.muted}>其中 {data.opening.counts.needsReview} 笔早于近 12 个月。按年份核对，历史记录不会遗漏。</Text>
      <Text style={s.text}>核对年份（{firstYear}–{lastYear}）</Text>
      <TextInput accessibilityLabel="核对年份" style={s.input} value={reviewYear} onChangeText={setReviewYear} maxLength={4} keyboardType="number-pad" />
      {!validYear && <Text style={s.error}>请输入上述范围内的四位年份</Text>}
      <View style={{ gap: 8 }}>
        <Action title="选择最早年份" onPress={() => setReviewYear(String(firstYear).padStart(4, '0'))} />
        <Action title="核对这一年" disabled={!validYear} onPress={() => review(`${reviewYear}-01-01`, year === lastYear ? data.summary.endDate : `${reviewYear}-12-31`)} />
      </View>
    </View>}
    <AssetTrendChart monthly={data.monthly} />
    <Action title={expanded ? '收起月度明细' : '展开月度明细'} onPress={() => setExpanded(v => !v)} />
    {expanded && data.monthly.map(m => <View style={s.card} key={m.month}>
      <Text style={s.heading}>{m.month}</Text>
      <Text style={s.text}>累计 {money(m.cumulativeCashSurplus)}{'\n'}本月结余 {money(m.cashSurplus)} · 退款 {money(m.refundInflow)}</Text>
      {!m.cumulativeComplete && <Text style={s.error}>累计 {m.cumulativeNeedsReview} 笔待核对（本月 {m.counts.needsReview} 笔）</Text>}
      {!!m.counts.needsReview && <Action title={`核对 ${m.month}`} onPress={() => review(m.startDate, m.endDate)} />}
    </View>)}
    <AssetCompositionChart totals={data.window} categories={data.categories} dateRange={`${data.window.startDate} 至 ${data.window.endDate}`} />
  </>;
}
