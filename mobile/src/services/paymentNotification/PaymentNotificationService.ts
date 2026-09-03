/**
 * 支付通知服务
 *
 * 用于管理支付通知监听的权限。
 * 实际的支付检测和记账逻辑已移至 Android 原生层处理。
 *
 * @author zhizhang
 * @since 1.0.0
 */

import { NativeModules, Platform } from 'react-native';
import type { BillNotificationSettings, NotificationSoundItem, PermissionStatus } from './types';

const { PaymentNotificationModule } = NativeModules;

/**
 * 支付通知服务类
 */
class PaymentNotificationService {
  /**
   * 检查当前平台是否支持支付通知功能
   */
  isSupported(): boolean {
    return Platform.OS === 'android' && !!PaymentNotificationModule;
  }

  /**
   * 获取通知监听权限状态
   */
  async getPermissionStatus(): Promise<PermissionStatus> {
    if (!this.isSupported()) {
      return 'unknown';
    }

    try {
      const status = await PaymentNotificationModule.getPermissionStatus();
      return status as PermissionStatus;
    } catch (error) {
      console.error('Failed to get permission status:', error);
      return 'unknown';
    }
  }

  /**
   * 获取悬浮窗权限状态
   */
  async getOverlayPermissionStatus(): Promise<PermissionStatus> {
    if (!this.isSupported()) {
      return 'unknown';
    }

    try {
      const status = await PaymentNotificationModule.getOverlayPermissionStatus();
      return status as PermissionStatus;
    } catch (error) {
      console.error('Failed to get overlay permission status:', error);
      return 'unknown';
    }
  }

  /**
   * 请求通知监听权限
   * 会跳转到系统设置页面
   */
  requestPermission(): void {
    if (!this.isSupported()) {
      return;
    }

    try {
      PaymentNotificationModule.requestPermission();
    } catch (error) {
      console.error('Failed to request permission:', error);
    }
  }

  /**
   * 请求悬浮窗权限
   * 会跳转到系统设置页面
   */
  requestOverlayPermission(): void {
    if (!this.isSupported()) {
      return;
    }

    try {
      PaymentNotificationModule.requestOverlayPermission();
    } catch (error) {
      console.error('Failed to request overlay permission:', error);
    }
  }

  /**
   * 保存监听应用配置
   *
   * @param monitoredApps 监听应用列表
   * @param filterKeywords 过滤关键词列表
   */
  async saveMonitoringConfig(
    monitoredApps: Array<{ packageName: string; appName: string; enabled: boolean }>,
    filterKeywords: string[],
    autoRecordEnabled = true,
  ): Promise<boolean> {
    if (!this.isSupported()) {
      return false;
    }

    try {
      await PaymentNotificationModule.saveMonitoringConfig(monitoredApps, filterKeywords, autoRecordEnabled);
      return true;
    } catch (error) {
      console.error('Failed to save monitoring config:', error);
      return false;
    }
  }

  /**
   * 获取已安装应用列表
   *
   * @returns 已安装应用列表
   */
  async getInstalledApps(): Promise<Array<{ packageName: string; appName: string }>> {
    if (!this.isSupported()) {
      return [];
    }

    try {
      const apps = await PaymentNotificationModule.getInstalledApps();
      return apps;
    } catch (error) {
      console.error('Failed to get installed apps:', error);
      return [];
    }
  }

  async getBillNotificationSettings(): Promise<BillNotificationSettings> {
    const fallback: BillNotificationSettings = { enabled: true, sound: 'default' };
    if (!this.isSupported()) return fallback;
    try {
      const settings = await PaymentNotificationModule.getBillNotificationSettings();
      return {
        enabled: settings?.enabled !== false,
        sound: settings?.sound === 'silent' || settings?.sound === 'custom' ? settings.sound : 'default',
        soundUri: settings?.soundUri || null,
        soundName: settings?.soundName || null,
      };
    } catch (error) {
      console.error('Failed to get bill notification settings:', error);
      return fallback;
    }
  }

  async saveBillNotificationSettings(settings: BillNotificationSettings): Promise<boolean> {
    if (!this.isSupported()) return false;
    try {
      await PaymentNotificationModule.saveBillNotificationSettings(
        settings.enabled,
        settings.sound,
        settings.soundUri || null,
        settings.soundName || null,
      );
      return true;
    } catch (error) {
      console.error('Failed to save bill notification settings:', error);
      return false;
    }
  }

  async getBillNotificationSounds(): Promise<NotificationSoundItem[]> {
    if (!this.isSupported()) return [];
    try {
      const sounds = await PaymentNotificationModule.getBillNotificationSounds();
      return Array.isArray(sounds) ? sounds : [];
    } catch (error) {
      console.error('Failed to get bill notification sounds:', error);
      return [];
    }
  }

  async pickBillNotificationSound(): Promise<NotificationSoundItem | null> {
    if (!this.isSupported()) return null;
    try {
      return await PaymentNotificationModule.pickBillNotificationSound();
    } catch (error) {
      console.error('Failed to pick bill notification sound:', error);
      return null;
    }
  }

  async saveBillNotificationSoundClip(soundId: string, startMs: number, endMs: number): Promise<NotificationSoundItem | null> {
    if (!this.isSupported()) return null;
    try {
      return await PaymentNotificationModule.saveBillNotificationSoundClip(soundId, startMs, endMs);
    } catch (error) {
      console.error('Failed to save bill notification sound clip:', error);
      throw error;
    }
  }

  async previewBillNotificationSound(soundId: string): Promise<boolean> {
    if (!this.isSupported()) return false;
    try {
      return await PaymentNotificationModule.previewBillNotificationSound(soundId);
    } catch (error) {
      console.error('Failed to preview bill notification sound:', error);
      return false;
    }
  }

  stopBillNotificationSoundPreview(): void {
    if (!this.isSupported()) return;
    try {
      PaymentNotificationModule.stopBillNotificationSoundPreview();
    } catch (error) {
      console.error('Failed to stop bill notification sound preview:', error);
    }
  }

  async getAppNotificationPermissionStatus(): Promise<PermissionStatus> {
    if (!this.isSupported()) return 'unknown';
    try {
      const status = await PaymentNotificationModule.getAppNotificationPermissionStatus();
      return status as PermissionStatus;
    } catch (error) {
      console.error('Failed to get app notification permission:', error);
      return 'unknown';
    }
  }

  requestAppNotificationPermission(): void {
    if (!this.isSupported()) return;
    try {
      PaymentNotificationModule.requestAppNotificationPermission();
    } catch (error) {
      console.error('Failed to request app notification permission:', error);
    }
  }

  openAppNotificationSettings(): void {
    if (!this.isSupported()) return;
    try {
      PaymentNotificationModule.openAppNotificationSettings();
    } catch (error) {
      console.error('Failed to open app notification settings:', error);
    }
  }

  async getBatteryOptimizationStatus(): Promise<PermissionStatus> {
    if (!this.isSupported()) return 'unknown';
    try {
      return (await PaymentNotificationModule.getBatteryOptimizationStatus()) as PermissionStatus;
    } catch (error) {
      console.error('Failed to get battery optimization status:', error);
      return 'unknown';
    }
  }

  requestBatteryOptimizationPermission(): void {
    if (!this.isSupported()) return;
    try {
      PaymentNotificationModule.requestBatteryOptimizationPermission();
    } catch (error) {
      console.error('Failed to request battery optimization permission:', error);
    }
  }

  async getInstallPermissionStatus(): Promise<PermissionStatus> {
    if (!this.isSupported()) return 'unknown';
    try {
      return (await PaymentNotificationModule.getInstallPermissionStatus()) as PermissionStatus;
    } catch (error) {
      console.error('Failed to get install permission status:', error);
      return 'unknown';
    }
  }

  requestInstallPermission(): void {
    if (!this.isSupported()) return;
    try {
      PaymentNotificationModule.requestInstallPermission();
    } catch (error) {
      console.error('Failed to request install permission:', error);
    }
  }
}

export const paymentNotificationService = new PaymentNotificationService();
