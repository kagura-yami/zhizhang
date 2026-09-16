/**
 * YearGrid - 3列年份网格（年收支用）
 * 每格显示年份 + 当年净额
 */
import React from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { ThemeColors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { useStyles } from '../../hooks';
import GridCell from './GridCell';
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
  const { width: screenWidth } = useWindowDimensions();
  const cellWidth = (screenWidth - spacing.lg * 2 - GAP * (NUM_COLS - 1)) / NUM_COLS;
  const cellHeight = Math.max(76, cellWidth * 0.75);

  const currentYear = currentBusinessDate().year;

  return (
    <View style={styles.container}>
      <View style={styles.grid}>
        {years.map(({ year, income, expense, refund, balance, pending }) => {
          const isFuture = year > currentYear;
          return (
            <View key={year} style={{ marginRight: years.indexOf(years.find(y => y.year === year)!) % NUM_COLS === NUM_COLS - 1 ? 0 : GAP, marginBottom: GAP }}>
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
                height={cellHeight}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => ({
  ...StyleSheet.create({
    container: {
      paddingHorizontal: spacing.lg,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
  }),
  _colors: colors,
});
