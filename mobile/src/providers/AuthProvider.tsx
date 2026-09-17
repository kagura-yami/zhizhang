import { Alert, AppState, DeviceEventEmitter, NativeModules } from 'react-native';
import { queryClient } from '../lib/queryClient';
/**
 * 认证上下文提供者
 * 管理用户登录状态、Token存储和自动登录
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import { storage } from '../utils/storage';
import { STORAGE_KEYS } from '../constants/app';
import { authService } from '../services/api/auth';
import { httpService } from '../services/http';
import { logger } from '../utils/logger';
import { setNativeToken, clearNativeToken } from '../utils/nativeAuth';
import {
  clearAuthSession,
  getBiometricLoginCredential,
  getAuthSession,
  isBiometricEnabled,
  saveAuthSession,
} from '../services/security';
import { getAutoLoginSetting } from '../services/security';
import type { User, LoginCredentials, RegisterData, AuthState } from '../types/user';

interface AuthContextValue extends AuthState {
  login: (credentials: LoginCredentials) => Promise<void>;
  loginWithBiometric: () => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const TAG = 'AuthProvider';

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({
    isLoggedIn: false,
    isLoading: true,
    user: null,
    token: null,
  });

  const stateRef = useRef(state);
  stateRef.current = state;
  const publishState = useCallback((next: AuthState | ((previous: AuthState) => AuthState)) => {
    stateRef.current = typeof next === 'function' ? next(stateRef.current) : next;
    setState(stateRef.current);
  }, []);
  const cleanupRef = useRef<Promise<void>>(Promise.resolve());
  const clearLocalSession = useCallback(() => {
    const empty = { isLoggedIn: false, isLoading: false, user: null, token: null };
    stateRef.current = empty;
    publishState(empty);
    queryClient.clear();
    cleanupRef.current = (async () => {
      await Promise.all([clearAuthSession(), storage.removeItem(STORAGE_KEYS.USER_TOKEN), storage.removeItem(STORAGE_KEYS.USER_INFO), clearNativeToken()]);
    })();
    return cleanupRef.current;
  }, []);

  useEffect(() => httpService.addResponseInterceptor({
    onResponseError: async (error: any) => {
      const status = error.response?.status ?? error.code;
      const sent = error.config?.headers?.Authorization;
      if (status !== 401 || !stateRef.current.token || sent !== `Bearer ${stateRef.current.token}`) return;
      const cleanup = clearLocalSession();
      Alert.alert('请重新登录', '登录状态已失效或设备凭证不可用，请重新登录。');
      await cleanup;
    },
  }), [clearLocalSession]);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('AuthSessionRejected', async ({ token }: { token: string }) => {
      const active = stateRef.current.token;
      if (!active || !await NativeModules.AuthTokenModule.isSameSession(active, token) || stateRef.current.token !== active) return;
      const cleanup = clearLocalSession();
      Alert.alert('请重新登录', '登录状态已失效或设备凭证不可用，请重新登录。');
      await cleanup;
    });
    return () => subscription.remove();
  }, [clearLocalSession]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', status => {
      if (status === 'active' && stateRef.current.isLoggedIn) void authService.getProfile().catch(() => {});
    });
    return () => subscription.remove();
  }, []);

  // 从存储中恢复登录状态
  useEffect(() => {
    const restoreAuth = async () => {
      try {
        logger.info(TAG, '正在恢复登录状态...');

        const autoLogin = await getAutoLoginSetting();
        if (!autoLogin) {
          logger.info(TAG, '自动登录已关闭');
          publishState({ isLoggedIn: false, isLoading: false, user: null, token: null });
          return;
        }

        const biometricRequired = await isBiometricEnabled();
        let session = await getAuthSession({ requireBiometric: biometricRequired });

        // 从旧版本普通存储迁移到系统安全存储，迁移后立即删除明文副本。
        // 已开启生物识别时禁止走旧版回退路径，避免取消验证后绕过安全锁。
        if (!session && !biometricRequired) {
          const legacyToken = await storage.getItem<string>(STORAGE_KEYS.USER_TOKEN);
          const legacyUser = await storage.getItem<User>(STORAGE_KEYS.USER_INFO);
          if (legacyToken && legacyUser) {
            await saveAuthSession(legacyToken, legacyUser);
            await storage.removeItem(STORAGE_KEYS.USER_TOKEN);
            await storage.removeItem(STORAGE_KEYS.USER_INFO);
            session = { token: legacyToken, user: legacyUser };
            logger.info(TAG, '已将旧版登录信息迁移到系统安全存储');
          }
        }

        if (session) {
          logger.info(TAG, '发现已保存的登录状态，先使用本地会话进入应用，再后台验证...');

          // 不再阻塞首屏等待 profile 网络请求；网络慢时用户仍可立即查看本地页面，
          // 后台验证成功后更新资料，只有明确收到 401 才清除会话。
          await setNativeToken(session.token);
          publishState({
            isLoggedIn: true,
            isLoading: false,
            user: session.user,
            token: session.token,
          });

          void authService.getProfile().then(async response => {
            if (stateRef.current.token !== session.token) return;
            if (response.success && response.data) {
              if (stateRef.current.token === session.token) publishState(prev => ({ ...prev, user: response.data! }));
              logger.info(TAG, '后台登录状态验证成功');
              return;
            }
            if (response.code === 401) {
              throw Object.assign(new Error('登录状态已失效'), { code: 401 });
            }
          }).catch(async error => {
            const status = error?.code ?? error?.response?.status;
            if (status !== 401) {
              logger.warn(TAG, '后台验证暂时失败，保留本地会话等待下次重试');
              return;
            }
            if (stateRef.current.token === session.token) await clearLocalSession();
            logger.warn(TAG, '登录状态已失效，已退出登录');
          });
          return;
        }

        logger.info(TAG, '未找到有效的登录状态');
        publishState({
          isLoggedIn: false,
          isLoading: false,
          user: null,
          token: null,
        });
      } catch (error) {
        logger.error(TAG, '恢复登录状态失败', error);
        publishState({
          isLoggedIn: false,
          isLoading: false,
          user: null,
          token: null,
        });
      }
    };

    restoreAuth();
  }, []);

  // 登录
  const login = useCallback(async (credentials: LoginCredentials) => {
    try {
      await cleanupRef.current;
      logger.info(TAG, `正在登录: ${credentials.username}`);

      const response = await authService.login(credentials);

      if (!response.success || !response.data) {
        throw new Error(response.message || '登录失败');
      }

      const { user, token } = response.data;

      // 保存到系统安全存储，不在 AsyncStorage 中保存令牌或密码。
      await saveAuthSession(token, user);
      await storage.removeItem(STORAGE_KEYS.USER_TOKEN);
      await storage.removeItem(STORAGE_KEYS.USER_INFO);

      // 同步 Token 到原生层（供 Android 悬浮窗使用）
      await setNativeToken(token);

      logger.info(TAG, '登录成功');

      publishState({
        isLoggedIn: true,
        isLoading: false,
        user,
        token,
      });
    } catch (error: any) {
      logger.error(TAG, '登录失败', error);
      throw error;
    }
  }, []);

  const loginWithBiometric = useCallback(async () => {
    await cleanupRef.current;
    const credential = await getBiometricLoginCredential();
    if (!credential) throw new Error('当前设备未绑定生物识别登录');
    const response = await authService.biometricLogin(credential);
    if (!response.success || !response.data) throw new Error(response.message || '生物识别登录失败');
    const { user, token } = response.data;
    await saveAuthSession(token, user);
    await setNativeToken(token);
    publishState({ isLoggedIn: true, isLoading: false, user, token });
  }, []);

  // 注册
  const register = useCallback(async (data: RegisterData) => {
    try {
      await cleanupRef.current;
      logger.info(TAG, `正在注册: ${data.username}`);

      const response = await authService.register(data);

      if (!response.success || !response.data) {
        throw new Error(response.message || '注册失败');
      }

      const { user, token } = response.data;

      // 保存到系统安全存储，不在 AsyncStorage 中保存令牌或密码。
      await saveAuthSession(token, user);
      await storage.removeItem(STORAGE_KEYS.USER_TOKEN);
      await storage.removeItem(STORAGE_KEYS.USER_INFO);

      // 同步 Token 到原生层（供 Android 悬浮窗使用）
      await setNativeToken(token);

      logger.info(TAG, '注册成功');

      publishState({
        isLoggedIn: true,
        isLoading: false,
        user,
        token,
      });
    } catch (error: any) {
      logger.error(TAG, '注册失败', error);
      throw error;
    }
  }, []);

  // Online logout revokes the device session; local logout still works when offline.
  const logout = useCallback(async () => {
    const token = stateRef.current.token;
    if (token) {
      try { await httpService.post('/auth/device/logout', {}, { headers: { Authorization: `Bearer ${token}` }, timeout: 5000 }); } catch {}
    }
    await clearLocalSession();
  }, [clearLocalSession]);

  // 刷新用户信息
  const refreshProfile = useCallback(async () => {
    try {
      const response = await authService.getProfile();

      if (stateRef.current.token === state.token && response.success && response.data) {
        const userData = response.data;
        publishState(prev => ({
          ...prev,
          user: userData,
        }));
      }
    } catch (error) {
      logger.error(TAG, '刷新用户信息失败', error);
    }
  }, [state.token]);

  const value = useMemo<AuthContextValue>(() => ({
    ...state,
    login,
    loginWithBiometric,
    register,
    logout,
    refreshProfile,
  }), [state, login, register, logout, refreshProfile]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * 获取认证上下文的 Hook
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
