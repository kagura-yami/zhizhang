import { useCallback, useEffect, useState } from 'react';
import {
  disableBiometric,
  enableBiometric,
  getSupportedBiometryType,
  isBiometricEnabled,
} from '../services/security';
import type { BIOMETRY_TYPE } from 'react-native-keychain';
import { getAutoLoginSetting, setAutoLoginSetting } from '../services/security';

export function useSecuritySettings() {
  const [autoLogin, setAutoLoginState] = useState(true);
  const [biometricEnabled, setBiometricEnabledState] = useState(false);
  const [biometryType, setBiometryType] = useState<BIOMETRY_TYPE | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([getAutoLoginSetting(), isBiometricEnabled(), getSupportedBiometryType()])
      .then(([savedAutoLogin, savedBiometric, supportedType]) => {
        if (!active) return;
        setAutoLoginState(savedAutoLogin);
        setBiometricEnabledState(savedBiometric);
        setBiometryType(supportedType);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const setAutoLogin = useCallback(async (enabled: boolean) => {
    await setAutoLoginSetting(enabled);
    setAutoLoginState(enabled);
  }, []);

  const setBiometric = useCallback(async (enabled: boolean) => {
    if (enabled) {
      const supportedType = await enableBiometric();
      setBiometryType(supportedType);
      setBiometricEnabledState(true);
    } else {
      await disableBiometric();
      setBiometricEnabledState(false);
    }
  }, []);

  return {
    autoLogin,
    biometricEnabled,
    biometryType,
    loading,
    setAutoLogin,
    setBiometric,
  };
}
