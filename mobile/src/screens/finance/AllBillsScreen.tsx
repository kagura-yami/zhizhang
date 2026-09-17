/**
 * 全部账单页面。
 * 支持搜索、渐进式筛选、按月折叠，以及完整分页数据的本地分组。
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import {
  ChevronDown,
  ChevronRight,
  Search,
  SearchX,
  SlidersHorizontal,
  X,
} from 'lucide-react-native';
import { BillItem } from '../../components';
import { useStyles, useToast } from '../../hooks';
import { billsService } from '../../services';
import { ThemeColors } from '../../theme/colors';
import { borderRadius, borderWidth, spacing } from '../../theme';
import { getCurrentMonthRange, getLastMonthRange } from '../../utils/date';
import type { BillData } from '../../types/bill';

type BillTypeFilter = 'all' | 'income' | 'expense';
type TimeRange = 'all' | 'month' | 'lastMonth';
type SortMode = 'latest' | 'amountDesc' | 'amountAsc';

const AllBillsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { showError } = useToast();
  const styles = useStyles(createStyles);
  const routeParams = route.params as { initialFilter?: BillTypeFilter } | undefined;

  const [bills, setBills] = useState<BillData[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<BillTypeFilter>(routeParams?.initialFilter || 'all');
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [searchText, setSearchText] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('latest');
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());

  const fetchBills = useCallback(async (isRefresh = false) => {
    try {
      isRefresh ? setRefreshing(true) : setLoading(true);
      const params: any = {
        page: 1,
        limit: 100,
        orderBy: 'date',
        orderDirection: 'desc',
      };
      if (filter !== 'all') params.type = filter;
      if (timeRange === 'month') Object.assign(params, getCurrentMonthRange());
      if (timeRange === 'lastMonth') Object.assign(params, getLastMonthRange());

      const firstPage = await billsService.getBills(params);
      if (!firstPage.success) throw new Error(firstPage.message || '加载账单失败');

      const allBills = [...(firstPage.data || [])];
      const totalPages = firstPage.pagination?.totalPages || 1;
      if (totalPages > 1) {
        const remainingPages = await Promise.all(
          Array.from({ length: totalPages - 1 }, (_, index) =>
            billsService.getBills({ ...params, page: index + 2 })
          )
        );
        remainingPages.forEach(response => allBills.push(...(response.data || [])));
      }
      setBills(allBills);
    } catch (error: any) {
      showError(error.message || '加载账单失败');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, showError, timeRange]);

  useFocusEffect(useCallback(() => {
    fetchBills();
  }, [fetchBills]));

  const categories = useMemo(() => {
    const map = new Map<number, { id: number; name: string; icon?: string }>();
    bills.forEach(bill => {
      if (bill.category) map.set(bill.category.id, bill.category);
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }, [bills]);

  const visibleBills = useMemo(() => {
    const query = searchText.trim().toLocaleLowerCase('zh-CN');
    const minimum = minAmount.trim() ? Number(minAmount) : null;
    const maximum = maxAmount.trim() ? Number(maxAmount) : null;
    const next = bills.filter(bill => {
      const amount = Number(bill.amount);
      if (categoryId !== null && bill.categoryId !== categoryId) return false;
      if (minimum !== null && Number.isFinite(minimum) && amount < minimum) return false;
      if (maximum !== null && Number.isFinite(maximum) && amount > maximum) return false;
      if (!query) return true;
      const searchable = [
        bill.category?.name,
        bill.description,
        bill.counterparty,
        bill.paymentChannel,
        bill.sourceApp,
        String(bill.amount),
      ].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN');
      return searchable.includes(query);
    });

    return next.sort((a, b) => {
      if (sortMode === 'amountDesc') return Number(b.amount) - Number(a.amount);
      if (sortMode === 'amountAsc') return Number(a.amount) - Number(b.amount);
      const aTime = new Date(a.time || a.date || a.createdAt).getTime();
      const bTime = new Date(b.time || b.date || b.createdAt).getTime();
      return bTime - aTime;
    });
  }, [bills, categoryId, maxAmount, minAmount, searchText, sortMode]);

  const groupedBills = useMemo(() => {
    const groups = new Map<string, BillData[]>();
    visibleBills.forEach(bill => {
      const date = new Date(bill.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      groups.set(monthKey, [...(groups.get(monthKey) || []), bill]);
    });
    return Array.from(groups.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([monthKey, monthBills]) => {
        const [year, month] = monthKey.split('-');
        return [`${year}年${Number(month)}月`, monthBills] as [string, BillData[]];
      });
  }, [visibleBills]);

  const hasAdvancedFilters = timeRange !== 'all' || categoryId !== null || !!minAmount || !!maxAmount || sortMode !== 'latest';

  const resetAdvancedFilters = () => {
    setTimeRange('all');
    setCategoryId(null);
    setMinAmount('');
    setMaxAmount('');
    setSortMode('latest');
  };

  const toggleMonth = (month: string) => {
    setCollapsedMonths(current => {
      const next = new Set(current);
      next.has(month) ? next.delete(month) : next.add(month);
      return next;
    });
  };

  const getMonthTotals = (monthBills: BillData[]) => monthBills.reduce(
    (result, bill) => {
      const amount = Number(bill.amount);
      bill.type === 'income' ? result.income += amount : result.expense += amount;
      return result;
    },
    { income: 0, expense: 0 }
  );

  return (
    <View style={styles.container}>
      <View style={styles.filterBar}>
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Search size={19} color={styles._colors.textSecondary} />
            <TextInput
              style={styles.searchInput}
              value={searchText}
              onChangeText={setSearchText}
              placeholder="查找分类、备注、对象、渠道或金额"
              placeholderTextColor={styles._colors.textTertiary}
              returnKeyType="search"
              accessibilityLabel="查找账单"
            />
            {!!searchText && (
              <TouchableOpacity style={styles.iconTouch} onPress={() => setSearchText('')} accessibilityLabel="清空查找内容">
                <X size={18} color={styles._colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            style={[styles.moreFilterButton, (showAdvancedFilters || hasAdvancedFilters) && styles.moreFilterButtonActive]}
            onPress={() => setShowAdvancedFilters(value => !value)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showAdvancedFilters }}
            accessibilityLabel="展开更多筛选"
          >
            <SlidersHorizontal size={20} color={(showAdvancedFilters || hasAdvancedFilters) ? '#FFFFFF' : styles._colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickFilters}>
          {(['all', 'expense', 'income'] as BillTypeFilter[]).map(option => (
            <TouchableOpacity
              key={option}
              style={[styles.filterBtn, filter === option && styles.filterBtnActive]}
              onPress={() => setFilter(option)}
              accessibilityState={{ selected: filter === option }}
            >
              <Text style={[styles.filterText, filter === option && styles.filterTextActive]}>
                {option === 'all' ? '全部' : option === 'expense' ? '支出' : '收入'}
              </Text>
            </TouchableOpacity>
          ))}
          <Text style={styles.resultCount}>共 {visibleBills.length} 笔</Text>
        </ScrollView>

        {showAdvancedFilters && (
          <View style={styles.advancedPanel}>
            <View style={styles.advancedTitleRow}>
              <Text style={styles.advancedTitle}>更多筛选</Text>
              {hasAdvancedFilters && (
                <TouchableOpacity style={styles.resetButton} onPress={resetAdvancedFilters}>
                  <Text style={styles.resetButtonText}>重置</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.filterLabel}>时间范围</Text>
            <View style={styles.wrappedOptions}>
              {(['all', 'month', 'lastMonth'] as TimeRange[]).map(option => (
                <TouchableOpacity
                  key={option}
                  style={[styles.smallOption, timeRange === option && styles.smallOptionActive]}
                  onPress={() => setTimeRange(option)}
                >
                  <Text style={[styles.smallOptionText, timeRange === option && styles.smallOptionTextActive]}>
                    {option === 'all' ? '全部时间' : option === 'month' ? '本月' : '上月'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {categories.length > 0 && (
              <>
                <Text style={styles.filterLabel}>分类</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryOptions}>
                  <TouchableOpacity style={[styles.smallOption, categoryId === null && styles.smallOptionActive]} onPress={() => setCategoryId(null)}>
                    <Text style={[styles.smallOptionText, categoryId === null && styles.smallOptionTextActive]}>全部分类</Text>
                  </TouchableOpacity>
                  {categories.map(category => (
                    <TouchableOpacity
                      key={category.id}
                      style={[styles.smallOption, categoryId === category.id && styles.smallOptionActive]}
                      onPress={() => setCategoryId(category.id)}
                    >
                      <Text style={[styles.smallOptionText, categoryId === category.id && styles.smallOptionTextActive]}>
                        {category.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}

            <Text style={styles.filterLabel}>金额范围</Text>
            <View style={styles.amountRangeRow}>
              <TextInput style={styles.amountFilterInput} value={minAmount} onChangeText={setMinAmount} placeholder="最低金额" placeholderTextColor={styles._colors.textTertiary} keyboardType="decimal-pad" />
              <Text style={styles.amountSeparator}>—</Text>
              <TextInput style={styles.amountFilterInput} value={maxAmount} onChangeText={setMaxAmount} placeholder="最高金额" placeholderTextColor={styles._colors.textTertiary} keyboardType="decimal-pad" />
            </View>

            <Text style={styles.filterLabel}>排序</Text>
            <View style={styles.wrappedOptions}>
              {(['latest', 'amountDesc', 'amountAsc'] as SortMode[]).map(option => (
                <TouchableOpacity key={option} style={[styles.smallOption, sortMode === option && styles.smallOptionActive]} onPress={() => setSortMode(option)}>
                  <Text style={[styles.smallOptionText, sortMode === option && styles.smallOptionTextActive]}>
                    {option === 'latest' ? '时间最新' : option === 'amountDesc' ? '金额从高到低' : '金额从低到高'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </View>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchBills(true)} />}
      >
        {loading && !refreshing ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={styles._colors.primary} />
            <Text style={styles.loadingText}>加载中...</Text>
          </View>
        ) : groupedBills.length === 0 ? (
          <View style={styles.emptyContainer}>
            <SearchX size={46} color={styles._colors.textTertiary} />
            <Text style={styles.emptyText}>{bills.length === 0 ? '暂无账单记录' : '没有找到符合条件的账单'}</Text>
            {(searchText || hasAdvancedFilters) && (
              <TouchableOpacity style={styles.clearFiltersButton} onPress={() => { setSearchText(''); resetAdvancedFilters(); }}>
                <Text style={styles.clearFiltersText}>清除筛选</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : groupedBills.map(([month, monthBills]) => {
          const collapsed = collapsedMonths.has(month);
          const totals = getMonthTotals(monthBills);
          const balance = totals.income - totals.expense;
          return (
            <View key={month} style={styles.monthSection}>
              <TouchableOpacity
                style={styles.monthHeader}
                onPress={() => toggleMonth(month)}
                accessibilityRole="button"
                accessibilityState={{ expanded: !collapsed }}
                accessibilityLabel={`${month}，${monthBills.length}笔账单`}
              >
                <View style={styles.monthTitleRow}>
                  {collapsed
                    ? <ChevronRight size={20} color={styles._colors.textPrimary} />
                    : <ChevronDown size={20} color={styles._colors.textPrimary} />}
                  <Text style={styles.monthTitle}>{month}</Text>
                  <Text style={styles.monthCount}>{monthBills.length} 笔</Text>
                </View>
                <View style={styles.monthTotals}>
                  <Text style={styles.monthIncome}>收 ¥{totals.income.toFixed(2)}</Text>
                  <Text style={styles.monthExpense}>支 ¥{totals.expense.toFixed(2)}</Text>
                  <Text style={[styles.monthBalance, { color: balance >= 0 ? styles._colors.income : styles._colors.expense }]}>
                    余 {balance >= 0 ? '+' : '-'}¥{Math.abs(balance).toFixed(2)}
                  </Text>
                </View>
              </TouchableOpacity>

              {!collapsed && (
                <View style={styles.billList}>
                  {monthBills.map(bill => {
                    const occurredAt = new Date(bill.time || bill.date || bill.createdAt);
                    return (
                      <BillItem
                        key={bill.id}
                        bill={{
                          id: bill.id.toString(),
                          category: bill.category?.name || '未分类',
                          amount: bill.amount,
                          type: bill.type,
                          date: `${occurredAt.toLocaleDateString('zh-CN')} ${occurredAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`,
                          description: bill.description,
                          relatedBill: bill.relatedBill,
                          icon: bill.category?.icon || '📝',
                        }}
                        onPress={() => navigation.navigate('BillDetail', { billId: bill.id })}
                      />
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
};

const createStyles = (colors: ThemeColors) => ({
  ...StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    filterBar: { backgroundColor: colors.surface, padding: spacing.md, borderBottomWidth: borderWidth.thin, borderBottomColor: colors.stroke },
    searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    searchBox: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.md, paddingRight: spacing.xs, borderWidth: borderWidth.thin, borderColor: colors.divider, borderRadius: borderRadius.small, backgroundColor: colors.background },
    searchInput: { flex: 1, minWidth: 0, paddingVertical: spacing.sm, fontSize: 14, fontWeight: '600', color: colors.textPrimary },
    iconTouch: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    moreFilterButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: borderRadius.small, borderWidth: borderWidth.thin, borderColor: colors.divider, backgroundColor: colors.background },
    moreFilterButtonActive: { backgroundColor: colors.primary },
    quickFilters: { alignItems: 'center', paddingTop: spacing.sm },
    filterBtn: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.lg, borderRadius: borderRadius.small, marginRight: spacing.sm, backgroundColor: colors.surface, borderWidth: borderWidth.thin, borderColor: colors.divider },
    filterBtnActive: { backgroundColor: colors.primary },
    filterText: { fontSize: 13, color: colors.textSecondary, fontWeight: '700' },
    filterTextActive: { color: '#FFFFFF', fontWeight: '800' },
    resultCount: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, paddingHorizontal: spacing.xs },
    advancedPanel: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: borderWidth.thin, borderTopColor: colors.divider },
    advancedTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    advancedTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
    resetButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.sm },
    resetButtonText: { fontSize: 13, fontWeight: '800', color: colors.primary },
    filterLabel: { marginTop: spacing.md, marginBottom: spacing.xs, fontSize: 12, fontWeight: '800', color: colors.textSecondary },
    wrappedOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    categoryOptions: { gap: spacing.xs },
    smallOption: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: borderRadius.small, borderWidth: borderWidth.thin, borderColor: colors.divider, backgroundColor: colors.background },
    smallOptionActive: { backgroundColor: colors.primary },
    smallOptionText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
    smallOptionTextActive: { color: '#FFFFFF' },
    amountRangeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    amountFilterInput: { flex: 1, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: borderRadius.small, borderWidth: borderWidth.thin, borderColor: colors.divider, backgroundColor: colors.background, color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
    amountSeparator: { color: colors.textSecondary, fontWeight: '800' },
    scrollView: { flex: 1 },
    monthSection: { marginBottom: spacing.md },
    monthHeader: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.surface, borderBottomWidth: borderWidth.thin, borderBottomColor: colors.stroke },
    monthTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    monthTitle: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
    monthCount: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, marginLeft: spacing.xs },
    monthTotals: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs, marginLeft: 28 },
    monthIncome: { fontSize: 11, fontWeight: '700', color: colors.income, fontFamily: 'Courier' },
    monthExpense: { fontSize: 11, fontWeight: '700', color: colors.expense, fontFamily: 'Courier' },
    monthBalance: { fontSize: 11, fontWeight: '800', fontFamily: 'Courier' },
    billList: { backgroundColor: colors.background },
    loadingContainer: { alignItems: 'center', paddingTop: 100 },
    loadingText: { marginTop: spacing.md, fontSize: 15, fontWeight: '600', color: colors.textSecondary },
    emptyContainer: { alignItems: 'center', paddingTop: 100, paddingHorizontal: spacing.lg },
    emptyText: { marginTop: spacing.md, fontSize: 15, fontWeight: '700', color: colors.textTertiary, textAlign: 'center' },
    clearFiltersButton: { minHeight: 44, justifyContent: 'center', marginTop: spacing.md, paddingHorizontal: spacing.lg, borderRadius: borderRadius.small, borderWidth: borderWidth.thin, borderColor: colors.primary },
    clearFiltersText: { fontSize: 13, fontWeight: '800', color: colors.primary },
  }),
  _colors: colors,
});

export default AllBillsScreen;
