/** 应用安全设置：仅管理本机自动登录偏好。 */
import React from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { LockKeyhole } from 'lucide-react-native';
import { useSecuritySettings, useStyles } from '../hooks';
import { ThemeColors } from '../theme/colors';
import { borderRadius, borderWidth, spacing } from '../theme';

export default function AppSecuritySettingsScreen() {
  const styles = useStyles(createStyles);
  const { autoLogin, loading, setAutoLogin } = useSecuritySettings();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.title}>本机登录保护</Text>
        <Text style={styles.description}>自动登录是本机偏好。账号生物识别登录请到“用户资料 → 修改密码 → 账号安全”中绑定。</Text>
        <View style={styles.row}>
          <View style={styles.rowInfo}>
            <View style={styles.rowTitle}><LockKeyhole size={19} color={styles._colors.primary} /><Text style={styles.label}>自动登录</Text></View>
            <Text style={styles.hint}>关闭后，每次打开应用都需要登录</Text>
          </View>
          <Switch value={autoLogin} onValueChange={setAutoLogin} disabled={loading} trackColor={{ false: styles._colors.divider, true: styles._colors.primary }} thumbColor="#FFFFFF" />
        </View>
      </View>
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) => ({
  ...StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.lg, paddingBottom: spacing.xl },
    card: { backgroundColor: colors.surface, borderWidth: borderWidth.thin, borderColor: colors.stroke, borderRadius: borderRadius.card, padding: spacing.lg },
    title: { fontSize: 17, fontWeight: '800', color: colors.textPrimary },
    description: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, lineHeight: 19, marginTop: spacing.xs, marginBottom: spacing.md },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md, borderBottomWidth: borderWidth.thin, borderBottomColor: colors.divider },
    lastRow: { borderBottomWidth: 0, paddingBottom: 0 },
    rowInfo: { flex: 1, marginRight: spacing.md },
    rowTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    label: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
    hint: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginTop: 4 },
  }),
  _colors: colors,
});
