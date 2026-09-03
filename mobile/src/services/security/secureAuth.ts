/**
 * 登录凭据安全存储。
 * Android 使用 Keystore，iOS 使用 Keychain；不在 AsyncStorage 中保存令牌或密码。
 */
import * as Keychain from 'react-native-keychain';
import type { User } from '../../types/user';

const AUTH_SERVICE = 'com.zhizhang.auth.session';
const BIOMETRIC_SERVICE = 'com.zhizhang.auth.biometric';
const BIOMETRIC_LOGIN_SERVICE = 'com.zhizhang.auth.biometric.login';

export interface SecureAuthSession {
  token: string;
  user: User;
}

export async function saveAuthSession(token: string, user: User): Promise<void> {
  const result = await Keychain.setGenericPassword(
    user.username,
    JSON.stringify({ token, user }),
    {
      service: AUTH_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      securityLevel: Keychain.SECURITY_LEVEL.SECURE_SOFTWARE,
    },
  );
  if (result === false) throw new Error('系统安全存储不可用，登录信息未保存');
}

export async function getAuthSession(options: { requireBiometric?: boolean } = {}): Promise<SecureAuthSession | null> {
  if (options.requireBiometric) {
    const gate = await Keychain.getGenericPassword({
      service: BIOMETRIC_SERVICE,
      authenticationPrompt: {
        title: '验证身份以进入知账',
        subtitle: '使用指纹或人脸识别解锁',
        cancel: '取消',
      },
    });
    if (!gate) return null;
  }

  const credentials = await Keychain.getGenericPassword({ service: AUTH_SERVICE });
  if (!credentials) return null;

  try {
    const parsed = JSON.parse(credentials.password) as SecureAuthSession;
    if (!parsed?.token || !parsed?.user) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearAuthSession(): Promise<void> {
  await Keychain.resetGenericPassword({ service: AUTH_SERVICE });
}

export async function getSupportedBiometryType(): Promise<Keychain.BIOMETRY_TYPE | null> {
  try {
    return await Keychain.getSupportedBiometryType();
  } catch {
    return null;
  }
}

export async function isBiometricEnabled(): Promise<boolean> {
  try {
    return await Keychain.hasGenericPassword({ service: BIOMETRIC_SERVICE });
  } catch {
    return false;
  }
}

export async function enableBiometric(): Promise<Keychain.BIOMETRY_TYPE> {
  const biometryType = await getSupportedBiometryType();
  if (!biometryType) {
    throw new Error('当前设备没有可用的指纹或人脸识别');
  }

  const result = await Keychain.setGenericPassword('enabled', '1', {
    service: BIOMETRIC_SERVICE,
    accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
    authenticationPrompt: {
      title: '开启生物识别解锁',
      subtitle: '验证后即可使用指纹或人脸识别登录',
      cancel: '取消',
    },
  });
  if (result === false) throw new Error('无法启用生物识别，请检查设备锁屏和已录入的生物特征');
  return biometryType;
}

export async function disableBiometric(): Promise<void> {
  await Keychain.resetGenericPassword({ service: BIOMETRIC_SERVICE });
}

/**
 * 创建绑定账号的设备凭据。系统只在读取凭据时进行指纹/人脸验证，
 * 服务端收到的只是随机字符串的哈希，绝不会收到原始生物特征模板。
 */
export async function createBiometricLoginCredential(): Promise<{ credential: string; biometryType: Keychain.BIOMETRY_TYPE }> {
  const biometryType = await getSupportedBiometryType();
  if (!biometryType) throw new Error('当前设备没有可用的指纹或人脸识别');
  const bytes = new Uint8Array(48);
  const cryptoApi = (globalThis as any).crypto;
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  const credential = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  const result = await Keychain.setGenericPassword('device', credential, {
    service: BIOMETRIC_LOGIN_SERVICE,
    accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    authenticationPrompt: {
      title: '绑定生物识别登录',
      subtitle: '验证后将此设备绑定到当前账号',
      cancel: '取消',
    },
  });
  if (result === false) throw new Error('无法创建生物识别登录凭据');
  return { credential, biometryType };
}

export async function getBiometricLoginCredential(): Promise<string | null> {
  const credentials = await Keychain.getGenericPassword({
    service: BIOMETRIC_LOGIN_SERVICE,
    authenticationPrompt: {
      title: '生物识别登录',
      subtitle: '验证后自动登录对应账号',
      cancel: '取消',
    },
  });
  return credentials ? credentials.password : null;
}

export async function isBiometricLoginEnabled(): Promise<boolean> {
  try {
    return await Keychain.hasGenericPassword({ service: BIOMETRIC_LOGIN_SERVICE });
  } catch {
    return false;
  }
}

export async function disableBiometricLogin(): Promise<void> {
  await Keychain.resetGenericPassword({ service: BIOMETRIC_LOGIN_SERVICE });
}
