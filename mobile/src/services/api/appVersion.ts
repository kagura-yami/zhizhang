/**
 * 应用版本 API 服务
 */
import httpService from '../http';

export interface AppVersionInfo {
  id: number;
  version: string;
  versionCode: number;
  downloadUrl: string;
  updateLog: string;
  forceUpdate: boolean;
  platform: string;
  createdAt: string;
}

export interface CheckUpdateResponse {
  hasUpdate: boolean;
  latestVersion?: AppVersionInfo;
  /** 当前版本之后的全部版本，按版本号从旧到新排列。 */
  updates?: AppVersionInfo[];
}

/**
 * 应用版本服务
 */
export const appVersionApi = {
  /**
   * 检查更新
   */
  async checkUpdate(currentVersion: string): Promise<CheckUpdateResponse> {
    console.log('[AppVersion] 检查更新, 当前版本:', currentVersion);
    const response = await httpService.get<CheckUpdateResponse>(
      '/app-version/check',
      // 更新接口禁止缓存；时间戳同时兼容仍会缓存 GET 的系统代理/网关。
      { params: { currentVersion, platform: 'android', _ts: Date.now() } }
    );
    console.log('[AppVersion] 检查更新响应:', JSON.stringify(response));
    // httpService.get 已经返回 response.data，所以直接访问 .data
    const result = (response as any).data || response;
    console.log('[AppVersion] 解析结果:', JSON.stringify(result));
    return result;
  },

  /**
   * 获取最新版本
   */
  async getLatest(): Promise<AppVersionInfo | null> {
    try {
      const response = await httpService.get<AppVersionInfo>(
        '/app-version/latest',
        { params: { platform: 'android', _ts: Date.now() } }
      );
      return (response as any).data || response;
    } catch {
      return null;
    }
  },

  /** 获取版本历史，供关于页面展示。 */
  async getHistory(): Promise<AppVersionInfo[]> {
    try {
      const response = await httpService.get<AppVersionInfo[]>('/app-version', {
        params: { platform: 'android' },
      });
      const result = (response as any).data || response;
      return Array.isArray(result) ? result : [];
    } catch {
      return [];
    }
  },
};
