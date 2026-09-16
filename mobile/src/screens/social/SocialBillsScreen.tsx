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
  const [state, setState] = useState<'pending' | 'reviewed' | 'all'>('pending');
  const r = useSocialResource(
    useCallback(() => api.sharedBills(id, page, state), [api, id, page, state]),
  );
  return (
    <Page>
      <Text style={s.title}>对方授权的账单</Text>
      <Text style={s.muted}>
        仅显示当前获准的范围。你的票与文字不会展示给其他评价者。
      </Text>
      <View style={s.row}>
        {(
          [
            ['pending', '待评'],
            ['reviewed', '已评价'],
            ['all', '全部'],
          ] as const
        ).map(([value, label]) => (
          <View style={s.grow} key={value}>
            <Action
              title={label}
              primary={state === value}
              onPress={() => {
                setState(value);
                setPage(1);
              }}
            />
          </View>
        ))}
      </View>
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
          hasNext={page * 20 < r.value.total}
          change={setPage}
        />
      )}
    </Page>
  );
}
