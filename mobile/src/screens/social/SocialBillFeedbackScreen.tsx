import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useStyles } from '../../hooks/useStyles';
import {
  Action,
  Page,
  Status,
  stylesFor,
  useSocialApi,
  useSocialResource,
} from './shared';
import { Pager, voteLabels } from './reviewShared';
export default function SocialBillFeedbackScreen({
  route,
  navigation,
}: {
  route: any;
  navigation: any;
}) {
  const api = useSocialApi(),
    s = useStyles(stylesFor),
    id: number = route.params.billId;
  const [page, setPage] = useState(1),
    [ackError, setAckError] = useState(false);
  const boundary = useSocialResource(
    useCallback(() => api.billFeedback(id), [api, id]),
  );
  // Fetch only after the entry boundary; changing pages must not advance it.
  const r = useSocialResource(
    useCallback(
      () =>
        boundary.value
          ? api.ownerReviewSummary(id, page)
          : Promise.resolve(null),
      [api, id, page, boundary.value],
    ),
  );
  useEffect(() => {
    let active = true;
    setAckError(false);
    if (r.value && boundary.value)
      void api.readInbox(boundary.value.receipt).catch(() => {
        if (active) setAckError(true);
      });
    return () => {
      active = false;
    };
  }, [api, r.value, boundary.value]);
  return (
    <Page>
      <Text style={s.title}>这笔账单的评价</Text>
      <Text style={s.muted}>
        进入本页会将进入时已有反馈标为已读，新到的反馈仍保留未读。每位评价者的文字分别查看，不对其他评价者开放。
      </Text>
      <Status {...boundary} />
      <Status {...r} />
      {ackError && (
        <View style={s.card}>
          <Text style={s.error}>已读状态未能同步。重新加载可重试。</Text>
          <Action title="重新加载已读状态" onPress={r.refresh} />
        </View>
      )}
      {r.value && (
        <>
          <Text style={s.heading}>
            夯 {r.value.hang} · 拉 {r.value.la}
          </Text>
          {r.value.threads.map(t => (
            <View key={t.id} style={s.card}>
              <Text style={s.heading}>
                {t.reviewer.nickname || '未设置昵称'} · {voteLabels[t.vote]}
              </Text>
              <Text selectable style={s.small}>
                {t.reviewer.id}
              </Text>
              <Action
                title="查看这位评价者的对话"
                onPress={() =>
                  navigation.navigate('SocialReviewThread', { threadId: t.id })
                }
              />
            </View>
          ))}
          {r.value.threads.length === 0 && (
            <Text style={s.muted}>还没有评价。</Text>
          )}
          <Pager
            page={page}
            hasNext={r.value.threads.length === 20}
            change={setPage}
          />
        </>
      )}
    </Page>
  );
}
