/**
 * MonthGrid - 4x3 月份网格（月收支用）
 * 每格显示月份 + 当月净额
 */
import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemeColors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { useStyles } from '../../hooks';
import GridCell from './GridCell';
import FixedColumnGrid from './FixedColumnGrid';
import { currentBusinessDate, LedgerCell } from '../../services/api/ledger';

const NUM_COLS = 4;
const GAP = spacing.sm;

interface MonthGridProps {
  year: number;
  monthlyData: Array<LedgerCell & { month: number }>;
  selectedMonth: number | null;
  onMonthPress: (month: number) => void;
}

export default function MonthGrid({
  year,
  monthlyData,
  selectedMonth,
  onMonthPress,
}: MonthGridProps) {
  const styles = useStyles(createStyles);
  const currentYear = currentBusinessDate().year;
  const currentMonth = currentBusinessDate().month + 1;

  const months = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const monthNum = i + 1;
      const data = monthlyData.find((m) => m.month === monthNum);
      const income = data?.income ?? 0;
      const expense = data?.expense ?? 0;
      const isFuture = (year > currentYear || (year === currentYear && monthNum > currentMonth)) && !data?.total;
      return { monthNum, income, expense, isFuture, refund: data?.refund, balance: data?.balance, pending: data?.pending };
    });
  }, [year, monthlyData, currentYear, currentMonth]);

  return (
    <View style={styles.container}>
      <FixedColumnGrid items={months} columns={NUM_COLS} gap={GAP} itemKey={item => String(item.monthNum)}
        renderItem={({ monthNum, income, expense, isFuture, refund, balance, pending }, cellWidth) => (
            <GridCell
              label={`${monthNum}月`}
              income={isFuture ? 0 : income}
              expense={isFuture ? 0 : expense}
              refund={refund} balance={balance} pending={pending}
              isSelected={selectedMonth === monthNum}
              isCurrentPeriod={year === currentYear && monthNum === currentMonth}
              disabled={isFuture}
              onPress={() => onMonthPress(monthNum)}
              width={cellWidth}
              height={Math.max(72, cellWidth * 0.85)}
            />
        )}
      />
    </View>
  );
}

const createStyles = (colors: ThemeColors) => ({
  ...StyleSheet.create({
    container: {
      paddingHorizontal: spacing.lg,
    },
  }),
  _colors: colors,
});
