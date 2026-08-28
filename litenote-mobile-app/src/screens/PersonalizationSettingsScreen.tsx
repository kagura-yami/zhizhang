/** 个性化设置：集中管理主题、首页展示偏好和自动记账提醒。 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, PanResponder, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { BellRing, ChartNoAxesCombined, GripVertical, List, Music2, Palette, Plus, X } from 'lucide-react-native';
import { useAlert, useTheme } from '../providers';
import { useHomeDisplayPreference, useStyles } from '../hooks';
import type { HomeMainMetric, HomeSectionId, HomeSecondaryMetric } from '../hooks/useHomeDisplayPreference';
import { paymentNotificationService } from '../services/paymentNotification';
import type { BillNotificationSettings, NotificationSoundItem, PermissionStatus } from '../services/paymentNotification/types';
import { ThemeColors } from '../theme/colors';
import { borderRadius, borderWidth, spacing } from '../theme';

const THEME_OPTIONS = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
] as const;

const MAIN_METRIC_OPTIONS: Array<{ value: HomeMainMetric; label: string }> = [
  { value: 'dailyBalance', label: '今日结余' },
  { value: 'dailyExpense', label: '今日支出' },
  { value: 'dailyIncome', label: '今日收入' },
  { value: 'monthlyBalance', label: '本月结余' },
  { value: 'monthlyExpense', label: '本月支出' },
  { value: 'monthlyIncome', label: '本月收入' },
];

const SECONDARY_METRIC_OPTIONS: Array<{ value: HomeSecondaryMetric; label: string }> = [
  { value: 'monthlyIncomeExpense', label: '本月收支' },
  { value: 'dailyIncomeExpense', label: '今日收支' },
  { value: 'monthlyBalance', label: '本月结余' },
  { value: 'dailyBalance', label: '今日结余' },
  { value: 'none', label: '不显示' },
];

const HOME_SECTION_OPTIONS: Array<{ value: HomeSectionId; label: string; description: string }> = [
  { value: 'bills', label: '近期账单', description: '按日期查看最近自动或手动记录的账单' },
  { value: 'charts', label: '统计图表', description: '查看每日、每月和每年的收支趋势' },
];

const moveHomeSection = (items: HomeSectionId[], from: number, to: number) => {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
};

function SortableHomeSectionRow({
  item,
  index,
  total,
  onMove,
  onDelete,
  styles,
}: {
  item: HomeSectionId;
  index: number;
  total: number;
  onMove: (from: number, to: number) => void;
  onDelete: () => void;
  styles: any;
}) {
  const translateY = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);
  const option = HOME_SECTION_OPTIONS.find(candidate => candidate.value === item)!;

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 4,
    onPanResponderGrant: () => setDragging(true),
    onPanResponderMove: (_, gesture) => translateY.setValue(gesture.dy),
    onPanResponderRelease: (_, gesture) => {
      const target = Math.max(0, Math.min(total - 1, index + Math.round(gesture.dy / 72)));
      setDragging(false);
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
      if (target !== index) onMove(index, target);
    },
    onPanResponderTerminate: () => {
      setDragging(false);
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
    },
  }), [index, onMove, total, translateY]);

  return (
    <Animated.View style={[
      styles.sortableRow,
      dragging && styles.sortableRowDragging,
      { transform: [{ translateY }] },
    ]}>
      <View style={styles.sortableRowIcon}>
        {item === 'bills'
          ? <List size={19} color={styles._colors.primary} />
          : <ChartNoAxesCombined size={19} color={styles._colors.primary} />}
      </View>
      <View style={styles.sortableRowText}>
        <Text style={styles.sortableRowLabel} maxFontSizeMultiplier={1.25}>{option.label}</Text>
        <Text style={styles.sortableRowDescription} maxFontSizeMultiplier={1.2}>{option.description}</Text>
      </View>
      <TouchableOpacity
        style={styles.sortableDelete}
        onPress={onDelete}
        accessibilityRole="button"
        accessibilityLabel={`从首页删除${option.label}`}
      >
        <X size={20} color={styles._colors.error} />
      </TouchableOpacity>
      <View
        style={styles.sortableHandle}
        accessibilityRole="adjustable"
        accessibilityLabel={`拖动${option.label}调整首页顺序`}
        accessibilityActions={[
          { name: 'increment', label: '向下移动' },
          { name: 'decrement', label: '向上移动' },
        ]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === 'increment' && index < total - 1) onMove(index, index + 1);
          if (nativeEvent.actionName === 'decrement' && index > 0) onMove(index, index - 1);
        }}
        {...panResponder.panHandlers}
      >
        <GripVertical size={22} color={styles._colors.textSecondary} />
      </View>
    </Animated.View>
  );
}

function SortableHomeSectionTable({
  value,
  onChange,
  styles,
}: {
  value: HomeSectionId[];
  onChange: (value: HomeSectionId[]) => void;
  styles: any;
}) {
  const available = HOME_SECTION_OPTIONS.filter(option => !value.includes(option.value));
  const move = (from: number, to: number) => onChange(moveHomeSection(value, from, to));

  return (
    <View style={styles.sortableTable}>
      <View style={styles.sortableTableHeader}>
        <Text style={styles.sortableTableHint}>首页从上到下</Text>
        <Text style={styles.sortableTableHint}>{value.length} 项</Text>
      </View>
      {value.length === 0 && (
        <View style={styles.sortableEmpty}>
          <Text style={styles.sortableEmptyText}>暂未添加下方内容，首页将只显示主卡片和预算卡片</Text>
        </View>
      )}
      {value.map((item, index) => (
        <SortableHomeSectionRow
          key={item}
          item={item}
          index={index}
          total={value.length}
          onMove={move}
          onDelete={() => onChange(value.filter(candidate => candidate !== item))}
          styles={styles}
        />
      ))}
      {available.length > 0 && <Text style={styles.sortableAddTitle}>可添加内容</Text>}
      {available.map(option => (
        <TouchableOpacity
          key={option.value}
          style={styles.sortableAddButton}
          onPress={() => onChange([...value, option.value])}
          accessibilityRole="button"
          accessibilityLabel={`添加${option.label}到首页`}
        >
          <Plus size={19} color={styles._colors.primary} />
          <Text style={styles.sortableAddText}>{option.label}</Text>
          <Text style={styles.sortableTableHint}>添加到末尾</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function PersonalizationSettingsScreen() {
  const styles = useStyles(createStyles);
  const { alert } = useAlert();
  const { themeMode, setThemeMode } = useTheme();
  const {
    showBudgetCard,
    setShowBudgetCard,
    mainMetric,
    setMainMetric,
    secondaryMetric,
    setSecondaryMetric,
    homeSections,
    setHomeSections,
  } = useHomeDisplayPreference();
  const [notificationSettings, setNotificationSettings] = useState<BillNotificationSettings>({
    enabled: true,
    sound: 'default',
  });
  const [notificationPermission, setNotificationPermission] = useState<PermissionStatus>('unknown');
  const [soundLibrary, setSoundLibrary] = useState<NotificationSoundItem[]>([]);
  const [previewingSoundId, setPreviewingSoundId] = useState<string | null>(null);
  const [editingSound, setEditingSound] = useState<NotificationSoundItem | null>(null);
  const [editStartSeconds, setEditStartSeconds] = useState('0');
  const [editEndSeconds, setEditEndSeconds] = useState('0');

  const loadSettings = async () => {
    const [settings, permission, sounds] = await Promise.all([
      paymentNotificationService.getBillNotificationSettings(),
      paymentNotificationService.getAppNotificationPermissionStatus(),
      paymentNotificationService.getBillNotificationSounds(),
    ]);
    setNotificationSettings(settings);
    setNotificationPermission(permission);
    setSoundLibrary(sounds);
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const saveNotificationSettings = async (next: BillNotificationSettings) => {
    setNotificationSettings(next);
    if (!await paymentNotificationService.saveBillNotificationSettings(next)) {
      alert('提示', '通知设置保存失败，请稍后重试');
    }
  };

  const chooseCustomSound = async () => {
    const result = await paymentNotificationService.pickBillNotificationSound();
    if (result) {
      setSoundLibrary(current => [result, ...current.filter(item => item.id !== result.id)]);
      setNotificationSettings(current => ({ ...current, sound: 'custom', soundUri: result.soundUri, soundName: result.name }));
    }
  };

  const selectSound = async (sound: NotificationSoundItem) => {
    const next = { ...notificationSettings, sound: 'custom' as const, soundUri: sound.soundUri, soundName: sound.name };
    await saveNotificationSettings(next);
  };

  const previewSound = async (soundId: string) => {
    if (previewingSoundId === soundId) {
      paymentNotificationService.stopBillNotificationSoundPreview();
      setPreviewingSoundId(null);
      return;
    }
    const started = await paymentNotificationService.previewBillNotificationSound(soundId);
    if (!started) return;
    setPreviewingSoundId(soundId);
    const duration = soundId === 'default'
      ? 4000
      : Math.max(1000, (soundLibrary.find(item => item.id === soundId)?.endMs || 4000) - (soundLibrary.find(item => item.id === soundId)?.startMs || 0));
    setTimeout(() => setPreviewingSoundId(current => current === soundId ? null : current), duration);
  };

  const openSoundEditor = (sound: NotificationSoundItem) => {
    setEditingSound(sound);
    setEditStartSeconds((sound.startMs / 1000).toFixed(1));
    setEditEndSeconds((sound.endMs / 1000).toFixed(1));
  };

  const saveSoundClip = async () => {
    if (!editingSound) return;
    const startMs = Number(editStartSeconds) * 1000;
    const endMs = Number(editEndSeconds) * 1000;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      alert('铃声片段', '请输入有效的开始和结束秒数');
      return;
    }
    try {
      const updated = await paymentNotificationService.saveBillNotificationSoundClip(editingSound.id, startMs, endMs);
      if (!updated) throw new Error('铃声片段保存失败');
      setSoundLibrary(current => current.map(item => item.id === updated.id ? updated : item));
      await selectSound(updated);
      setEditingSound(null);
    } catch (error: any) {
      alert('铃声片段', error?.message || '保存铃声片段失败，请尝试更换音频格式');
    }
  };

  const requestNotificationPermission = () => {
    paymentNotificationService.requestAppNotificationPermission();
    setTimeout(() => {
      paymentNotificationService.getAppNotificationPermissionStatus().then(setNotificationPermission);
    }, 800);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.card}>
        <View style={styles.titleRow}>
          <Palette size={21} color={styles._colors.primary} />
          <Text style={styles.cardTitle}>外观</Text>
        </View>
        <Text style={styles.label}>主题模式</Text>
        <View style={styles.optionsRow}>
          {THEME_OPTIONS.map(option => (
            <TouchableOpacity
              key={option.value}
              style={[styles.option, themeMode === option.value && styles.optionActive]}
              onPress={() => setThemeMode(option.value)}
            >
              <Text style={[styles.optionText, themeMode === option.value && styles.optionTextActive]}>{option.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.titleRow}>
          <ChartNoAxesCombined size={21} color={styles._colors.primary} />
          <Text style={styles.cardTitle}>首页展示</Text>
        </View>
        <Text style={styles.label}>主卡片重点指标</Text>
        <Text style={styles.description}>选择首页最醒目位置显示的金额，默认显示今日结余</Text>
        <View style={styles.choiceGrid}>
          {MAIN_METRIC_OPTIONS.map(option => (
            <TouchableOpacity
              key={option.value}
              style={[styles.choiceOption, mainMetric === option.value && styles.optionActive]}
              onPress={() => setMainMetric(option.value)}
            >
              <Text style={[styles.optionText, mainMetric === option.value && styles.optionTextActive]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.label, styles.subsectionLabel]}>主卡片辅助摘要</Text>
        <Text style={styles.description}>选择主金额下面的补充信息，默认显示本月收入和支出</Text>
        <View style={styles.choiceGrid}>
          {SECONDARY_METRIC_OPTIONS.map(option => (
            <TouchableOpacity
              key={option.value}
              style={[styles.choiceOption, secondaryMetric === option.value && styles.optionActive]}
              onPress={() => setSecondaryMetric(option.value)}
            >
              <Text style={[styles.optionText, secondaryMetric === option.value && styles.optionTextActive]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.label, styles.subsectionLabel]}>预算与目标卡片</Text>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.description}>固定显示在主卡片下面，不随账单/图表切换移动</Text>
          </View>
          <Switch
            value={showBudgetCard}
            onValueChange={setShowBudgetCard}
            trackColor={{ false: styles._colors.divider, true: styles._colors.primary }}
            thumbColor="#FFFFFF"
          />
        </View>

        <Text style={[styles.label, styles.subsectionLabel]}>下方内容</Text>
        <Text style={styles.description}>可添加或删除首页内容，拖动右侧手柄调整上下顺序</Text>
        <SortableHomeSectionTable
          value={homeSections}
          onChange={setHomeSections}
          styles={styles}
        />
      </View>

      <View style={styles.card}>
        <View style={styles.titleRow}>
          <BellRing size={21} color={styles._colors.primary} />
          <Text style={styles.cardTitle}>记账提醒</Text>
        </View>
        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.label}>记账成功通知</Text>
            <Text style={styles.description}>自动记账成功后在通知栏提醒</Text>
          </View>
          <Switch
            value={notificationSettings.enabled}
            onValueChange={enabled => saveNotificationSettings({ ...notificationSettings, enabled })}
            trackColor={{ false: styles._colors.divider, true: styles._colors.primary }}
            thumbColor="#FFFFFF"
          />
        </View>
        <View style={styles.soundHeader}>
          <Music2 size={17} color={styles._colors.textSecondary} />
          <Text style={styles.label}>通知铃声</Text>
        </View>
        <View style={styles.optionsRow}>
          <TouchableOpacity
            style={[styles.option, notificationSettings.sound === 'default' && styles.optionActive]}
            onPress={() => saveNotificationSettings({ ...notificationSettings, sound: 'default' })}
          >
            <Text style={[styles.optionText, notificationSettings.sound === 'default' && styles.optionTextActive]}>默认</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.option, notificationSettings.sound === 'silent' && styles.optionActive]}
            onPress={() => saveNotificationSettings({ ...notificationSettings, sound: 'silent' })}
          >
            <Text style={[styles.optionText, notificationSettings.sound === 'silent' && styles.optionTextActive]}>静音</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.option, notificationSettings.sound === 'custom' && styles.optionActive]}
            onPress={chooseCustomSound}
          >
            <Text style={[styles.optionText, notificationSettings.sound === 'custom' && styles.optionTextActive]}>自定义</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.previewRow}>
          <Text style={styles.description}>试听</Text>
          <TouchableOpacity style={styles.previewButton} onPress={() => previewSound('default')}>
            <Text style={styles.previewButtonText}>{previewingSoundId === 'default' ? '停止试听' : '试听默认铃声'}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.importSoundButton} onPress={chooseCustomSound}>
          <Text style={styles.importSoundButtonText}>＋ 导入本地铃声</Text>
        </TouchableOpacity>
        {soundLibrary.length > 0 && (
          <View style={styles.soundLibrary}>
            <Text style={styles.libraryTitle}>我的铃声</Text>
            {soundLibrary.map(sound => {
              const selected = notificationSettings.sound === 'custom' && notificationSettings.soundUri === sound.soundUri;
              return (
                <View key={sound.id} style={[styles.soundItem, selected && styles.soundItemSelected]}>
                  <TouchableOpacity style={styles.soundItemMain} onPress={() => selectSound(sound)}>
                    <Text style={styles.soundItemName} numberOfLines={1}>{sound.name}</Text>
                    <Text style={styles.soundItemMeta}>
                      {selected ? '使用中 · ' : ''}{(sound.startMs / 1000).toFixed(1)}s - {(sound.endMs / 1000).toFixed(1)}s / {(sound.durationMs / 1000).toFixed(1)}s
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.soundAction} onPress={() => previewSound(sound.id)}>
                    <Text style={styles.soundActionText}>{previewingSoundId === sound.id ? '停止' : '试听'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.soundAction} onPress={() => openSoundEditor(sound)}>
                    <Text style={styles.soundActionText}>片段</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}
        <View style={styles.permissionRow}>
          <Text style={styles.description}>系统通知权限：{notificationPermission === 'authorized' ? '已允许' : '未允许'}</Text>
          {notificationPermission !== 'authorized' && (
            <TouchableOpacity style={styles.permissionButton} onPress={requestNotificationPermission}>
              <Text style={styles.permissionButtonText}>去开启</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Modal visible={!!editingSound} transparent animationType="fade" onRequestClose={() => setEditingSound(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.editorCard}>
            <Text style={styles.editorTitle}>编辑铃声片段</Text>
            <Text style={styles.description} numberOfLines={1}>{editingSound?.name}</Text>
            <Text style={styles.editorHint}>请输入开始和结束时间（秒），最长 30 秒，至少 0.5 秒。</Text>
            <View style={styles.editorFields}>
              <View style={styles.editorField}>
                <Text style={styles.inputLabel}>开始</Text>
                <TextInput style={styles.secondsInput} value={editStartSeconds} onChangeText={setEditStartSeconds} keyboardType="decimal-pad" />
              </View>
              <View style={styles.editorField}>
                <Text style={styles.inputLabel}>结束</Text>
                <TextInput style={styles.secondsInput} value={editEndSeconds} onChangeText={setEditEndSeconds} keyboardType="decimal-pad" />
              </View>
            </View>
            <View style={styles.editorActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setEditingSound(null)}>
                <Text style={styles.cancelButtonText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveClipButton} onPress={saveSoundClip}>
                <Text style={styles.saveClipButtonText}>保存并使用</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) => ({
  ...StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
    card: { backgroundColor: colors.surface, borderWidth: borderWidth.thin, borderColor: colors.stroke, borderRadius: borderRadius.card, padding: spacing.lg },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
    cardTitle: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
    label: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
    description: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginTop: 3 },
    optionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    option: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: borderRadius.small, borderWidth: borderWidth.thin, borderColor: colors.stroke, backgroundColor: colors.background },
    choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
    choiceOption: { width: '48%', minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, borderRadius: borderRadius.small, borderWidth: borderWidth.thin, borderColor: colors.stroke, backgroundColor: colors.background },
    optionActive: { backgroundColor: colors.primary },
    optionText: { fontSize: 13, fontWeight: '800', color: colors.textPrimary },
    optionTextActive: { color: '#FFFFFF' },
    settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    subsectionLabel: { marginTop: spacing.lg },
    settingInfo: { flex: 1, marginRight: spacing.md },
    sortableTable: { marginTop: spacing.sm, gap: spacing.sm },
    sortableTableHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xs },
    sortableTableHint: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
    sortableRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: borderRadius.small, borderWidth: borderWidth.thin, borderColor: colors.stroke, backgroundColor: colors.background },
    sortableRowDragging: { borderColor: colors.primary, backgroundColor: colors.primary + '12', zIndex: 5, elevation: 5 },
    sortableRowIcon: { width: 36, height: 36, borderRadius: borderRadius.small, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary + '18', marginRight: spacing.sm },
    sortableRowText: { flex: 1, minWidth: 0, marginRight: spacing.sm },
    sortableRowLabel: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
    sortableRowDescription: { fontSize: 11, fontWeight: '600', color: colors.textSecondary, marginTop: 2 },
    sortableHandle: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: borderRadius.small },
    sortableDelete: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: borderRadius.small },
    sortableAddTitle: { fontSize: 12, fontWeight: '800', color: colors.textSecondary, marginTop: spacing.xs },
    sortableAddButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, borderRadius: borderRadius.small, borderWidth: borderWidth.thin, borderColor: colors.primary, backgroundColor: colors.background, gap: spacing.sm },
    sortableAddText: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: '800', color: colors.primary },
    sortableEmpty: { paddingVertical: spacing.md, paddingHorizontal: spacing.sm, borderRadius: borderRadius.small, borderWidth: borderWidth.thin, borderColor: colors.stroke, borderStyle: 'dashed', backgroundColor: colors.background },
    sortableEmptyText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' },
    soundHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.md },
    previewRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
    previewButton: { borderWidth: borderWidth.thin, borderColor: colors.primary, borderRadius: borderRadius.small, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
    previewButtonText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
    importSoundButton: { marginTop: spacing.sm, borderWidth: borderWidth.thin, borderColor: colors.stroke, borderRadius: borderRadius.small, paddingVertical: spacing.sm, alignItems: 'center', backgroundColor: colors.background },
    importSoundButtonText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
    soundLibrary: { marginTop: spacing.md, gap: spacing.xs },
    libraryTitle: { fontSize: 13, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.xs },
    soundItem: { flexDirection: 'row', alignItems: 'center', padding: spacing.sm, borderRadius: borderRadius.small, backgroundColor: colors.background, borderWidth: borderWidth.thin, borderColor: colors.stroke, gap: spacing.xs },
    soundItemSelected: { borderColor: colors.primary, backgroundColor: colors.primary + '12' },
    soundItemMain: { flex: 1, minWidth: 0 },
    soundItemName: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
    soundItemMeta: { marginTop: 2, fontSize: 11, fontWeight: '600', color: colors.textSecondary },
    soundAction: { borderWidth: borderWidth.thin, borderColor: colors.stroke, borderRadius: borderRadius.small, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
    soundActionText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
    permissionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md },
    permissionButton: { borderWidth: borderWidth.thin, borderColor: colors.primary, borderRadius: borderRadius.small, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
    permissionButtonText: { color: colors.primary, fontSize: 13, fontWeight: '800' },
    modalBackdrop: { flex: 1, justifyContent: 'center', padding: spacing.lg, backgroundColor: 'rgba(0,0,0,0.45)' },
    editorCard: { backgroundColor: colors.surface, borderRadius: borderRadius.card, padding: spacing.lg, borderWidth: borderWidth.thin, borderColor: colors.stroke },
    editorTitle: { fontSize: 17, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.xs },
    editorHint: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginTop: spacing.sm },
    editorFields: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    editorField: { flex: 1 },
    inputLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginBottom: spacing.xs },
    secondsInput: { borderWidth: borderWidth.thin, borderColor: colors.stroke, borderRadius: borderRadius.small, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, color: colors.textPrimary, backgroundColor: colors.background },
    editorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.lg },
    cancelButton: { borderWidth: borderWidth.thin, borderColor: colors.stroke, borderRadius: borderRadius.small, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
    cancelButtonText: { color: colors.textSecondary, fontSize: 13, fontWeight: '800' },
    saveClipButton: { backgroundColor: colors.primary, borderRadius: borderRadius.small, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
    saveClipButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  }),
  _colors: colors,
});
