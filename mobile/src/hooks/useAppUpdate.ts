/**
 * 应用更新检查 Hook
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { AppState, Platform, NativeModules, DeviceEventEmitter } from 'react-native';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { appVersionApi, AppVersionInfo } from '../services/api/appVersion';
import { useAlert } from '../providers';
import { getInstalledAppVersion, getInstalledAppVersionSync } from '../utils/appVersion';

const FOREGROUND_UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * react-native-fs 2.20 在 RN 0.81 上对不存在文件的 unlink 会以空错误码
 * 调用 Promise.reject，原生层因此触发 Kotlin 非空参数崩溃。所有清理动作
 * 先确认文件存在，并吞掉清理竞态，避免启动更新检查把应用直接杀掉。
 */
async function unlinkIfExists(filePath: string): Promise<void> {
  try {
    if (await RNFS.exists(filePath)) {
      await RNFS.unlink(filePath);
    }
  } catch {
    // 清理失败不应影响更新检查或应用启动。
  }
}

interface UpdateState {
  checking: boolean;
  hasUpdate: boolean;
  latestVersion: AppVersionInfo | null;
  updateHistory: AppVersionInfo[];
  showModal: boolean;
  downloading: boolean;
  progress: number;
  downloadedVersion: string | null;
}

interface UseAppUpdateOptions {
  /** 是否在 hook 挂载时自动检查更新，默认 true */
  autoCheck?: boolean;
  /** 兼容旧调用方；APK 更新始终保留前台提示和通知。 */
  suppressPrompt?: boolean;
}

export function useAppUpdate(options: UseAppUpdateOptions = {}) {
  const { autoCheck = true } = options;
  const { suppressPrompt = false } = options;
  const { alert } = useAlert();
  const [state, setState] = useState<UpdateState>({
    checking: false,
    hasUpdate: false,
    latestVersion: null,
    updateHistory: [],
    showModal: false,
    downloading: false,
    progress: 0,
    downloadedVersion: null,
  });
  const downloadJobId = useRef<number | null>(null);
  // 同一版本只允许一个下载任务，避免前台点击与 WorkManager/自动检查并发写入。
  const downloadPromiseRef = useRef<{ version: string; promise: Promise<string | null> } | null>(null);
  const appState = useRef(AppState.currentState);
  const checkingRef = useRef(false);

  const getCachedPath = useCallback((version: string) => `${RNFS.CachesDirectoryPath}/app-v${version}.apk`, []);

  const isValidCachedApk = useCallback(async (version: string, filePath: string): Promise<boolean> => {
    try {
      const validate = NativeModules.InstallApk?.validateApk;
      if (typeof validate === 'function') {
        return Boolean(await validate(filePath, version));
      }
      const stat = await RNFS.stat(filePath);
      return Number(stat.size) >= 1024 * 1024;
    } catch {
      return false;
    }
  }, []);

  const downloadLatestApk = useCallback(async (versionInfo: AppVersionInfo, silent = false): Promise<string | null> => {
    const activeDownload = downloadPromiseRef.current;
    if (activeDownload?.version === versionInfo.version) {
      return activeDownload.promise;
    }

    const filePath = getCachedPath(versionInfo.version);
    const promise = (async () => {
      // 新 APK 使用统一的原生下载器，前台多页面和后台任务共享下载及断点。
      if (typeof NativeModules.InstallApk?.downloadUpdate === 'function') {
        setState(prev => ({ ...prev, downloading: true, progress: 0, downloadedVersion: null }));
        const sub = DeviceEventEmitter.addListener('ApkDownloadProgress', event => {
          if (event.version !== versionInfo.version) return;
          const progress = event.contentLength > 0 ? Math.min(99, Math.round(event.bytesWritten / event.contentLength * 100)) : 0;
          setState(prev => ({ ...prev, progress }));
        });
        try {
          const path = await NativeModules.InstallApk.downloadUpdate(versionInfo.downloadUrl, versionInfo.version);
          if (!(await isValidCachedApk(versionInfo.version, path))) throw new Error('安装包完整性校验失败');
          setState(prev => ({ ...prev, downloading: false, progress: 100, downloadedVersion: versionInfo.version }));
          return path;
        } catch (error: any) {
          setState(prev => ({ ...prev, downloading: false, downloadedVersion: null }));
          if (!silent) alert('下载中断', `${error?.message || '网络暂不可用'}。网络恢复后重试，可从有效断点继续下载。`);
          return null;
        } finally {
          sub.remove();
          downloadPromiseRef.current = null;
        }
      }
      // 兼容旧 APK 的 JS 热更新；新 APK 不再走独立 RNFS 下载。
      // 前台 RN 下载与 WorkManager 可能同时运行，临时文件必须实例隔离，
      // 否则一方清理/覆盖另一方的 .part 会产生半包或校验竞态。
      const partialPath = `${filePath}.part-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      try {
        if (await RNFS.exists(filePath) && await isValidCachedApk(versionInfo.version, filePath)) {
          setState(prev => ({ ...prev, downloadedVersion: versionInfo.version }));
          return filePath;
        }
        // 旧版本可能留下半包或损坏文件，重新下载前必须清理。
        await unlinkIfExists(filePath);
        // 兼容旧版本遗留的固定 .part 文件，但不触碰其他正在下载的实例。
        await unlinkIfExists(`${filePath}.part`);
        await unlinkIfExists(partialPath);
        // 自动下载完全在后台执行，不更新前台下载进度或弹窗状态。
        setState(prev => ({ ...prev, downloading: true, progress: 0, downloadedVersion: null }));
        const downloadResult = RNFS.downloadFile({
          fromUrl: versionInfo.downloadUrl,
          // 先写入临时文件，完成后再原子移动，避免安装时读到未下载完的 APK。
          toFile: partialPath,
          connectionTimeout: 15000,
          readTimeout: 60000,
          progress: (res: { bytesWritten: number; contentLength: number }) => {
            const progress = res.contentLength > 0 ? Math.round((res.bytesWritten / res.contentLength) * 100) : 0;
            setState(prev => ({ ...prev, progress }));
          },
          progressDivider: 1,
        });
        downloadJobId.current = downloadResult.jobId;
        const result = await downloadResult.promise;
        if (result.statusCode !== 200) throw new Error(`下载失败: ${result.statusCode}`);
        if (!(await isValidCachedApk(versionInfo.version, partialPath))) {
          throw new Error('下载的安装包校验失败');
        }
        await RNFS.moveFile(partialPath, filePath);
        if (!(await isValidCachedApk(versionInfo.version, filePath))) {
          await unlinkIfExists(filePath);
          throw new Error('安装包完整性校验失败');
        }
        setState(prev => ({
          ...prev,
          downloading: false,
          progress: 100,
          downloadedVersion: versionInfo.version,
        }));
        return filePath;
      } catch (error: any) {
        setState(prev => ({ ...prev, downloading: false, downloadedVersion: null }));
        if (!silent) alert('下载失败', error?.message || '下载更新包失败，请稍后重试');
        return null;
      } finally {
        await unlinkIfExists(partialPath);
        if (downloadPromiseRef.current?.version === versionInfo.version) {
          downloadPromiseRef.current = null;
        }
        downloadJobId.current = null;
      }
    })();
    downloadPromiseRef.current = { version: versionInfo.version, promise };
    return promise;
  }, [alert, getCachedPath, isValidCachedApk]);

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
    if (Platform.OS !== 'android' || checkingRef.current) return;

    checkingRef.current = true;
    console.log('[useAppUpdate] 开始检查更新...');
    setState(prev => ({ ...prev, checking: true }));

    try {
      const installedVersion = await refreshCurrentVersion();
      const result = await appVersionApi.checkUpdate(installedVersion);
      console.log('[useAppUpdate] API 返回结果:', JSON.stringify(result));

      // 用户开启“自动下载最近安装包”后，先静默下载，完成后才提醒安装。
      let autoDownloadEnabled = true;
      try {
        const configRaw = await AsyncStorage.getItem('appGeneralConfig');
        const config = configRaw ? JSON.parse(configRaw) as { autoDownloadUpdateEnabled?: boolean } : {};
        autoDownloadEnabled = config.autoDownloadUpdateEnabled !== false;
      } catch {
        // 设置读取失败不影响正常检查更新。
      }

      setState(prev => ({
        ...prev,
        checking: false,
        hasUpdate: result.hasUpdate,
        latestVersion: result.latestVersion || null,
        updateHistory: result.updates || (result.latestVersion ? [result.latestVersion] : []),
        // 自动下载期间不弹窗，待安装包完整落盘后再提示用户。
        showModal: !suppressPrompt && result.hasUpdate && !!result.latestVersion && (showNoUpdateAlert || !autoDownloadEnabled),
      }));

      if (result.hasUpdate && result.latestVersion) {
        const combinedUpdateLog = (result.updates?.length
          ? result.updates.map(item => item.updateLog).filter(Boolean).join('；')
          : result.latestVersion.updateLog) || '';
        if (autoDownloadEnabled) {
          void (async () => {
            const filePath = await downloadLatestApk(result.latestVersion!, !showNoUpdateAlert);
            const packageReady = !!filePath && await RNFS.exists(filePath);
            // 下载完成后才发送通知，避免用户点进来时安装包尚未准备好。
            const notificationPromise = NativeModules.InstallApk?.notifyUpdateAvailable?.(
              result.latestVersion!.version,
              combinedUpdateLog,
              packageReady,
            );
            notificationPromise?.catch?.(() => undefined);
            if (!suppressPrompt || packageReady) {
              setState(prev => ({ ...prev, showModal: !suppressPrompt && !!prev.latestVersion }));
            }
          })();
        } else {
          const notificationPromise = NativeModules.InstallApk?.notifyUpdateAvailable?.(
            result.latestVersion.version,
            combinedUpdateLog,
            false,
          );
          notificationPromise?.catch?.(() => undefined);
        }
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
    } finally {
      checkingRef.current = false;
    }
  }, [refreshCurrentVersion, alert, suppressPrompt, downloadLatestApk]);

  const hideModal = useCallback(() => {
    setState(prev => ({ ...prev, showModal: false }));
  }, []);

  const installApk = useCallback(async (filePath: string) => {
    try {
      const { InstallApk } = NativeModules;
      if (InstallApk) {
        await InstallApk.install(filePath);
        return true;
      } else {
        await RNFS.scanFile(filePath);
        alert('下载完成', '请在通知栏或文件管理器中点击安装包进行安装');
        return false;
      }
    } catch (error: any) {
      console.log('[useAppUpdate] 安装失败:', error);
      alert('安装未启动', error?.message || '无法打开系统安装器，请重试或手动安装 APK。');
      return false;
    }
  }, [alert]);

  const downloadAndInstall = useCallback(async (): Promise<boolean> => {
    if (!state.latestVersion || state.downloading) {
      if (state.downloading) alert('更新准备中', '安装包还没有下载完成，请稍等片刻再点击更新。');
      return false;
    }
    // Revalidate even a previously ready cache; Android may reclaim it at any time.
    const filePath = await downloadLatestApk(state.latestVersion);
    if (!filePath || !(await isValidCachedApk(state.latestVersion.version, filePath))) {
      alert('更新包不可用', '安装包尚未完整下载，请重新等待后台下载完成。');
      return false;
    }
    const started = await installApk(filePath);
    if (started) setState(prev => ({ ...prev, showModal: false }));
    return started;
  }, [alert, downloadLatestApk, getCachedPath, installApk, isValidCachedApk, state.downloadedVersion, state.downloading, state.latestVersion]);

  // 启动时自动检查更新（可通过 autoCheck 参数禁用）
  useEffect(() => {
    if (autoCheck) {
      checkUpdate(false);
    }
  }, [autoCheck, checkUpdate]);

  // 应用持续停留在前台时定时检查，避免发布新版本后必须重启或切后台才收到通知。
  useEffect(() => {
    if (!autoCheck) return;
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') {
        checkUpdate(false);
      }
    }, FOREGROUND_UPDATE_CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
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
