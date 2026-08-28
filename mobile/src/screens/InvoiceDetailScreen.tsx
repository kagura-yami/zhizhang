import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { ExternalLink, FileText } from 'lucide-react-native';
import { useAlert, useTheme } from '../providers';
import { invoiceMailboxService } from '../services/api/invoiceMailbox';
import type { InvoiceDocument } from '../types/invoice';
import { borderRadius, borderWidth, spacing, shadow } from '../theme/spacing';

export default function InvoiceDetailScreen({ route }: any) {
  const { colors } = useTheme();
  const { alert } = useAlert();
  const [invoice, setInvoice] = useState<InvoiceDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const styles = createStyles(colors);

  useEffect(() => {
    let mounted = true;
    invoiceMailboxService.getInvoice(Number(route?.params?.invoiceId)).then((result) => {
      if (!result.success || !result.data) throw new Error(result.message || '发票加载失败');
      if (mounted) setInvoice(result.data);
    }).catch((error: any) => alert('加载失败', error?.message || '请稍后重试'))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [alert, route?.params?.invoiceId]);

  const openAttachment = async () => {
    if (!invoice) return;
    setOpening(true);
    try {
      const path = await invoiceMailboxService.downloadFile(invoice.id);
      const mime = invoice.mimeType || (/\.pdf$/i.test(invoice.fileName) ? 'application/pdf' : 'image/*');
      await ReactNativeBlobUtil.android.actionViewIntent(path, mime);
    } catch (error: any) {
      alert('无法打开附件', error?.message || '附件已保存，但系统没有可用的查看器');
    } finally { setOpening(false); }
  };

  if (loading) return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /></View>;
  if (!invoice) return <View style={[styles.center, { backgroundColor: colors.background }]}><Text style={styles.muted}>发票不存在或已被删除</Text></View>;
  const rows: Array<[string, string]> = [
    ['发票抬头（购方）', invoice.invoiceCategory || invoice.buyer || '未识别'],
    ['销售方', invoice.seller || '未识别'],
    ['发票号码', invoice.invoiceNumber || '未识别'],
    ['金额', invoice.amount == null ? '未识别' : `¥${invoice.amount.toFixed(2)}`],
    ['开票日期', invoice.invoiceDate ? invoice.invoiceDate.slice(0, 10) : '未识别'],
    ['邮件主题', invoice.subject || '未知'],
    ['发件人', invoice.sender || '未知'],
    ['整理状态', invoice.status === 'matched' ? '已关联账单' : '待整理'],
  ];
  return <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.content}>
    <View style={styles.card}>
      <View style={styles.titleRow}><FileText size={22} color={colors.primary} /><Text style={styles.title} numberOfLines={2}>{invoice.fileName}</Text></View>
      {rows.map(([label, value]) => <View style={styles.infoRow} key={label}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>)}
    </View>
    <TouchableOpacity style={styles.previewButton} onPress={openAttachment} disabled={opening} accessibilityRole="button">
      <ExternalLink size={18} color="#FFFFFF" /><Text style={styles.previewText}>{opening ? '正在打开…' : '查看原始附件'}</Text>
    </TouchableOpacity>
    {invoice.contentText ? <View style={styles.card}><Text style={styles.sectionTitle}>提取文本</Text><Text selectable style={styles.extracted}>{invoice.contentText}</Text></View> : <Text style={styles.hint}>暂未提取到文本；仍可打开原始 PDF 或图片查看完整内容。</Text>}
  </ScrollView>;
}

const createStyles = (colors: any) => StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: colors.surface, borderWidth: borderWidth.thin, borderColor: colors.stroke, borderRadius: borderRadius.card, padding: spacing.md, ...shadow.small },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.sm, borderBottomWidth: borderWidth.thin, borderBottomColor: colors.divider },
  title: { flex: 1, color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  infoRow: { flexDirection: 'row', paddingTop: spacing.sm, gap: spacing.sm },
  label: { width: 108, color: colors.textSecondary, fontSize: 12 },
  value: { flex: 1, color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  previewButton: { marginTop: spacing.md, minHeight: 48, borderRadius: borderRadius.button, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.sm },
  previewText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  sectionTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '800', marginBottom: spacing.sm },
  extracted: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  hint: { color: colors.textTertiary, fontSize: 12, textAlign: 'center', marginTop: spacing.md },
  muted: { color: colors.textSecondary },
});
