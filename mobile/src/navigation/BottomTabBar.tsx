import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Home, BarChart3, MessageCircle, User, Users } from 'lucide-react-native';
import { spacing, borderRadius, borderWidth } from '../theme/spacing';
import { ThemeColors } from '../theme/colors';

// 使用 lucide-react-native 图标 - Neo-Brutalism 加粗描边
const HomeIcon = ({ color, size = 24 }: { color: string; size?: number }) => (
  <Home size={size} color={color} strokeWidth={2.5} />
);

const ChartIcon = ({ color, size = 24 }: { color: string; size?: number }) => (
  <BarChart3 size={size} color={color} strokeWidth={2.5} />
);

const ChatIcon = ({ color, size = 24 }: { color: string; size?: number }) => (
  <MessageCircle size={size} color={color} strokeWidth={2.5} />
);

const UserIcon = ({ color, size = 24 }: { color: string; size?: number }) => (
  <User size={size} color={color} strokeWidth={2.5} />
);

// 底部导航标签配置
interface TabConfig {
  key: string;
  label: string;
  IconComponent: React.FC<{ color: string; size?: number }>;
}

const tabs: TabConfig[] = [
  { key: 'dashboard', label: '首页', IconComponent: HomeIcon },
  { key: 'reports', label: '统计', IconComponent: ChartIcon },
  { key: 'add', label: '记账', IconComponent: () => null },
  { key: 'community', label: '社群', IconComponent: ({ color, size }) => <Users color={color} size={size} strokeWidth={2.5} /> },
  { key: 'ai', label: 'AI助手', IconComponent: ChatIcon },
  { key: 'settings', label: '我的', IconComponent: UserIcon },
];

// Neo-Brutalism 底部导航栏组件
interface BottomTabBarProps {
  activeTab: string;
  onTabPress: (key: string) => void;
  colors: ThemeColors;
  communityEnabled: boolean;
}

export default function BottomTabBar({ activeTab, onTabPress, colors, communityEnabled }: BottomTabBarProps) {
  const dynamicStyles = useMemo(() => StyleSheet.create({
    container: {
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderTopWidth: borderWidth.thick,
      borderTopColor: colors.stroke,
      paddingBottom: spacing.sm,
      paddingTop: spacing.sm,
    },
    tabLabel: {
      fontSize: 10,
      color: colors.textTertiary,
      fontWeight: '600',
      marginTop: 3,
    },
    tabLabelActive: {
      color: colors.textPrimary,
      fontWeight: '700',
    },
    // 活跃 tab 的背景块 — 始终保留 border 占位，避免切换时 borderRadius 表现不一致
    tabIconBlock: {
      width: 36,
      height: 36,
      borderRadius: borderRadius.small,
      borderWidth: borderWidth.thin,
      borderColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabIconBlockActive: {
      backgroundColor: colors.primaryLight,
      borderColor: colors.stroke,
    },
    // 中央"+"按钮 - Neo-Brutalism 方圆角 + 实心阴影
    addButtonOuter: {
      marginTop: -22,
    },
    addButtonShadow: {
      position: 'absolute',
      width: 52,
      height: 52,
      borderRadius: borderRadius.medium,
      backgroundColor: colors.stroke,
      top: 3,
      left: 3,
    },
    addButton: {
      width: 52,
      height: 52,
      borderRadius: borderRadius.medium,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: borderWidth.thick,
      borderColor: colors.stroke,
    },
    addButtonLabel: {
      fontSize: 10,
      color: colors.textTertiary,
      fontWeight: '600',
      marginTop: 6,
    },
  }), [colors]);

  return (
    <View style={dynamicStyles.container}>
      {tabs.filter(tab => tab.key !== 'community' || communityEnabled).map((tab) => {
        const isActive = activeTab === tab.key;
        const isAddButton = tab.key === 'add';

        if (isAddButton) {
          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => onTabPress(tab.key)}
              style={tabStyles.addButtonContainer}
              activeOpacity={0.8}
            >
              <View style={dynamicStyles.addButtonOuter}>
                <View style={dynamicStyles.addButtonShadow} />
                <View style={dynamicStyles.addButton}>
                  <Text style={tabStyles.addButtonIcon}>+</Text>
                </View>
              </View>
              <Text style={dynamicStyles.addButtonLabel}>{tab.label}</Text>
            </TouchableOpacity>
          );
        }

        const IconComponent = tab.IconComponent;
        const iconColor = isActive ? colors.primary : colors.textTertiary;

        return (
          <TouchableOpacity
            key={tab.key}
            onPress={() => onTabPress(tab.key)}
            style={tabStyles.tab}
            activeOpacity={0.7}
          >
            <View style={[
              dynamicStyles.tabIconBlock,
              isActive && dynamicStyles.tabIconBlockActive,
            ]}>
              <IconComponent color={iconColor} size={22} />
            </View>
            <Text style={[dynamicStyles.tabLabel, isActive && dynamicStyles.tabLabelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const tabStyles = StyleSheet.create({
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  addButtonContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  addButtonIcon: {
    fontSize: 28,
    fontWeight: '800',
    color: '#1A1A1A',
    marginTop: -2,
  },
});

