/**
 * 预算管理页面 - Neo-Brutalism 风格
 * 预算列表 + 新增/编辑弹窗 + 分类选择 + 进度追踪
 */
import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ChevronLeft, Plus, Trash2, Pencil } from 'lucide-react-native';
import { ThemeColors } from '../theme/colors';
import { spacing, borderRadius, borderWidth, shadow } from '../theme/spacing';
import { BrutalPressable } from '../components/ui';
import { useStyles } from '../hooks';
import { useAlert, useAuth } from '../providers';
import { httpService } from '../services/http';
import { Action, Status, useSocialResource } from './social/shared';
import { createBudgetApi, LedgerBudgetProgress } from '../services/api/budgets';
import { CategoryData } from '../services/api/categories';
import { invalidateCache } from '../lib/queryClient';
import type {
  BudgetPeriod,
  CreateBudgetDto,
} from '../types/budget';

export default function BudgetScreen() {
  const { token } = useAuth();
  return <BudgetContent key={token || 'signed-out'} token={token || ''} />;
}
function BudgetContent({ token }: { token: string }) {
  const navigation = useNavigation<any>();
  const api = useMemo(() => createBudgetApi(token), [token]);
  const styles = useStyles(createStyles);
  const { confirm } = useAlert();
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const compactLayout = width < 380 || fontScale > 1.15;

  // 弹窗状态
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingBudget, setEditingBudget] = useState<LedgerBudgetProgress | null>(null);

  // 表单状态
  const [formName, setFormName] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formPeriod, setFormPeriod] = useState<BudgetPeriod>('monthly');
  const [formCategoryId, setFormCategoryId] = useState<number | undefined>(undefined);
  const [formAlertAt, setFormAlertAt] = useState('80');

  const [formError, setFormError] = useState('');
  const loader = useCallback(() => api.progress(), [api]);
  const resource = useSocialResource(loader);
  const categoryLoader = useCallback(async () => {
    const res = await httpService.get<CategoryData[]>('/categories', {
      params: { type: 'expense' }, headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.success || !Array.isArray(res.data)) throw new Error(res.message || '分类加载失败');
    return res.data;
  }, [token]);
  const categoryResource = useSocialResource(categoryLoader);
  const categories = categoryResource.value;
  const { loading: isFetching, refresh: refetch } = resource;
  const budgets = resource.value ?? [];
  const totalBudgets = budgets.length;
  const pendingBudgets = budgets.filter(b => b.comparisonStatus !== 'complete').length;
  const overBudgets = budgets.filter(b => b.confirmedOverBudget === true).length;

  // 表单操作
  const openCreateModal = () => {
    setEditingBudget(null);
    setFormError('');
    setFormName('');
    setFormAmount('');
    setFormPeriod('monthly');
    setFormCategoryId(undefined);
    setFormAlertAt('80');
    setShowFormModal(true);
  };

  const openEditModal = (budget: LedgerBudgetProgress) => {
    setEditingBudget(budget);
    setFormError('');
    setFormName(budget.name);
    setFormAmount(String(budget.amount));
    setFormPeriod(budget.period);
    setFormCategoryId(budget.categoryId ?? undefined);
    setFormAlertAt(String(budget.alertAt));
    setShowFormModal(true);
  };

  const closeFormModal = () => {
    setShowFormModal(false);
    setEditingBudget(null);
  };

  const handleSubmitForm = () => {
    const amount = Number(formAmount);
    const alertAt = Number(formAlertAt);
    if (!formName.trim() || !/^\d+(?:\.\d{1,4})?$/.test(formAmount.trim()) || !Number.isFinite(amount) || amount < 0) {
      setFormError('请填写预算名称和不小于 0 的金额，最多四位小数'); return;
    }
    if (!Number.isInteger(alertAt) || alertAt < 1 || alertAt > 100) {
      setFormError('预警阈值须为 1 至 100 的整数'); return;
    }
    setFormError('');

    const payload: CreateBudgetDto = {
      name: formName.trim(),
      amount,
      period: formPeriod,
      categoryId: formCategoryId,
      alertAt,
    };

    void resource.run(async () => {
      if (editingBudget) await api.update(editingBudget.id, { ...payload, categoryId: formCategoryId ?? null });
      else await api.create(payload);
    }, () => { invalidateCache.budgets(); closeFormModal(); void refetch(); });
  };

  const handleDelete = (budget: LedgerBudgetProgress) => {
    confirm(
      '删除预算',
      `确定要删除「${budget.name}」吗？此操作不可撤销。`,
      () => { void resource.run(() => api.remove(budget.id), () => { invalidateCache.budgets(); void refetch(); }); },
      undefined,
      { confirmText: '删除', destructive: true },
    );
  };

  const onRefresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const getProgressColor = (budget: LedgerBudgetProgress) => {
    if (budget.confirmedOverBudget) { return styles._colors.error; }
    if (budget.comparisonStatus !== 'complete') { return styles._colors.textSecondary; }
    if (budget.needsAlert) { return '#F59E0B'; }
    return styles._colors.success;
  };

  const getCategoryIcon = (budget: LedgerBudgetProgress) => {
    return budget.category?.icon || '💰';
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top + spacing.xs, spacing.lg) }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ChevronLeft size={24} color={styles._colors.textPrimary} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, compactLayout && styles.headerTitleCompact]} numberOfLines={1} maxFontSizeMultiplier={1.2}>预算管理</Text>
        <TouchableOpacity accessibilityLabel="新建预算" disabled={resource.busy} onPress={openCreateModal} style={styles.addButton}>
          <Plus size={20} color="#1A1A1A" strokeWidth={3} />
        </TouchableOpacity>
      </View>

      {/* Summary */}
      <View style={[styles.summaryBar, compactLayout && styles.summaryBarCompact]}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNumber} maxFontSizeMultiplier={1.2}>{resource.value ? totalBudgets : '—'}</Text>
          <Text style={styles.summaryLabel} numberOfLines={1} maxFontSizeMultiplier={1.15}>个预算</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNumber} maxFontSizeMultiplier={1.2}>{resource.value ? totalBudgets - overBudgets : '—'}</Text>
          <Text style={styles.summaryLabel} numberOfLines={1} maxFontSizeMultiplier={1.15}>进行中</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryNumber, overBudgets > 0 && { color: styles._colors.error }]} maxFontSizeMultiplier={1.2}>
            {resource.value ? overBudgets : '—'}
          </Text>
          <Text style={styles.summaryLabel} numberOfLines={1} maxFontSizeMultiplier={1.15}>已超支</Text>
        </View>
      </View>

      {/* Budget List */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, compactLayout && styles.scrollContentCompact]}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.ruleText}>按日常账单自动统计本月或本年支出。</Text>
        <Status loading={isFetching} error={resource.error} refresh={refetch} />
        {!isFetching && resource.value && (budgets.length === 0 ? (
          <View style={[styles.emptyState, compactLayout && styles.emptyStateCompact]}>
            <Text style={styles.emptyIcon}>💰</Text>
            <Text style={styles.emptyText} maxFontSizeMultiplier={1.2}>还没有预算计划</Text>
            <Text style={styles.emptySubtext} maxFontSizeMultiplier={1.2}>创建预算，合理控制你的开支</Text>
            <TouchableOpacity style={styles.emptyButton} disabled={resource.busy} onPress={openCreateModal}>
              <Text style={styles.emptyButtonText}>创建预算</Text>
            </TouchableOpacity>
          </View>
        ) : (
          budgets.map((budget) => (
            <View key={budget.id} style={styles.budgetCard}>
              {/* Card Header */}
              <View style={[styles.budgetHeader, compactLayout && { alignItems: 'stretch', flexDirection: 'column', gap: 12 }]}>
                <View style={styles.budgetTitleRow}>
                  <View style={styles.budgetIconBox}>
                    <Text style={styles.budgetIconText}>{getCategoryIcon(budget)}</Text>
                  </View>
                  <View style={styles.budgetTitleGroup}>
                    <Text style={styles.budgetName} numberOfLines={1}>{budget.name}</Text>
                    {budget.category && (
                      <Text style={styles.budgetCategory}>{budget.category.name}</Text>
                    )}
                  </View>
                </View>
                <View style={[styles.badgeRow, compactLayout && { marginLeft: 0 }]}>
                  <View style={styles.periodBadge}>
                    <Text style={styles.periodText}>
                      {budget.period === 'monthly' ? '本月' : '本年'}
                    </Text>
                  </View>
                  <View style={[
                    styles.percentBadge,
                    budget.confirmedOverBudget && styles.overBudgetBadge,
                  ]}>
                    <Text style={[
                      styles.percentText,
                      budget.confirmedOverBudget && styles.overBudgetBadgeText,
                    ]}>
                      {budget.progressPercent === null ? '无百分比' : `${Math.round(Number(budget.progressPercent))}%`}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Progress */}
              {budget.progressPercent !== null && <View style={styles.budgetProgressContainer}>
                <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.max(0, Math.min(Number(budget.progressPercent), 100)), text: `${budget.progressPercent}%` }} style={{ height: 14, backgroundColor: styles._colors.divider }}>
                  <View style={{ height: 14, width: `${Math.max(0, Math.min(Number(budget.progressPercent), 100))}%`, backgroundColor: getProgressColor(budget) }} />
                </View>
              </View>}

              {/* Amounts */}
              <View style={styles.budgetAmounts}>
                <Text style={styles.budgetAmountSpent}>
                  支出 ¥{Number(budget.spent).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </Text>
                <Text style={styles.budgetAmountTotal}>
                  / 预算 ¥{Number(budget.amount).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </Text>
              </View>

              {/* Over-budget warning */}
              {budget.confirmedOverBudget && (
                <View style={styles.warningBar}>
                  <Text style={styles.warningText}>
                    {budget.comparisonStatus === 'complete' ? '超支' : '超支'} ¥{Math.abs(Number(budget.remaining)).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </Text>
                </View>
              )}

              <Text style={styles.ruleText}>退款 ¥{Number(budget.refundInflow).toLocaleString(undefined, { maximumFractionDigits: 4 })} · {budget.ledger.startDate} 至 {budget.ledger.endDate}</Text>
              {Number(budget.amount) === 0 && <Text style={styles.ruleText}>零预算：发生消费即超支，不计算百分比。</Text>}
              {budget.comparisonStatus !== 'complete' && <Text style={styles.warningText}>
                {budget.comparisonStatus === 'invalid_budget' ? '预算金额无效，请编辑修正。' : `${budget.ledger.counts.needsReview} 笔异常，当前消费和进度不完整，暂不判断最终剩余额度。`}
              </Text>}
              {/* Actions */}
              <View style={styles.budgetActions}>
                <BrutalPressable
                  style={styles.editButton}
                  shadowOffset={2}
                  shadowColor={styles._colors.stroke}
                  onPress={() => { if (!resource.busy) openEditModal(budget); }}
                >
                  <Pencil size={16} color={styles._colors.textPrimary} strokeWidth={2.5} />
                  <Text style={styles.editButtonText}>编辑</Text>
                </BrutalPressable>
                <TouchableOpacity
                  style={styles.deleteButton}
                  disabled={resource.busy}
                  accessibilityLabel={`删除${budget.name}`}
                  onPress={() => handleDelete(budget)}
                >
                  <Trash2 size={16} color={styles._colors.error} strokeWidth={2.5} />
                </TouchableOpacity>
              </View>
            </View>
          ))
        ))}
      </ScrollView>

      {/* Create/Edit Modal */}
      <Modal visible={showFormModal} transparent animationType="fade" onRequestClose={closeFormModal}>
        <View style={styles.modalOverlay}>
          <ScrollView
            contentContainerStyle={styles.modalScrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>
                {editingBudget ? '编辑预算' : '新建预算'}
              </Text>

              <Status loading={resource.busy} error={resource.error} refresh={refetch} />
              {!!formError && <Text accessibilityRole="alert" style={styles.warningText}>{formError}</Text>}
              <Text style={styles.inputLabel}>预算名称</Text>
              <TextInput
                style={styles.textInput}
                value={formName}
                onChangeText={setFormName}
                placeholder="如：每月餐饮、年度旅行"
                placeholderTextColor={styles._colors.textTertiary}
                maxLength={50}
              />

              <Text style={styles.inputLabel}>预算金额</Text>
              <TextInput
                style={styles.textInput}
                value={formAmount}
                onChangeText={setFormAmount}
                placeholder="0.00"
                placeholderTextColor={styles._colors.textTertiary}
                keyboardType="decimal-pad"
              />

              <Text style={styles.inputLabel}>预算周期</Text>
              <View style={styles.periodPicker}>
                <TouchableOpacity
                  style={[styles.periodOption, formPeriod === 'monthly' && styles.periodOptionSelected]}
                  onPress={() => setFormPeriod('monthly')}
                >
                  <Text style={[
                    styles.periodOptionText,
                    formPeriod === 'monthly' && styles.periodOptionTextSelected,
                  ]}>月度</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.periodOption, formPeriod === 'yearly' && styles.periodOptionSelected]}
                  onPress={() => setFormPeriod('yearly')}
                >
                  <Text style={[
                    styles.periodOptionText,
                    formPeriod === 'yearly' && styles.periodOptionTextSelected,
                  ]}>年度</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.inputLabel}>关联分类（可选）</Text>
              <Status loading={categoryResource.loading} error={categoryResource.error} refresh={categoryResource.refresh} />
              <ScrollView
                style={styles.categoryScroll}
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
              >
                <TouchableOpacity
                  style={[styles.categoryChip, !formCategoryId && styles.categoryChipSelected]}
                  onPress={() => setFormCategoryId(undefined)}
                >
                  <Text style={styles.categoryChipIcon}>📊</Text>
                  <Text style={[
                    styles.categoryChipText,
                    !formCategoryId && styles.categoryChipTextSelected,
                  ]}>全部分类</Text>
                </TouchableOpacity>
                {(categories ?? []).map((cat: CategoryData) => (
                  <TouchableOpacity
                    key={cat.id}
                    style={[styles.categoryChip, formCategoryId === cat.id && styles.categoryChipSelected]}
                    onPress={() => setFormCategoryId(cat.id)}
                  >
                    <Text style={styles.categoryChipIcon}>{cat.icon || '📁'}</Text>
                    <Text style={[
                      styles.categoryChipText,
                      formCategoryId === cat.id && styles.categoryChipTextSelected,
                    ]}>{cat.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.inputLabel}>预警阈值（%）</Text>
              <TextInput
                style={styles.textInput}
                value={formAlertAt}
                onChangeText={setFormAlertAt}
                placeholder="80"
                placeholderTextColor={styles._colors.textTertiary}
                keyboardType="number-pad"
                maxLength={3}
              />

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelButton} onPress={closeFormModal}>
                  <Text style={styles.cancelButtonText}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.submitButton, (!formName.trim() || !formAmount) && styles.submitButtonDisabled]}
                  onPress={handleSubmitForm}
                  disabled={!formName.trim() || !formAmount || resource.busy || categoryResource.loading || !!categoryResource.error}
                >
                  <Text style={styles.submitButtonText}>
                    {editingBudget ? '保存' : '创建'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => ({
  ...StyleSheet.create({
    ruleText: { color: colors.textSecondary, fontSize: 14, lineHeight: 22, marginVertical: 8 },
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },

    // ===== Header =====
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xl,
      paddingBottom: spacing.md,
      backgroundColor: colors.surface,
      borderBottomWidth: borderWidth.medium,
      borderBottomColor: colors.divider,
    },
    backButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.textPrimary,
      flexShrink: 1,
      textAlign: 'center',
    },
    headerTitleCompact: {
      fontSize: 18,
    },
    addButton: {
      width: 44,
      height: 44,
      borderRadius: borderRadius.small,
      borderWidth: borderWidth.thin,
      borderColor: colors.divider,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },

    // ===== Summary =====
    summaryBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-around',
      marginHorizontal: spacing.lg,
      marginTop: spacing.lg,
      paddingVertical: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.card,
      borderWidth: borderWidth.thin,
      borderColor: colors.divider,
      ...shadow.small,
    },
    summaryBarCompact: {
      marginHorizontal: spacing.md,
      marginTop: spacing.md,
      paddingVertical: spacing.sm,
    },
    summaryItem: {
      flex: 1,
      minWidth: 0,
      alignItems: 'center',
    },
    summaryNumber: {
      fontSize: 22,
      fontWeight: '900',
      color: colors.textPrimary,
      fontFamily: 'Courier',
    },
    summaryLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textTertiary,
      marginTop: 2,
    },
    summaryDivider: {
      width: 1,
      height: 28,
      backgroundColor: colors.divider,
    },

    // ===== Scroll =====
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      padding: spacing.lg,
      paddingBottom: 40,
    },
    scrollContentCompact: {
      padding: spacing.md,
      paddingBottom: 40,
    },

    // ===== Empty =====
    emptyState: {
      alignItems: 'center',
      padding: spacing.xxxl,
      marginTop: spacing.xxl,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.card,
      borderWidth: borderWidth.medium,
      borderColor: colors.divider,
      ...shadow.medium,
    },
    emptyStateCompact: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xl,
      marginTop: spacing.lg,
    },
    emptyIcon: {
      fontSize: 56,
      marginBottom: spacing.md,
    },
    emptyText: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.textPrimary,
      marginBottom: spacing.sm,
    },
    emptySubtext: {
      fontSize: 14,
      fontWeight: '500',
      color: colors.textTertiary,
      marginBottom: spacing.xl,
      textAlign: 'center',
    },
    emptyButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
      borderRadius: borderRadius.button,
      borderWidth: borderWidth.medium,
      borderColor: colors.divider,
      ...shadow.small,
    },
    emptyButtonText: {
      fontSize: 15,
      fontWeight: '800',
      color: '#FFFFFF',
    },

    // ===== Budget Card =====
    budgetCard: {
      backgroundColor: colors.surface,
      borderRadius: borderRadius.card,
      borderWidth: borderWidth.medium,
      borderColor: colors.divider,
      padding: spacing.lg,
      marginBottom: spacing.md,
      ...shadow.small,
    },
    budgetHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.md,
    },
    budgetTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
      gap: spacing.md,
    },
    budgetIconBox: {
      width: 44,
      height: 44,
      borderRadius: borderRadius.medium,
      borderWidth: borderWidth.thin,
      borderColor: colors.divider,
      backgroundColor: colors.accent + '30',
      alignItems: 'center',
      justifyContent: 'center',
    },
    budgetIconText: {
      fontSize: 22,
    },
    budgetTitleGroup: {
      flex: 1,
    },
    budgetName: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    budgetCategory: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textTertiary,
      marginTop: 2,
    },
    badgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginLeft: spacing.sm,
    },
    periodBadge: {
      backgroundColor: colors.primaryLight,
      borderRadius: borderRadius.small,
      borderWidth: borderWidth.thin,
      borderColor: colors.divider,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    periodText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    percentBadge: {
      backgroundColor: colors.accent,
      borderRadius: borderRadius.small,
      borderWidth: borderWidth.thin,
      borderColor: colors.divider,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    overBudgetBadge: {
      backgroundColor: colors.error,
    },
    percentText: {
      fontSize: 13,
      fontWeight: '800',
      color: '#1A1A1A',
      fontFamily: 'Courier',
    },
    overBudgetBadgeText: {
      color: '#FFFFFF',
    },

    // Progress
    budgetProgressContainer: {
      borderRadius: borderRadius.small,
      borderWidth: borderWidth.thin,
      borderColor: colors.divider,
      overflow: 'hidden',
      marginBottom: spacing.sm,
    },

    // Amounts
    budgetAmounts: {
      flexWrap: 'wrap',
      flexDirection: 'row',
      alignItems: 'baseline',
      marginBottom: spacing.sm,
    },
    budgetAmountSpent: {
      fontSize: 16,
      fontWeight: '900',
      color: colors.textPrimary,
      fontFamily: 'Courier',
    },
    budgetAmountTotal: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textTertiary,
      fontFamily: 'Courier',
      marginLeft: spacing.xs,
    },

    // Warning
    warningBar: {
      backgroundColor: colors.error + '15',
      borderRadius: borderRadius.small,
      borderWidth: borderWidth.thin,
      borderColor: colors.error,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.md,
      marginBottom: spacing.sm,
    },
    warningText: {
      fontSize: 14,
      lineHeight: 22,
      fontWeight: '700',
      color: colors.error,
      fontFamily: 'Courier',
      textAlign: 'center',
    },

    // Actions
    budgetActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    editButton: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.button,
      borderWidth: borderWidth.thin,
      borderColor: colors.divider,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    editButtonText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    deleteButton: {
      minWidth: 44,
      minHeight: 44,
      marginLeft: 'auto',
      padding: spacing.sm,
    },

    // ===== Modal =====
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'center',
    },
    modalScrollContent: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.xxl,
    },
    modalContent: {
      backgroundColor: colors.surface,
      borderRadius: borderRadius.card,
      borderWidth: borderWidth.medium,
      borderColor: colors.divider,
      padding: spacing.xl,
      ...shadow.large,
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.textPrimary,
      marginBottom: spacing.lg,
      textAlign: 'center',
    },
    inputLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSecondary,
      marginBottom: spacing.xs,
      marginTop: spacing.md,
    },
    textInput: {
      borderWidth: borderWidth.thin,
      borderColor: colors.divider,
      borderRadius: borderRadius.input,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      fontSize: 15,
      fontWeight: '600',
      color: colors.textPrimary,
      backgroundColor: colors.background,
    },

    // Period picker
    periodPicker: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    periodOption: {
      flex: 1,
      paddingVertical: spacing.md,
      borderRadius: borderRadius.button,
      borderWidth: borderWidth.thin,
      borderColor: colors.divider,
      alignItems: 'center',
      backgroundColor: colors.background,
    },
    periodOptionSelected: {
      borderWidth: borderWidth.medium,
      backgroundColor: colors.primaryLight,
    },
    periodOptionText: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    periodOptionTextSelected: {
      color: colors.primary,
      fontWeight: '800',
    },

    // Category picker
    categoryScroll: {
      maxHeight: 160,
      marginTop: spacing.xs,
      borderWidth: borderWidth.thin,
      borderColor: colors.divider,
      borderRadius: borderRadius.input,
      backgroundColor: colors.background,
    },
    categoryChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    categoryChipSelected: {
      backgroundColor: colors.primaryLight,
    },
    categoryChipIcon: {
      fontSize: 16,
    },
    categoryChipText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    categoryChipTextSelected: {
      color: colors.primary,
      fontWeight: '800',
    },

    // Modal Actions
    modalActions: {
      flexDirection: 'row',
      gap: spacing.md,
      marginTop: spacing.xl,
    },
    cancelButton: {
      flex: 1,
      paddingVertical: spacing.md,
      borderRadius: borderRadius.button,
      borderWidth: borderWidth.thin,
      borderColor: colors.divider,
      alignItems: 'center',
    },
    cancelButtonText: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    submitButton: {
      flex: 1,
      paddingVertical: spacing.md,
      borderRadius: borderRadius.button,
      borderWidth: borderWidth.medium,
      borderColor: colors.divider,
      backgroundColor: colors.primary,
      alignItems: 'center',
      ...shadow.small,
    },
    submitButtonDisabled: {
      opacity: 0.5,
    },
    submitButtonText: {
      fontSize: 15,
      fontWeight: '800',
      color: '#FFFFFF',
    },
  }),
  _colors: colors,
});
