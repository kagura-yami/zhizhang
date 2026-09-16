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
export default function SocialBillsScreen({
  route,
  navigation,
}: {
  route: any;
  navigation: any;
}) {
  const api = useSocialApi(),
    s = useStyles(stylesFor),
    id: string = route.params.userId;
  const [page, setPage] = useState(1);
  const r = useSocialResource(
    useCallback(() => api.sharedBills(id, page), [api, id, page]),
  );
  return (
    <Page>
      <Text style={s.title}>对方授权的账单</Text>
      <Text style={s.muted}>
        仅显示当前获准的范围。你的票与文字不会展示给其他评价者。
      </Text>
      <Status {...r} />
      {r.value?.items.map(b => (
        <View key={b.id}>
          <BillSnapshot bill={b} />
          <Action
            title="查看我的评价"
            onPress={() =>
              navigation.navigate('SocialBillReview', { billId: b.id })
            }
          />
        </View>
      ))}
      {r.value?.items.length === 0 && (
        <Text style={s.muted}>当前范围内没有账单。</Text>
      )}
      {r.value && (
        <Pager
          page={page}
          hasNext={r.value.items.length === 20}
          change={setPage}
        />
      )}
    </Page>
  );
}
