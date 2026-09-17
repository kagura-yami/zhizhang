/**
 * 首页收支图表：日视图使用折线图，月视图使用扇形图，年视图使用柱状图。
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { BarChart, LineChart, PieChart } from '../charts';
import { SegmentedControl } from '../ui';
import { useYearlyGridData } from '../../hooks/useIncomeExpenseData';
import { useStyles } from '../../hooks/useStyles';
import { borderRadius, borderWidth, shadow, spacing } from '../../theme';
import type { LedgerAnalytics } from '../../services/api/ledger';
import { Status } from '../../screens/social/shared';

type ChartPeriod = 'daily' | 'monthly' | 'yearly';

interface HomeChartsProps {
  analytics: LedgerAnalytics;
}

const CATEGORY_COLORS = ['#FF6B6B', '#FFD93D', '#7EB6FF', '#7DCEA0', '#C5A3FF', '#FFB366', '#E17055', '#45B7D1'];

export default function HomeCharts({ analytics }: HomeChartsProps) {
  const styles = useStyles(createStyles);
  const [chartWidth, setChartWidth] = useState(240);
  const [period, setPeriod] = useState<ChartPeriod>('daily');

  const dailyExpense = useMemo(() => analytics.daily.map((item) => ({
    label: item.date.slice(8),
    value: Number(item.grossExpense) || 0,
  })), [analytics]);
  const dailyIncome = useMemo(() => analytics.daily.map((item) => ({
    label: item.date.slice(8),
    value: Number(item.ordinaryIncome) || 0,
  })), [analytics]);
  const expenseCategories = useMemo(() => analytics.categories
    .filter((item) => Number(item.grossExpense) > 0)
    .map((item, index) => ({
      value: Number(item.grossExpense),
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
      label: item.name || '未分类',
    })), [analytics]);

  const renderChart = () => {
    if (period === 'daily') {
      return (
        <>
          <Text style={styles.chartSubtitle}>本月每日支出</Text>
          {dailyExpense.length > 0 ? (
            <LineChart width={chartWidth} data={dailyExpense} height={175} lineColor={styles._colors.expense} dotColor={styles._colors.expense} formatValue={(value) => `¥${value.toFixed(0)}`} />
          ) : <Text style={styles.emptyText}>本月暂无支出趋势</Text>}
          <Text style={styles.chartSubtitle}>本月每日收入</Text>
          {dailyIncome.length > 0 ? (
            <LineChart width={chartWidth} data={dailyIncome} height={175} lineColor={styles._colors.income} dotColor={styles._colors.income} formatValue={(value) => `¥${value.toFixed(0)}`} />
          ) : <Text style={styles.emptyText}>本月暂无收入趋势</Text>}
        </>
      );
    }

    if (period === 'monthly') {
      return expenseCategories.length > 0 ? (
        <PieChart data={expenseCategories} size={190} innerRadius={0.58} showLabels showLegend />
      ) : <Text style={styles.emptyText}>本月暂无支出</Text>;
    }

    return <AnnualCharts width={chartWidth} />;
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>📊 收支图表</Text>
        <Text style={styles.hint}>首页展示</Text>
      </View>
      <SegmentedControl
        options={[{ key: 'daily', label: '每日' }, { key: 'monthly', label: '本月分类' }, { key: 'yearly', label: '年度' }]}
        selectedKey={period}
        onSelect={(key) => setPeriod(key as ChartPeriod)}
        style={styles.segmented}
      />
      <Text style={styles.chartSubtitle}>收入不含退款，账单保存后自动计入。</Text>
      <View onLayout={e => setChartWidth(e.nativeEvent.layout.width)}>{renderChart()}</View>
    </View>
  );
}

function AnnualCharts({ width }: { width: number }) {
  const styles = useStyles(createStyles);
  const { yearlyData, isLoading, error, refetch } = useYearlyGridData();
  return <>
    <Status loading={isLoading} error={error} refresh={refetch} />
    {!isLoading && !error && <>
      <Text style={styles.chartSubtitle}>年度消费</Text>
      <BarChart width={width} data={yearlyData.map(r => ({ label: String(r.year), value: r.expense }))} height={180} barColor={styles._colors.expense} formatValue={v => `¥${v.toFixed(0)}`} />
      <Text style={styles.chartSubtitle}>年度普通收入</Text>
      <BarChart width={width} data={yearlyData.map(r => ({ label: String(r.year), value: r.income }))} height={180} barColor={styles._colors.income} formatValue={v => `¥${v.toFixed(0)}`} />
      {yearlyData.map(r => <Text key={r.year} style={styles.chartSubtitle}>{r.year}：退款 ¥{r.refund.toFixed(2)}{r.pending ? ` · ${r.pending} 笔数据异常` : ''}</Text>)}
    </>}
  </>;
}

const createStyles = (colors: any) => ({
  ...StyleSheet.create({
    card: { backgroundColor: colors.surface, borderRadius: borderRadius.card, borderWidth: borderWidth.medium, borderColor: colors.divider, padding: spacing.md, marginBottom: spacing.lg, ...shadow.small },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
    title: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
    hint: { fontSize: 11, fontWeight: '700', color: colors.textTertiary },
    segmented: { marginBottom: spacing.md },
    chartSubtitle: { fontSize: 12, fontWeight: '800', color: colors.textSecondary, marginTop: spacing.sm, marginBottom: spacing.xs },
    emptyText: { color: colors.textTertiary, fontSize: 13, fontWeight: '700', textAlign: 'center', paddingVertical: spacing.xl },
  }),
  _colors: colors,
});
