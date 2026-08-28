/**
 * 首页收支图表：日视图使用折线图，月视图使用扇形图，年视图使用柱状图。
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { BarChart, LineChart, PieChart } from '../charts';
import { SegmentedControl } from '../ui';
import { useMonthlyGridData, useYearlyGridData } from '../../hooks/useIncomeExpenseData';
import { useStyles } from '../../hooks/useStyles';
import { borderRadius, borderWidth, shadow, spacing } from '../../theme';
import type { BillStatistics } from '../../types/bill';

type ChartPeriod = 'daily' | 'monthly' | 'yearly';

interface HomeChartsProps {
  statistics: BillStatistics | null;
}

const CATEGORY_COLORS = ['#FF6B6B', '#FFD93D', '#7EB6FF', '#7DCEA0', '#C5A3FF', '#FFB366', '#E17055', '#45B7D1'];

export default function HomeCharts({ statistics }: HomeChartsProps) {
  const styles = useStyles(createStyles);
  const [period, setPeriod] = useState<ChartPeriod>('daily');
  const now = new Date();
  const { monthlyData } = useMonthlyGridData(now.getFullYear());
  const { yearlyData } = useYearlyGridData();

  const dailyExpense = useMemo(() => (statistics?.dailyTrends ?? []).map((item) => ({
    label: item.date.slice(8),
    value: Number(item.expense) || 0,
  })), [statistics]);
  const dailyIncome = useMemo(() => (statistics?.dailyTrends ?? []).map((item) => ({
    label: item.date.slice(8),
    value: Number(item.income) || 0,
  })), [statistics]);
  const expenseCategories = useMemo(() => (statistics?.expenseCategoryStats ?? [])
    .filter((item) => Number(item.amount) > 0)
    .slice(0, 8)
    .map((item, index) => ({
      value: Number(item.amount),
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
      label: `${item.categoryIcon || '•'} ${item.categoryName}`,
    })), [statistics]);

  const monthlyExpense = monthlyData.map((item) => ({ label: `${item.month}月`, value: Number(item.expense) || 0 }));
  const monthlyIncome = monthlyData.map((item) => ({ label: `${item.month}月`, value: Number(item.income) || 0 }));
  const yearlyExpense = yearlyData.map((item) => ({ label: `${item.year}`, value: Number(item.expense) || 0 }));
  const yearlyIncome = yearlyData.map((item) => ({ label: `${item.year}`, value: Number(item.income) || 0 }));

  const renderChart = () => {
    if (period === 'daily') {
      return (
        <>
          <Text style={styles.chartSubtitle}>本月每日支出</Text>
          {dailyExpense.length > 0 ? (
            <LineChart data={dailyExpense} height={175} lineColor={styles._colors.expense} dotColor={styles._colors.expense} formatValue={(value) => `¥${value.toFixed(0)}`} />
          ) : <Text style={styles.emptyText}>本月暂无支出趋势</Text>}
          <Text style={styles.chartSubtitle}>本月每日收入</Text>
          {dailyIncome.length > 0 ? (
            <LineChart data={dailyIncome} height={175} lineColor={styles._colors.income} dotColor={styles._colors.income} formatValue={(value) => `¥${value.toFixed(0)}`} />
          ) : <Text style={styles.emptyText}>本月暂无收入趋势</Text>}
        </>
      );
    }

    if (period === 'monthly') {
      return expenseCategories.length > 0 ? (
        <PieChart data={expenseCategories} size={190} innerRadius={0.58} showLabels showLegend />
      ) : <Text style={styles.emptyText}>今年暂无分类支出</Text>;
    }

    return (
      <>
        <Text style={styles.chartSubtitle}>年度支出</Text>
        <BarChart data={yearlyExpense} height={180} barColor={styles._colors.expense} formatValue={(value) => `¥${value.toFixed(0)}`} />
        <Text style={styles.chartSubtitle}>年度收入</Text>
        <BarChart data={yearlyIncome} height={180} barColor={styles._colors.income} formatValue={(value) => `¥${value.toFixed(0)}`} />
      </>
    );
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>📊 收支图表</Text>
        <Text style={styles.hint}>首页展示</Text>
      </View>
      <SegmentedControl
        options={[{ key: 'daily', label: '每日' }, { key: 'monthly', label: '月度' }, { key: 'yearly', label: '年度' }]}
        selectedKey={period}
        onSelect={(key) => setPeriod(key as ChartPeriod)}
        style={styles.segmented}
      />
      {renderChart()}
    </View>
  );
}

const createStyles = (colors: any) => ({
  ...StyleSheet.create({
    card: { backgroundColor: colors.surface, borderRadius: borderRadius.card, borderWidth: borderWidth.medium, borderColor: colors.stroke, padding: spacing.md, marginBottom: spacing.lg, ...shadow.small },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
    title: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
    hint: { fontSize: 11, fontWeight: '700', color: colors.textTertiary },
    segmented: { marginBottom: spacing.md },
    chartSubtitle: { fontSize: 12, fontWeight: '800', color: colors.textSecondary, marginTop: spacing.sm, marginBottom: spacing.xs },
    emptyText: { color: colors.textTertiary, fontSize: 13, fontWeight: '700', textAlign: 'center', paddingVertical: spacing.xl },
  }),
  _colors: colors,
});
