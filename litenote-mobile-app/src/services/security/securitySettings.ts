/** 非敏感的安全偏好。令牌和用户信息不在这里保存。 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const AUTO_LOGIN_KEY = '@litenote/security/auto_login';

export async function getAutoLoginSetting(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(AUTO_LOGIN_KEY);
    return value === null ? true : value === 'true';
  } catch {
    return true;
  }
}
export async function setAutoLoginSetting(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(AUTO_LOGIN_KEY, String(enabled));
}
