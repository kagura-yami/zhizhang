import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { useAuth, useTheme } from '../../providers';
import { useStyles } from '../../hooks/useStyles';
import { SegmentedControl } from '../../components/ui';
import { LineChart } from '../../components/charts';
import { useSocialResource, Status, stylesFor } from '../social/shared';
import LedgerNotice from '../reports/LedgerNotice';
import AssetCompositionChart from '../../components/reports/AssetCompositionChart';
import { analysisRange, expenseIncomeRatio, AnalysisPeriod } from '../../services/api/analysis';
import { getLedgerAnalytics } from '../../services/api/ledger';

export default function StatisticsScreen() {
  const { token } = useAuth();
  return <StatisticsContent key={token || 'signed-out'} token={token || ''} />;
}
function StatisticsContent({ token }: { token: string }) {
  const s = useStyles(stylesFor), { colors } = useTheme();
  const [period, setPeriod] = useState<AnalysisPeriod>('month');
  const [width, setWidth] = useState(240);
  const r = useSocialResource(useCallback(() => {
    const range = analysisRange(period);
    return getLedgerAnalytics(token, range.startDate, range.endDate);
  }, [token, period]));
  const facts = r.value?.summary;
  const useDays = period === 'month' || period === 'lastMonth';
  const trend = useDays ? r.value?.daily.map(d => ({ label: d.date.slice(8), value: Number(d.grossExpense) })) : r.value?.monthly.map(m => ({ label: m.month.slice(5), value: Number(m.grossExpense) }));
  const ratio = facts && expenseIncomeRatio(facts.ordinaryIncome, facts.grossExpense, facts.complete);
  return <ScrollView style={s.screen} contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={r.loading} onRefresh={r.refresh} />}>
    <Text style={s.title}>分类与季度分析</Text>
    <SegmentedControl options={[{key:'month',label:'本月'}, {key:'lastMonth',label:'上月'}, {key:'quarter',label:'季度'}, {key:'year',label:'年度'}]} selectedKey={period} onSelect={key => setPeriod(key as AnalysisPeriod)} />
    <Text style={s.muted}>按 UTC+8 完整自然周期统计，包含周期内已录入的未来日期。</Text>
    <Status loading={r.loading} error={r.error} refresh={r.refresh} />
    {r.value && facts && <>
      <View style={s.card}>
        <Text style={s.heading}>{facts.startDate} 至 {facts.endDate}</Text>
        <Text style={s.text}>普通收入 ¥{Number(facts.ordinaryIncome).toFixed(2)}{'\n'}消费 ¥{Number(facts.grossExpense).toFixed(2)}{'\n'}退款 ¥{Number(facts.refundInflow).toFixed(2)}{'\n'}结余 ¥{Number(facts.cashSurplus).toFixed(2)}</Text>
        <Text style={s.muted}>{ratio == null ? !facts.complete ? '消费 / 普通收入：有异常账单，暂不计算比例' : '消费 / 普通收入：收入为零，比例无定义' : `消费 / 普通收入：${ratio.toFixed(1)}%`}</Text>
      </View>
      <LedgerNotice gridHint={false} summary={facts} error="" loading={false} refresh={r.refresh} />
      <AssetCompositionChart title="本周期分类构成" categories={r.value.categories} totals={facts} dateRange={`${facts.startDate} 至 ${facts.endDate}`} />
      <View style={s.card}>
        <Text style={s.heading}>{useDays ? '每日消费趋势' : '月度消费趋势'}</Text>
        <Text style={s.muted}>仅含当前选择周期内的支出；退款单列，不抵减消费。</Text>
        {trend?.some(t => t.value > 0) ? <View onLayout={e => setWidth(e.nativeEvent.layout.width)}>
          <LineChart width={width} data={trend || []} height={200} lineColor={colors.expense} dotColor={colors.expense} formatValue={v => `¥${v.toFixed(0)}`} />
        </View> : <Text style={s.muted}>本周期暂无支出</Text>}
        {r.value.monthly.map(m => <Text key={m.month} style={s.muted}>{m.month} · 消费 ¥{Number(m.grossExpense).toFixed(2)} · 退款 ¥{Number(m.refundInflow).toFixed(2)}{!m.complete ? ` · ${m.counts.needsReview} 笔异常` : ''}</Text>)}
      </View>
    </>}
  </ScrollView>;
}
