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
import { Pager } from './reviewShared';
const scopes: Record<string, string> = {
  income: '收入',
  expense: '支出',
  both: '收入与支出',
};
export default function SocialReviewableOwnersScreen({
  navigation,
}: {
  navigation: any;
}) {
  const api = useSocialApi(),
    s = useStyles(stylesFor),
    [page, setPage] = useState(1);
  const r = useSocialResource(
    useCallback(() => api.reviewableOwners(page), [api, page]),
  );
  return (
    <Page>
      <Text style={s.title}>互评账单</Text>
      <Text style={s.muted}>
        先选一个授权给你的账号，再逐笔评价。关注和互关不会自动开放账单。
      </Text>
      <Status {...r} />
      {r.value?.items.map(row => (
        <View style={s.card} key={row.owner.id}>
          <Text style={s.heading}>{row.owner.nickname || '未设置昵称'}</Text>
          <Text selectable style={s.small}>
            {row.owner.id}
          </Text>
          <Text style={s.text}>
            待评 {row.pendingCount} 笔 · 已评价 {row.reviewedCount} 笔
          </Text>
          <Text style={s.muted}>
            {scopes[row.scope]} ·{' '}
            {row.historyStart
              ? `${row.historyStart.slice(0, 10)} 起`
              : '仅本次授权后的新账单'}
          </Text>
          <Action
            primary
            title="查看此人的账单"
            onPress={() =>
              navigation.navigate('SocialBills', { userId: row.owner.id })
            }
          />
          <Action
            title="关系与授权"
            onPress={() =>
              navigation.navigate('SocialPerson', { userId: row.owner.id })
            }
          />
        </View>
      ))}
      {r.value?.items.length === 0 && (
        <View style={s.card}>
          <Text style={s.heading}>还没有可查看的账号</Text>
          <Text style={s.muted}>
            可以查找认识的人，在对方资料页申请评账。对方批准后会出现在这里。
          </Text>
          <Action
            title="查找用户"
            onPress={() => navigation.navigate('SocialPeople')}
          />
        </View>
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
