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
  embedded = false,
}: {
  navigation: any;
  embedded?: boolean;
}) {
  const api = useSocialApi(),
    s = useStyles(stylesFor),
    [page, setPage] = useState(1);
  const r = useSocialResource(
    useCallback(() => api.reviewableOwners(page), [api, page]),
  );
  return (
    <Page>
      {!embedded && <Text style={s.title}>互评账单</Text>}
      <Text style={s.muted}>
        看看好友的消费，分享你的想法。账单仅在授权后可见。
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
        <View style={s.empty}>
          <Text style={[s.heading, { textAlign: 'center' }]}>和好友一起看懂开销</Text>
          <Text style={s.muted}>
            在“我的 → 好友”中建立联系并申请评账，获准后就能在这里看到对方。
          </Text>

        </View>
      )}
      {r.value && (page > 1 || r.value.total > 20) && (
        <Pager
          page={page}
          hasNext={page * 20 < r.value.total}
          change={setPage}
        />
      )}
    </Page>
  );
}
