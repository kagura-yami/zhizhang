/**
 * DailyView - 日收支视图
 * 月日历网格 + 点击某天展示账单明细
 */
import LedgerNotice from './LedgerNotice';
import { currentBusinessDate } from '../../services/api/ledger';
import { Status } from '../social/shared';
import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeColors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';
import { useStyles } from '../../hooks';
import { useDailyGridData, useDailyBills } from '../../hooks/useIncomeExpenseData';
import { CalendarGrid, PeriodNavigator } from '../../components/reports';
import { LineChart } from '../../components/charts';
import BillItem from '../../components/business/BillItem';
import type { BillData as BillItemData } from '../../components/business/BillItem';

interface DailyViewProps {
  initialYear?: number;
  initialMonth?: number;
  initialSelectedDay?: string | null;
}

export default function DailyView({
  initialYear,
  initialMonth,
  initialSelectedDay = null,
}: DailyViewProps) {
  const styles = useStyles(createStyles);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const now = currentBusinessDate();

  const [year, setYear] = useState(initialYear ?? now.year);
  const [month, setMonth] = useState(initialMonth ?? now.month);
  const [selectedDay, setSelectedDay] = useState<string | null>(initialSelectedDay);

  // 当外部初始值变化时更新
  useEffect(() => {
    if (initialYear !== undefined) setYear(initialYear);
    if (initialMonth !== undefined) setMonth(initialMonth);
    if (initialSelectedDay !== undefined) setSelectedDay(initialSelectedDay);
  }, [initialYear, initialMonth, initialSelectedDay]);

  const { dailyMap, summary, error, isLoading, refetch } = useDailyGridData(year, month);
  const { bills, error: billsError, refetch: refreshBills, isLoading: billsLoading } = useDailyBills(selectedDay);

  const handlePrev = () => {
    if (month === 0) {
      setYear(year - 1);
      setMonth(11);
    } else {
      setMonth(month - 1);
    }
    setSelectedDay(null);
  };

  const handleNext = () => {
    if (month === 11) {
      setYear(year + 1);
      setMonth(0);
    } else {
      setMonth(month + 1);
    }
    setSelectedDay(null);
  };

  const isNextDisabled = year === now.year && month >= now.month;

  const handleDayPress = (dateStr: string) => {
    setSelectedDay(selectedDay === dateStr ? null : dateStr);
  };

  const handleBillPress = (bill: BillItemData) => {
    navigation.navigate('BillDetail', { billId: Number(bill.id) });
  };

  // 映射后端 BillData 到 BillItem 组件需要的格式
  const mapBill = (bill: any): BillItemData => ({
    id: String(bill.id),
    category: bill.category?.name || '未分类',
    amount: typeof bill.amount === 'number' ? bill.amount : parseFloat(bill.amount),
    type: bill.type,
    date: bill.date?.split('T')[0] || bill.date,
    description: bill.description || bill.note,
    icon: bill.category?.icon || '💰',
  });

  // 计算选中日的汇总
  const selectedDayData = selectedDay ? dailyMap.get(selectedDay) : null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: Math.max(spacing.xxxl, insets.bottom + spacing.xxxxl) }}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={() => { void refetch(); void refreshBills(); }} />}
      showsVerticalScrollIndicator={false}
    >
      <PeriodNavigator
        title={`${year}年${month + 1}月`}
        onPrev={handlePrev}
        onNext={handleNext}
        disableNext={isNextDisabled}
      />

      <LedgerNotice summary={summary} error={error} loading={isLoading} refresh={refetch} />
      {!isLoading && !error && (<CalendarGrid
        year={year}
        month={month}
        dailyData={dailyMap}
        selectedDay={selectedDay}
        onDayPress={handleDayPress}
      />)}

      {dailyMap.size > 0 && (
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>📈 每日支出趋势</Text>
          <LineChart
            data={Array.from(dailyMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({
              label: date.slice(8),
              value: value.expense,
            }))}
            height={190}
            lineColor={styles._colors.expense}
            dotColor={styles._colors.expense}
            formatValue={(value) => `¥${value.toFixed(0)}`}
          />
        </View>
      )}

      {/* 选中日的明细 */}
      {selectedDay && (
        <View style={styles.detailSection}>
          <View style={styles.detailHeader}>
            <Text style={styles.detailTitle}>
              {parseInt(selectedDay.split('-')[1], 10)}月{parseInt(selectedDay.split('-')[2], 10)}日明细
            </Text>
            {selectedDayData && (
              <View style={styles.daySummary}>
                {selectedDayData.refund > 0 && <Text style={styles.incomeText}>退 +{selectedDayData.refund.toFixed(2)}</Text>}
                {selectedDayData.pending > 0 && <Text style={styles.expenseText}>{selectedDayData.pending} 笔异常</Text>}
                {selectedDayData.income > 0 && (
                  <Text style={styles.incomeText}>收 +{selectedDayData.income.toFixed(2)}</Text>
                )}
                {selectedDayData.expense > 0 && (
                  <Text style={styles.expenseText}>支 -{selectedDayData.expense.toFixed(2)}</Text>
                )}
                <Text style={[
                  styles.balanceText,
                  {
                    color: selectedDayData.balance >= 0
                      ? styles._colors.income
                      : styles._colors.expense,
                  },
                ]}>
                  余 {selectedDayData.balance >= 0 ? '+' : ''}
                  {(selectedDayData.balance).toFixed(2)}
                </Text>
              </View>
            )}
          </View>

          <Status error={billsError} loading={false} refresh={refreshBills} />
          {billsLoading ? (
            <ActivityIndicator
              style={styles.loading}
              color={styles._colors.primary}
            />
          ) : billsError ? null : bills.length > 0 ? (
            bills.map((bill: any) => (
              <BillItem
                key={bill.id}
                bill={mapBill(bill)}
                onPress={handleBillPress}
              />
            ))
          ) : (
            <Text style={styles.emptyText}>当天暂无记录</Text>
          )}
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
      borderColor: colors.stroke,
    },
    chartTitle: {
      fontSize: 15,
      fontWeight: '800',
      color: colors.textPrimary,
      marginBottom: spacing.sm,
    },
    detailHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.sm,
    },
    detailTitle: {
      fontSize: 15,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    daySummary: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      flexWrap: 'wrap',
      gap: spacing.sm,
      flex: 1,
      marginLeft: spacing.sm,
    },
    incomeText: {
      fontSize: 12,
      fontWeight: '700',
      fontFamily: 'Courier',
      color: colors.income,
    },
    expenseText: {
      fontSize: 12,
      fontWeight: '700',
      fontFamily: 'Courier',
      color: colors.expense,
    },
    balanceText: {
      fontSize: 12,
      fontWeight: '800',
      fontFamily: 'Courier',
    },
    loading: {
      padding: spacing.xxxl,
    },
    emptyText: {
      fontSize: 14,
      color: colors.textTertiary,
      textAlign: 'center',
      padding: spacing.xxxl,
    },
  }),
  _colors: colors,
});
