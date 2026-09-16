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

export const requestLabels = {
  pending: '等待处理',
  approved: '已批准',
  rejected: '已拒绝',
  withdrawn: '已撤回',
  system_cancelled: '已取消',
};
export default function SocialRequestsScreen({
  navigation,
  route,
}: {
  navigation: any;
  route: any;
}) {
  const api = useSocialApi(),
    s = useStyles(stylesFor),
    { confirm } = useAlert();
  const [direction, setDirection] = useState<'incoming' | 'outgoing'>(
    route.params?.direction === 'outgoing' ? 'outgoing' : 'incoming',
  );
  const [page, setPage] = useState(1);
  const r = useSocialResource(
    useCallback(() => api.requests(direction, page), [api, direction, page]),
  );
  return (
    <Page>
      <Text style={s.title}>评账申请</Text>
      <Text style={s.muted}>
        批准只开放你确认的账单范围，不会自动关注或互相授权。已批准的记录不代表当前授权仍然有效。
      </Text>
      <View style={s.chipRow}>
        {(
          [
            ['incoming', '收到的申请'],
            ['outgoing', '发出的申请'],
          ] as const
        ).map(([key, label]) => (
          <Action
            key={key}
            title={label}
            primary={direction === key}
            onPress={() => {
              setDirection(key);
              setPage(1);
            }}
          />
        ))}
      </View>
      <Status {...r} />
      {r.value?.map(row => {
        const person = direction === 'incoming' ? row.applicant : row.owner;
        return (
          <View style={s.card} key={`${row.ownerId}:${row.applicantId}`}>
            <Text style={s.heading}>{person.nickname || '未设置昵称'}</Text>
            <Text selectable style={s.small}>
              {person.id}
            </Text>
            <Text style={s.text}>{requestLabels[row.status]}</Text>
            <Text style={s.small}>
              {new Date(row.requestedAt).toLocaleString()}
            </Text>
            {row.status === 'system_cancelled' && (
              <Text style={s.muted}>
                申请已因关系变化或申请冷却等原因取消，不会自动恢复。
              </Text>
            )}
            {row.status === 'pending' &&
              (direction === 'incoming' ? (
                <>
                  <Action
                    title="选择范围并批准"
                    primary
                    disabled={r.busy}
                    onPress={() =>
                      navigation.navigate('SocialGrant', {
                        userId: person.id,
                        requestVersion: row.version,
                      })
                    }
                  />
                  <Action
                    title="拒绝申请"
                    disabled={r.busy}
                    onPress={() =>
                      confirm(
                        '拒绝评账申请',
                        '拒绝后不会开放任何账单。对方可能再次申请，也可以在关系页面拉黑。',
                        () => {
                          void r.run(() =>
                            api.rejectRequest(person.id, row.version),
                          );
                        },
                      )
                    }
                  />
                </>
              ) : (
                <Action
                  title="撤回申请"
                  disabled={r.busy}
                  onPress={() =>
                    confirm(
                      '撤回申请',
                      '撤回后对方不能批准这一轮申请。',
                      () => {
                        void r.run(() =>
                          api.withdrawRequest(person.id, row.version),
                        );
                      },
                    )
                  }
                />
              ))}
            <Action
              title="查看关系与授权"
              disabled={r.busy}
              onPress={() =>
                navigation.navigate('SocialPerson', { userId: person.id })
              }
            />
          </View>
        );
      })}
      {r.value?.length === 0 && <Text style={s.muted}>暂无申请记录。</Text>}
      {r.value && (
        <View style={s.row}>
          <View style={s.grow}>
            <Action
              title="上一页"
              disabled={page === 1}
              onPress={() => setPage(p => p - 1)}
            />
          </View>
          <Text style={s.text}>{page}</Text>
          <View style={s.grow}>
            <Action
              title="下一页"
              disabled={r.value.length < 20}
              onPress={() => setPage(p => p + 1)}
            />
          </View>
        </View>
      )}
    </Page>
  );
}
