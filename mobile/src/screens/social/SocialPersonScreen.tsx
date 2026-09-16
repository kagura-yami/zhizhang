import React, { useCallback } from 'react';
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

const scopes = { expense: '支出', income: '收入', both: '收入与支出' };
export default function SocialPersonScreen({
  route,
  navigation,
}: {
  route: any;
  navigation: any;
}) {
  const api = useSocialApi();
  const id: string = route.params.userId,
    s = useStyles(stylesFor),
    { confirm } = useAlert();
  const r = useSocialResource(
    useCallback(async () => {
      const [person, grants] = await Promise.all([
        api.person(id),
        api.grants(id),
      ]);
      return { person, ...grants };
    }, [api, id]),
  );
  return (
    <Page>
      <Status {...r} />
      {r.value && (
        <>
          <View style={s.card}>
            <Text style={s.title}>
              {r.value.person.nickname || '未设置昵称'}
            </Text>
            <Text selectable style={s.small}>
              {id}
            </Text>
            <Text style={s.text}>
              {r.value.person.friend
                ? '互相关注 · 好友'
                : r.value.person.followedBy
                ? '对方已关注你'
                : '尚未互相关注'}
            </Text>
            <Action
              title={r.value.person.following ? '取消关注' : '关注'}
              disabled={r.busy}
              onPress={() => {
                void r.run(() => api.follow(id, !r.value!.person.following));
              }}
            />
          </View>
          <View style={s.card}>
            <Text style={s.heading}>我分享给对方的账单</Text>
            <Text style={s.text}>
              {r.value.given?.status === 'active'
                ? `${scopes[r.value.given.scope]} · ${
                    r.value.given.historyStart
                      ? r.value.given.historyStart.slice(0, 10) + ' 起'
                      : '仅授权后新账单'
                  }`
                : '没有生效中的授权'}
            </Text>
            <Action
              primary
              title={
                r.value.given?.status === 'active'
                  ? '修改分享范围'
                  : '授权对方评账'
              }
              onPress={() => navigation.navigate('SocialGrant', { userId: id })}
            />
            {r.value.given?.status === 'active' && (
              <Action
                title="撤销授权"
                disabled={r.busy}
                onPress={() =>
                  confirm(
                    '撤销评账授权',
                    '对方将无法继续查看或评价你的账单，你仍保留自己的评账存档。',
                    () => {
                      void r.run(() => api.endGrant(id, false));
                    },
                  )
                }
              />
            )}
          </View>
          <View style={s.card}>
            <Text style={s.heading}>对方分享给我的账单</Text>
            <Text style={s.text}>
              {r.value.received?.status === 'active'
                ? `${scopes[r.value.received.scope]} · ${
                    r.value.received.historyStart
                      ? r.value.received.historyStart.slice(0, 10) + ' 起'
                      : '仅授权后新账单'
                  }`
                : '对方尚未授权'}
            </Text>
            {r.value.received?.status === 'active' && (
              <Action
                title="退出此授权"
                disabled={r.busy}
                onPress={() =>
                  confirm(
                    '退出评账授权',
                    '退出后无法继续查看对应账单。若不希望对方再次联系，可以拉黑。',
                    () => {
                      void r.run(() => api.endGrant(id, true));
                    },
                  )
                }
              />
            )}
          </View>
          <Action
            title="拉黑此用户"
            disabled={r.busy}
            onPress={() =>
              confirm(
                '拉黑此用户',
                '双方关注、评账授权和待处理申请会终止。解除拉黑后不会自动恢复。',
                () => {
                  void r.run(
                    () => api.block(id, true),
                    () => navigation.goBack(),
                  );
                },
                undefined,
                { destructive: true },
              )
            }
          />
        </>
      )}
    </Page>
  );
}
