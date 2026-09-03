import React, { useCallback, useEffect, useState } from 'react';
import { AppState, DeviceEventEmitter, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Provider as PaperProvider, MD3DarkTheme, MD3LightTheme } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient, invalidateCache } from './src/lib/queryClient';
import { useAppStateManager, useAppUpdate, useHotUpdate } from './src/hooks';
import { UpdateModal } from './src/components/UpdateModal';
import { ThemeProvider, useTheme, AuthProvider, AlertProvider } from './src/providers';
import { useAlert } from './src/providers';
import AppNavigator from './src/navigation/AppNavigator';

const { PaymentNotificationModule } = NativeModules;

function AppContent() {
  // 管理应用状态，处理后台缓存清理
  useAppStateManager();

  // 获取主题
  const { isDark, colors } = useTheme();
  const { alert } = useAlert();
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true);

  const refreshAutoUpdateSetting = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem('appGeneralConfig');
      const parsed = raw ? JSON.parse(raw) as { autoUpdateEnabled?: boolean } : {};
      setAutoUpdateEnabled(parsed.autoUpdateEnabled !== false);
    } catch {
      setAutoUpdateEnabled(true);
    }
  }, []);

  // 检查应用更新
  const {
    showModal,
    latestVersion,
    updateHistory,
    downloading,
    progress,
    hideModal,
    downloadAndInstall,
  } = useAppUpdate({ autoCheck: true });

  // 热更新（静默检查，非强制更新下次启动生效）
  const hotUpdate = useHotUpdate({ autoCheck: autoUpdateEnabled });

  useEffect(() => {
    void refreshAutoUpdateSetting();
    const settingSubscription = DeviceEventEmitter.addListener(
      'autoUpdateSettingChanged',
      (enabled: boolean) => setAutoUpdateEnabled(enabled),
    );
    const appStateSubscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refreshAutoUpdateSetting();
    });
    return () => {
      settingSubscription.remove();
      appStateSubscription.remove();
    };
  }, [refreshAutoUpdateSetting]);

  useEffect(() => {
    AsyncStorage.getItem('pendingAutoUpdateNotice').then(raw => {
      if (!raw) return;
      const notice = JSON.parse(raw) as { version?: number; updateLog?: string };
      AsyncStorage.removeItem('pendingAutoUpdateNotice').catch(() => undefined);
      alert('自动更新完成', notice.updateLog?.trim() || '知账已完成一次后台更新');
    }).catch(() => undefined);
  }, [alert]);

  // 有热更新且不是强制更新时自动静默下载
  useEffect(() => {
    if (autoUpdateEnabled && hotUpdate.hasUpdate && hotUpdate.bundleInfo && hotUpdate.status === 'idle') {
      const bundle = hotUpdate.bundleInfo;
      hotUpdate.applyUpdate().then(success => {
        if (!success) return;
        AsyncStorage.setItem('pendingAutoUpdateNotice', JSON.stringify({
          version: bundle.bundleVersion,
          updateLog: bundle.updateLog,
        })).catch(() => undefined);
      });
    }
  }, [autoUpdateEnabled, hotUpdate.hasUpdate, hotUpdate.bundleInfo, hotUpdate.status]);

  // 监听账单创建成功事件
  useEffect(() => {
    console.log('[App] 开始注册账单创建事件监听器...');

    if (!PaymentNotificationModule) {
      console.warn('[App] PaymentNotificationModule 不可用');
      return;
    }

    console.log('[App] PaymentNotificationModule 可用，创建事件监听器');
    const subscription = DeviceEventEmitter.addListener('onBillCreated', () => {
      console.log('========================================');
      console.log('[App] ✓ 收到账单创建成功事件！');
      console.log('[App] 开始刷新数据...');
      console.log('========================================');

      // 使账单相关的所有缓存失效
      invalidateCache.bills();

      console.log('[App] 缓存失效完成，等待重新获取数据');
    });

    console.log('[App] ✓ 事件监听器注册成功');

    return () => {
      console.log('[App] 注销事件监听器');
      subscription.remove();
    };
  }, []);

  // 配置 Paper 主题
  const paperTheme = isDark
    ? { ...MD3DarkTheme, colors: { ...MD3DarkTheme.colors, primary: colors.primary } }
    : { ...MD3LightTheme, colors: { ...MD3LightTheme.colors, primary: colors.primary } };

  return (
    <PaperProvider theme={paperTheme}>
      <AppNavigator />
      <UpdateModal
        visible={showModal}
        versionInfo={latestVersion}
        updateHistory={updateHistory}
        downloading={downloading}
        progress={progress}
        onConfirm={downloadAndInstall}
        onCancel={hideModal}
      />
    </PaperProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <AlertProvider>
              <AppContent />
            </AlertProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
