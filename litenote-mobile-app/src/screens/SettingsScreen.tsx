/**
 * 设置屏幕 - Neo-Brutalism 风格
 * 描边用户卡片 + 糖果色图标块 + 描边设置分组
 */
import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Image,
  Switch,
} from 'react-native';
import {
  Wallet,
  Flag,
  Settings,
  Info,
  ChevronRight,
  User,
  LogOut,
} from 'lucide-react-native';
import { ThemeColors } from '../theme/colors';
import { spacing, borderRadius, borderWidth, shadow } from '../theme';
import { useStyles } from '../hooks';
import { useAuth, useAlert } from '../providers';
import { getAvatarUrl } from '../utils/url';

interface SettingsScreenProps {
  navigation?: any;
}

// 设置项类型定义
interface BaseSettingItem {
  id: string;
  label: string;
  icon: string;
}

interface PressableSettingItem extends BaseSettingItem {
  isSwitch?: false;
  onPress: () => void;
}

interface SwitchSettingItem extends BaseSettingItem {
  isSwitch: true;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

type SettingItem = PressableSettingItem | SwitchSettingItem;

interface SettingGroup {
  title: string;
  items: SettingItem[];
}

// 糖果色图标背景映射
const ICON_CANDY_COLORS: Record<string, string> = {
  wallet: '#FFD93D',
  flag: '#FF90B3',
  settings: '#7EB6FF',
  info: '#7DCEA0',
};

export default function SettingsScreen({ navigation }: SettingsScreenProps) {
  const { user, logout } = useAuth();
  const { confirm } = useAlert();
  const styles = useStyles(createStyles);

  const iconMap: Record<string, React.FC<{ size: number; color: string }>> = {
    wallet: Wallet,
    flag: Flag,
    settings: Settings,
    info: Info,
  };

  const settingGroups: SettingGroup[] = [
    {
      title: '💰 财务',
      items: [
        { id: 'budget-manage', label: '预算管理', icon: 'wallet', onPress: () => navigation?.navigate('Budgets') },
        { id: 'financial-goals', label: '财务目标', icon: 'flag', onPress: () => navigation?.navigate('FinancialGoals') },
      ],
    },
    {
      title: '⚙️ 应用',
      items: [
        {
          id: 'app-settings',
          label: '应用设置',
          icon: 'settings',
          onPress: () => navigation?.navigate('AppSettings'),
        },
      ],
    },
    {
      title: 'ℹ️ 关于',
      items: [
        { id: 'about', label: '关于应用', icon: 'info', onPress: () => navigation?.navigate('About') },
      ],
    },
  ];

  const handleLogout = () => {
    confirm(
      '退出登录',
      '确定要退出登录吗？',
      async () => {
        try {
          await logout();
        } catch (error) {
          console.error('退出登录失败', error);
        }
      },
      undefined,
      { confirmText: '确定', destructive: true }
    );
  };

  const displayAvatar = getAvatarUrl(user?.avatar);

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => navigation?.navigate('EditProfile')}
        activeOpacity={0.8}
      >
        <View style={styles.userInfo}>
          <View style={styles.avatarContainer}>
            {displayAvatar ? (
              <Image source={{ uri: displayAvatar }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <User size={32} color={styles._colors.primary} />
              </View>
            )}
          </View>
          <View style={styles.userDetails}>
            <Text style={styles.userName}>{user?.nickname || user?.username || '用户'}</Text>
            <Text style={styles.userType}>{user?.email || '智能记账用户'}</Text>
          </View>
          <ChevronRight size={24} color={styles._colors.stroke} strokeWidth={2.5} />
        </View>
      </TouchableOpacity>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {settingGroups.map((group, groupIndex) => (
          <View key={groupIndex} style={styles.settingGroup}>
            <Text style={styles.groupTitle}>{group.title}</Text>
            <View style={styles.groupItems}>
              {group.items.map((item) => {
                const IconComponent = iconMap[item.icon];
                const candyColor = ICON_CANDY_COLORS[item.icon] || styles._colors.accent;
                return (
                <View key={item.id}>
                  {('isSwitch' in item && item.isSwitch) ? (
                    <View style={styles.settingItem}>
                      <View style={styles.settingLeft}>
                        <View style={[styles.iconContainer, { backgroundColor: candyColor }]}>
                          {IconComponent && <IconComponent size={20} color={styles._colors.stroke} />}
                        </View>
                        <Text style={styles.settingLabel}>{item.label}</Text>
                      </View>
                      <Switch
                        value={item.value}
                        onValueChange={item.onValueChange}
                        disabled={item.disabled}
                        trackColor={{ false: styles._colors.divider, true: styles._colors.primary }}
                        thumbColor="#FFFFFF"
                      />
                    </View>
                  ) : ('onPress' in item) ? (
                    <TouchableOpacity
                      style={styles.settingItem}
                      onPress={item.onPress}
                      activeOpacity={0.8}
                    >
                      <View style={styles.settingLeft}>
                        <View style={[styles.iconContainer, { backgroundColor: candyColor }]}>
                          {IconComponent && <IconComponent size={20} color={styles._colors.stroke} />}
                        </View>
                        <Text style={styles.settingLabel}>{item.label}</Text>
                      </View>
                      <ChevronRight size={20} color={styles._colors.textTertiary} strokeWidth={2.5} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              )})}
            </View>
          </View>
        ))}

        <TouchableOpacity
          style={styles.logoutButton}
          onPress={handleLogout}
          activeOpacity={0.8}
        >
          <LogOut size={20} color={styles._colors.error} strokeWidth={2.5} />
          <Text style={styles.logoutText}>退出登录</Text>
        </TouchableOpacity>

        <View style={styles.versionInfo}>
          <Text style={styles.copyrightText}>© 2026 知帐</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => ({
  ...StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      backgroundColor: colors.surface,
      marginHorizontal: spacing.lg,
      marginTop: spacing.lg,
      borderRadius: borderRadius.card,
      borderWidth: borderWidth.thin,
      borderColor: colors.stroke,
      padding: spacing.lg,
      ...shadow.small,
    },
    userInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    avatarContainer: {
      width: 64,
      height: 64,
      borderRadius: borderRadius.medium,
      borderWidth: borderWidth.medium,
      borderColor: colors.stroke,
      backgroundColor: colors.accent,
      overflow: 'hidden',
    },
    avatar: {
      width: '100%',
      height: '100%',
    },
    avatarPlaceholder: {
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    },
    userDetails: {
      flex: 1,
    },
    userName: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.textPrimary,
      marginBottom: 2,
    },
    userType: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    scrollView: {
      flex: 1,
    },
    settingGroup: {
      marginTop: spacing.lg,
      paddingHorizontal: spacing.lg,
    },
    groupTitle: {
      fontSize: 14,
      fontWeight: '800',
      color: colors.textSecondary,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.xs,
    },
    groupItems: {
      gap: spacing.sm,
    },
    settingItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      minHeight: 56,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.card,
      borderWidth: borderWidth.thin,
      borderColor: colors.stroke,
    },
    settingLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
      gap: spacing.md,
    },
    iconContainer: {
      width: 40,
      height: 40,
      borderRadius: borderRadius.small,
      borderWidth: borderWidth.thin,
      borderColor: colors.stroke,
      alignItems: 'center',
      justifyContent: 'center',
    },
    settingLabel: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    choiceInfo: {
      flex: 1,
    },
    choiceHint: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textTertiary,
      marginTop: 2,
    },
    choiceButtons: {
      flexDirection: 'row',
      borderWidth: borderWidth.thin,
      borderColor: colors.stroke,
      borderRadius: borderRadius.small,
      overflow: 'hidden',
    },
    choiceButton: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      backgroundColor: colors.background,
    },
    choiceButtonActive: {
      backgroundColor: colors.primary,
    },
    choiceButtonText: {
      fontSize: 12,
      fontWeight: '800',
      color: colors.textSecondary,
    },
    choiceButtonTextActive: {
      color: '#FFFFFF',
    },
    logoutButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      marginHorizontal: spacing.lg,
      marginTop: spacing.xl,
      paddingVertical: spacing.md,
      backgroundColor: colors.error + '15',
      borderRadius: borderRadius.button,
      borderWidth: borderWidth.thin,
      borderColor: colors.error,
      minHeight: 48,
    },
    logoutText: {
      fontSize: 15,
      fontWeight: '800',
      color: colors.error,
    },
    versionInfo: {
      alignItems: 'center',
      paddingTop: spacing.lg,
      paddingBottom: spacing.xl,
    },
    versionText: {
      fontSize: 12,
      fontWeight: '600',
      fontFamily: 'Courier',
      color: colors.textTertiary,
    },
    copyrightText: {
      fontSize: 12,
      fontWeight: '600',
      fontFamily: 'Courier',
      color: colors.textTertiary,
      marginTop: 4,
    },
    aboutOverlay: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.lg,
      backgroundColor: 'rgba(0, 0, 0, 0.45)',
    },
    aboutCard: {
      width: '100%',
      maxWidth: 420,
      backgroundColor: colors.surface,
      borderRadius: borderRadius.card,
      borderWidth: borderWidth.medium,
      borderColor: colors.stroke,
      padding: spacing.lg,
      ...shadow.medium,
    },
    aboutHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: spacing.lg,
    },
    aboutLogo: {
      width: 52,
      height: 52,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
      borderRadius: borderRadius.medium,
      borderWidth: borderWidth.medium,
      borderColor: colors.stroke,
      marginRight: spacing.md,
    },
    aboutLogoText: {
      fontSize: 28,
      fontWeight: '900',
      color: colors.textPrimary,
    },
    aboutTitleBlock: {
      flex: 1,
    },
    aboutTitle: {
      fontSize: 22,
      fontWeight: '900',
      color: colors.textPrimary,
    },
    aboutSubtitle: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSecondary,
      marginTop: 2,
    },
    aboutClose: {
      width: 34,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
      borderRadius: borderRadius.small,
      borderWidth: borderWidth.thin,
      borderColor: colors.stroke,
    },
    aboutCloseText: {
      fontSize: 24,
      lineHeight: 26,
      fontWeight: '800',
      color: colors.textPrimary,
    },
    aboutVersionBadge: {
      alignSelf: 'flex-start',
      backgroundColor: colors.primaryLight,
      borderRadius: borderRadius.small,
      borderWidth: borderWidth.thin,
      borderColor: colors.stroke,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      marginBottom: spacing.md,
    },
    aboutVersionText: {
      fontSize: 12,
      fontWeight: '800',
      fontFamily: 'Courier',
      color: colors.textPrimary,
    },
    aboutInfoList: {
      borderTopWidth: borderWidth.thin,
      borderTopColor: colors.divider,
      marginBottom: spacing.lg,
    },
    aboutInfoRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingVertical: spacing.sm,
      borderBottomWidth: borderWidth.thin,
      borderBottomColor: colors.divider,
    },
    aboutInfoLabel: {
      width: 72,
      fontSize: 12,
      fontWeight: '800',
      color: colors.textSecondary,
    },
    aboutInfoValue: {
      flex: 1,
      fontSize: 12,
      lineHeight: 18,
      fontWeight: '700',
      color: colors.textPrimary,
    },
    aboutGithubButton: {
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
      borderRadius: borderRadius.button,
      borderWidth: borderWidth.thin,
      borderColor: colors.stroke,
    },
    aboutGithubText: {
      fontSize: 14,
      fontWeight: '900',
      color: '#FFFFFF',
    },
  }),
  _colors: colors,
});
