import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth, useTheme } from '../../providers';
import { useStyles } from '../../hooks/useStyles';
import type { ThemeColors } from '../../theme/colors';
import { createSocialApi } from '../../services/api/social';

export function useSocialApi() {
  const { token } = useAuth();
  return useMemo(() => createSocialApi(token || ''), [token]);
}

export const stylesFor = (c: ThemeColors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    content: { padding: 20, paddingBottom: 48, gap: 16 },
    card: {
      borderWidth: 1,
      borderColor: c.divider,
      borderRadius: 16,
      padding: 18,
      backgroundColor: c.surface,
      gap: 12,
    },
    title: { fontSize: 23, fontWeight: '800', color: c.textPrimary },
    heading: { fontSize: 18, fontWeight: '700', color: c.textPrimary },
    text: { fontSize: 16, lineHeight: 25, color: c.textPrimary },
    muted: { fontSize: 14, lineHeight: 22, color: c.textSecondary },
    row: { flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 12 },
    grow: { flex: 1 },
    button: {
      minHeight: 48,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderWidth: 1,
      borderColor: c.divider,
      borderRadius: 12,
      backgroundColor: c.surface,
      justifyContent: 'center',
    },
    primary: { backgroundColor: c.accent },
    primaryText: { color: '#1A1A1A' },
    buttonText: {
      fontSize: 16,
      fontWeight: '700',
      color: c.textPrimary,
      textAlign: 'center',
    },
    input: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: c.divider,
      borderRadius: 12,
      padding: 12,
      color: c.textPrimary,
      backgroundColor: c.surface,
      fontSize: 16,
    },
    error: { fontSize: 15, lineHeight: 23, color: c.error },
    disabled: { opacity: 0.45 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: c.surface },
    tabs: { flexDirection: 'row', padding: 4, borderRadius: 14, backgroundColor: c.surface },
    tab: { flex: 1, minHeight: 44, padding: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
    tabActive: { backgroundColor: c.accent },
    empty: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 20, gap: 12 },
    small: { fontSize: 12, lineHeight: 19, color: c.textSecondary },
  });
export function Action({
  title,
  onPress,
  disabled,
  primary,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  const s = useStyles(stylesFor);
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[s.button, primary && s.primary, disabled && s.disabled]}
    >
      <Text style={[s.buttonText, primary && s.primaryText]}>{title}</Text>
    </TouchableOpacity>
  );
}
export function Consent({
  checked,
  onChange,
  text,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  text: string;
}) {
  const s = useStyles(stylesFor);
  return (
    <TouchableOpacity
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      style={[s.button, s.row]}
    >
      <Text style={s.heading}>{checked ? '☑' : '□'}</Text>
      <Text style={[s.text, s.grow]}>{text}</Text>
    </TouchableOpacity>
  );
}
export function Page({ children }: { children: React.ReactNode }) {
  const s = useStyles(stylesFor);
  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}
export function Status({
  loading,
  error,
  refresh,
}: {
  loading: boolean;
  error: string;
  refresh: () => void;
}) {
  const { colors } = useTheme();
  const s = useStyles(stylesFor);
  return (
    <>
      {loading && (
        <ActivityIndicator
          accessibilityLabel="正在加载"
          color={colors.primary}
        />
      )}
      {!!error && (
        <View style={s.card}>
          <Text accessibilityRole="alert" style={s.error}>
            {error}
          </Text>
          <Action title="重新加载" onPress={refresh} />
        </View>
      )}
    </>
  );
}
/** No persisted social cache; clear on blur/background and ignore stale account/request responses. */
export function useSocialResource<T>(loader: () => Promise<T>) {
  const { user } = useAuth();
  const [value, setValue] = useState<T | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const epoch = useRef(0),
    focused = useRef(false),
    acting = useRef(false);
  const refresh = useCallback(async () => {
    const current = ++epoch.current;
    setValue(null);
    setError('');
    setLoading(true);
    try {
      const next = await loader();
      if (focused.current && current === epoch.current) setValue(next);
    } catch (e: any) {
      if (focused.current && current === epoch.current)
        setError(e?.message || '加载失败，请检查网络');
    } finally {
      if (focused.current && current === epoch.current) setLoading(false);
    }
  }, [loader]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void refresh();
      const sub = AppState.addEventListener('change', state => {
        if (state === 'active') {
          focused.current = true;
          void refresh();
        } else {
          focused.current = false;
          ++epoch.current;
          setValue(null);
          setLoading(true);
        }
      });
      return () => {
        focused.current = false;
        ++epoch.current;
        setValue(null);
        sub.remove();
      };
    }, [refresh, user?.id]),
  );
  const run = async (
    operation: () => Promise<unknown>,
    success?: () => void,
  ) => {
    if (acting.current || !focused.current) return;
    acting.current = true;
    setBusy(true);
    setError('');
    const current = epoch.current;
    try {
      await operation();
      if (focused.current && current === epoch.current) {
        if (success) success();
        else await refresh();
      }
    } catch (e: any) {
      if (focused.current && current === epoch.current)
        setError(e?.message || '操作失败，请重试');
    } finally {
      acting.current = false;
      setBusy(false);
    }
  };
  return { value, loading, error, busy, refresh, run };
}
