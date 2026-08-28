/** 应用设置二级菜单：集中承载应用级配置，避免主“我的”页过于拥挤。 */
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronRight, Palette, Settings2, ShieldCheck } from 'lucide-react-native';
import { useStyles } from '../hooks';
import { ThemeColors } from '../theme/colors';
import { borderRadius, borderWidth, spacing } from '../theme';

interface AppSettingsScreenProps {
  navigation?: any;
}

const ITEMS = [
  { id: 'general', title: '通用配置', description: '自动记账监听应用与识别关键词', icon: Settings2, route: 'GeneralSettings', color: '#7EB6FF' },
  { id: 'personalization', title: '个性化设置', description: '主题、首页展示和通知铃声', icon: Palette, route: 'PersonalizationSettings', color: '#C5A3FF' },
  { id: 'security', title: '应用安全', description: '本机自动登录与生物识别保护', icon: ShieldCheck, route: 'AppSecuritySettings', color: '#B7E4C7' },
] as const;

export default function AppSettingsScreen({ navigation }: AppSettingsScreenProps) {
  const styles = useStyles(createStyles);
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
  }),
  _colors: colors,
});
