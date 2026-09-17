/**
 * YearGrid - 3列年份网格（年收支用）
 * 每格显示年份 + 当年净额
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemeColors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { useStyles } from '../../hooks';
import GridCell from './GridCell';
import FixedColumnGrid from './FixedColumnGrid';
import { currentBusinessDate, LedgerCell } from '../../services/api/ledger';

const NUM_COLS = 3;
const GAP = spacing.sm;

interface YearGridProps {
  years: Array<LedgerCell & { year: number }>;
  selectedYear: number | null;
  onYearPress: (year: number) => void;
}

export default function YearGrid({
  years,
  selectedYear,
  onYearPress,
}: YearGridProps) {
  const styles = useStyles(createStyles);
  const currentYear = currentBusinessDate().year;

  return (
    <View style={styles.container}>
      <FixedColumnGrid items={years} columns={NUM_COLS} gap={GAP} itemKey={item => String(item.year)}
        renderItem={({ year, income, expense, refund, balance, pending }, cellWidth) => {
          const isFuture = year > currentYear;
          return (
              <GridCell
                label={String(year)}
                income={isFuture ? 0 : income}
                expense={isFuture ? 0 : expense}
                refund={refund} balance={balance} pending={pending}
                isSelected={selectedYear === year}
                isCurrentPeriod={year === currentYear}
                disabled={isFuture}
                onPress={() => onYearPress(year)}
                width={cellWidth}
                height={Math.max(76, cellWidth * 0.75)}
              />
          );
        }}
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
