/**
 * 首页展示偏好。
 * 主卡片指标、主卡片底部摘要、账单/图表和预算卡片分别保存，互不影响。
 */
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type HomeDisplayMode = 'bills' | 'charts';
export type HomeSectionId = 'bills' | 'charts';
export type HomeMainMetric =
  | 'dailyBalance'
  | 'dailyExpense'
  | 'dailyIncome'
  | 'monthlyBalance'
  | 'monthlyExpense'
  | 'monthlyIncome';
export type HomeSecondaryMetric =
  | 'monthlyIncomeExpense'
  | 'dailyIncomeExpense'
  | 'monthlyBalance'
  | 'dailyBalance'
  | 'none';

const STORAGE_KEY = '@zhizhang/home_display_mode';
const BUDGET_CARD_STORAGE_KEY = '@zhizhang/home_budget_card_enabled';
const MAIN_METRIC_STORAGE_KEY = '@zhizhang/home_main_metric';
const SECONDARY_METRIC_STORAGE_KEY = '@zhizhang/home_secondary_metric';
const HOME_SECTIONS_STORAGE_KEY = '@zhizhang/home_sections';

export const DEFAULT_HOME_SECTIONS: HomeSectionId[] = ['bills'];

const normalizeHomeSections = (value: unknown): HomeSectionId[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is HomeSectionId => item === 'bills' || item === 'charts')
    .filter((item, index, list) => list.indexOf(item) === index);
};

export function useHomeDisplayPreference() {
  const [mode, setModeState] = useState<HomeDisplayMode>('bills');
  const [showBudgetCard, setShowBudgetCardState] = useState(true);
  // 默认组合：主卡片突出今日结余，下方同时显示本月收入和支出。
  const [mainMetric, setMainMetricState] = useState<HomeMainMetric>('dailyBalance');
  const [secondaryMetric, setSecondaryMetricState] = useState<HomeSecondaryMetric>('monthlyIncomeExpense');
  const [homeSections, setHomeSectionsState] = useState<HomeSectionId[]>(DEFAULT_HOME_SECTIONS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      AsyncStorage.getItem(STORAGE_KEY),
      AsyncStorage.getItem(BUDGET_CARD_STORAGE_KEY),
      AsyncStorage.getItem(MAIN_METRIC_STORAGE_KEY),
      AsyncStorage.getItem(SECONDARY_METRIC_STORAGE_KEY),
      AsyncStorage.getItem(HOME_SECTIONS_STORAGE_KEY),
    ])
      .then(([modeValue, budgetValue, mainMetricValue, secondaryMetricValue, sectionsValue]) => {
        if (!active) return;
        if (modeValue === 'charts' || modeValue === 'bills') setModeState(modeValue);
        if (budgetValue === 'true' || budgetValue === 'false') setShowBudgetCardState(budgetValue === 'true');
        if (
          mainMetricValue === 'dailyBalance' ||
          mainMetricValue === 'dailyExpense' ||
          mainMetricValue === 'dailyIncome' ||
          mainMetricValue === 'monthlyBalance' ||
          mainMetricValue === 'monthlyExpense' ||
          mainMetricValue === 'monthlyIncome'
        ) {
          setMainMetricState(mainMetricValue);
        }
        if (
          secondaryMetricValue === 'monthlyIncomeExpense' ||
          secondaryMetricValue === 'dailyIncomeExpense' ||
          secondaryMetricValue === 'monthlyBalance' ||
          secondaryMetricValue === 'dailyBalance' ||
          secondaryMetricValue === 'none'
        ) {
          setSecondaryMetricState(secondaryMetricValue);
        }

        let storedSections: HomeSectionId[] = [];
        if (sectionsValue !== null) {
          try {
            storedSections = normalizeHomeSections(JSON.parse(sectionsValue));
          } catch (error) {
            console.warn('[首页展示偏好] 下方内容设置格式无效', error);
          }
        }
        // 兼容旧版本只保存账单/图表单选项的情况。
        if (sectionsValue === null && (modeValue === 'bills' || modeValue === 'charts')) {
          storedSections = [modeValue];
        }
        setHomeSectionsState(sectionsValue === null && storedSections.length === 0 ? DEFAULT_HOME_SECTIONS : storedSections);
      })
      .catch((error) => console.warn('[首页展示偏好] 读取失败', error))
      .finally(() => {
        if (active) setLoaded(true);
      });

    return () => {
      active = false;
    };
  }, []);

  const setMode = useCallback(async (nextMode: HomeDisplayMode) => {
    setModeState(nextMode);
    setHomeSectionsState([nextMode]);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, nextMode);
      await AsyncStorage.setItem(HOME_SECTIONS_STORAGE_KEY, JSON.stringify([nextMode]));
    } catch (error) {
      console.warn('[首页展示偏好] 保存失败', error);
    }
  }, []);

  const setHomeSections = useCallback(async (nextSections: HomeSectionId[]) => {
    const normalized = normalizeHomeSections(nextSections);
    setHomeSectionsState(normalized);
    // 旧字段保留为首个内容，便于旧版客户端读取时仍有合理结果。
    setModeState(normalized[0] || 'bills');
    try {
      await AsyncStorage.setItem(HOME_SECTIONS_STORAGE_KEY, JSON.stringify(normalized));
      await AsyncStorage.setItem(STORAGE_KEY, normalized[0] || 'bills');
    } catch (error) {
      console.warn('[首页展示偏好] 下方内容保存失败', error);
    }
  }, []);

  const setShowBudgetCard = useCallback(async (enabled: boolean) => {
    setShowBudgetCardState(enabled);
    try {
      await AsyncStorage.setItem(BUDGET_CARD_STORAGE_KEY, String(enabled));
    } catch (error) {
      console.warn('[首页展示偏好] 预算卡片设置保存失败', error);
    }
  }, []);

  const setMainMetric = useCallback(async (nextMetric: HomeMainMetric) => {
    setMainMetricState(nextMetric);
    try {
      await AsyncStorage.setItem(MAIN_METRIC_STORAGE_KEY, nextMetric);
    } catch (error) {
      console.warn('[首页展示偏好] 主指标保存失败', error);
    }
  }, []);

  const setSecondaryMetric = useCallback(async (nextMetric: HomeSecondaryMetric) => {
    setSecondaryMetricState(nextMetric);
    try {
      await AsyncStorage.setItem(SECONDARY_METRIC_STORAGE_KEY, nextMetric);
    } catch (error) {
      console.warn('[首页展示偏好] 辅助摘要保存失败', error);
    }
  }, []);

  return {
    mode,
    setMode,
    showBudgetCard,
    setShowBudgetCard,
    mainMetric,
    setMainMetric,
    secondaryMetric,
    setSecondaryMetric,
    homeSections,
    setHomeSections,
    loaded,
  };
}
