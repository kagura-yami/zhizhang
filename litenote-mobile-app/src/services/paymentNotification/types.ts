/**
 * 支付通知服务类型定义
 */

/**
 * 支付来源类型
 */
export type PaymentSource = 'wechat' | 'alipay' | 'pinduoduo' | 'bank_sms' | 'bank_app' | 'unknown';

/**
 * 权限状态类型
 */
export type PermissionStatus = 'authorized' | 'denied' | 'unknown';

export type BillNotificationSound = 'default' | 'silent' | 'custom';

export interface BillNotificationSettings {
  enabled: boolean;
  sound: BillNotificationSound;
  soundUri?: string | null;
  soundName?: string | null;
}

export interface NotificationSoundItem {
  id: string;
  name: string;
  sourceUri: string;
  soundUri: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  createdAt: number;
}
