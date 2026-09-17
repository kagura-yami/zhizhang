import React, { useCallback } from 'react';
import { Text, View } from 'react-native';
import { useAlert, useAuth } from '../../providers';
import { useStyles } from '../../hooks/useStyles';
import SocialAvatar from './SocialAvatar';
import { requestLabels } from './SocialRequestsScreen';

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
  const { user } = useAuth();
  const id: string = route.params.userId,
    s = useStyles(stylesFor),
    { confirm } = useAlert();
  const r = useSocialResource(
    useCallback(async () => {
      if (id === user?.id) return { person: await api.person(id), given: null, received: null,
        requestContext: { pendingCount: 0, pendingLimit: 10, request: null, cooldownUntil: null } };
      const [person, grants, requestContext] = await Promise.all([
        api.person(id),
        api.grants(id),
        api.requestContext(id),
      ]);
      return { person, ...grants, requestContext };
    }, [api, id, user?.id]),
  );
  if (id === user?.id) return <Page><Text style={s.title}>我的社群资料</Text><Status {...r} />
    {r.value && <View style={s.card}><SocialAvatar avatar={r.value.person.avatar} nickname={r.value.person.nickname} size={64} /><Text style={s.heading}>{r.value.person.nickname || '未设置昵称'}</Text><Text selectable style={s.small}>{id}</Text>
      <Text style={s.muted}>这是你的账号。排行展示不会为其他人开放账单权限。</Text><Action title="隐私设置" onPress={() => navigation.navigate('SocialPrivacy')} /></View>}
  </Page>;
  return (
    <Page>
      <Status {...r} />
      {r.value && (
        <>
          <View style={s.card}>
            <View style={s.row}>
              <SocialAvatar avatar={r.value.person.avatar} nickname={r.value.person.nickname} size={64} />
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={s.title}>{r.value.person.nickname || '未设置昵称'}</Text>
                <Text style={s.muted}>{r.value.person.friend ? '互相关注 · 好友' : r.value.person.followedBy ? '对方已关注你' : r.value.person.following ? '你已关注对方' : '社群用户'}</Text>
              </View>
            </View>
            {!r.value.person.friend && <Action primary
              title={r.value.person.incomingFriendRequestId ? '同意好友申请' : r.value.person.friendRequestSent ? '已发送好友申请' : '申请好友'}
              disabled={r.busy || (!!r.value.person.friendRequestSent && !r.value.person.incomingFriendRequestId)}
              onPress={() => { void r.run(() => r.value!.person.incomingFriendRequestId ? api.acceptFriend(r.value!.person.incomingFriendRequestId) : api.requestFriend(id)); }} />}
            <Text style={s.small}>{r.value.person.friend ? '你们已经是好友，可以在好友榜查看彼此排名。' : '发送申请后自动关注对方，对方同意并回关后成为好友。'}</Text>
            {r.value.person.following && <Action title="取消关注" disabled={r.busy} onPress={() => confirm('取消关注', '取消后将解除好友关系，尚未处理的好友申请也会失效。', () => { void r.run(() => api.follow(id, false)); })} />}
          </View>
          <Text style={s.heading}>账单互动</Text>
          <Text style={s.muted}>成为好友后，账单仍需单独授权才能查看和评价。</Text>
          {r.value.received?.status !== 'active' && (
            <View style={s.card}>
              <Text style={s.heading}>申请查看对方的账单</Text>
              <Text style={s.muted}>
                仅向对方发送申请；由对方决定是否批准及开放范围。
              </Text>
              <Text style={s.text}>
                待处理 {r.value.requestContext.pendingCount}/
                {r.value.requestContext.pendingLimit} ·{' '}
                {r.value.requestContext.request
                  ? requestLabels[r.value.requestContext.request.status]
                  : '尚未申请'}
              </Text>
              {!!r.value.requestContext.cooldownUntil &&
                new Date(r.value.requestContext.cooldownUntil).getTime() >
                  Date.now() && (
                  <Text style={s.error}>
                    申请冷却至{' '}
                    {new Date(
                      r.value.requestContext.cooldownUntil,
                    ).toLocaleString()}
                    。到期后请重新加载。
                  </Text>
                )}
              {r.value.requestContext.request?.status === 'pending' ? (
                <Action
                  title="撤回申请"
                  disabled={r.busy}
                  onPress={() =>
                    confirm(
                      '撤回申请',
                      '撤回后对方不能批准这一轮申请。',
                      () => {
                        void r.run(() =>
                          api.withdrawRequest(
                            id,
                            r.value!.requestContext.request!.version,
                          ),
                        );
                      },
                    )
                  }
                />
              ) : (
                <Action
                  title="发起评账申请"
                  disabled={
                    r.busy ||
                    r.value.requestContext.pendingCount >=
                      r.value.requestContext.pendingLimit ||
                    (!!r.value.requestContext.cooldownUntil &&
                      new Date(r.value.requestContext.cooldownUntil).getTime() >
                        Date.now())
                  }
                  onPress={() =>
                    confirm(
                      '发起评账申请',
                      '将向对方展示你的昵称、头像和用户 ID。最多同时保留十条待处理申请；连续三次被拒绝后冷却 24 小时。',
                      () => {
                        void r.run(() =>
                          api.submitRequest(
                            id,
                            r.value!.requestContext.request?.version,
                          ),
                        );
                      },
                    )
                  }
                />
              )}
              <Action
                title="刷新申请状态"
                disabled={r.busy}
                onPress={r.refresh}
              />
            </View>
          )}
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
            {r.value.received?.status === 'active' && (
              <Action
                title="查看授权账单"
                primary
                onPress={() =>
                  navigation.navigate('SocialBills', { userId: id })
                }
              />
            )}
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
