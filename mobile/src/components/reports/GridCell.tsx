/**
 * GridCell - 通用网格单元格组件
 * 用于日/月/年日历网格的单元格展示
 * 上下结构显示收入、支出和结余金额
 */
import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ThemeColors } from '../../theme/colors';
import { borderRadius, borderWidth, spacing } from '../../theme/spacing';
import { useStyles } from '../../hooks';

interface GridCellProps {
  label: string;
  income: number;
  expense: number;
  refund?: number;
  balance?: number;
  pending?: number;
  isSelected: boolean;
  isCurrentPeriod?: boolean;
  disabled?: boolean;
  onPress: () => void;
  width: number;
  height: number;
}

const formatAmount = (val: number, compact: boolean) => {
  if (val === 0) return compact ? '0' : '0.00';
  const absolute = Math.abs(val);
  if (absolute >= 10000) return `${(absolute / 10000).toFixed(1)}w`;
  if (compact && absolute >= 1000) return `${(absolute / 1000).toFixed(1)}k`;
  if (compact && absolute >= 10) return absolute.toFixed(0);
  if (compact) return absolute.toFixed(1);
  return val.toFixed(2);
};

function GridCell({
  label,
  income,
  expense,
  refund = 0,
  balance: confirmedBalance,
  pending = 0,
  isSelected,
  isCurrentPeriod = false,
  disabled = false,
  onPress,
  width,
  height,
}: GridCellProps) {
  const styles = useStyles(createStyles);

  const hasData = income > 0 || expense > 0 || refund > 0;
  const balance = confirmedBalance ?? income + refund - expense;
  const compact = width < 64;

  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}，收入${income.toFixed(2)}，消费${expense.toFixed(2)}，退款${refund.toFixed(2)}，结余${balance.toFixed(2)}，异常${pending}笔`}
      disabled={disabled}
      activeOpacity={0.7}
      style={[
        styles.cell,
        {
          width,
          height,
          backgroundColor: isSelected ? styles._colors.primary : styles._colors.surface,
          borderColor: isSelected
            ? styles._colors.stroke
            : isCurrentPeriod
              ? styles._colors.primary
              : styles._colors.stroke,
          borderWidth: borderWidth.thin,
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.label,
          isSelected && { color: '#FFFFFF', fontWeight: '800' },
          isCurrentPeriod && !isSelected && { fontWeight: '800' },
        ]}
      >
        {label}{pending > 0 ? '待' : ''}
      </Text>
      {!disabled && hasData ? (
        <View style={styles.amountWrap}>
          {refund > 0 && <Text style={[styles.incomeText, isSelected && { color: '#FFFFFF' }]} numberOfLines={1}>退{formatAmount(refund, compact)}</Text>}
          {income > 0 && (
            <Text
              style={[
                styles.incomeText,
                isSelected && { color: '#FFFFFF' },
              ]}
              numberOfLines={1}
            >
              收{compact ? '' : ' '}{formatAmount(income, compact)}
            </Text>
          )}
          {expense > 0 && (
            <Text
              style={[
                styles.expenseText,
                isSelected && { color: '#FFFFFF' },
              ]}
              numberOfLines={1}
            >
              支{compact ? '' : ' '}{formatAmount(expense, compact)}
            </Text>
          )}
          <Text
            style={[
              styles.balanceText,
              { color: balance >= 0 ? styles._colors.income : styles._colors.expense },
              isSelected && { color: '#FFFFFF' },
            ]}
            numberOfLines={1}
          >
            余{compact ? '' : ' '}{balance < 0 ? '-' : '+'}{formatAmount(Math.abs(balance), compact)}
          </Text>
        </View>
      ) : !disabled ? (
        <Text style={styles.zeroAmount}>-</Text>
      ) : null}
    </TouchableOpacity>
  );
}

const createStyles = (colors: ThemeColors) => ({
  ...StyleSheet.create({
    cell: {
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: borderRadius.small,
      paddingVertical: 2,
      paddingHorizontal: 1,
    },
    label: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    amountWrap: {
      alignItems: 'center',
      marginTop: 1,
    },
    incomeText: {
      fontSize: 9,
      fontWeight: '700',
      fontFamily: 'Courier',
      color: colors.income,
    },
    expenseText: {
      fontSize: 9,
      fontWeight: '700',
      fontFamily: 'Courier',
      color: colors.expense,
    },
    balanceText: {
      fontSize: 8,
      fontWeight: '800',
      fontFamily: 'Courier',
    },
    zeroAmount: {
      fontSize: 9,
      fontWeight: '500',
      color: colors.textQuaternary,
      marginTop: 1,
    },
  }),
  _colors: colors,
});

export default memo(GridCell);
