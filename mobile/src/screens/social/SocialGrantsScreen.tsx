import React, { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useAlert } from '../../providers';
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
const statuses = { active: '生效中', revoked: '已撤销', exited: '已退出' };
const scopes = { income: '收入', expense: '支出', both: '收入与支出' };
export default function SocialGrantsScreen({
  navigation,
}: {
  navigation: any;
}) {
  const api = useSocialApi(),
    s = useStyles(stylesFor),
    { confirm } = useAlert();
  const [direction, setDirection] = useState<'given' | 'received'>('given'),
    [page, setPage] = useState(1);
  const r = useSocialResource(
    useCallback(() => api.grantList(direction, page), [api, direction, page]),
  );
  return (
    <Page>
      <Text style={s.title}>评账授权</Text>
      <Text style={s.muted}>
        两个方向分别生效，你可随时调整分享范围或退出对方授权。
      </Text>
      <View style={s.row}>
        {(['given', 'received'] as const).map(value => (
          <View key={value} style={s.grow}>
            <Action
              title={value === 'given' ? '我分享的' : '分享给我的'}
              primary={direction === value}
              onPress={() => {
                setDirection(value);
                setPage(1);
              }}
            />
          </View>
        ))}
      </View>
      <Status {...r} />
      {r.value?.map(grant => {
        const person = direction === 'given' ? grant.reviewer : grant.owner;
        return (
          <View key={person.id} style={s.card}>
            <Text style={s.heading}>
              {person.nickname || '未设置昵称'} · {statuses[grant.status]}
            </Text>
            <Text selectable style={s.small}>
              {person.id}
            </Text>
            <Text style={s.text}>
              {scopes[grant.scope]} ·{' '}
              {grant.historyStart
                ? `${grant.historyStart.slice(0, 10)} 起`
                : '仅授权后的新账单'}
            </Text>
            <Action
              title="查看关系与授权"
              onPress={() =>
                navigation.navigate('SocialPerson', { userId: person.id })
              }
            />
            {direction === 'given' && (
              <Action
                title={grant.status === 'active' ? '修改分享范围' : '重新授权'}
                onPress={() =>
                  navigation.navigate('SocialGrant', { userId: person.id })
                }
              />
            )}
            {grant.status === 'active' && (
              <Action
                title={direction === 'given' ? '撤销授权' : '退出授权'}
                disabled={r.busy}
                onPress={() =>
                  confirm(
                    '结束评账授权',
                    '结束后，评价者将无法继续读取或评价这些账单。账单主人仍保留历史对话。',
                    () => {
                      void r.run(() =>
                        api.endGrant(person.id, direction === 'received'),
                      );
                    },
                    undefined,
                    { confirmText: '确认结束' },
                  )
                }
              />
            )}
          </View>
        );
      })}
      {r.value?.length === 0 && (
        <Text style={s.muted}>这个方向还没有授权记录。</Text>
      )}
      {r.value && (
        <Pager page={page} hasNext={r.value.length === 20} change={setPage} />
      )}
    </Page>
  );
}
