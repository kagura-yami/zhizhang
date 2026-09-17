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
import { BillSnapshot, Pager } from './reviewShared';
export default function SocialReceivedReviewsScreen({
  navigation,
}: {
  navigation: any;
}) {
  const api = useSocialApi(),
    s = useStyles(stylesFor),
    [page, setPage] = useState(1);
  const r = useSocialResource(
    useCallback(() => api.receivedBillReviews(page), [api, page]),
  );
  return (
    <Page>
      <Text style={s.title}>我的反馈</Text>
      <Text style={s.muted}>
        每位评价者有独立对话。删除账单后，历史对话仍在这里只读保留。
      </Text>
      <Status {...r} />
      {r.value?.map(row => (
        <View style={s.card} key={row.originalBillId}>
          <Text style={s.heading}>
            夯 {row.hang} · 拉 {row.la}
          </Text>
          {!!row.deletedAt && (
            <Text style={s.muted}>原账单已删除 · 只读存档</Text>
          )}
          <BillSnapshot bill={row.snapshot} />
          <Action
            title="查看这笔账单的反馈"
            onPress={() =>
              navigation.navigate('SocialBillFeedback', {
                billId: row.originalBillId,
              })
            }
          />
        </View>
      ))}
      {r.value?.length === 0 && <Text style={s.muted}>还没有收到评账。</Text>}
      {r.value && (page > 1 || r.value.length === 20) && (
        <Pager page={page} hasNext={r.value.length === 20} change={setPage} />
      )}
    </Page>
  );
}
