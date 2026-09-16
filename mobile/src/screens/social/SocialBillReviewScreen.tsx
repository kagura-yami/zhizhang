import React, { useCallback } from 'react';
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
import { BillSnapshot, voteLabels } from './reviewShared';
export default function SocialBillReviewScreen({
  route,
  navigation,
}: {
  route: any;
  navigation: any;
}) {
  const api = useSocialApi(),
    s = useStyles(stylesFor),
    id: number = route.params.billId;
  const r = useSocialResource(useCallback(() => api.myVote(id), [api, id]));
  return (
    <Page>
      <Status {...r} />
      {r.value && (
        <>
          <BillSnapshot bill={r.value.snapshot} />
          <Text style={s.heading}>
            {r.value.thread
              ? `我的投票：${voteLabels[r.value.thread.vote]}`
              : '先投票，再写主评'}
          </Text>
          <Text style={s.muted}>
            每账单一票，可以改票，不能取消。仅你和账单主人可看你的私密对话。
          </Text>
          <View style={s.chipRow}>
            {(['hang', 'la'] as const).map(v => (
              <Action
                key={v}
                title={voteLabels[v]}
                primary={r.value?.thread?.vote === v}
                disabled={r.busy}
                onPress={() => {
                  void r.run(() => api.vote(id, v));
                }}
              />
            ))}
          </View>
          {r.value.thread && (
            <Action
              title="进入私密对话"
              primary
              onPress={() =>
                navigation.navigate('SocialReviewThread', {
                  threadId: r.value!.thread!.id,
                })
              }
            />
          )}
        </>
      )}
    </Page>
  );
}
