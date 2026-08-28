/**
 * 应用版本号统一读取入口。
 *
 * Android 必须以已安装 APK 的 BuildConfig.VERSION_NAME 为准，不能使用热更新
 * bundle 内嵌的 package.json，否则旧 bundle 会让界面短暂显示错误版本号。
 */
import { NativeModules, Platform } from 'react-native';
import packageJson from '../../package.json';

interface InstallApkNativeModule {
  appVersion?: string;
  getAppVersion?: () => Promise<string>;
}
function normalizeVersion(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** 同步读取原生模块常量，供首屏渲染和同步服务使用。 */
export function getInstalledAppVersionSync(): string | null {
  if (Platform.OS !== 'android') return packageJson.version;
  const installApk = NativeModules.InstallApk as InstallApkNativeModule | undefined;
  return normalizeVersion(installApk?.appVersion);
}

/**
 * 异步确认已安装应用版本。原生常量不可用时再调用桥接方法；仅在非 Android
 * 或原生模块确实缺失的开发环境中回退 package.json。
 */
export async function getInstalledAppVersion(): Promise<string> {
  const syncVersion = getInstalledAppVersionSync();
  if (syncVersion) return syncVersion;

  const installApk = NativeModules.InstallApk as InstallApkNativeModule | undefined;
  const nativeVersion = await installApk?.getAppVersion?.();
  return normalizeVersion(nativeVersion) ?? packageJson.version;
}
