/**
 * 应用更新检查 Hook
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { AppState, Platform, NativeModules } from 'react-native';
import RNFS from 'react-native-fs';
import { appVersionApi, AppVersionInfo } from '../services/api/appVersion';
import { useAlert } from '../providers';
import { getInstalledAppVersion, getInstalledAppVersionSync } from '../utils/appVersion';

interface UpdateState {
  checking: boolean;
  hasUpdate: boolean;
  latestVersion: AppVersionInfo | null;
  updateHistory: AppVersionInfo[];
  showModal: boolean;
  downloading: boolean;
  progress: number;
}

interface UseAppUpdateOptions {
  /** 是否在 hook 挂载时自动检查更新，默认 true */
  autoCheck?: boolean;
}

export function useAppUpdate(options: UseAppUpdateOptions = {}) {
  const { autoCheck = true } = options;
  const { alert } = useAlert();
  const [state, setState] = useState<UpdateState>({
    checking: false,
    hasUpdate: false,
    latestVersion: null,
    updateHistory: [],
    showModal: false,
    downloading: false,
    progress: 0,
  });
  const downloadJobId = useRef<number | null>(null);
  const appState = useRef(AppState.currentState);

  const [currentVersion, setCurrentVersion] = useState(
    () => getInstalledAppVersionSync() ?? '读取中…',
  );

  /**
   * 以已安装 APK 的 versionName 为准。JS 热更新包可能比原生 APK 旧，不能把
   * bundle 中编译时嵌入的 package.json 当作当前应用版本。
   */
  const refreshCurrentVersion = useCallback(async () => {
    const installedVersion = await getInstalledAppVersion();
    setCurrentVersion(installedVersion);
    return installedVersion;
  }, []);

  const checkUpdate = useCallback(async (showNoUpdateAlert = false) => {
    if (Platform.OS !== 'android') return;

    console.log('[useAppUpdate] 开始检查更新...');
    setState(prev => ({ ...prev, checking: true }));

    try {
      const installedVersion = await refreshCurrentVersion();
      const result = await appVersionApi.checkUpdate(installedVersion);
      console.log('[useAppUpdate] API 返回结果:', JSON.stringify(result));

      setState(prev => ({
        ...prev,
        checking: false,
        hasUpdate: result.hasUpdate,
        latestVersion: result.latestVersion || null,
        updateHistory: result.updates || (result.latestVersion ? [result.latestVersion] : []),
        showModal: result.hasUpdate && !!result.latestVersion,
      }));

      if (result.hasUpdate && result.latestVersion) {
        const combinedUpdateLog = (result.updates?.length
          ? result.updates.map(item => item.updateLog).filter(Boolean).join('；')
          : result.latestVersion.updateLog) || '';
        const notificationPromise = NativeModules.InstallApk?.notifyUpdateAvailable?.(
          result.latestVersion.version,
          combinedUpdateLog,
        );
        notificationPromise?.catch?.(() => undefined);
      }

      if (!result.hasUpdate && showNoUpdateAlert) {
        alert('检查更新', '当前已是最新版本');
      }
    } catch (error) {
      console.log('[useAppUpdate] 检查更新失败:', error);
      setState(prev => ({ ...prev, checking: false }));
      if (showNoUpdateAlert) {
        alert('检查更新', '检查更新失败，请稍后重试');
      }
    }
  }, [refreshCurrentVersion, alert]);

  const hideModal = useCallback(() => {
    setState(prev => ({ ...prev, showModal: false }));
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (!state.latestVersion) return;

    const { downloadUrl, version } = state.latestVersion;
    const filePath = `${RNFS.CachesDirectoryPath}/app-v${version}.apk`;

    console.log('[useAppUpdate] 开始下载:', downloadUrl);
    console.log('[useAppUpdate] 保存路径:', filePath);

    setState(prev => ({ ...prev, downloading: true, progress: 0 }));

    try {
      const downloadResult = RNFS.downloadFile({
        fromUrl: downloadUrl,
        toFile: filePath,
        progress: (res) => {
          const progress = Math.round((res.bytesWritten / res.contentLength) * 100);
          setState(prev => ({ ...prev, progress }));
        },
        progressDivider: 1,
      });

      downloadJobId.current = downloadResult.jobId;

      const result = await downloadResult.promise;
      console.log('[useAppUpdate] 下载完成:', result);

      if (result.statusCode === 200) {
        setState(prev => ({ ...prev, downloading: false, showModal: false }));
        // 安装 APK
        installApk(filePath);
      } else {
        throw new Error(`下载失败: ${result.statusCode}`);
      }
    } catch (error: any) {
      console.log('[useAppUpdate] 下载失败:', error);
      setState(prev => ({ ...prev, downloading: false }));
      alert('下载失败', error.message || '下载更新包失败，请稍后重试');
    }
  }, [state.latestVersion, alert]);

  const installApk = useCallback(async (filePath: string) => {
    try {
      // 使用 Android Intent 安装 APK
      const { InstallApk } = NativeModules;
      if (InstallApk) {
        InstallApk.install(filePath);
      } else {
        // 备用方案：使用 react-native-fs 的 Android 特定方法
        await RNFS.scanFile(filePath);
        alert('下载完成', '请在通知栏或文件管理器中点击安装包进行安装');
      }
    } catch (error) {
      console.log('[useAppUpdate] 安装失败:', error);
      alert('安装失败', '请手动安装下载的 APK 文件');
    }
  }, [alert]);

  // 启动时自动检查更新（可通过 autoCheck 参数禁用）
  useEffect(() => {
    if (autoCheck) {
      checkUpdate(false);
    }
  }, [autoCheck, checkUpdate]);

  // 从后台回到前台时再次检查，保证用户打开记账本或切回应用后能立即收到提示。
  useEffect(() => {
    if (!autoCheck) return;
    const subscription = AppState.addEventListener('change', nextState => {
      const wasBackground = appState.current.match(/inactive|background/);
      appState.current = nextState;
      if (wasBackground && nextState === 'active') {
        checkUpdate(false);
      }
    });
    return () => subscription.remove();
  }, [autoCheck, checkUpdate]);

  // 即使禁用自动检查更新，也要在页面挂载时确认真实 APK 版本号。
  useEffect(() => {
    refreshCurrentVersion().catch(error => {
      console.log('[useAppUpdate] 读取当前版本失败:', error);
    });
  }, [refreshCurrentVersion]);

  // 清理下载任务
  useEffect(() => {
    return () => {
      if (downloadJobId.current) {
        RNFS.stopDownload(downloadJobId.current);
      }
    };
  }, []);

  return {
    ...state,
    currentVersion,
    refreshCurrentVersion,
    checkUpdate: () => checkUpdate(true),
    hideModal,
    downloadAndInstall,
  };
}
