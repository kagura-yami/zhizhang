import LedgerNotice from './LedgerNotice';
/**
 * YearlyView - 年收支视图
 * 近5年网格 + 点击某年展示12月汇总 + 点击某月跳转月收支
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeColors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { useStyles } from '../../hooks';
import { useYearlyGridData } from '../../hooks/useIncomeExpenseData';
import { YearGrid, MonthlySummaryList } from '../../components/reports';
import { BarChart } from '../../components/charts';

interface YearlyViewProps {
  onJumpToMonthly?: (year: number, month?: number) => void;
}

export default function YearlyView({ onJumpToMonthly }: YearlyViewProps) {
  const styles = useStyles(createStyles);
  const insets = useSafeAreaInsets();
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const { yearlyData, summaries, error, getMonthlyDataForYear, isLoading, refetch } = useYearlyGridData();

  const handleYearPress = (year: number) => {
    setSelectedYear(selectedYear === year ? null : year);
  };

  const handleMonthPress = (month: number) => {
    if (onJumpToMonthly && selectedYear) {
      onJumpToMonthly(selectedYear, month);
    }
  };

  const fullMonthlyData = selectedYear ? getMonthlyDataForYear(selectedYear) : [];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: Math.max(spacing.xxxl, insets.bottom + spacing.xxxxl) }}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>近5年收支</Text>
      </View>

      <LedgerNotice summary={summaries?.find(s => s.startDate.startsWith(String(selectedYear)))} error={error} loading={isLoading} refresh={refetch} />
      <Text style={styles.headerTitle}>点击年份查看退款、结余和异常明细</Text>
      {!isLoading && !error && (<YearGrid
        years={yearlyData}
        selectedYear={selectedYear}
        onYearPress={handleYearPress}
      />)}

      {yearlyData.some((item) => item.expense > 0) && (
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>📊 年度消费对比</Text>
          <BarChart
            data={yearlyData.map((item) => ({
              label: `${item.year}`,
              value: item.expense,
              color: item.expense > 0 ? styles._colors.expense : styles._colors.divider,
            }))}
            height={190}
            showValues={false}
            barColor={styles._colors.expense}
            formatValue={(value) => `¥${value.toFixed(0)}`}
          />
        </View>
      )}

      {/* 选中年的12月汇总 */}
      {selectedYear && (
        <View style={styles.detailSection}>
          <Text style={styles.detailTitle}>
            {selectedYear}年 每月收支
          </Text>
          <MonthlySummaryList
            data={fullMonthlyData}
            onMonthPress={handleMonthPress}
          />
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
    header: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.textPrimary,
      textAlign: 'center',
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
      borderColor: colors.stroke,
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
