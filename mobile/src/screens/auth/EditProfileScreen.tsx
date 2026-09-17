/**
 * 编辑资料页面 - Neo-Brutalism 风格
 * 方圆角头像+描边 + 描边表单 + 分区描边卡片
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Image,
  TextInput,
  ActivityIndicator,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { User, Camera, Check, Eye, EyeOff, Receipt, ChevronRight } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { launchImageLibrary, launchCamera, type ImagePickerResponse } from 'react-native-image-picker';
import { useAuth, useAlert } from '../../providers';
import { authService } from '../../services/api/auth';
import { getAvatarUrl } from '../../utils/url';
import { ThemeColors } from '../../theme/colors';
import { spacing, borderRadius, borderWidth, shadow } from '../../theme/spacing';
import { useSecuritySettings, useStyles } from '../../hooks';
import {
  createBiometricLoginCredential,
  disableBiometric,
  disableBiometricLogin,
  isBiometricLoginEnabled,
} from '../../services/security';

export default function EditProfileScreen() {
  const navigation = useNavigation();
  const { user, refreshProfile } = useAuth();
  const { alert } = useAlert();
  const styles = useStyles(createStyles);
  const {
    autoLogin,
    biometryType,
    loading: securityLoading,
    setAutoLogin,
  } = useSecuritySettings();
  const [biometricLoginEnabled, setBiometricLoginEnabled] = useState(false);

  useEffect(() => {
    isBiometricLoginEnabled().then(setBiometricLoginEnabled).catch(() => setBiometricLoginEnabled(false));
  }, []);

  const [nickname, setNickname] = useState(user?.nickname || '');
  const [username, setUsername] = useState(user?.username || '');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  const [nicknameError, setNicknameError] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const handleSelectAvatar = () => {
    alert(
      '选择头像',
      '请选择头像来源',
      [
        {
          text: '拍照',
          style: 'default',
          onPress: () => {
            launchCamera(
              { mediaType: 'photo', quality: 0.8, maxWidth: 500, maxHeight: 500 },
              handleImageResponse,
            );
          },
        },
        {
          text: '从相册选择',
          style: 'default',
          onPress: () => {
            launchImageLibrary(
              { mediaType: 'photo', quality: 0.8, maxWidth: 500, maxHeight: 500 },
              handleImageResponse,
            );
          },
        },
        { text: '取消', style: 'cancel' },
      ],
    );
  };

  const handleImageResponse = async (response: ImagePickerResponse) => {
    if (response.didCancel || response.errorCode) return;
    const asset = response.assets?.[0];
    if (!asset?.uri) return;

    setAvatarUri(asset.uri);
    setIsUploadingAvatar(true);

    try {
      const result = await authService.uploadAvatar(asset.uri);
      if (result.success && result.data) {
        await refreshProfile();
        alert('成功', '头像上传成功');
      }
    } catch (error: any) {
      alert('上传失败', error?.message || '头像上传失败，请重试');
      setAvatarUri(null);
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleSaveProfile = async () => {
    setNicknameError('');
    setUsernameError('');

    let hasError = false;
    if (username && username.length < 3) {
      setUsernameError('用户名至少需要3个字符');
      hasError = true;
    }
    if (hasError) return;

    const hasChanges = (nickname !== user?.nickname) || (username !== user?.username);
    if (!hasChanges) {
      alert('提示', '没有需要保存的修改');
      return;
    }

    setIsLoading(true);
    try {
      const updateData: { nickname?: string; username?: string } = {};
      if (nickname !== user?.nickname) updateData.nickname = nickname;
      if (username !== user?.username) updateData.username = username;

      const result = await authService.updateProfile(updateData);
      if (result.success) {
        await refreshProfile();
        alert('成功', '资料更新成功');
      }
    } catch (error: any) {
      const message = error?.message || '资料更新失败';
      if (message.includes('用户名')) {
        setUsernameError(message);
      } else {
        alert('更新失败', message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleChangePassword = async () => {
    setPasswordError('');
    if (!currentPassword) { setPasswordError('请输入当前密码'); return; }
    if (!newPassword) { setPasswordError('请输入新密码'); return; }
    if (newPassword.length < 6) { setPasswordError('新密码至少需要6个字符'); return; }
    if (newPassword !== confirmPassword) { setPasswordError('两次输入的密码不一致'); return; }

    setIsLoading(true);
    try {
      const result = await authService.changePassword({ currentPassword, newPassword });
      if (result.success) {
        alert('成功', '密码修改成功');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setShowPasswordSection(false);
      }
    } catch (error: any) {
      setPasswordError(error?.message || '密码修改失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBiometricLoginSetting = async (enabled: boolean) => {
    try {
      if (enabled) {
        const { credential, biometryType: detectedType } = await createBiometricLoginCredential();
        const result = await authService.enrollBiometric(credential, detectedType);
        if (!result.success) throw new Error(result.message || '账号绑定失败');
        setBiometricLoginEnabled(true);
        alert('账号安全', '已绑定本机生物识别。下次可在登录页直接使用指纹或人脸登录。');
      } else {
        await authService.revokeBiometric();
        await disableBiometricLogin();
        await disableBiometric();
        setBiometricLoginEnabled(false);
        alert('账号安全', '已解除本机生物识别登录绑定');
      }
    } catch (error: any) {
      if (enabled) await disableBiometricLogin().catch(() => undefined);
      alert('账号安全', error?.message || '生物识别登录设置失败');
    }
  };

  const displayAvatar = avatarUri || getAvatarUrl(user?.avatar);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Avatar Section */}
        <View style={styles.avatarSection}>
          <TouchableOpacity
            style={styles.avatarContainer}
            onPress={handleSelectAvatar}
            disabled={isUploadingAvatar}
          >
            {displayAvatar ? (
              <Image source={{ uri: displayAvatar }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <User size={48} color={styles._colors.primary} />
              </View>
            )}
            <View style={styles.cameraIcon}>
              {isUploadingAvatar ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Camera size={16} color="#FFFFFF" />
              )}
            </View>
          </TouchableOpacity>
          <Text style={styles.avatarHint}>点击更换头像</Text>
        </View>

        {/* Basic Info Section */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>📝 基本信息</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>昵称</Text>
            <TextInput
              style={[styles.input, nicknameError && styles.inputError]}
              value={nickname}
              onChangeText={(text) => { setNickname(text); setNicknameError(''); }}
              placeholder="请输入昵称"
              placeholderTextColor={styles._colors.textTertiary}
            />
            {nicknameError ? <Text style={styles.errorText}>{nicknameError}</Text> : null}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>账号名称</Text>
            <TextInput
              style={[styles.input, usernameError && styles.inputError]}
              value={username}
              onChangeText={(text) => { setUsername(text); setUsernameError(''); }}
              placeholder="请输入账号名称"
              placeholderTextColor={styles._colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {usernameError ? <Text style={styles.errorText}>{usernameError}</Text> : null}
          </View>

          <TouchableOpacity
            style={styles.saveButton}
            onPress={handleSaveProfile}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Check size={18} color="#FFFFFF" strokeWidth={2.5} />
                <Text style={styles.saveButtonText}>保存资料</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Password Section */}
        <View style={styles.sectionCard}>
          <TouchableOpacity
            style={styles.sectionHeader}
            onPress={() => setShowPasswordSection(!showPasswordSection)}
          >
            <Text style={styles.sectionTitle}>🔒 修改密码</Text>
            <Text style={styles.sectionToggle}>
              {showPasswordSection ? '收起' : '展开'}
            </Text>
          </TouchableOpacity>

          {showPasswordSection && (
            <View style={styles.passwordSection}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>当前密码</Text>
                <View style={styles.passwordInputWrapper}>
                  <TextInput
                    style={styles.passwordInput}
                    value={currentPassword}
                    onChangeText={(text) => { setCurrentPassword(text); setPasswordError(''); }}
                    placeholder="请输入当前密码"
                    placeholderTextColor={styles._colors.textTertiary}
                    secureTextEntry={!showCurrentPassword}
                  />
                  <TouchableOpacity
                    onPress={() => setShowCurrentPassword(!showCurrentPassword)}
                    style={styles.eyeIcon}
                  >
                    {showCurrentPassword ? (
                      <EyeOff size={20} color={styles._colors.textTertiary} />
                    ) : (
                      <Eye size={20} color={styles._colors.textTertiary} />
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>新密码</Text>
                <View style={styles.passwordInputWrapper}>
                  <TextInput
                    style={styles.passwordInput}
                    value={newPassword}
                    onChangeText={(text) => { setNewPassword(text); setPasswordError(''); }}
                    placeholder="请输入新密码"
                    placeholderTextColor={styles._colors.textTertiary}
                    secureTextEntry={!showNewPassword}
                  />
                  <TouchableOpacity
                    onPress={() => setShowNewPassword(!showNewPassword)}
                    style={styles.eyeIcon}
                  >
                    {showNewPassword ? (
                      <EyeOff size={20} color={styles._colors.textTertiary} />
                    ) : (
                      <Eye size={20} color={styles._colors.textTertiary} />
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>确认新密码</Text>
                <TextInput
                  style={styles.input}
                  value={confirmPassword}
                  onChangeText={(text) => { setConfirmPassword(text); setPasswordError(''); }}
                  placeholder="请再次输入新密码"
                  placeholderTextColor={styles._colors.textTertiary}
                  secureTextEntry
                />
              </View>

              {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}

              <TouchableOpacity
                style={[styles.saveButton, styles.passwordButton]}
                onPress={handleChangePassword}
                disabled={isLoading}
                activeOpacity={0.8}
              >
                {isLoading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveButtonText}>修改密码</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={styles.sectionCard}>
          <TouchableOpacity
            style={styles.mailboxEntry}
            onPress={() => navigation.navigate('InvoiceMailbox' as never)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="设置发票邮箱"
          >
            <View style={styles.mailboxIcon}>
              <Receipt size={20} color={styles._colors.primary} />
            </View>
            <View style={styles.securityInfo}>
              <Text style={styles.inputLabel}>发票邮箱</Text>
              <Text style={styles.securityDescription}>自动接收并整理发送到邮箱的电子发票</Text>
            </View>
            <ChevronRight size={20} color={styles._colors.textTertiary} />
          </TouchableOpacity>
        </View>

        {/* Account Security Section */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>🛡️ 账号安全</Text>
          <Text style={styles.securityHint}>生物识别由系统在本机验证，服务端仅保存设备凭据哈希并绑定当前账号。</Text>
          <View style={styles.securityRow}>
            <View style={styles.securityInfo}>
              <Text style={styles.inputLabel}>自动登录</Text>
              <Text style={styles.securityDescription}>打开应用时自动恢复登录状态</Text>
            </View>
            <Switch
              value={autoLogin}
              onValueChange={setAutoLogin}
              disabled={securityLoading}
              trackColor={{ false: styles._colors.divider, true: styles._colors.primary }}
              thumbColor="#FFFFFF"
            />
          </View>
          <View style={[styles.securityRow, styles.securityRowLast]}>
            <View style={styles.securityInfo}>
              <Text style={styles.inputLabel}>{biometryType === 'Face' || biometryType === 'FaceID' ? '人脸登录' : '指纹登录'}</Text>
              <Text style={styles.securityDescription}>{biometryType ? '绑定后可在登录页免账号密码登录当前账号' : '当前设备未检测到可用的生物识别'}</Text>
            </View>
            <Switch
              value={biometricLoginEnabled}
              onValueChange={handleBiometricLoginSetting}
              disabled={securityLoading || !biometryType}
              trackColor={{ false: styles._colors.divider, true: styles._colors.primary }}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>

        <View style={styles.bottomSpacing} />
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => ({
  ...StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollView: {
      flex: 1,
    },
    avatarSection: {
      alignItems: 'center',
      paddingVertical: spacing.xl,
    },
    avatarContainer: {
      width: 100,
      height: 100,
      borderRadius: borderRadius.medium,
      borderWidth: borderWidth.medium,
      borderColor: colors.divider,
      backgroundColor: colors.accent,
      overflow: 'visible',
      position: 'relative',
    },
    avatar: {
      width: '100%',
      height: '100%',
      borderRadius: borderRadius.medium - 2,
    },
    avatarPlaceholder: {
      width: '100%',
      height: '100%',
      borderRadius: borderRadius.medium - 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },
    cameraIcon: {
      position: 'absolute',
      right: -8,
      bottom: -8,
      width: 36,
      height: 36,
      borderRadius: borderRadius.small,
      borderWidth: borderWidth.thin,
      borderColor: colors.divider,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarHint: {
      marginTop: spacing.md,
      fontSize: 13,
      fontWeight: '600',
      color: colors.textTertiary,
    },
    sectionCard: {
      backgroundColor: colors.surface,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.lg,
      borderRadius: borderRadius.card,
      borderWidth: borderWidth.thin,
      borderColor: colors.divider,
      padding: spacing.lg,
    },
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.textPrimary,
      marginBottom: spacing.md,
    },
    sectionToggle: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.primary,
      marginBottom: spacing.md,
    },
    inputGroup: {
      marginBottom: spacing.md,
    },
    inputLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSecondary,
      marginBottom: spacing.xs,
    },
    input: {
      backgroundColor: colors.background,
      borderRadius: borderRadius.input,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      fontSize: 15,
      fontWeight: '600',
      color: colors.textPrimary,
      borderWidth: borderWidth.thin,
      borderColor: colors.divider,
      minHeight: 48,
    },
    inputError: {
      borderColor: colors.error,
    },
    passwordInputWrapper: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.background,
      borderRadius: borderRadius.input,
      borderWidth: borderWidth.thin,
      borderColor: colors.divider,
    },
    passwordInput: {
      flex: 1,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      fontSize: 15,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    eyeIcon: {
      padding: spacing.md,
    },
    errorText: {
      color: colors.error,
      fontSize: 12,
      fontWeight: '600',
      marginTop: spacing.xs,
    },
    securityHint: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
      marginBottom: spacing.sm,
    },
    securityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.md,
      borderBottomWidth: borderWidth.thin,
      borderBottomColor: colors.divider,
    },
    securityRowLast: {
      borderBottomWidth: 0,
      paddingBottom: 0,
    },
    securityInfo: {
      flex: 1,
      marginRight: spacing.md,
    },
    securityDescription: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
      marginTop: 3,
    },
    mailboxEntry: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
    },
    mailboxIcon: {
      width: 40,
      height: 40,
      borderRadius: borderRadius.small,
      backgroundColor: colors.primaryLight,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.md,
    },
    saveButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
      borderRadius: borderRadius.button,
      borderWidth: borderWidth.thin,
      borderColor: colors.divider,
      paddingVertical: spacing.md,
      marginTop: spacing.sm,
      gap: spacing.xs,
      minHeight: 48,
      ...shadow.small,
    },
    saveButtonText: {
      color: '#FFFFFF',
      fontSize: 15,
      fontWeight: '800',
    },
    passwordSection: {
      marginTop: spacing.sm,
    },
    passwordButton: {
      marginTop: spacing.md,
    },
    bottomSpacing: {
      height: spacing.xxl,
    },
  }),
  _colors: colors,
});
