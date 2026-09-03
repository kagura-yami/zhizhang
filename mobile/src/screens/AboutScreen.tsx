/**
 * 关于应用 - 基础信息、更新检查与历史版本。
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  DeviceEventEmitter,
  Switch,
  NativeModules,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Check, ChevronDown, ChevronUp, Clock3, Github, RefreshCw, Sparkles, Tags, BarChart3, BellRing } from 'lucide-react-native';
import { useAppUpdate, useStyles } from '../hooks';
import { useAlert } from '../providers';
import { UpdateModal } from '../components/UpdateModal';
import { appVersionApi, AppVersionInfo } from '../services/api/appVersion';
import { ThemeColors } from '../theme/colors';
import { borderRadius, borderWidth, shadow, spacing } from '../theme';

// 构建前从二维码素材解码出的微信链接，点击后直接交给系统唤起微信。
const WECHAT_QR_LINKS = {
  service: 'https://u.wechat.com/MEzLig5zSHR1NCG8RChCeR8?s=3',
  group: 'https://weixin.qq.com/g/AQYAAJQ87uXtTLJbJI4O8A7ZkGP6fpzkL-lridIL-twHRkdiDCe1IUr6tU7C5tyr',
} as const;

export default function AboutScreen() {
  const styles = useStyles(createStyles);
  const { alert } = useAlert();
  const [history, setHistory] = useState<AppVersionInfo[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true);
  const [autoDownloadEnabled, setAutoDownloadEnabled] = useState(true);
  const {
    checking,
    hasUpdate,
    showModal,
    latestVersion,
    updateHistory,
    downloading,
    downloadedVersion,
    progress,
    currentVersion,
    refreshCurrentVersion,
    checkUpdate,
    hideModal,
    downloadAndInstall,
  } = useAppUpdate({ autoCheck: false });

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    const versions = await appVersionApi.getHistory();
    setHistory(versions);
    setHistoryLoading(false);
  }, []);

  useEffect(() => {
    refreshCurrentVersion().catch(() => undefined);
    loadHistory();
    AsyncStorage.getItem('appGeneralConfig').then(raw => {
      if (!raw) return;
      const parsed = JSON.parse(raw) as { autoUpdateEnabled?: boolean; autoDownloadUpdateEnabled?: boolean };
      setAutoUpdateEnabled(parsed.autoUpdateEnabled !== false);
      setAutoDownloadEnabled(parsed.autoDownloadUpdateEnabled !== false);
    }).catch(() => undefined);
  }, [loadHistory, refreshCurrentVersion]);

  const toggleAutoUpdate = async (enabled: boolean) => {
    setAutoUpdateEnabled(enabled);
    try {
      const raw = await AsyncStorage.getItem('appGeneralConfig');
      const config = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      await AsyncStorage.setItem('appGeneralConfig', JSON.stringify({ ...config, autoUpdateEnabled: enabled }));
      DeviceEventEmitter.emit('autoUpdateSettingChanged', enabled);
    } catch {
      setAutoUpdateEnabled(!enabled);
    }
  };

  const toggleAutoDownload = async (enabled: boolean) => {
    setAutoDownloadEnabled(enabled);
    try {
      const raw = await AsyncStorage.getItem('appGeneralConfig');
      const config = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      await AsyncStorage.setItem('appGeneralConfig', JSON.stringify({ ...config, autoDownloadUpdateEnabled: enabled }));
    } catch {
      setAutoDownloadEnabled(!enabled);
    }
  };

  const openWechatLink = async (url: string, targetName: string) => {
    try {
      if (Platform.OS === 'android' && NativeModules.WechatLinkModule?.open) {
        await NativeModules.WechatLinkModule.open(url);
      } else {
        await Linking.openURL(url);
      }
    } catch {
      alert('无法打开微信', `请先安装微信，再打开${targetName}链接。`);
    }
  };

  const handleCheckUpdate = async () => {
    await checkUpdate();
    // 检查完成后刷新列表，保证刚发布的版本立即出现在历史记录中。
    await loadHistory();
  };

  const handleUpdatePress = async () => {
    if (downloading) {
      alert('更新准备中', '安装包正在后台下载，完成后再点击“更新”。');
      return;
    }
    if (downloadedVersion && downloadedVersion === latestVersion?.version) {
      await downloadAndInstall();
      return;
    }
    // 未准备好时只启动/复用下载，不直接打开安装器，避免安装半包。
    await checkUpdate();
  };

  const visibleHistory = historyExpanded ? history : history.slice(0, 7);
  const hasHiddenHistory = history.length > 7;

  const formatDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brandCard}>
          <Image
            source={require('../../public/icons/brand-banner.png')}
            style={styles.brandImage}
            resizeMode="contain"
          />
          <View style={styles.brandMeta}>
            <View>
              <Text style={styles.eyebrow}>ZHIZHANG · SMART FINANCE</Text>
              <Text style={styles.subtitle}>自动记账 · 智能生活</Text>
            </View>
            <View style={styles.currentBadge}>
              <Text style={styles.currentBadgeText}>当前版本</Text>
              <Text style={styles.currentVersion}>{currentVersion}</Text>
            </View>
          </View>
        </View>

        <View style={styles.infoCard}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>知账能帮你</Text>
              <Text style={styles.sectionHint}>把每一笔收支变成清晰的生活线索</Text>
            </View>
            <Sparkles size={21} color={styles._colors.primary} />
          </View>
          <View style={styles.featureList}>
            <FeatureRow icon={<BellRing size={18} />} title="自动捕捉" text="从通知和短信中识别收支，减少手动记录" styles={styles} />
            <FeatureRow icon={<Tags size={18} />} title="智能整理" text="自动提取商户、用途和消费分类" styles={styles} />
            <FeatureRow icon={<BarChart3 size={18} />} title="看懂收支" text="用日、月、年视角掌握结余和消费趋势" styles={styles} />
          </View>
        </View>

        <View style={styles.updateRow}>
          <View style={styles.updateCopy}>
            <Text style={styles.sectionTitle}>版本更新</Text>
            <Text style={styles.sectionHint}>
              {hasUpdate
                ? `发现 v${latestVersion?.version || ''}`
                : '已是最新版本'}
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.updateButton,
              !hasUpdate && styles.updateButtonReady,
            ]}
            onPress={hasUpdate ? handleUpdatePress : handleCheckUpdate}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={downloading ? '更新包准备中' : hasUpdate ? '更新应用' : '检查更新'}
          >
            {checking ? (
              <ActivityIndicator
                size="small"
                color={hasUpdate ? '#FFFFFF' : styles._colors.success}
              />
            ) : downloading ? (
              <>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={styles.updateButtonText}>准备中</Text>
              </>
            ) : hasUpdate ? (
              <>
                <RefreshCw size={16} color="#FFFFFF" />
                <Text style={styles.updateButtonText}>更新</Text>
              </>
            ) : (
              <Check size={19} color={styles._colors.success} strokeWidth={3} />
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.autoUpdateRow}>
          <View style={styles.updateCopy}>
            <Text style={styles.sectionTitle}>自动检查更新</Text>
            <Text style={styles.sectionHint}>发现新版本后通知你，不会自动安装</Text>
          </View>
          <Switch
            value={autoUpdateEnabled}
            onValueChange={enabled => { toggleAutoUpdate(enabled).catch(() => undefined); }}
            trackColor={{ false: styles._colors.divider, true: styles._colors.primary }}
            thumbColor="#FFFFFF"
          />
        </View>

        <View style={styles.autoUpdateRow}>
          <View style={styles.updateCopy}>
            <Text style={styles.sectionTitle}>自动下载更新包</Text>
            <Text style={styles.sectionHint}>
              {downloadedVersion ? `检测到更新后会自动在后台准备安装包，v${downloadedVersion} 已缓存` : '检测到新版本后自动在后台下载，不显示进度，也不会自动打开安装界面'}
            </Text>
          </View>
          <Switch
            value={autoDownloadEnabled}
            onValueChange={enabled => { toggleAutoDownload(enabled).catch(() => undefined); }}
            trackColor={{ false: styles._colors.divider, true: styles._colors.primary }}
            thumbColor="#FFFFFF"
          />
        </View>

        <View style={styles.historyCard}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>历史版本</Text>
              <Text style={styles.sectionHint}>最近发布记录</Text>
            </View>
            <Clock3 size={21} color={styles._colors.primary} />
          </View>
          {historyLoading ? (
            <Text style={styles.emptyText}>正在加载版本记录…</Text>
          ) : history.length === 0 ? (
            <Text style={styles.emptyText}>暂无版本记录</Text>
          ) : (
            <>
              {visibleHistory.map((item, index) => (
                <View
                  key={item.id}
                  style={[
                    styles.historyRow,
                    index === visibleHistory.length - 1 &&
                      styles.historyRowLast,
                  ]}
                >
                  <View style={styles.historyVersionBlock}>
                    <Text style={styles.historyVersion}>v{item.version}</Text>
                    <Text style={styles.historyDate}>
                      {formatDate(item.createdAt)}
                    </Text>
                  </View>
                  <Text style={styles.historyLog}>
                    {item.updateLog || '体验与稳定性优化'}
                  </Text>
                </View>
              ))}
              {hasHiddenHistory && (
                <TouchableOpacity
                  style={styles.historyToggle}
                  onPress={() => setHistoryExpanded(value => !value)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.historyToggleText}>
                    {historyExpanded
                      ? '收起较早版本'
                      : `展开全部版本（${history.length}）`}
                  </Text>
                  {historyExpanded ? (
                    <ChevronUp size={17} color={styles._colors.primary} />
                  ) : (
                    <ChevronDown size={17} color={styles._colors.primary} />
                  )}
                </TouchableOpacity>
              )}
            </>
          )}
        </View>

        <View style={styles.contactCard}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>联系与交流</Text>
              <Text style={styles.sectionHint}>扫码联系神楽知客服，或加入知账用户群</Text>
            </View>
            <Text style={styles.contactEmoji}>💬</Text>
          </View>
          <View style={styles.qrGrid}>
            <TouchableOpacity
              style={styles.qrItem}
              onPress={() => openWechatLink(WECHAT_QR_LINKS.service, '客服 Bot')}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="打开微信联系神楽知客服 Bot"
            >
              <View style={styles.qrImageFrame}>
                <Image source={require('../../public/icons/wechat-service-qr.png')} style={styles.qrImage} resizeMode="contain" />
              </View>
              <Text style={styles.qrTitle}>神楽知客服 Bot</Text>
              <Text style={styles.qrHint}>点击打开微信</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.qrItem}
              onPress={() => openWechatLink(WECHAT_QR_LINKS.group, '知账用户群')}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="打开微信加入知账用户群"
            >
              <View style={styles.qrImageFrame}>
                <Image source={require('../../public/icons/wechat-group-qr.png')} style={styles.qrImage} resizeMode="contain" />
              </View>
              <Text style={styles.qrTitle}>知账用户群</Text>
              <Text style={styles.qrHint}>点击打开微信</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          style={styles.githubButton}
          onPress={() =>
            Linking.openURL('https://github.com/kagura-yami/zhizhang').catch(
              () => alert('提示', '无法打开项目地址'),
            )
          }
          activeOpacity={0.85}
        >
          <Github size={19} color={styles._colors.stroke} />
          <Text style={styles.githubText}>查看项目源码</Text>
        </TouchableOpacity>
      </ScrollView>

      <UpdateModal
        visible={showModal}
        versionInfo={latestVersion}
        updateHistory={updateHistory}
        downloading={downloading}
        progress={progress}
        onConfirm={downloadAndInstall}
        onCancel={hideModal}
      />
    </View>
  );
}

function FeatureRow({
  icon,
  title,
  text,
  styles,
}: {
  icon: React.ReactElement;
  title: string;
  text: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.featureRow}>
      <View style={styles.featureIcon}>
        {React.cloneElement(icon as React.ReactElement<any>, { color: styles._colors.primary })}
      </View>
      <View style={styles.featureCopy}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureText}>{text}</Text>
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => ({
  ...StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.lg, paddingBottom: spacing.xxl },
    brandCard: {
      backgroundColor: colors.surface,
      borderWidth: borderWidth.thin,
      borderColor: colors.stroke,
      borderRadius: borderRadius.card,
      padding: spacing.md,
      ...shadow.small,
    },
    brandImage: { width: '100%', height: 116 },
    brandMeta: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      marginTop: spacing.sm,
      paddingHorizontal: spacing.xs,
    },
    eyebrow: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1.1,
      color: colors.primary,
    },
    subtitle: {
      marginTop: 3,
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    currentBadge: { alignItems: 'flex-end' },
    currentBadgeText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textTertiary,
    },
    currentVersion: {
      marginTop: 3,
      fontSize: 16,
      fontWeight: '900',
      color: colors.primary,
    },
    infoCard: {
      marginTop: spacing.lg,
      backgroundColor: colors.surface,
      borderWidth: borderWidth.thin,
      borderColor: colors.stroke,
      borderRadius: borderRadius.card,
      padding: spacing.lg,
    },
    featureList: { marginTop: spacing.md, gap: spacing.sm },
    featureRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
      borderRadius: borderRadius.small,
      backgroundColor: colors.background,
    },
    featureIcon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primaryLight,
      marginRight: spacing.sm,
    },
    featureCopy: { flex: 1 },
    featureTitle: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
    featureText: { marginTop: 2, fontSize: 12, lineHeight: 17, color: colors.textSecondary },
    updateRow: {
      marginTop: spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xs,
      paddingVertical: spacing.sm,
    },
    updateCopy: { flex: 1 },
    autoUpdateRow: {
      marginTop: spacing.xs,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.xs,
      paddingVertical: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    updateButton: {
      minWidth: 74,
      height: 38,
      marginLeft: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      backgroundColor: colors.primary,
      borderWidth: borderWidth.medium,
      borderColor: colors.stroke,
      borderRadius: borderRadius.button,
      ...shadow.small,
    },
    updateButtonReady: {
      minWidth: 38,
      width: 38,
      backgroundColor: colors.successLight,
      borderColor: colors.success,
      shadowOpacity: 0,
      elevation: 0,
    },
    updateButtonText: { fontSize: 14, fontWeight: '900', color: '#FFFFFF' },
    historyCard: {
      marginTop: spacing.sm,
      backgroundColor: colors.surface,
      borderWidth: borderWidth.thin,
      borderColor: colors.stroke,
      borderRadius: borderRadius.card,
      padding: spacing.lg,
    },
    contactCard: {
      marginTop: spacing.sm,
      backgroundColor: colors.surface,
      borderWidth: borderWidth.thin,
      borderColor: colors.stroke,
      borderRadius: borderRadius.card,
      padding: spacing.lg,
    },
    contactEmoji: { fontSize: 22 },
    qrGrid: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    qrItem: {
      flex: 1,
      alignItems: 'center',
      padding: spacing.sm,
      borderRadius: borderRadius.small,
      backgroundColor: colors.background,
      borderWidth: borderWidth.thin,
      borderColor: colors.divider,
    },
    // 固定可预测的尺寸，避免 Android Remote/Image 在 flex 子项中把 100% + aspectRatio
    // 解析成原图尺寸，导致二维码溢出卡片；白色留白同时保证微信扫码识别率。
    qrImageFrame: {
      width: '100%',
      maxWidth: 136,
      height: 136,
      alignSelf: 'center',
      padding: spacing.xs,
      borderRadius: borderRadius.small,
      backgroundColor: '#FFFFFF',
      overflow: 'hidden',
    },
    qrImage: { width: '100%', height: '100%' },
    qrTitle: { marginTop: spacing.sm, fontSize: 13, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
    qrHint: { marginTop: 3, fontSize: 11, color: colors.textTertiary, textAlign: 'center' },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    sectionTitle: {
      fontSize: 17,
      fontWeight: '900',
      color: colors.textPrimary,
      marginBottom: spacing.sm,
    },
    sectionHint: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    historyRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    historyRowLast: { borderBottomWidth: 0 },
    historyVersionBlock: { width: 82 },
    historyVersion: { fontSize: 14, fontWeight: '900', color: colors.primary },
    historyDate: { marginTop: 3, fontSize: 11, color: colors.textTertiary },
    historyLog: {
      flex: 1,
      fontSize: 13,
      lineHeight: 19,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    historyToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      marginTop: spacing.sm,
      paddingTop: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    historyToggleText: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.primary,
    },
    emptyText: {
      paddingVertical: spacing.lg,
      textAlign: 'center',
      fontSize: 13,
      color: colors.textTertiary,
    },
    githubButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      marginTop: spacing.lg,
      paddingVertical: spacing.md,
      borderWidth: borderWidth.thin,
      borderColor: colors.stroke,
      borderRadius: borderRadius.button,
      backgroundColor: colors.surface,
    },
    githubText: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
  }),
  _colors: colors,
});
