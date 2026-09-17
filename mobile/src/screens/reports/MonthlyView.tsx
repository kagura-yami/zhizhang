import LedgerNotice from './LedgerNotice';
import { currentBusinessDate, LedgerCell } from '../../services/api/ledger';
/**
 * MonthlyView - 月收支视图
 * 12个月网格 + 点击某月展示每日汇总 + 点击某天跳转日收支
 */
import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeColors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { useStyles } from '../../hooks';
import { useMonthlyGridData, useDailyGridData } from '../../hooks/useIncomeExpenseData';
import { MonthGrid, PeriodNavigator, DailySummaryList } from '../../components/reports';
import { PieChart } from '../../components/charts';

interface MonthlyViewProps {
  initialYear?: number;
  initialSelectedMonth?: number | null;
  onJumpToDaily?: (year: number, month: number, day?: string) => void;
}

export default function MonthlyView({
  initialYear,
  initialSelectedMonth = null,
  onJumpToDaily,
}: MonthlyViewProps) {
  const styles = useStyles(createStyles);
  const insets = useSafeAreaInsets();
  const now = currentBusinessDate();

  const [year, setYear] = useState(initialYear ?? now.year);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(initialSelectedMonth);

  // 当外部初始值变化时更新
  useEffect(() => {
    if (initialYear !== undefined) setYear(initialYear);
    if (initialSelectedMonth !== undefined) setSelectedMonth(initialSelectedMonth);
  }, [initialYear, initialSelectedMonth]);

  const { monthlyData, summary, error, isLoading, refetch } = useMonthlyGridData(year);

  // 当选中月份时，获取该月每日数据
  const { dailyMap, summary: dailySummary, error: dailyError, isLoading: dailyLoading, refetch: refreshDaily } = useDailyGridData(
    year,
    selectedMonth ? selectedMonth - 1 : 0,
  );

  const isNextDisabled = year >= now.year;

  const handlePrev = () => {
    setYear(year - 1);
    setSelectedMonth(null);
  };

  const handleNext = () => {
    setYear(year + 1);
    setSelectedMonth(null);
  };

  const handleMonthPress = (month: number) => {
    setSelectedMonth(selectedMonth === month ? null : month);
  };

  const handleDayPress = (dateStr: string) => {
    if (onJumpToDaily) {
      const parts = dateStr.split('-');
      onJumpToDaily(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, dateStr);
    }
  };

  // 将 dailyMap 转换为 DailySummaryList 需要的数组格式
  const dailySummaryData = React.useMemo(() => {
    if (!selectedMonth) return [];
    const result: Array<LedgerCell & { date: string }> = [];
    dailyMap.forEach((value, key) => {
      result.push({ date: key, ...value });
    });
    return result.sort((a, b) => a.date.localeCompare(b.date));
  }, [dailyMap, selectedMonth]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: Math.max(spacing.xxxl, insets.bottom + spacing.xxxxl) }}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => { void refetch(); void refreshDaily(); }} />}
      showsVerticalScrollIndicator={false}
    >
      <PeriodNavigator
        title={`${year}年`}
        onPrev={handlePrev}
        onNext={handleNext}
        disableNext={isNextDisabled}
      />

      <LedgerNotice summary={summary} error={error} loading={isLoading} refresh={refetch} />
      {!isLoading && !error && (<MonthGrid
        year={year}
        monthlyData={monthlyData}
        selectedMonth={selectedMonth}
        onMonthPress={handleMonthPress}
      />)}

      {(monthlyData.some((item) => item.expense > 0) && monthlyData.length > 0) && (
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>🥧 各月消费分布</Text>
          {monthlyData.length > 0 ? (
            <PieChart
              data={monthlyData.filter((item) => item.expense > 0).map((item) => ({
                value: item.expense,
                color: ['#FF6B6B', '#FFD93D', '#7EB6FF', '#7DCEA0', '#C5A3FF', '#FFB366'][item.month % 6],
                label: `${item.month}月`,
              }))}
              size={190}
              innerRadius={0.58}
              showLabels
            />
          ) : null}
        </View>
      )}

      {/* 选中月的每日汇总 */}
      {selectedMonth && (
        <View style={styles.detailSection}>
          <Text style={styles.detailTitle}>
            {year}年{selectedMonth}月 每日收支
          </Text>
          <LedgerNotice summary={dailySummary} error={dailyError} loading={dailyLoading} refresh={refreshDaily} />
          {!dailyLoading && !dailyError && <DailySummaryList
            data={dailySummaryData}
            onDayPress={handleDayPress}
          />}
        </View>
      )}

    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) => ({
  ...StyleSheet.create({
    container: {
      flex: 1,
    },
    detailSection: {
      marginTop: spacing.lg,
    },
    chartCard: {
      marginHorizontal: spacing.lg,
      marginTop: spacing.lg,
      padding: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: colors.divider,
    },
    chartTitle: {
      fontSize: 15,
      fontWeight: '800',
      color: colors.textPrimary,
      marginBottom: spacing.sm,
    },
    detailTitle: {
      fontSize: 15,
      fontWeight: '800',
      color: colors.textPrimary,
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.md,
    },
  }),
  _colors: colors,
});
