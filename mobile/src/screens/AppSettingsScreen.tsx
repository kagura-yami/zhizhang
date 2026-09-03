/** 应用设置二级菜单：集中承载应用级配置，避免主“我的”页过于拥挤。 */
import React, { useCallback, useEffect, useState } from 'react';
import { NativeModules, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronRight, Palette, Settings2, ShieldCheck } from 'lucide-react-native';
import { useStyles } from '../hooks';
import { ThemeColors } from '../theme/colors';
import { borderRadius, borderWidth, spacing } from '../theme';
import { paymentNotificationService } from '../services/paymentNotification';
import { useAlert } from '../providers';

interface AppSettingsScreenProps {
  navigation?: any;
}

const ITEMS = [
  { id: 'general', title: '通用配置', description: '应用权限、自动记账监听与识别关键词', icon: Settings2, route: 'GeneralSettings', color: '#7EB6FF' },
  { id: 'personalization', title: '个性化设置', description: '主题、首页展示和通知铃声', icon: Palette, route: 'PersonalizationSettings', color: '#C5A3FF' },
  { id: 'security', title: '应用安全', description: '本机自动登录与生物识别保护', icon: ShieldCheck, route: 'AppSecuritySettings', color: '#B7E4C7' },
] as const;

export default function AppSettingsScreen({ navigation }: AppSettingsScreenProps) {
  const styles = useStyles(createStyles);
  const { alert } = useAlert();
  const [triggerMode, setTriggerMode] = useState<'widget' | 'edge' | 'tile'>('widget');
  const [triggerModeLoading, setTriggerModeLoading] = useState(false);
  const voiceShortcutModule = NativeModules.VoiceShortcutModule;

  useEffect(() => {
    voiceShortcutModule?.getTriggerMode?.()
      .then((mode: 'widget' | 'edge' | 'tile') => setTriggerMode(mode === 'edge' || mode === 'tile' ? mode : 'widget'))
      .catch(() => undefined);
  }, [voiceShortcutModule]);

  const chooseTriggerMode = useCallback(async (mode: 'widget' | 'edge' | 'tile') => {
    if (mode === 'edge') {
      const overlay = await paymentNotificationService.getOverlayPermissionStatus();
      if (overlay !== 'authorized') {
        alert('需要悬浮窗权限', '左边缘手势需要悬浮窗权限，请先开启后再试。');
        paymentNotificationService.requestOverlayPermission();
        return;
      }
    }
    setTriggerModeLoading(true);
    try {
      const result = await voiceShortcutModule?.setTriggerMode?.(mode);
      if (result === false) throw new Error('系统未能启动快捷入口');
      setTriggerMode(mode);
      if (mode === 'tile') {
        alert('添加通知栏快捷按钮', '请下拉系统通知栏，点击编辑或铅笔图标，把“知账语音”添加到快捷设置。以后点击它即可进入知账并自动开始录音。');
      }
    } catch (error: any) {
      alert('快捷入口设置失败', error?.message || '请检查悬浮窗权限后重试');
    } finally {
      setTriggerModeLoading(false);
    }
  }, [alert, voiceShortcutModule]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {ITEMS.map(item => {
        const Icon = item.icon;
        return (
          <TouchableOpacity key={item.id} style={styles.item} onPress={() => navigation?.navigate(item.route)} activeOpacity={0.8}>
            <View style={[styles.icon, { backgroundColor: item.color }]}><Icon size={21} color={styles._colors.stroke} /></View>
            <View style={styles.info}><Text style={styles.title}>{item.title}</Text><Text style={styles.description}>{item.description}</Text></View>
            <ChevronRight size={21} color={styles._colors.textTertiary} strokeWidth={2.5} />
          </TouchableOpacity>
        );
      })}
      <View style={styles.quickEntryCard}>
        <View style={styles.quickEntryHeader}>
          <View style={[styles.icon, styles.quickEntryIcon]}><Text style={styles.quickEntryEmoji}>🎙️</Text></View>
          <View style={styles.info}>
            <Text style={styles.title}>语音与快捷入口</Text>
            <Text style={styles.description}>选择一种快捷呼出方式；不会在屏幕上显示常驻按钮</Text>
          </View>
        </View>
        <Text style={styles.quickEntryLabel}>快捷呼出方式</Text>
        <View style={styles.triggerOptions}>
          {([
            ['widget', '桌面组件按钮', '无需悬浮窗'],
            ['edge', '左边缘右滑', '隐形手势热区'],
            ['tile', '通知栏快捷按钮', '下拉通知栏添加'],
          ] as const).map(([mode, title, hint]) => (
            <TouchableOpacity key={mode} style={[styles.triggerOption, triggerMode === mode && styles.triggerOptionActive]} onPress={() => chooseTriggerMode(mode)} disabled={triggerModeLoading} activeOpacity={0.8}>
              <Text style={[styles.triggerOptionTitle, triggerMode === mode && styles.triggerOptionTextActive]}>{title}</Text>
              <Text style={[styles.triggerOptionHint, triggerMode === mode && styles.triggerOptionTextActive]}>{hint}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity style={styles.quickEntryLink} onPress={() => navigation?.navigate('GeneralSettings')} activeOpacity={0.8}>
          <Text style={styles.quickEntryLinkText}>管理语音 API 与其他快捷设置</Text>
          <ChevronRight size={18} color={styles._colors.primary} strokeWidth={2.5} />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) => ({
  ...StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.lg, gap: spacing.sm },
    item: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, minHeight: 70, backgroundColor: colors.surface, borderWidth: borderWidth.thin, borderColor: colors.stroke, borderRadius: borderRadius.card },
    icon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderWidth: borderWidth.thin, borderColor: colors.stroke, borderRadius: borderRadius.small },
    info: { flex: 1, marginHorizontal: spacing.md },
    title: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
    description: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginTop: 4 },
    quickEntryCard: { padding: spacing.md, backgroundColor: colors.surface, borderWidth: borderWidth.thin, borderColor: colors.stroke, borderRadius: borderRadius.card },
    quickEntryHeader: { flexDirection: 'row', alignItems: 'center' },
    quickEntryIcon: { backgroundColor: '#FFD6E7' },
    quickEntryEmoji: { fontSize: 20 },
    quickEntryRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: borderWidth.thin, borderTopColor: colors.divider },
    quickEntryText: { flex: 1, marginRight: spacing.md },
    quickEntryLabel: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
    quickEntryLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm, paddingTop: spacing.sm },
    quickEntryLinkText: { fontSize: 12, fontWeight: '800', color: colors.primary },
    triggerOptions: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
    triggerOption: { flex: 1, minHeight: 64, paddingHorizontal: spacing.xs, paddingVertical: spacing.sm, alignItems: 'center', justifyContent: 'center', borderWidth: borderWidth.thin, borderColor: colors.divider, borderRadius: borderRadius.small, backgroundColor: colors.background },
    triggerOptionActive: { backgroundColor: colors.primary, borderColor: colors.stroke },
    triggerOptionTitle: { color: colors.textPrimary, fontSize: 12, fontWeight: '800', textAlign: 'center' },
    triggerOptionHint: { color: colors.textSecondary, fontSize: 10, fontWeight: '600', marginTop: 3, textAlign: 'center' },
    triggerOptionTextActive: { color: '#FFFFFF' },
  }),
  _colors: colors,
});
