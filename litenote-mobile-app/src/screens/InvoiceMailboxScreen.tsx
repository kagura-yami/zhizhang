import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, Mail, RefreshCw, Trash2, FolderOpen, ChevronRight } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { useAlert, useTheme } from '../providers';
import { invoiceMailboxService } from '../services/api/invoiceMailbox';
import type { InvoiceMailbox, InvoiceMailboxProvider } from '../types/invoice';
import { borderRadius, borderWidth, spacing, shadow } from '../theme/spacing';

const providers: Array<{ key: InvoiceMailboxProvider; label: string }> = [
  { key: 'qq', label: 'QQ邮箱' },
  { key: '163', label: '163邮箱' },
  { key: 'outlook', label: 'Outlook' },
  { key: 'gmail', label: 'Gmail' },
];

const providerHelp: Record<InvoiceMailboxProvider, {
  title: string;
  steps: string[];
  url?: string;
  buttonLabel?: string;
  notice?: string;
}> = {
  qq: {
    title: 'QQ邮箱授权码获取方式',
    steps: ['打开 QQ邮箱网页版并登录', '进入「设置」→「账户」', '找到 POP3/IMAP/SMTP 服务并开启 IMAP/SMTP', '按页面提示生成授权码，复制到这里'],
    url: 'https://mail.qq.com/',
  },
  '163': {
    title: '163邮箱授权码获取方式',
    steps: ['打开 163邮箱网页版并登录', '进入「设置」→「POP3/SMTP/IMAP」', '开启 IMAP 服务', '按页面提示获取授权码，复制到这里'],
    url: 'https://mail.163.com/',
  },
  outlook: {
    title: 'Outlook 官方授权方式',
    steps: ['点击下方按钮并登录 Outlook 网页版', '在 Microsoft 授权页同意读取邮件权限', '授权完成后返回知帐，应用会自动读取收件箱中的发票附件'],
    url: 'https://login.microsoftonline.com/',
    buttonLabel: '打开 Microsoft 登录页',
    notice: '知帐使用 Microsoft Graph 读取发票邮件，无需手动开启 IMAP，也不需要填写邮箱密码或授权码。',
  },
  gmail: {
    title: 'Gmail应用专用密码获取方式',
    steps: ['打开 Google 账户安全设置并开启两步验证', '进入「应用专用密码」并创建一个新密码', '确认 Gmail 设置中已开启 IMAP', '将生成的 16 位应用专用密码填写到这里'],
    url: 'https://myaccount.google.com/security',
  },
  custom: {
    title: '自定义邮箱授权方式',
    steps: ['打开邮箱服务商的网页设置', '找到 POP3/IMAP/SMTP 或客户端授权设置', '开启 IMAP 服务并生成授权码', '将服务器提供的授权码填写到这里'],
    notice: '不同邮箱服务商的入口名称可能不同；如果找不到，请在服务商帮助中心搜索“开启 IMAP”或“客户端授权码”。',
  },
};

const getCallbackParam = (query: string, key: string) => {
  const item = query.split('&').find((part) => part.split('=')[0] === key);
  if (!item) return null;
  try { return decodeURIComponent(item.slice(key.length + 1).replace(/\+/g, ' ')); } catch { return null; }
};

export default function InvoiceMailboxScreen() {
  const { colors } = useTheme();
  const { alert } = useAlert();
  const navigation = useNavigation();
  const [mailbox, setMailbox] = useState<InvoiceMailbox | null>(null);
  const [email, setEmail] = useState('');
  const [credential, setCredential] = useState('');
  const [provider, setProvider] = useState<InvoiceMailboxProvider>('qq');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [helpVisible, setHelpVisible] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const mailboxResponse = await invoiceMailboxService.getMailbox();
      if (mailboxResponse.success && mailboxResponse.data) {
        setMailbox(mailboxResponse.data);
        setEmail(mailboxResponse.data.email);
        setProvider(mailboxResponse.data.provider);
      }
    } catch (error: any) {
      alert('加载失败', error?.message || '发票邮箱信息加载失败，请重试');
    } finally {
      setLoading(false);
    }
  }, [alert]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const handleOAuthUrl = (url: string) => {
      if (!url.startsWith('zhizhang://invoice-mailbox/oauth/callback')) return;
      const query = url.split('?')[1] || '';
      setOauthLoading(false);
      const status = getCallbackParam(query, 'status');
      const callbackEmail = getCallbackParam(query, 'email');
      const callbackMessage = getCallbackParam(query, 'message');
      if (status === 'success') {
        setProvider('outlook');
        if (callbackEmail) setEmail(callbackEmail);
        setCredential('');
        void load();
      alert('Outlook 登录成功', '邮箱已完成授权，知帐会自动回扫全部含“发票”的邮件并整理 PDF 附件。');
      } else {
        alert('Outlook 登录未完成', callbackMessage || '授权已取消，请重试。');
      }
    };
    const subscription = Linking.addEventListener('url', ({ url }) => handleOAuthUrl(url));
    void Linking.getInitialURL().then((url) => { if (url) handleOAuthUrl(url); }).catch(() => undefined);
    return () => subscription.remove();
  }, [alert, load]);

  const save = async () => {
    if (!email.trim()) { alert('提示', '请输入收票邮箱'); return; }
    if (!credential.trim()) { alert('提示', provider === 'outlook' ? '请输入 Microsoft 账户凭据' : '请输入邮箱授权码，而不是邮箱登录密码'); return; }
    setSaving(true);
    try {
      const result = await invoiceMailboxService.saveMailbox({ email: email.trim(), provider, credential: credential.trim() });
      if (!result.success || !result.data) throw new Error(result.message || '邮箱绑定失败');
      setMailbox(result.data);
      setCredential('');
      alert('绑定成功', '邮箱已验证并绑定。服务端只保存加密后的授权信息。');
    } catch (error: any) {
      alert('绑定失败', error?.message || (provider === 'outlook' ? '请确认已开启 IMAP。Outlook 官方要求 OAuth2/现代身份验证，普通密码可能无法完成认证。' : '请确认已在邮箱设置中开启 IMAP，并使用授权码'));
    } finally {
      setSaving(false);
    }
  };

  const loginOutlook = async () => {
    setOauthLoading(true);
    try {
      const result = await invoiceMailboxService.startOutlookOAuth(email.trim() || undefined);
      if (!result.success || !result.data?.authUrl) throw new Error(result.message || '无法发起 Outlook 登录');
      await Linking.openURL(result.data.authUrl);
    } catch (error: any) {
      setOauthLoading(false);
      alert('无法打开 Outlook 登录', error?.message || '请稍后重试');
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const result = await invoiceMailboxService.sync();
      if (!result.success) throw new Error(result.message || '同步失败');
      const data = result.data;
      await load();
      const linkedPdf = data?.linkedPdfAttachments || 0;
      const availablePdf = (data?.pdfAttachments || 0) + linkedPdf;
      if (data?.inProgress) {
        alert('正在扫描', '邮箱正在后台扫描，请稍后在发票中心查看整理结果。');
      } else if (!data?.candidateMessages) {
        alert('扫描完成', `已检查 ${data?.scanned || 0} 封邮件，没有找到包含“发票”关键词的邮件。`);
      } else if (!availablePdf && (data?.linkCandidates || 0)) {
        alert('扫描完成', `找到 ${data.candidateMessages} 封发票邮件和 ${data.linkCandidates} 个下载链接，但链接没有返回可读取的 PDF（可能需要在邮箱网页中登录后下载）。`);
      } else if (!availablePdf) {
        alert('扫描完成', `找到 ${data.candidateMessages} 封发票邮件，但其中没有可整理的 PDF 附件或下载链接。`);
      } else if (!data.imported) {
        alert('扫描完成', `找到 ${data.candidateMessages} 封发票邮件和 ${availablePdf} 个 PDF，均已整理过，没有重复导入。`);
      } else {
        alert('同步完成', `扫描 ${data.scanned} 封邮件，发现 ${availablePdf} 个 PDF；新整理 ${data.imported} 张发票，自动关联 ${data.matched} 张账单。`);
      }
    } catch (error: any) {
      alert('同步失败', error?.message || '邮箱同步失败，请检查绑定状态');
    } finally {
      setSyncing(false);
    }
  };

  const remove = () => {
    alert('解绑收票邮箱', '解绑后会停止继续读取该邮箱，已整理的发票和附件会保留在你的账户中。', [
      { text: '取消', style: 'cancel' },
      {
        text: '解绑', style: 'destructive', onPress: async () => {
          try {
            await invoiceMailboxService.removeMailbox();
            setMailbox(null);
            setCredential('');
            alert('已解绑', '收票邮箱已解绑，已整理的发票仍然保留。');
          } catch (error: any) {
            alert('解绑失败', error?.message || '请稍后重试');
          }
        },
      },
    ]);
  };

  const styles = createStyles(colors);
  const help = providerHelp[provider];
  if (loading) {
    return <SafeAreaView style={styles.container}><ActivityIndicator style={styles.loader} color={colors.primary} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}><Mail size={28} color={colors.primary} /></View>
          <Text style={styles.title}>自动整理电子发票</Text>
          <Text style={styles.subtitle}>知帐会扫描绑定邮箱中主题、正文或附件名含“发票”的邮件，自动保存 PDF、提取信息并尝试关联账单。</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>收票邮箱</Text>
          <Text style={styles.label}>邮箱地址</Text>
          <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="例如 name@qq.com" placeholderTextColor={colors.textTertiary} keyboardType="email-address" autoCapitalize="none" />
          <Text style={styles.label}>邮箱服务商</Text>
          <View style={styles.providerGrid}>
            {providers.map((item) => (
              <TouchableOpacity key={item.key} style={[styles.provider, provider === item.key && styles.providerSelected]} onPress={() => setProvider(item.key)} activeOpacity={0.75} accessibilityRole="radio" accessibilityState={{ selected: provider === item.key }}>
                <Text style={[styles.providerText, provider === item.key && styles.providerTextSelected]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {provider === 'outlook' && (
            <View style={styles.oauthPanel}>
              <Text style={styles.oauthTitle}>推荐使用官方登录</Text>
              <Text style={styles.oauthDescription}>点击后会打开 Microsoft 登录页，授权完成后自动返回知帐，不需要填写邮箱密码或授权码。</Text>
              <TouchableOpacity style={styles.oauthButton} onPress={loginOutlook} disabled={oauthLoading} activeOpacity={0.8} accessibilityRole="button">
                {oauthLoading ? <ActivityIndicator color="#FFFFFF" /> : <><Mail size={18} color="#FFFFFF" /><Text style={styles.oauthButtonText}>登录 Outlook 并授权邮箱读取</Text></>}
              </TouchableOpacity>
              <Text style={styles.oauthFallback}>如果管理员尚未配置 Outlook OAuth2，仍可使用下方手动凭据方式。</Text>
            </View>
          )}
          <View style={styles.labelRow}>
            <Text style={[styles.label, styles.labelRowText]}>{provider === 'outlook' ? 'Microsoft 账户凭据（可选）' : '邮箱授权码'}</Text>
            <TouchableOpacity
              style={styles.helpButton}
              onPress={() => setHelpVisible(true)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={provider === 'outlook' ? '查看 Outlook IMAP 开启方式' : '查看授权码获取方式'}
            >
              <Text style={styles.helpButtonText}>{provider === 'outlook' ? '查看 IMAP 开启方式' : '点击获取授权码'}</Text>
            </TouchableOpacity>
          </View>
          <TextInput style={styles.input} value={credential} onChangeText={setCredential} placeholder={provider === 'outlook' ? '填写 Microsoft 账户密码或应用密码' : mailbox ? '重新绑定时输入新的授权码' : '请填写授权码，不是登录密码'} placeholderTextColor={colors.textTertiary} secureTextEntry autoCapitalize="none" />
          <Text style={styles.helper}>{provider === 'outlook' ? 'Outlook 官方要求 OAuth2/现代身份验证；部分账户不再接受普通密码或应用密码。凭据只用于连接邮箱并加密保存。' : '授权码只用于 IMAP 读取邮件，传输使用 HTTPS，服务端使用 AES-GCM 加密保存，不会在界面回显。'}</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={save} disabled={saving} activeOpacity={0.8} accessibilityRole="button">
            {saving ? <ActivityIndicator color="#FFFFFF" /> : <><Check size={18} color="#FFFFFF" /><Text style={styles.primaryText}>{mailbox ? '更新邮箱绑定' : '验证并绑定'}</Text></>}
          </TouchableOpacity>
        </View>

        {mailbox && (
          <View style={styles.card}>
            <View style={styles.rowHeader}><View><Text style={styles.sectionTitle}>同步状态</Text><Text style={styles.statusText}>{mailbox.status === 'error' ? mailbox.lastError || '同步异常' : mailbox.status === 'syncing' ? '正在同步…' : `已绑定 · ${mailbox.invoiceCount} 张发票`}</Text></View></View>
            <TouchableOpacity style={styles.secondaryButton} onPress={sync} disabled={syncing} activeOpacity={0.8} accessibilityRole="button">
              {syncing ? <ActivityIndicator color={colors.primary} /> : <><RefreshCw size={18} color={colors.primary} /><Text style={styles.secondaryText}>扫描全邮箱发票</Text></>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.removeButton} onPress={remove} activeOpacity={0.8} accessibilityRole="button"><Trash2 size={17} color={colors.error} /><Text style={styles.removeText}>解绑收票邮箱</Text></TouchableOpacity>
          </View>
        )}

        <TouchableOpacity style={styles.centerEntry} onPress={() => navigation.navigate('InvoiceCenter' as never)} activeOpacity={0.78} accessibilityRole="button" accessibilityLabel="打开发票中心">
          <View style={styles.mailboxIcon}><FolderOpen size={20} color={colors.primary} /></View>
          <View style={styles.securityInfo}><Text style={styles.inputLabel}>发票中心</Text><Text style={styles.securityDescription}>查看、筛选并批量下载已整理发票</Text></View>
          <ChevronRight size={20} color={colors.textTertiary} />
        </TouchableOpacity>
        <View style={styles.bottomSpacing} />
      </ScrollView>
      <Modal visible={helpVisible} transparent animationType="fade" onRequestClose={() => setHelpVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.helpModal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{help.title}</Text>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setHelpVisible(false)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="关闭授权码说明"
              >
                <Text style={styles.closeButtonText}>×</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalWarning}>{provider === 'outlook' ? 'IMAP 开关位于 Outlook 邮箱设置中，不在 Microsoft 账户安全页面。' : '授权码不是邮箱登录密码，只用于第三方应用读取邮件。'}</Text>
            <View style={styles.stepList}>
              {help.steps.map((step, index) => (
                <View key={step} style={styles.stepRow}>
                  <View style={styles.stepBadge}><Text style={styles.stepBadgeText}>{index + 1}</Text></View>
                  <Text style={styles.stepText}>{step}</Text>
                </View>
              ))}
            </View>
            {help.notice && <Text style={styles.providerNotice}>{help.notice}</Text>}
            {help.url && (
              <TouchableOpacity
                style={styles.openSettingsButton}
                onPress={() => { void Linking.openURL(help.url!).catch(() => alert('无法打开网页', '请按照上面的步骤，在浏览器中打开邮箱设置。')); }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`打开${providers.find(item => item.key === provider)?.label || '邮箱'}设置`}
              >
                <Text style={styles.openSettingsText}>{help.buttonLabel || '打开邮箱设置'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.modalCloseAction} onPress={() => setHelpVisible(false)} activeOpacity={0.75} accessibilityRole="button">
              <Text style={styles.modalCloseActionText}>知道了</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (colors: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  loader: { flex: 1 },
  hero: { paddingVertical: spacing.md, alignItems: 'center' },
  heroIcon: { width: 64, height: 64, borderRadius: borderRadius.medium, backgroundColor: colors.primaryLight, borderWidth: borderWidth.thin, borderColor: colors.stroke, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  title: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  subtitle: { fontSize: 13, lineHeight: 20, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: borderRadius.card, borderWidth: borderWidth.thin, borderColor: colors.stroke, padding: spacing.lg, marginTop: spacing.lg, ...shadow.small },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: colors.textPrimary, marginBottom: spacing.md },
  label: { fontSize: 13, fontWeight: '700', color: colors.textSecondary, marginBottom: spacing.xs, marginTop: spacing.sm },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  labelRowText: { marginTop: 0, marginBottom: spacing.xs },
  helpButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.xs },
  helpButtonText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  oauthPanel: { marginTop: spacing.md, padding: spacing.md, borderRadius: borderRadius.small, backgroundColor: colors.primaryLight, borderWidth: borderWidth.thin, borderColor: colors.stroke },
  oauthTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '800' },
  oauthDescription: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: spacing.xs },
  oauthButton: { minHeight: 48, borderRadius: borderRadius.button, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
  oauthButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  oauthFallback: { color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: spacing.sm },
  input: { minHeight: 48, borderWidth: borderWidth.thin, borderColor: colors.stroke, borderRadius: borderRadius.input, backgroundColor: colors.background, color: colors.textPrimary, paddingHorizontal: spacing.md, fontSize: 15 },
  providerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  provider: { minHeight: 44, minWidth: 92, paddingHorizontal: spacing.md, borderWidth: borderWidth.thin, borderColor: colors.divider, borderRadius: borderRadius.small, alignItems: 'center', justifyContent: 'center' },
  providerSelected: { backgroundColor: colors.primaryLight, borderColor: colors.stroke },
  providerText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  providerTextSelected: { color: colors.textPrimary },
  helper: { color: colors.textTertiary, fontSize: 12, lineHeight: 18, marginTop: spacing.sm },
  primaryButton: { minHeight: 48, borderRadius: borderRadius.button, borderWidth: borderWidth.thin, borderColor: colors.stroke, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusText: { color: colors.textSecondary, fontSize: 13 },
  secondaryButton: { minHeight: 48, borderRadius: borderRadius.button, borderWidth: borderWidth.thin, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md },
  secondaryText: { color: colors.primary, fontSize: 15, fontWeight: '800' },
  removeButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
  removeText: { color: colors.error, fontSize: 14, fontWeight: '700' },
  centerEntry: { backgroundColor: colors.surface, borderRadius: borderRadius.card, borderWidth: borderWidth.thin, borderColor: colors.stroke, padding: spacing.lg, marginTop: spacing.lg, flexDirection: 'row', alignItems: 'center', ...shadow.small },
  mailboxIcon: { width: 40, height: 40, borderRadius: borderRadius.small, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  securityInfo: { flex: 1 },
  inputLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '800' },
  securityDescription: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  bottomSpacing: { height: spacing.xxl },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg },
  helpModal: { backgroundColor: colors.surface, borderRadius: borderRadius.card, padding: spacing.lg, borderWidth: borderWidth.thin, borderColor: colors.stroke, ...shadow.large },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modalTitle: { flex: 1, color: colors.textPrimary, fontSize: 18, fontWeight: '800', paddingRight: spacing.sm },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  closeButtonText: { color: colors.textSecondary, fontSize: 28, fontWeight: '400', lineHeight: 30 },
  modalWarning: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, marginTop: spacing.sm },
  stepList: { marginTop: spacing.md, gap: spacing.sm },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  stepBadge: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  stepBadgeText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  stepText: { flex: 1, color: colors.textPrimary, fontSize: 14, lineHeight: 21 },
  providerNotice: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: spacing.md, padding: spacing.sm, borderRadius: borderRadius.small, backgroundColor: colors.background },
  openSettingsButton: { minHeight: 48, borderRadius: borderRadius.button, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
  openSettingsText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  modalCloseAction: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xs },
  modalCloseActionText: { color: colors.textSecondary, fontSize: 14, fontWeight: '700' },
});
