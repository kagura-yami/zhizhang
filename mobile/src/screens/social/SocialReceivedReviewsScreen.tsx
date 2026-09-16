import React, { useCallback, useState } from 'react';
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
import { BillSnapshot, Pager, voteLabels } from './reviewShared';
export default function SocialReceivedReviewsScreen({
  navigation,
}: {
  navigation: any;
}) {
  const api = useSocialApi(),
    s = useStyles(stylesFor),
    [page, setPage] = useState(1);
  const r = useSocialResource(
    useCallback(() => api.receivedReviews(page), [api, page]),
  );
  return (
    <Page>
      <Text style={s.title}>收到的评账</Text>
      <Text style={s.muted}>
        每位评价者有独立对话。删除账单后，历史对话仍在这里只读保留。
      </Text>
      <Status {...r} />
      {r.value?.map(row => (
        <View style={s.card} key={row.id}>
          <Text style={s.heading}>
            {row.reviewer.nickname || '未设置昵称'} · {voteLabels[row.vote]}
          </Text>
          <Text selectable style={s.small}>
            {row.reviewer.id}
          </Text>
          {!!row.deletedAt && (
            <Text style={s.muted}>原账单已删除 · 只读存档</Text>
          )}
          <BillSnapshot bill={row.snapshot} />
          <Action
            title="打开私密对话"
            onPress={() =>
              navigation.navigate('SocialReviewThread', { threadId: row.id })
            }
          />
        </View>
      ))}
      {r.value?.length === 0 && <Text style={s.muted}>还没有收到评账。</Text>}
      {r.value && (
        <Pager page={page} hasNext={r.value.length === 20} change={setPage} />
      )}
    </Page>
  );
}
