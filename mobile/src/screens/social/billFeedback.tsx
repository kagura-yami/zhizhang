import React, { useCallback } from 'react';
import { Text, View } from 'react-native';
import { BillFeedback } from '../../services/api/social';
import { useStyles } from '../../hooks/useStyles';
import {
  Action,
  Status,
  stylesFor,
  useSocialApi,
  useSocialResource,
} from './shared';

export function useBillFeedbackSummaries(ids: number[]) {
  const api = useSocialApi();
  const key = [...new Set(ids)].sort((a, b) => a - b).join(',');
  return useSocialResource(
    useCallback(async () => {
      if (!key || !(await api.status()).enabled) return [] as BillFeedback[];
      const billIds = key.split(',').map(Number),
        rows: BillFeedback[] = [];
      for (let start = 0; start < billIds.length; start += 50)
        rows.push(
          ...(await api.billFeedbackSummaries(
            billIds.slice(start, start + 50),
          )),
        );
      return rows;
    }, [api, key]),
  );
}
export function BillFeedbackLabel({ feedback }: { feedback?: BillFeedback }) {
  const s = useStyles(stylesFor);
  if (!feedback) return null;
  return (
    <Text
      style={s.muted}
      accessibilityLabel={`夯 ${feedback.hang} 票，拉 ${feedback.la} 票${
        feedback.hasUnreadText ? '，有新文字反馈' : ''
      }`}
    >
      夯 {feedback.hang} · 拉 {feedback.la}
      {feedback.hasUnreadText ? '  ●' : ''}
    </Text>
  );
}
export function BillReviewEntry({
  billId,
  navigation,
}: {
  billId: number;
  navigation: any;
}) {
  const api = useSocialApi(),
    s = useStyles(stylesFor);
  const r = useSocialResource(
    useCallback(async () => {
      const status = await api.status();
      return status.enabled
        ? {
            enabled: true,
            feedback: (await api.billFeedbackSummaries([billId]))[0],
          }
        : { enabled: false, feedback: undefined };
    }, [api, billId]),
  );
  return (
    <View style={s.card}>
      <Text style={s.heading}>账单评价</Text>
      <Status {...r} />
      {r.value &&
        (r.value.enabled ? (
          <>
            <BillFeedbackLabel feedback={r.value.feedback} />
            <Action
              title="查看评价"
              primary
              onPress={() =>
                navigation.navigate('SocialBillFeedback', { billId })
              }
            />
          </>
        ) : (
          <>
            <Text style={s.muted}>
              启用社群并主动授权后，才能邀请他人评账。
            </Text>
            <Action
              title="了解社群与隐私"
              onPress={() => navigation.navigate('SocialSettings')}
            />
          </>
        ))}
    </View>
  );
}
