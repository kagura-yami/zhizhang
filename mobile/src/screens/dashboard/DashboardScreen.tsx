/**
 * Dashboard 首页 - Neo-Brutalism 风格
 * 粗线框、饱和糖果色块、粗描边、平移阴影
 * 像彩色积木构成的界面
 */
import React, { useCallback, useRef, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  PanResponder,
  DeviceEventEmitter,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ThemeColors } from '../../theme/colors';
import { borderRadius, borderWidth, spacing, shadow } from '../../theme/spacing';
import { BrutalPressable } from '../../components/ui';
import { HomeCharts } from '../../components/business';
import { DashboardSkeleton } from '../../components/skeleton';
import { useHomeDisplayPreference, useStyles } from '../../hooks';
import { useDashboard } from '../../hooks/useDashboard';
import { useAuth } from '../../providers';
import { useSocialResource, Action, Status } from '../social/shared';
import { httpService } from '../../services/http';
import { currentBusinessDate } from '../../services/api/ledger';
import LedgerNotice from '../reports/LedgerNotice';
import type { HomeMainMetric, HomeSectionId } from '../../hooks/useHomeDisplayPreference';
import { createBudgetApi, LedgerBudgetProgress } from '../../services/api/budgets';
import { invalidateCache } from '../../lib/queryClient';
import { paymentNotificationService } from '../../services/paymentNotification';
import type { BillData } from '../../types/bill';
import type { FinancialGoalProgress } from '../../types/financial-goal';
import { BillFeedbackLabel, useBillFeedbackSummaries } from '../social/billFeedback';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SWIPE_THRESHOLD = 80;
const SWIPE_VELOCITY = 0.3;

/** 统一的进度卡片数据 */
interface ProgressCardItem {
  id: string;
  type: 'budget' | 'goal';
  title: string;
  icon: string;
  progress: number | null;
  note?: string;
  currentAmount: number;
  totalAmount: number;
  color: string;
  labelLeft: string;
  labelRight: string;
}

/**
 * 可滑动丢弃的卡片堆叠组件
 * 跟随手指方向甩出，露出下方卡片
 */
function SwipeableCardStack({
  cards,
  styles,
  colors,
}: {
  cards: ProgressCardItem[];
  styles: any;
  colors: ThemeColors;
}) {
  const [topIndex, setTopIndex] = useState(0);
  const pan = useRef(new Animated.ValueXY()).current;

  // 当 cards 变化时重置
  useEffect(() => {
    setTopIndex(0);
    pan.setValue({ x: 0, y: 0 });
  }, [cards.length]);

  const panResponder = useMemo(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 5 || Math.abs(g.dy) > 5,
      onPanResponderMove: Animated.event(
        [null, { dx: pan.x, dy: pan.y }],
        { useNativeDriver: false },
      ),
      onPanResponderRelease: (_, g) => {
        const dist = Math.sqrt(g.dx * g.dx + g.dy * g.dy);
        const vel = Math.sqrt(g.vx * g.vx + g.vy * g.vy);
        const shouldDismiss = dist > SWIPE_THRESHOLD || vel > SWIPE_VELOCITY;

        if (shouldDismiss && cards.length > 1) {
          // 沿滑动方向飞出（放大到屏幕外）
          const scale = SCREEN_WIDTH * 1.5 / Math.max(dist, 1);
          const toX = g.dx * scale;
          const toY = g.dy * scale;
          Animated.timing(pan, {
            toValue: { x: toX, y: toY },
            duration: 280,
            useNativeDriver: true,
          }).start(() => {
            setTopIndex((prev) => (prev + 1) % cards.length);
            pan.setValue({ x: 0, y: 0 });
          });
        } else {
          // 弹回原位
          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            friction: 6,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  [cards.length, pan]);

  if (cards.length === 0) {return null;}

  const topRotate = pan.x.interpolate({
    inputRange: [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
    outputRange: ['-12deg', '0deg', '12deg'],
  });

  // 只渲染最多 3 张（从底到顶）
  const visibleCount = Math.min(cards.length, 3);
  const rendered = [];

  for (let i = visibleCount - 1; i >= 0; i--) {
    const cardIndex = (topIndex + i) % cards.length;
    const card = cards[cardIndex];
    const isTop = i === 0;

    const cardStyle: any = {
      position: i === 0 ? 'relative' : 'absolute',
      left: 0,
      right: 0,
      top: i * 6,
      zIndex: visibleCount - i,
      opacity: i === 2 ? 0.4 : i === 1 ? 0.7 : 1,
      transform: isTop
        ? [{ translateX: pan.x }, { translateY: pan.y }, { rotate: topRotate }]
        : [{ scale: 1 - i * 0.03 }],
    };

    rendered.push(
      <Animated.View
        key={card.id + '-' + cardIndex}
        style={[styles.progressCard, cardStyle]}
        accessibilityElementsHidden={!isTop}
        importantForAccessibility={isTop ? 'auto' : 'no-hide-descendants'}
        pointerEvents={isTop ? 'auto' : 'none'}
        {...(isTop ? panResponder.panHandlers : {})}
      >
        <View style={styles.progressCardHeader}>
          <View style={styles.budgetTitleRow}>
            <Text style={styles.sectionSticker}>{card.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.progressCardTitle}>{card.title}</Text>
              <Text style={styles.progressCardType}>
                {card.type === 'budget' ? '预算' : '目标'}
              </Text>
            </View>
          </View>
          <View style={[
            styles.budgetPercentBadge,
            (card.progress ?? 0) >= 100 && card.type === 'goal'
              ? { backgroundColor: colors.success }
              : undefined,
          ]}>
            <Text style={[
              styles.budgetPercentText,
              (card.progress ?? 0) >= 100 && card.type === 'goal'
                ? { color: '#FFFFFF' }
                : undefined,
            ]}>
              {card.progress === null ? '无百分比' : `${Math.round(card.progress)}%`}
            </Text>
          </View>
        </View>
        {card.progress !== null && <View style={styles.progressBarContainer}>
          <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.max(0, Math.min(card.progress, 100)), text: `${card.progress}%` }} style={{ height: 16, backgroundColor: colors.divider }}>
            <View style={{ width: `${Math.max(0, Math.min(card.progress, 100))}%`, height: 16, backgroundColor: card.color }} />
          </View>
        </View>}
        <View style={styles.budgetLabels}>
          <Text style={styles.budgetLabel}>{card.labelLeft}</Text>
          <Text style={styles.budgetLabel}>{card.labelRight}</Text>
        </View>
        {!!card.note && <Text style={[styles.budgetLabel, { marginTop: 10, lineHeight: 22 }]}>{card.note}</Text>}
        {isTop && cards.length > 1 && <TouchableOpacity accessibilityRole="button" onPress={() => setTopIndex(i => (i + 1) % cards.length)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={styles.budgetLabel}>下一张（{topIndex + 1}/{cards.length}） →</Text></TouchableOpacity>}
      </Animated.View>,
    );
  }

  return rendered;
}

/**
 * 列表项入场动画 - 交错滑入 + 淡入
 * 每个 item 延迟 index * 80ms，从下方 24px 滑入
 */
function AnimatedListItem({ children, index }: { children: React.ReactNode; index: number }) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 350,
      delay: index * 80,
      useNativeDriver: true,
    }).start();
  }, []);

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{
          translateY: anim.interpolate({
            inputRange: [0, 1],
            outputRange: [24, 0],
          }),
        }],
      }}
    >
      {children}
    </Animated.View>
  );
}

export default function DashboardScreen() {
  const { token } = useAuth();
  return <DashboardContent key={token || 'signed-out'} token={token || ''} />;
}
function DashboardContent({ token }: { token: string }) {
  const navigation = useNavigation();
  const styles = useStyles(createStyles);
  const {
    recentBills,
    monthIncome,
    monthExpense,
    monthBalance,
    analytics,
    data, todayFacts, todayBalance, recentTotal, error,
    todayExpense,
    todayIncome,
    isLoading,
    isFetching,
    refetch,
  } = useDashboard();
  const {
    showBudgetCard,
    mainMetric,
    secondaryMetric,
    homeSections,
  } = useHomeDisplayPreference();
  const [missingSetupCount, setMissingSetupCount] = useState(0);
  const billFeedback = useBillFeedbackSummaries(recentBills.map(bill => bill.id));
  const feedbackById = useMemo(() => new Map(billFeedback.value?.map(item => [item.billId, item])), [billFeedback.value]);

  // 首页提示会影响自动记账可靠性的关键设置，点击后统一进入权限配置。
  useFocusEffect(useCallback(() => {
    let active = true;
    const checkRequiredSettings = async () => {
      try {
        const [listener, appNotification, battery, configRaw] = await Promise.all([
          paymentNotificationService.getPermissionStatus(),
          paymentNotificationService.getAppNotificationPermissionStatus(),
          paymentNotificationService.getBatteryOptimizationStatus(),
          AsyncStorage.getItem('appGeneralConfig'),
        ]);
        const config = configRaw ? JSON.parse(configRaw) as { autoRecordEnabled?: boolean } : {};
        const missing = [listener, appNotification, battery].filter(status => status !== 'authorized').length;
        if (active) setMissingSetupCount(config.autoRecordEnabled === false ? 0 : missing);
      } catch {
        if (active) setMissingSetupCount(0);
      }
    };
    void checkRequiredSettings();
    return () => { active = false; };
  }, [refetch]));

  const budgetApi = useMemo(() => createBudgetApi(token), [token]);
  const budgetResource = useSocialResource(useCallback(() => budgetApi.progress(), [budgetApi]));
  const budgetProgressData = budgetResource.value;
  const refetchBudgets = budgetResource.refresh;
  const goalResource = useSocialResource(useCallback(async () => {
    const res = await httpService.get<FinancialGoalProgress[]>('/financial-goals/progress', { headers: { Authorization: `Bearer ${token}` } });
    const rows = Array.isArray(res) ? res : res.data;
    if (res.success === false || !Array.isArray(rows)) throw new Error(res.message || '财务目标加载失败');
    return rows as FinancialGoalProgress[];
  }, [token]));
  const goalProgressData = goalResource.value;
  const refetchGoals = goalResource.refresh;

  // 原生自动记账成功后主动刷新首页查询，避免“全部账单”已更新而“近期交易”仍显示旧缓存。
  useEffect(() => {
    // 原生模块通过 RCTDeviceEventEmitter 派发事件，使用 DeviceEventEmitter
    // 可覆盖 Release 环境，并避免 NativeEventEmitter 对模块 addListener 方法的依赖。
    const subscription = DeviceEventEmitter.addListener('onBillCreated', () => {
      invalidateCache.bills();
      refetch();
      refetchBudgets();
      refetchGoals();
    });
    return () => subscription.remove();
  }, [refetch, refetchBudgets, refetchGoals]);

  // 合并为统一的卡片数据（预算优先，财务目标补充）
  const progressCards: ProgressCardItem[] = useMemo(() => {
    const cards: ProgressCardItem[] = [];

    // 预算卡片由个性化设置单独控制，不随账单/图表切换。
    if (showBudgetCard) {
      (budgetProgressData ?? []).forEach((b: LedgerBudgetProgress) => {
        cards.push({
          id: `budget-${b.id}`,
          type: 'budget',
          title: b.name,
          icon: '📊',
          progress: b.progressPercent === null ? null : Number(b.progressPercent),
          currentAmount: Number(b.spent),
          totalAmount: Number(b.amount),
          color: b.confirmedOverBudget ? styles._colors.error : b.comparisonStatus !== 'complete' ? styles._colors.textSecondary : b.needsAlert ? styles._colors.warning : styles._colors.success,
          labelLeft: `已确认消费 ¥${Number(b.spent).toFixed(2)}`,
          labelRight: `预算 ¥${Number(b.amount).toFixed(2)}`,
          note: `${b.ledger.startDate} 至 ${b.ledger.endDate}\n退款 ¥${Number(b.refundInflow).toFixed(2)}（不抵减消费）${b.progressPercent === null ? ' · 不计算百分比' : ''}\n${b.comparisonStatus === 'invalid_budget' ? '金额无效，请编辑预算' : b.comparisonStatus === 'incomplete' ? `${b.ledger.counts.needsReview} 笔待核对，进度不完整${b.confirmedOverBudget ? '，已确认消费已超预算' : ''}` : b.isOverBudget ? `超支 ¥${Math.abs(Number(b.remaining)).toFixed(2)}` : `剩余 ¥${Number(b.remaining).toFixed(2)}`}`,

        });
      });
    }

    // 财务目标卡片（手动维护，作为补充）
    (goalProgressData ?? []).filter((g: FinancialGoalProgress) => !g.isCompleted).forEach((g: FinancialGoalProgress) => {
      cards.push({
        id: `goal-${g.id}`,
        type: 'goal',
        title: g.name,
        icon: g.icon || '🎯',
        progress: g.progress,
        currentAmount: g.currentAmount,
        totalAmount: g.targetAmount,
        color: g.color || styles._colors.success,
        labelLeft: `已存 ¥${g.currentAmount.toLocaleString()}`,
        labelRight: `目标 ¥${g.targetAmount.toLocaleString()}`,
      });
    });

    return cards;
  }, [budgetProgressData, goalProgressData, showBudgetCard, styles._colors]);

  const businessDate = data?.today ?? currentBusinessDate();
  const monthName = `${businessDate.month + 1}月账本`;
  const yearName = `${businessDate.year}`;

  const dayGroups = useMemo(() => {
    const groups = new Map<string, BillData[]>();
    recentBills.forEach((bill) => {
      const key = bill.date.slice(0, 10);
      const current = groups.get(key) || [];
      current.push(bill);
      groups.set(key, current);
    });

    return Array.from(groups.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, bills]) => ({
        date,
        bills: bills.sort((a, b) => {
          const aTime = new Date(a.time || a.createdAt || a.date).getTime();
          const bTime = new Date(b.time || b.createdAt || b.date).getTime();
          return bTime - aTime;
        }),
        facts: analytics?.daily.find(d => d.date === date),
      }));
  }, [recentBills, analytics]);

  const formatBillTime = (bill: BillData) => {
    const value = bill.time || bill.createdAt;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? '--:--'
      : parsed.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

  const formatGroupDate = (date: string) => {
    const parsed = new Date(`${date}T12:00:00`);
    const isToday = date === businessDate.key;
    return `${parsed.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}${isToday ? ' 今天' : ''}`;
  };

  const getCounterparty = (bill: BillData) => {
    if (bill.counterparty) return bill.counterparty;
    if (bill.description && !bill.description.startsWith('自动记账 ·')) return bill.description;
    return '支付详情未提供';
  };

  const onRefresh = useCallback(async () => {
    await Promise.all([refetch(), refetchBudgets(), refetchGoals(), billFeedback.refresh()]);
  }, [refetch, refetchBudgets, refetchGoals, billFeedback.refresh]);

  const handleAddBill = () => {
    navigation.navigate('CreateBill' as never);
  };

  const handleViewAllBills = () => {
    navigation.navigate('AllBills');
  };

  const handleViewExpense = () => {
    navigation.navigate('AllBills', { initialFilter: 'expense' });
  };

  const handleViewIncome = () => {
    navigation.navigate('AllBills', { initialFilter: 'income' });
  };

  const handleViewBillDetail = (bill: BillData) => {
    navigation.navigate('BillDetail', { billId: bill.id } as never);
  };

  const mainMetricData = useMemo(() => {
    const metrics: Record<HomeMainMetric, { label: string; value: number; hint: string }> = {
      dailyBalance: { label: '今日结余', value: todayBalance, hint: '已确认收入 + 退款 − 消费' },
      dailyExpense: { label: '今日支出', value: todayExpense, hint: '今日已确认消费' },
      dailyIncome: { label: '今日收入', value: todayIncome, hint: '今日已确认普通收入' },
      monthlyBalance: { label: '本月结余', value: monthBalance, hint: '已确认收入 + 退款 − 消费' },
      monthlyExpense: { label: '本月支出', value: monthExpense, hint: '本月已确认消费' },
      monthlyIncome: { label: '本月收入', value: monthIncome, hint: '本月已确认普通收入' },
    };
    return metrics[mainMetric];
  }, [mainMetric, monthBalance, monthExpense, monthIncome, todayExpense, todayIncome, todayBalance]);

  const secondaryCards = useMemo(() => {
    const cards: Array<{
      label: string;
      value: number;
      tone: 'income' | 'expense' | 'balance';
      icon: string;
      onPress?: () => void;
    }> = [];

    if (secondaryMetric === 'monthlyIncomeExpense') {
      cards.push(
        { label: '本月支出', value: monthExpense, tone: 'expense', icon: '↘', onPress: handleViewExpense },
        { label: '本月收入', value: monthIncome, tone: 'income', icon: '↗', onPress: handleViewIncome },
      );
    } else if (secondaryMetric === 'dailyIncomeExpense') {
      cards.push(
        { label: '今日支出', value: todayExpense, tone: 'expense', icon: '↘', onPress: handleViewExpense },
        { label: '今日收入', value: todayIncome, tone: 'income', icon: '↗', onPress: handleViewIncome },
      );
    } else if (secondaryMetric === 'monthlyBalance') {
      cards.push({ label: '本月结余', value: monthBalance, tone: 'balance', icon: '=', onPress: handleViewAllBills });
    } else if (secondaryMetric === 'dailyBalance') {
      cards.push({ label: '今日结余', value: todayBalance, tone: 'balance', icon: '=', onPress: handleViewAllBills });
    }

    return cards;
  }, [
    monthBalance,
    monthExpense,
    monthIncome,
    secondaryMetric,
    todayBalance,
    todayExpense,
    todayIncome,
  ]);

  // 分类图标
  const getCategoryIcon = (categoryName?: string): string => {
    const iconMap: { [key: string]: string } = {
      '餐饮': '☕',
      '交通': '🚗',
      '购物': '🛍️',
      '收入': '💰',
      '工资': '💼',
      '娱乐': '🎮',
      '医疗': '🏥',
      '教育': '📚',
    };
    return iconMap[categoryName || ''] || '📝';
  };

  // Neo-Brutalism 分类色块 - 饱和糖果色
  const getCategoryBlockColor = (categoryName?: string): string => {
    const colorMap: { [key: string]: string } = {
      '餐饮': '#FACC15',    // 明黄
      '交通': '#3B82F6',    // 蓝
      '购物': '#EC4899',    // 粉
      '收入': '#22C55E',    // 绿
      '工资': '#22C55E',    // 绿
      '娱乐': '#A855F7',    // 紫
      '医疗': '#EF4444',    // 红
      '教育': '#F97316',    // 橙
    };
    return colorMap[categoryName || ''] || '#E5E5E5';
  };

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={isFetching} onRefresh={onRefresh} />
      }
      showsVerticalScrollIndicator={false}
    >
      {/* ========== Header ========== */}
      <View style={styles.header}>
        <View>
          <View style={styles.headerTitleRow}>
            <Text style={styles.headerTitle}>{monthName}</Text>
            <Text style={styles.headerSticker}>✦</Text>
          </View>
          <Text style={styles.headerSubtitle}>{yearName}</Text>
        </View>
      </View>

      {missingSetupCount > 0 && (
        <TouchableOpacity
          style={styles.setupReminder}
          onPress={() => navigation.navigate('GeneralSettings' as never)}
          activeOpacity={0.85}
        >
          <Text style={styles.setupReminderIcon}>⚠️</Text>
          <View style={styles.setupReminderInfo}>
            <Text style={styles.setupReminderTitle}>自动记账还需要完成设置</Text>
            <Text style={styles.setupReminderText}>有 {missingSetupCount} 项关键权限未开启，可能导致通知漏记</Text>
          </View>
          <Text style={styles.setupReminderAction}>去设置 →</Text>
        </TouchableOpacity>
      )}

      <Status loading={false} error={error} refresh={refetch} />
      {data && <>
      {/* ========== Overview Card - 主色块 ========== */}
      <TouchableOpacity style={styles.overviewCard} activeOpacity={0.95}>
        {/* 装饰贴纸 */}
        <View style={styles.stickerTopRight}>
          <Text style={styles.stickerText}>⚡</Text>
        </View>
        <View style={styles.overviewContent}>
          <Text style={styles.overviewLabel}>{mainMetricData.label}</Text>
          <Text style={[
            styles.overviewBalance,
            mainMetricData.value < 0 && styles.overviewBalanceNegative,
          ]}>
            {mainMetricData.value < 0 ? '-¥ ' : '¥ '}{Math.abs(mainMetricData.value).toFixed(2)}
          </Text>
          <Text style={styles.overviewMonthHint}>{mainMetricData.hint}</Text>

          {secondaryCards.length > 0 && <View style={styles.overviewDivider} />}

          {secondaryCards.length > 0 && (
            <View style={[styles.overviewStats, secondaryCards.length === 1 && styles.overviewStatsSingle]}>
              {secondaryCards.map(card => (
                <TouchableOpacity
                  key={card.label}
                  style={styles.statBlock}
                  onPress={card.onPress}
                  activeOpacity={0.8}
                >
                  <View style={[
                    styles.statIconBlock,
                    card.tone === 'income' && styles.statIconBlockIncome,
                    card.tone === 'balance' && styles.statIconBlockBalance,
                  ]}>
                    <Text style={styles.statIcon}>{card.icon}</Text>
                  </View>
                  <View style={styles.statTextBlock}>
                    <Text style={styles.statLabel}>{card.label}</Text>
                    <Text style={styles.statValue} numberOfLines={1}>{card.value < 0 ? '-¥' : '¥'} {Math.abs(card.value).toFixed(2)}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </TouchableOpacity>

      <Text style={styles.transactionMeta}>本月汇总按完整自然月统计，包含已记录的未来日期账单。</Text>
      <LedgerNotice gridHint={false} summary={analytics?.summary} loading={false} error="" refresh={refetch} />
      {!!todayFacts && !todayFacts.complete && <Text style={styles.transactionMeta}>今日仍有 {todayFacts.counts.needsReview} 笔待核对，今日金额不完整。</Text>}
      </>}
      {showBudgetCard && <Status loading={budgetResource.loading} error={budgetResource.error} refresh={refetchBudgets} />}
      <Status loading={goalResource.loading} error={goalResource.error} refresh={refetchGoals} />
      {showBudgetCard && <Action title="管理预算与核对账单" onPress={() => navigation.navigate('Budgets' as never)} />}
      {/* ========== Progress Cards - 预算 & 财务目标 ========== */}
      {progressCards.length > 0 ? (
        <View style={[styles.carouselWrapper, { paddingBottom: 16, marginTop: 12 }]}>
          <SwipeableCardStack
            cards={progressCards}
            styles={styles}
            colors={styles._colors}
          />
        </View>
      ) : showBudgetCard && budgetResource.value && goalResource.value ? (
        <TouchableOpacity
          style={styles.progressEmptyCard}
          onPress={() => navigation.navigate('FinancialGoals' as never)}
          activeOpacity={0.8}
        >
          <Text style={styles.progressEmptyIcon}>📊</Text>
          <Text style={styles.progressEmptyText}>设置预算或财务目标来追踪进度</Text>
          <Text style={styles.progressEmptyHint}>点击前往设置 →</Text>
        </TouchableOpacity>
      ) : null}

      {/* 下方内容按个性化设置中的顺序渲染，预算/目标卡片始终在它们之前。 */}
      {data && homeSections.map((section: HomeSectionId) => section === 'charts' ? (
        <HomeCharts key="charts" analytics={analytics!} />
      ) : (
      /* ========== Recent Transactions ========== */
      <View key="bills" style={styles.section}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionSticker}>📋</Text>
            <Text style={styles.sectionTitle}>近期交易</Text>
          </View>
          <BrutalPressable
            onPress={handleViewAllBills}
            style={styles.viewAllButton}
            shadowOffset={2}
            shadowColor={styles._colors.stroke}
          >
            <Text style={styles.viewAllText}>查看全部 →</Text>
          </BrutalPressable>
        </View>

        <Text style={styles.transactionMeta}>本月最近 {recentBills.length} / {recentTotal} 条原始记录；按账单日期分组。日汇总涵盖整天已确认账单，退款单列。</Text>
        {!!billFeedback.error && <TouchableOpacity accessibilityRole="button" onPress={billFeedback.refresh} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={styles.transactionMeta}>评账状态暂不可用，点此重试</Text></TouchableOpacity>}
        {dayGroups.length > 0 ? (
          <View style={styles.transactionList}>
            {dayGroups.map((group, groupIndex) => (
              <View key={group.date} style={styles.dayGroup}>
                <View style={styles.dayHeader}>
                  <Text style={styles.dayTitle}>{formatGroupDate(group.date)}</Text>
                  {group.facts && <View style={[styles.dayTotals, { flexWrap: 'wrap' }]}>
                    <Text style={styles.dayExpense}>消费 ¥{Number(group.facts.grossExpense).toFixed(2)}</Text>
                    <Text style={styles.dayIncome}>收入 ¥{Number(group.facts.ordinaryIncome).toFixed(2)}</Text>
                    <Text style={styles.dayIncome}>退款 ¥{Number(group.facts.refundInflow).toFixed(2)}</Text>
                    <Text style={styles.dayBalance}>余 ¥{Number(group.facts.cashSurplus).toFixed(2)}{!group.facts.complete ? ' · 待核对' : ''}</Text>
                  </View>}
                </View>
                {group.bills.map((bill, index) => (
                  <AnimatedListItem key={bill.id} index={groupIndex + index}>
                    <BrutalPressable
                      style={styles.transactionItem}
                      shadowOffset={2}
                      shadowColor={styles._colors.stroke}
                      onPress={() => handleViewBillDetail(bill)}
                      accessibilityLabel={`${bill.type === 'income' ? '收入' : '支出'} ${Number(bill.amount).toFixed(2)} 元，${getCounterparty(bill)}`}
                    >
                      <View style={styles.transactionLeft}>
                        <View style={[
                          styles.transactionIcon,
                          { backgroundColor: getCategoryBlockColor(bill.category?.name) },
                        ]}>
                          <Text style={styles.transactionIconText}>
                            {bill.category?.icon || getCategoryIcon(bill.category?.name)}
                          </Text>
                        </View>
                        <View style={styles.transactionInfo}>
                          <Text style={styles.transactionTitle} numberOfLines={1}>
                            {bill.category?.name || (bill.type === 'income' ? '收入' : '支出')}
                          </Text>
                          <Text style={styles.transactionMeta} numberOfLines={1}>
                            {formatBillTime(bill)} · {getCounterparty(bill)}
                          </Text>
                          <BillFeedbackLabel feedback={feedbackById.get(bill.id)} />
                        </View>
                      </View>
                      <View style={[
                        styles.amountBadge,
                        bill.type === 'income' ? styles.incomeBadge : styles.expenseBadge,
                      ]}>
                        <Text style={[
                          styles.transactionAmount,
                          bill.type === 'income' ? styles.incomeAmount : styles.expenseAmount,
                        ]}>
                          {bill.type === 'income' ? '+' : '-'}¥{Number(bill.amount).toFixed(2)}
                        </Text>
                      </View>
                    </BrutalPressable>
                  </AnimatedListItem>
                ))}
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📝</Text>
            <Text style={styles.emptyText}>暂无交易记录</Text>
            <TouchableOpacity style={styles.emptyButton} onPress={handleAddBill}>
              <Text style={styles.emptyButtonText}>添加第一笔</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      ))}
    </ScrollView>
  );
}

// Neo-Brutalism 样式
const createStyles = (colors: ThemeColors) => ({
  ...StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xxl,
      paddingBottom: 80,
    },

    // ===== Header =====
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: spacing.xxl,
    },
    headerTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    headerTitle: {
      fontSize: 28,
      fontWeight: '800',
      color: colors.textPrimary,
      letterSpacing: -0.5,
    },
    headerSticker: {
      fontSize: 20,
      color: colors.accent,
    },
    headerSubtitle: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textTertiary,
      marginTop: spacing.xs,
      fontFamily: 'Courier',
    },
    setupReminder: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: -spacing.lg,
      marginBottom: spacing.lg,
      padding: spacing.md,
      backgroundColor: colors.warning + '22',
      borderWidth: borderWidth.thin,
      borderColor: colors.warning,
      borderRadius: borderRadius.small,
    },
    setupReminderIcon: { fontSize: 20, marginRight: spacing.sm },
    setupReminderInfo: { flex: 1, minWidth: 0, marginRight: spacing.sm },
    setupReminderTitle: { fontSize: 13, fontWeight: '800', color: colors.textPrimary },
    setupReminderText: { fontSize: 11, fontWeight: '600', color: colors.textSecondary, marginTop: 2 },
    setupReminderAction: { fontSize: 12, fontWeight: '800', color: colors.primary },

    // ===== Overview Card =====
    overviewCard: {
      backgroundColor: colors.primary,
      borderRadius: borderRadius.card,
      borderWidth: borderWidth.thick,
      borderColor: colors.stroke,
      overflow: 'hidden',
      marginBottom: spacing.xxl,
      ...shadow.large,
    },
    stickerTopRight: {
      position: 'absolute',
      right: 12,
      top: 12,
      width: 40,
      height: 40,
      borderRadius: borderRadius.small,
      backgroundColor: colors.accent,
      borderWidth: borderWidth.thin,
      borderColor: colors.stroke,
      alignItems: 'center',
      justifyContent: 'center',
      transform: [{ rotate: '12deg' }],
      zIndex: 10,
    },
    stickerText: {
      fontSize: 20,
    },
    overviewContent: {
      padding: spacing.xl,
    },
    overviewLabel: {
      fontSize: 14,
      fontWeight: '700',
      color: 'rgba(255, 255, 255, 0.85)',
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    overviewBalance: {
      fontSize: 40,
      fontWeight: '900',
      color: '#FFFFFF',
      marginTop: spacing.sm,
      letterSpacing: -1.5,
    },
    overviewBalanceNegative: {
      color: '#FFE0E0',
    },
    overviewMonthHint: {
      fontSize: 12,
      fontWeight: '700',
      color: 'rgba(255, 255, 255, 0.72)',
      marginTop: spacing.xs,
    },
    overviewDivider: {
      height: borderWidth.thin,
      backgroundColor: 'rgba(255, 255, 255, 0.3)',
      marginVertical: spacing.lg,
    },
    overviewStats: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    overviewStatsSingle: {
      flexDirection: 'column',
    },
    statBlock: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: 'rgba(0, 0, 0, 0.15)',
      borderRadius: borderRadius.medium,
      padding: spacing.md,
      borderWidth: borderWidth.thin,
      borderColor: 'rgba(255, 255, 255, 0.2)',
    },
    statBlockGreen: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: 'rgba(0, 0, 0, 0.15)',
      borderRadius: borderRadius.medium,
      padding: spacing.md,
      borderWidth: borderWidth.thin,
      borderColor: 'rgba(255, 255, 255, 0.2)',
    },
    statIconBlock: {
      width: 32,
      height: 32,
      borderRadius: borderRadius.small,
      backgroundColor: colors.error,
      borderWidth: 1.5,
      borderColor: 'rgba(255, 255, 255, 0.4)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    statIconBlockGreen: {
      width: 32,
      height: 32,
      borderRadius: borderRadius.small,
      backgroundColor: colors.success,
      borderWidth: 1.5,
      borderColor: 'rgba(255, 255, 255, 0.4)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    statIconBlockIncome: {
      backgroundColor: colors.success,
    },
    statIconBlockBalance: {
      backgroundColor: colors.primary,
    },
    statIcon: {
      fontSize: 16,
      color: '#FFFFFF',
      fontWeight: '800',
    },
    statLabel: {
      fontSize: 11,
      color: 'rgba(255, 255, 255, 0.7)',
      fontWeight: '600',
    },
    statValue: {
      fontSize: 16,
      fontWeight: '800',
      color: '#FFFFFF',
    },
    statTextBlock: {
      flex: 1,
      minWidth: 0,
    },

    // ===== Progress Cards Stack =====
    carouselWrapper: {
      marginBottom: spacing.md,
      position: 'relative',
    },
    progressCard: {
      backgroundColor: colors.surface,
      borderRadius: borderRadius.card,
      borderWidth: borderWidth.medium,
      borderColor: colors.stroke,
      padding: spacing.lg,
      ...shadow.medium,
    },
    progressCardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.md,
    },
    progressCardTitle: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    progressCardType: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textTertiary,
      fontFamily: 'Courier',
      marginTop: 1,
    },

    // Budget card styles (reused for progress cards)
    budgetTitleRow: {
      flex: 1,
      marginRight: 8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    budgetPercentBadge: {
      backgroundColor: colors.accent,
      borderRadius: borderRadius.small,
      borderWidth: borderWidth.thin,
      borderColor: colors.stroke,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    budgetPercentText: {
      fontSize: 14,
      fontWeight: '800',
      color: '#1A1A1A',
      fontFamily: 'Courier',
    },
    progressBarContainer: {
      borderRadius: borderRadius.small,
      borderWidth: borderWidth.thin,
      borderColor: colors.stroke,
      overflow: 'hidden',
      marginBottom: spacing.md,
    },
    budgetProgressBar: {
    },
    budgetLabels: {
      flexWrap: 'wrap',
      gap: 8,
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    budgetLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textTertiary,
      fontFamily: 'Courier',
    },

    // Progress empty state
    progressEmptyCard: {
      backgroundColor: colors.surface,
      borderRadius: borderRadius.card,
      borderWidth: borderWidth.medium,
      borderColor: colors.stroke,
      borderStyle: 'dashed',
      padding: spacing.xl,
      marginBottom: spacing.xxl,
      alignItems: 'center',
    },
    progressEmptyIcon: {
      fontSize: 32,
      marginBottom: spacing.sm,
    },
    progressEmptyText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textTertiary,
      textAlign: 'center',
    },
    progressEmptyHint: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.primary,
      marginTop: spacing.sm,
    },

    // ===== Section =====
    section: {
    },
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.lg,
    },
    sectionTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    sectionSticker: {
      fontSize: 18,
    },
    sectionTitle: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    viewAllButton: {
      backgroundColor: colors.surface,
      borderRadius: borderRadius.small,
      borderWidth: borderWidth.thin,
      borderColor: colors.stroke,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    viewAllText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textPrimary,
    },

    // ===== Transaction List =====
    transactionList: {
      gap: spacing.md,
    },
    dayGroup: {
      gap: spacing.sm,
    },
    dayHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xs,
      paddingTop: spacing.xs,
    },
    dayTitle: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    dayTotals: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      flexWrap: 'wrap',
      gap: spacing.sm,
      flex: 1,
      marginLeft: spacing.sm,
    },
    dayExpense: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.error,
      fontFamily: 'Courier',
    },
    dayIncome: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.success,
      fontFamily: 'Courier',
    },
    dayBalance: {
      color: colors.textPrimary,
      fontSize: 12,
      fontWeight: '800',
      fontFamily: 'Courier',
    },
    transactionItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.card,
      borderWidth: borderWidth.medium,
      borderColor: colors.stroke,
    },
    transactionLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    transactionIcon: {
      width: 48,
      height: 48,
      borderRadius: borderRadius.medium,
      borderWidth: borderWidth.thin,
      borderColor: colors.stroke,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.md,
    },
    transactionIconText: {
      fontSize: 22,
    },
    transactionInfo: {
      flex: 1,
    },
    transactionTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textPrimary,
      marginBottom: spacing.xs,
    },
    transactionMeta: {
      fontSize: 12,
      fontWeight: '500',
      color: colors.textTertiary,
      fontFamily: 'Courier',
    },
    amountBadge: {
      borderRadius: borderRadius.small,
      borderWidth: borderWidth.thin,
      borderColor: colors.stroke,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    incomeBadge: {
      backgroundColor: '#DCFCE7',
    },
    expenseBadge: {
      backgroundColor: '#FEE2E2',
    },
    transactionAmount: {
      fontSize: 15,
      fontWeight: '800',
      fontFamily: 'Courier',
    },
    incomeAmount: {
      color: '#16A34A',
    },
    expenseAmount: {
      color: '#DC2626',
    },

    // ===== Empty State =====
    emptyState: {
      alignItems: 'center',
      padding: spacing.xxl,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.card,
      borderWidth: borderWidth.medium,
      borderColor: colors.stroke,
      ...shadow.medium,
    },
    emptyIcon: {
      fontSize: 48,
      marginBottom: spacing.md,
    },
    emptyText: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textTertiary,
      marginBottom: spacing.lg,
    },
    emptyButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
      borderRadius: borderRadius.button,
      borderWidth: borderWidth.medium,
      borderColor: colors.stroke,
      ...shadow.small,
    },
    emptyButtonText: {
      fontSize: 15,
      fontWeight: '800',
      color: '#FFFFFF',
    },

  }),
  _colors: colors,
});
