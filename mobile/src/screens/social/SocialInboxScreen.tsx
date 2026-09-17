import React, { useCallback, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { ChevronRight, MessageCircle, UserCheck, Flag } from 'lucide-react-native';
import { useAuth, useTheme } from '../../providers';
import { useStyles } from '../../hooks/useStyles';
import { InboxTarget } from '../../services/api/social';
import {
  Action,
  Page,
  Status,
  stylesFor,
  useSocialApi,
  useSocialResource,
} from './shared';
const latest = 2147483647;
export default function SocialInboxScreen({ navigation }: { navigation: any }) {
  const { token } = useAuth();
  return <InboxContent key={token || ''} navigation={navigation} />;
}
function InboxContent({ navigation }: { navigation: any }) {
  const api = useSocialApi(),
    s = useStyles(stylesFor),
    { user } = useAuth(),
    { colors } = useTheme();
  const [cursors, setCursors] = useState([latest]);
  const before = cursors[cursors.length - 1];
  const r = useSocialResource(
    useCallback(() => api.inbox(before), [api, before]),
  );
  const open = (target: InboxTarget) => {
    if (target.type === 'review')
      navigation.navigate('SocialReviewThread', {
        threadId: target.threadId,
        messageId: target.messageId,
      });
    else if (target.type === 'bills')
      navigation.navigate('SocialBills', { userId: target.ownerId });
    else if (target.type === 'grant')
      navigation.navigate('SocialPerson', { userId: target.ownerId });
    else if (target.type === 'profile')
      navigation.navigate('SocialPerson', { userId: target.userId });
    else if (target.type === 'request')
      navigation.navigate('SocialRequests', {
        direction: target.applicantId === user?.id ? 'outgoing' : 'incoming',
      });
  };
  const resolveAndOpen = (id: number) => {
    let currentTarget: InboxTarget | undefined;
    void r.run(
      async () => {
        currentTarget = (await api.inboxEvent(id)).target;
      },
      () => {
        if (currentTarget) open(currentTarget);
      },
    );
  };
  return (
    <Page>
      <Text style={s.title}>社群消息</Text>
      <Text style={s.muted}>
        好友的互动与通知都在这里。
      </Text>
      <View style={[s.card, { gap: 0, paddingVertical: 4 }]}>
        {([
          ['我的反馈', '看看大家如何评价你的开销', 'SocialReceivedReviews', MessageCircle],
          ['评账申请', '处理收到和发出的申请', 'SocialRequests', UserCheck],
          ['我的举报', '查看处理进度', 'SocialReports', Flag],
        ] as const).map(([label, hint, screen, Icon], index) => <TouchableOpacity key={screen} accessibilityRole="button" onPress={() => navigation.navigate(screen)} style={[s.row, { paddingVertical: 14, borderTopWidth: index ? 1 : 0, borderTopColor: colors.divider }]}>
          <Icon size={21} color={colors.textPrimary} />
          <View style={s.grow}><Text style={s.text}>{label}</Text><Text style={s.small}>{hint}</Text></View>
          <ChevronRight size={17} color={colors.textSecondary} />
        </TouchableOpacity>)}
      </View>
      <Action
        title="刷新消息"
        disabled={r.busy || r.loading}
        onPress={() => {
          if (cursors.length === 1) void r.refresh();
          else setCursors([latest]);
        }}
      />
      <Status {...r} />
      {!r.error &&
        r.value?.items.map(item => (
          <View style={s.card} key={item.id}>
            <Text style={s.heading}>
              {item.unread ? '● 未读 · ' : ''}
              {item.title}
            </Text>
            <Text style={s.small}>
              {new Date(item.createdAt).toLocaleString()}
            </Text>
            {item.preview && (
              <Text selectable style={s.text}>
                {item.preview}
              </Text>
            )}
            {item.target.type === 'bills' && (
              <Text style={s.muted}>
                {item.target.count} 笔当前可查看的账单
              </Text>
            )}
            {item.target.type === 'report' ? (
              <>
                <Text style={s.text}>
                  举报 #{item.target.reportId} ·{' '}
                  {item.target.status === 'upheld' ? '举报成立' : '未认定违规'}
                </Text>
                <Text selectable style={s.text}>
                  {item.target.reason || '暂无处理说明'}
                </Text>
              </>
            ) : (
              <Action
                title="查看详情"
                disabled={r.busy}
                onPress={() => resolveAndOpen(item.id)}
              />
            )}
            {item.unread && (
              <Action
                title="标为已读"
                disabled={r.busy}
                onPress={() => {
                  void r.run(() => api.readInbox(item.readReceipt));
                }}
              />
            )}
          </View>
        ))}
      {!r.error && r.value?.items.length === 0 && (
        <Text style={s.muted}>
          {r.value.hasMore
            ? '这一页没有仍可展示的消息，可继续查看更早消息。'
            : '没有更多可展示的消息。'}
        </Text>
      )}
      {!r.error && r.value?.receipt && r.value.items.some(i => i.unread) && (
        <Action
          title="将本页消息标为已读"
          disabled={r.busy}
          onPress={() => {
            void r.run(() => api.readInbox(r.value!.receipt!));
          }}
        />
      )}
      {!r.error && r.value && (cursors.length > 1 || r.value.hasMore) && (
        <View style={s.row}>
          <View style={s.grow}>
            <Action
              title="较新一页"
              disabled={r.busy || cursors.length === 1}
              onPress={() => setCursors(v => v.slice(0, -1))}
            />
          </View>
          <View style={s.grow}>
            <Action
              title="更早消息"
              disabled={r.busy || !r.value.hasMore}
              onPress={() => setCursors(v => [...v, r.value!.nextBefore])}
            />
          </View>
        </View>
      )}
    </Page>
  );
}
