/**
 * 应用更新弹窗组件 - Neo-Brutalism 风格
 */
import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { AppVersionInfo } from '../services/api/appVersion';
import { ThemeColors } from '../theme/colors';
import { borderRadius, borderWidth, spacing, shadow } from '../theme/spacing';
import { useStyles } from '../hooks';

interface UpdateModalProps {
  visible: boolean;
  versionInfo: AppVersionInfo | null;
  updateHistory?: AppVersionInfo[];
  downloading: boolean;
  progress: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function UpdateModal({
  visible,
  versionInfo,
  updateHistory = [],
  downloading,
  progress,
  onConfirm,
  onCancel,
}: UpdateModalProps) {
  const styles = useStyles(createStyles);

  if (!versionInfo) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={versionInfo.forceUpdate ? undefined : onCancel}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          <Text style={styles.title}>发现新版本 v{versionInfo.version}</Text>

          <ScrollView style={styles.updateLogBlock} contentContainerStyle={styles.updateLogContent} showsVerticalScrollIndicator={false}>
            <Text style={styles.updateLogTitle}>更新内容</Text>
            {(updateHistory.length > 0 ? updateHistory : [versionInfo]).map((item, index) => (
              <View key={`${item.id}-${index}`} style={styles.updateLogRow}>
                <Text style={styles.updateLogDot}>•</Text>
                <Text style={styles.updateLog}>{item.updateLog || '体验与稳定性优化'}</Text>
              </View>
            ))}
          </ScrollView>

          {downloading ? (
            <View style={styles.progressContainer}>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${progress}%` }]} />
              </View>
              <Text style={styles.progressText}>下载中 {progress}%</Text>
            </View>
          ) : (
            <View style={styles.buttons}>
              {!versionInfo.forceUpdate && (
                <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
                  <Text style={styles.cancelText}>稍后再说</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.confirmBtn} onPress={onConfirm}>
                <Text style={styles.confirmText}>立即更新</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: ThemeColors) => ({
  ...StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    container: {
      width: '80%',
      backgroundColor: colors.surface,
      borderRadius: borderRadius.card,
      borderWidth: borderWidth.thick,
      borderColor: colors.divider,
      padding: spacing.xl,
      ...shadow.medium,
    },
    title: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.textPrimary,
      textAlign: 'center',
      marginBottom: spacing.md,
    },
    updateLog: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSecondary,
      lineHeight: 20,
      flex: 1,
    },
    updateLogBlock: {
      maxHeight: 260,
      marginBottom: spacing.lg,
    },
    updateLogContent: {
      paddingRight: spacing.xs,
    },
    updateLogTitle: {
      fontSize: 14,
      fontWeight: '800',
      color: colors.textPrimary,
      marginBottom: spacing.sm,
    },
    updateLogRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: spacing.xs,
    },
    updateLogDot: {
      width: 18,
      fontSize: 16,
      lineHeight: 20,
      color: colors.primary,
    },
    progressContainer: {
      alignItems: 'center',
    },
    progressBar: {
      width: '100%',
      height: 10,
      backgroundColor: colors.divider,
      borderRadius: borderRadius.small,
      borderWidth: borderWidth.thin,
      borderColor: colors.divider,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      backgroundColor: colors.primary,
      borderRadius: borderRadius.small,
    },
    progressText: {
      marginTop: spacing.sm,
      fontSize: 14,
      fontWeight: '700',
      fontFamily: 'Courier',
      color: colors.textSecondary,
    },
    buttons: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    cancelBtn: {
      flex: 1,
      paddingVertical: spacing.md,
      borderRadius: borderRadius.button,
      borderWidth: borderWidth.thin,
      borderColor: colors.divider,
      backgroundColor: colors.accent,
      alignItems: 'center',
    },
    cancelText: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    confirmBtn: {
      flex: 1,
      paddingVertical: spacing.md,
      borderRadius: borderRadius.button,
      borderWidth: borderWidth.medium,
      borderColor: colors.divider,
      backgroundColor: colors.primary,
      alignItems: 'center',
      ...shadow.small,
    },
    confirmText: {
      fontSize: 15,
      fontWeight: '700',
      color: '#FFFFFF',
    },
  }),
  _colors: colors,
});
