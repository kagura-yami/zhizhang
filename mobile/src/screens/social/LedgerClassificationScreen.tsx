import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useStyles } from '../../hooks/useStyles';
import { FinancialKind, LedgerContext } from '../../services/api/rankings';
import {
  Action,
  Consent,
  Page,
  Status,
  stylesFor,
  useSocialResource,
} from './shared';
import { financialLabels, moneyText, useRankingApi } from './rankingShared';

const descriptions: Record<FinancialKind, string> = {
  ordinary: '工资、购买商品等真实收入或支出，计入结余。',
  refund: '商户退回的款项，作为退款流入计入结余，不计作普通收入。',
  internal_transfer: '自己账户之间的转账、钱包充值或提现，不计入收支结余。',
  adjustment: '用于校正账本的调账，不计入收支结余。',
  ignored: '优惠券、满减提醒或其他误记，保留原账单但从结余口径排除。',
};
export default function LedgerClassificationScreen({
  route,
  navigation,
}: {
  route: any;
  navigation: any;
}) {
  const api = useRankingApi(),
    s = useStyles(stylesFor),
    id: number = route.params.billId;
  const r = useSocialResource(useCallback(() => api.context(id), [api, id]));
  const [choice, setChoice] = useState<{
    context: LedgerContext;
    kind: FinancialKind | null;
    accepted: boolean;
  } | null>(null);
  const kind =
    choice?.context === r.value
      ? choice?.kind ?? null
      : r.value && !r.value.needsReview
      ? r.value.financialClassification?.kind ?? null
      : null;
  const accepted = choice?.context === r.value && !!choice?.accepted;
  useEffect(() => {
    setChoice(null);
  }, [r.value]);
  return (
    <Page>
      <Text style={s.title}>这笔钱实际是什么？</Text>
      <Status {...r} />
      {r.value && (
        <>
          <View style={s.card}>
            <Text style={s.title}>
              {r.value.type === 'income' ? '收入' : '支出'} ¥
              {moneyText(r.value.amount)}
            </Text>
            <Text style={s.text}>
              {r.value.description || r.value.category?.name || '未填写说明'}
            </Text>
            <Text style={s.muted}>
              {r.value.date} ·{' '}
              {r.value.needsReview
                ? '待确认'
                : `已确认：${
                    financialLabels[r.value.financialClassification!.kind]
                  }`}
            </Text>
          </View>
          {(Object.keys(financialLabels) as FinancialKind[]).map(value => (
            <View key={value}>
              <Action
                title={financialLabels[value]}
                primary={kind === value}
                disabled={
                  r.busy || (value === 'refund' && !r.value!.canBeRefund)
                }
                onPress={() => {
                  setChoice({
                    context: r.value!,
                    kind: value,
                    accepted: false,
                  });
                }}
              />
              <Text style={s.muted}>{descriptions[value]}</Text>
            </View>
          ))}
          {!r.value.canBeRefund && (
            <Text style={s.muted}>
              退款需为收入，关联原账单（如有）必须是本人的支出。请先修正原账单再确认退款。
            </Text>
          )}
          <Consent
            checked={accepted}
            onChange={value =>
              setChoice({ context: r.value!, kind, accepted: value })
            }
            text="我已核对原交易，确认这是人民币账单，且上述口径准确"
          />
          <Text style={s.muted}>
            确认后，首页、收支统计、预算和累计结余将在刷新时按新口径计算；已封榜的记录不会重算。
          </Text>
          <Action
            title={r.busy ? '正在保存…' : '保存确认'}
            primary
            disabled={!kind || !accepted || r.busy}
            onPress={() => {
              if (kind && r.value)
                void r.run(
                  () => api.classify(id, kind, r.value!.updatedAt),
                  () => navigation.goBack(),
                );
            }}
          />
          <Action
            title="查看原账单"
            onPress={() => navigation.navigate('BillDetail', { billId: id })}
          />
        </>
      )}
    </Page>
  );
}
