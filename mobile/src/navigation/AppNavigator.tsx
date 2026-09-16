/**
 * 应用导航器 - Neo-Brutalism 风格
 * 粗描边 Tab Bar + 糖果色活跃态 + 方圆角"+"按钮 + 实心阴影
 */
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { DeviceEventEmitter, View, StyleSheet, StatusBar, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Sentry from '@sentry/react-native';
import BottomTabBar from './BottomTabBar';
import { useSocialApi, useSocialResource } from '../screens/social/shared';

// 导入屏幕组件
import SettingsScreen from '../screens/SettingsScreen';
import GeneralSettingsScreen from '../screens/GeneralSettingsScreen';
import PersonalizationSettingsScreen from '../screens/PersonalizationSettingsScreen';
import AppSecuritySettingsScreen from '../screens/AppSecuritySettingsScreen';
import AppSettingsScreen from '../screens/AppSettingsScreen';
import AboutScreen from '../screens/AboutScreen';
import {
  CreateBillScreen,
  AllBillsScreen,
  StatisticsScreen,
  CategoryManageScreen,
  BillDetailScreen,
} from '../screens/finance';
import { DashboardScreen } from '../screens/dashboard';
import { ReportsScreen } from '../screens/reports';
import { AIChatScreen, AIChatSessionsScreen } from '../screens/ai';
import VoiceInputOverlay from '../components/VoiceInputOverlay';
import { LoginScreen, UserAgreementScreen, PrivacyPolicyScreen, EditProfileScreen } from '../screens/auth';
import FinancialGoalScreen from '../screens/FinancialGoalScreen';
import BudgetScreen from '../screens/BudgetScreen';
import InvoiceMailboxScreen from '../screens/InvoiceMailboxScreen';
import InvoiceCenterScreen from '../screens/InvoiceCenterScreen';
import InvoiceDetailScreen from '../screens/InvoiceDetailScreen';
import SocialSettingsScreen from '../screens/social/SocialSettingsScreen';
import SocialCommunityScreen from '../screens/social/SocialCommunityScreen';
import SocialGrantsScreen from '../screens/social/SocialGrantsScreen';
import SocialRankingsScreen from '../screens/social/SocialRankingsScreen';
import SocialRankingSettingsScreen from '../screens/social/SocialRankingSettingsScreen';
import SocialPeopleScreen from '../screens/social/SocialPeopleScreen';
import SocialPersonScreen from '../screens/social/SocialPersonScreen';
import SocialGrantScreen from '../screens/social/SocialGrantScreen';
import SocialRequestsScreen from '../screens/social/SocialRequestsScreen';
import SocialBillsScreen from '../screens/social/SocialBillsScreen';
import SocialBillReviewScreen from '../screens/social/SocialBillReviewScreen';
import SocialReceivedReviewsScreen from '../screens/social/SocialReceivedReviewsScreen';
import SocialReviewThreadScreen from '../screens/social/SocialReviewThreadScreen';
import SocialReviewVersionsScreen from '../screens/social/SocialReviewVersionsScreen';
import SocialReportScreen from '../screens/social/SocialReportScreen';
import SocialReportsScreen from '../screens/social/SocialReportsScreen';
import SocialInboxScreen from '../screens/social/SocialInboxScreen';
import SocialBillFeedbackScreen from '../screens/social/SocialBillFeedbackScreen';

import { useTheme, useAuth } from '../providers';
import { borderWidth } from '../theme/spacing';
import '../types/navigation';

const Stack = createNativeStackNavigator();

// 主导航容器组件
function MainNavigator({ navigation }: { navigation: any }) {
  const [activeTab, setActiveTab] = useState('dashboard');
  const { isDark, colors } = useTheme();
  const socialApi = useSocialApi();
  const community = useSocialResource(useCallback(() => socialApi.status(), [socialApi]));
  const communityEnabled = community.value?.enabled === true;
  useEffect(() => {
    const listener = DeviceEventEmitter.addListener('communityChanged', community.refresh);
    return () => listener.remove();
  }, [community.refresh]);
  useEffect(() => {
    if (community.value?.enabled === false && activeTab === 'community') setActiveTab('dashboard');
  }, [community.value?.enabled, activeTab]);

  const dynamicStyles = useMemo(() => StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
  }), [colors]);

  const handleTabPress = (key: string) => {
    if (key === 'add') {
      Sentry.captureMessage('用户点击记账按钮', {
        level: 'info',
        tags: {
          action: 'navigation',
          screen: 'create_bill',
        },
      });
      navigation.navigate('CreateBill');
    } else {
      setActiveTab(key);
    }
  };

  const renderScreen = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardScreen />;
      case 'reports':
        return <ReportsScreen />;
      case 'settings':
        return <SettingsScreen navigation={navigation} />;
      case 'ai':
        return <AIChatScreen />;
      case 'community':
        return communityEnabled ? <SocialCommunityScreen navigation={navigation} /> : <DashboardScreen />;
      default:
        return <DashboardScreen />;
    }
  };

  return (
    <SafeAreaView style={dynamicStyles.container}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
        translucent={false}
      />
      <View style={styles.content}>
        {renderScreen()}
      </View>
      <BottomTabBar activeTab={activeTab} onTabPress={handleTabPress} colors={colors} communityEnabled={communityEnabled} />
      <VoiceInputOverlay />
    </SafeAreaView>
  );
}

// 加载页面
function LoadingScreen() {
  const { colors } = useTheme();

  return (
    <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

// 根导航器
export default function AppNavigator() {
  const { isDark, colors } = useTheme();
  const { isLoggedIn, isLoading } = useAuth();

  // Neo-Brutalism 导航主题
  const navigationTheme = useMemo(() => ({
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      primary: colors.primary,
      background: colors.background,
      card: colors.surface,
      text: colors.textPrimary,
      border: colors.stroke,
    },
  }), [isDark, colors]);

  // Neo-Brutalism Stack Header 样式
  const stackScreenOptions = useMemo(() => ({
    headerShown: false,
    headerStyle: {
      backgroundColor: colors.surface,
      borderBottomWidth: borderWidth.medium,
      borderBottomColor: colors.stroke,
    } as any,
    headerTitleStyle: {
      fontSize: 18,
      fontWeight: '800' as const,
      color: colors.textPrimary,
    },
    headerTintColor: colors.textPrimary,
    headerShadowVisible: false,
  }), [colors]);

  if (isLoading) {
    return (
      <NavigationContainer theme={navigationTheme}>
        <LoadingScreen />
      </NavigationContainer>
    );
  }

  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator screenOptions={stackScreenOptions}>
        {!isLoggedIn ? (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen
              name="UserAgreement"
              component={UserAgreementScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="PrivacyPolicy"
              component={PrivacyPolicyScreen}
              options={{ headerShown: false }}
            />
          </>
        ) : (
          <>
            <Stack.Screen name="Main" component={MainNavigator} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
            <Stack.Screen name="SocialSettings" component={SocialSettingsScreen} options={{ headerShown: true, title: '社群与隐私' }} />
            <Stack.Screen name="SocialCommunity" component={SocialCommunityScreen} options={{ headerShown: true, title: '社群' }} />
            <Stack.Screen name="SocialGrants" component={SocialGrantsScreen} options={{ headerShown: true, title: '评账授权' }} />
            <Stack.Screen name="SocialRankings" component={SocialRankingsScreen} options={{ headerShown: true, title: '结余排行榜' }} />
            <Stack.Screen name="SocialRankingSettings" component={SocialRankingSettingsScreen} options={{ headerShown: true, title: '参榜与金额隐私' }} />
            <Stack.Screen name="SocialPeople" component={SocialPeopleScreen} options={{ headerShown: true, title: '关系管理' }} />
            <Stack.Screen name="SocialPerson" component={SocialPersonScreen} options={{ headerShown: true, title: '关系与授权' }} />
            <Stack.Screen name="SocialGrant" component={SocialGrantScreen} options={{ headerShown: true, title: '确认评账授权' }} />
            <Stack.Screen name="SocialRequests" component={SocialRequestsScreen} options={{ headerShown: true, title: '评账申请' }} />
            <Stack.Screen name="SocialBills" component={SocialBillsScreen} options={{ headerShown: true, title: '授权账单' }} />
            <Stack.Screen name="SocialBillReview" component={SocialBillReviewScreen} options={{ headerShown: true, title: '我的评价' }} />
            <Stack.Screen name="SocialReceivedReviews" component={SocialReceivedReviewsScreen} options={{ headerShown: true, title: '收到的评账' }} />
            <Stack.Screen name="SocialReviewThread" component={SocialReviewThreadScreen} options={{ headerShown: true, title: '私密对话' }} />
            <Stack.Screen name="SocialReviewVersions" component={SocialReviewVersionsScreen} options={{ headerShown: true, title: '文字版本' }} />
            <Stack.Screen name="SocialReport" component={SocialReportScreen} options={{ headerShown: true, title: '举报披露确认' }} />
            <Stack.Screen name="SocialReports" component={SocialReportsScreen} options={{ headerShown: true, title: '我的举报' }} />
            <Stack.Screen name="SocialInbox" component={SocialInboxScreen} options={{ headerShown: true, title: '社群消息' }} />
            <Stack.Screen name="SocialBillFeedback" component={SocialBillFeedbackScreen} options={{ headerShown: true, title: '账单评价' }} />
            <Stack.Screen
              name="About"
              component={AboutScreen}
              options={{ headerShown: true, title: '关于应用' }}
            />
            <Stack.Screen
              name="AppSettings"
              component={AppSettingsScreen}
              options={{ headerShown: true, title: '应用设置' }}
            />
            <Stack.Screen
              name="GeneralSettings"
              component={GeneralSettingsScreen}
              options={{ headerShown: true, title: '通用配置' }}
            />
            <Stack.Screen
              name="PersonalizationSettings"
              component={PersonalizationSettingsScreen}
              options={{ headerShown: true, title: '个性化设置' }}
            />
            <Stack.Screen
              name="AppSecuritySettings"
              component={AppSecuritySettingsScreen}
              options={{ headerShown: true, title: '应用安全' }}
            />
            <Stack.Screen
              name="CreateBill"
              component={CreateBillScreen}
              options={{
                headerShown: true,
                title: '创建账单',
              }}
            />
            <Stack.Screen
              name="EditBill"
              component={CreateBillScreen}
              options={{
                headerShown: true,
                title: '编辑账单',
              }}
            />
            <Stack.Screen
              name="AllBills"
              component={AllBillsScreen}
              options={{
                headerShown: true,
                title: '全部账单',
              }}
            />
            <Stack.Screen
              name="Statistics"
              component={StatisticsScreen}
              options={{
                headerShown: true,
                title: '统计分析',
              }}
            />
            <Stack.Screen
              name="Categories"
              component={CategoryManageScreen}
              options={{
                headerShown: true,
                title: '分类管理',
              }}
            />
            <Stack.Screen
              name="BillDetail"
              component={BillDetailScreen}
              options={{
                headerShown: true,
                title: '交易详情',
              }}
            />
            <Stack.Screen
              name="EditProfile"
              component={EditProfileScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="InvoiceMailbox"
              component={InvoiceMailboxScreen}
              options={{ headerShown: true, title: '发票邮箱' }}
            />
            <Stack.Screen
              name="InvoiceCenter"
              component={InvoiceCenterScreen}
              options={{ headerShown: true, title: '发票中心' }}
            />
            <Stack.Screen
              name="InvoiceDetail"
              component={InvoiceDetailScreen}
              options={{ headerShown: true, title: '发票详情' }}
            />
            <Stack.Screen
              name="FinancialGoals"
              component={FinancialGoalScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Budgets"
              component={BudgetScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="AIChatSessions"
              component={AIChatSessionsScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="AIChat"
              component={AIChatScreen}
              options={{ headerShown: false }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
