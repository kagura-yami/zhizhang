/**
 * 关于应用 - 基础信息、更新检查与历史版本。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CheckCircle2, Clock3, Github, RefreshCw } from 'lucide-react-native';
import { useAppUpdate, useStyles } from '../hooks';
import { useAlert } from '../providers';
import { UpdateModal } from '../components/UpdateModal';
import { appVersionApi, AppVersionInfo } from '../services/api/appVersion';
import { ThemeColors } from '../theme/colors';
import { borderRadius, borderWidth, shadow, spacing } from '../theme';

export default function AboutScreen() {
  const styles = useStyles(createStyles);
  const { alert } = useAlert();
  const [history, setHistory] = useState<AppVersionInfo[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const {
    showModal,
    latestVersion,
    updateHistory,
    downloading,
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
  }, [loadHistory, refreshCurrentVersion]);

  const handleCheckUpdate = async () => {
    await checkUpdate();
    // 检查完成后刷新列表，保证刚发布的版本立即出现在历史记录中。
    await loadHistory();
  };

  const formatDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.brandCard}>
          <View style={styles.logo}><Text style={styles.logoText}>知</Text></View>
          <View style={styles.brandCopy}>
            <Text style={styles.title}>知帐 zhizhang</Text>
            <Text style={styles.subtitle}>智能记账，轻量生活</Text>
          </View>
          <View style={styles.currentBadge}>
            <Text style={styles.currentBadgeText}>当前版本</Text>
            <Text style={styles.currentVersion}>{currentVersion}</Text>
          </View>
        </View>

        <View style={styles.infoCard}>
          <Text style={styles.sectionTitle}>应用信息</Text>
          <InfoRow label="应用功能" value="自动记账 · 收支统计 · AI 助手" styles={styles} />
          <InfoRow label="统计维度" value="每日 · 月度 · 年度" styles={styles} />
          <InfoRow label="服务地址" value="note.kagurayami.top" styles={styles} />
          <InfoRow label="隐私提示" value="AI API 由用户自行配置" styles={styles} />
        </View>

        <View style={styles.updateCard}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>版本更新</Text>
              <Text style={styles.sectionHint}>检查新版本并查看完整更新内容</Text>
            </View>
            <CheckCircle2 size={24} color={styles._colors.success} />
          </View>
          <TouchableOpacity style={styles.checkButton} onPress={handleCheckUpdate} activeOpacity={0.85}>
            <RefreshCw size={19} color="#FFFFFF" />
            <Text style={styles.checkButtonText}>检查更新</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.historyCard}>
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionTitle}>历史版本</Text>
              <Text style={styles.sectionHint}>每次发布的版本与更新说明</Text>
            </View>
            <Clock3 size={24} color={styles._colors.primary} />
          </View>
          {historyLoading ? (
            <Text style={styles.emptyText}>正在加载版本记录…</Text>
          ) : history.length === 0 ? (
            <Text style={styles.emptyText}>暂无版本记录</Text>
          ) : history.map((item) => (
            <View key={item.id} style={styles.historyRow}>
              <View style={styles.historyVersionBlock}>
                <Text style={styles.historyVersion}>v{item.version}</Text>
                <Text style={styles.historyDate}>{formatDate(item.createdAt)}</Text>
              </View>
              <Text style={styles.historyLog}>{item.updateLog || '体验与稳定性优化'}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={styles.githubButton}
          onPress={() => Linking.openURL('https://github.com/kagura-yami/Auto-LiteNote').catch(() => alert('提示', '无法打开项目地址'))}
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

function InfoRow({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => ({
  ...StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.lg, paddingBottom: spacing.xxl },
    brandCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: borderWidth.thin, borderColor: colors.stroke, borderRadius: borderRadius.card, padding: spacing.lg, ...shadow.small },
    logo: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight, borderWidth: borderWidth.medium, borderColor: colors.stroke, borderRadius: borderRadius.medium },
    logoText: { fontSize: 34, fontWeight: '900', color: colors.primary },
    brandCopy: { flex: 1, marginLeft: spacing.md },
    title: { fontSize: 23, fontWeight: '900', color: colors.textPrimary },
    subtitle: { marginTop: 3, fontSize: 13, fontWeight: '600', color: colors.textSecondary },
    currentBadge: { alignItems: 'flex-end' },
    currentBadgeText: { fontSize: 11, fontWeight: '700', color: colors.textTertiary },
    currentVersion: { marginTop: 3, fontSize: 16, fontWeight: '900', color: colors.primary },
    infoCard: { marginTop: spacing.lg, backgroundColor: colors.surface, borderWidth: borderWidth.thin, borderColor: colors.stroke, borderRadius: borderRadius.card, padding: spacing.lg },
    updateCard: { marginTop: spacing.lg, backgroundColor: colors.accent, borderWidth: borderWidth.thin, borderColor: colors.stroke, borderRadius: borderRadius.card, padding: spacing.lg, ...shadow.small },
    historyCard: { marginTop: spacing.lg, backgroundColor: colors.surface, borderWidth: borderWidth.thin, borderColor: colors.stroke, borderRadius: borderRadius.card, padding: spacing.lg },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sectionTitle: { fontSize: 17, fontWeight: '900', color: colors.textPrimary, marginBottom: spacing.sm },
    sectionHint: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
    infoRow: { flexDirection: 'row', paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    infoLabel: { width: 76, fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    infoValue: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.textPrimary },
    checkButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.primary, borderWidth: borderWidth.medium, borderColor: colors.stroke, borderRadius: borderRadius.button },
    checkButtonText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
    historyRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    historyVersionBlock: { width: 82 },
    historyVersion: { fontSize: 14, fontWeight: '900', color: colors.primary },
    historyDate: { marginTop: 3, fontSize: 11, color: colors.textTertiary },
    historyLog: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '600', color: colors.textPrimary },
    emptyText: { paddingVertical: spacing.lg, textAlign: 'center', fontSize: 13, color: colors.textTertiary },
    githubButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.lg, paddingVertical: spacing.md, borderWidth: borderWidth.thin, borderColor: colors.stroke, borderRadius: borderRadius.button, backgroundColor: colors.surface },
    githubText: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
  }),
  _colors: colors,
});
