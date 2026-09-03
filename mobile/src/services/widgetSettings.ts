import { NativeModules, Platform } from 'react-native';

export type WidgetTheme = 'light' | 'dark' | 'auto';
export type WidgetAccent = 'blue' | 'green' | 'purple';
export interface WidgetSettings {
  theme: WidgetTheme;
  accent: WidgetAccent;
  showBalance: boolean;
  showMonthly: boolean;
  compact: boolean;
}

const fallback: WidgetSettings = { theme: 'light', accent: 'blue', showBalance: true, showMonthly: true, compact: false };
const module = NativeModules.WidgetSettingsModule;

export const widgetSettingsService = {
  async get(): Promise<WidgetSettings> {
    if (Platform.OS !== 'android' || !module?.getSettings) return fallback;
    try { return { ...fallback, ...(await module.getSettings()) }; } catch { return fallback; }
  },
  async save(settings: WidgetSettings): Promise<boolean> {
    if (Platform.OS !== 'android' || !module?.saveSettings) return false;
    try { await module.saveSettings(settings); return true; } catch { return false; }
  },
  async refresh(): Promise<void> {
    if (Platform.OS !== 'android' || !module?.refreshWidget) return;
    try { await module.refreshWidget(); } catch { /* 组件下次周期任务会重试 */ }
  },
};
