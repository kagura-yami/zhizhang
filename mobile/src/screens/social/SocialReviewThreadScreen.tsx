import React, { useCallback, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useAlert, useAuth } from '../../providers';
import { useStyles } from '../../hooks/useStyles';
import { ReviewDetail, ReviewMessage } from '../../services/api/social';
import {
  Action,
  Page,
  Status,
  stylesFor,
  useSocialApi,
  useSocialResource,
} from './shared';
import { BillSnapshot, Pager, messageKey, voteLabels } from './reviewShared';

function MessageCard({
  message: m,
  detail,
  busy,
  change,
  versions,
  report,
}: {
  message: ReviewMessage;
  detail: ReviewDetail;
  busy: boolean;
  change: (action: 'edit' | 'withdraw' | 'restore', body?: string) => void;
  versions: () => void;
  report: () => void;
}) {
  const s = useStyles(stylesFor),
    { user } = useAuth(),
    { confirm } = useAlert();
  const [editing, setEditing] = useState(false),
    [body, setBody] = useState(m.body || '');
  const editable =
    detail.canWrite &&
    !m.hidden &&
    m.authorId === user?.id &&
    (m.isMain || !detail.mainWithdrawn);
  return (
    <View style={s.card}>
      <Text style={s.heading}>
        {m.authorId === user?.id
          ? '我'
          : detail.otherPerson?.nickname || '对方'}{' '}
        · {m.isMain ? '主评' : '回复'}
      </Text>
      <Text style={s.small}>
        {new Date(m.createdAt).toLocaleString()} · 版本 {m.revision}
      </Text>
      <Text selectable style={s.text}>
        {m.hidden
          ? '此内容已被审核隐藏'
          : m.withdrawn
          ? '此内容已由作者撤回'
          : m.body}
      </Text>
      {editing && editable && !m.withdrawn ? (
        <>
          <TextInput
            accessibilityLabel="修改文字"
            multiline
            maxLength={2000}
            value={body}
            onChangeText={setBody}
            editable={!busy}
            style={[s.input, { minHeight: 120, textAlignVertical: 'top' }]}
          />
          <Action
            title="保存修改"
            disabled={busy || !body.trim()}
            onPress={() => change('edit', body.trim())}
          />
          <Action
            title="取消修改"
            disabled={busy}
            onPress={() => setEditing(false)}
          />
        </>
      ) : (
        editable && (
          <View style={s.chipRow}>
            {!m.withdrawn && (
              <Action
                title="编辑"
                disabled={busy}
                onPress={() => setEditing(true)}
              />
            )}
            <Action
              title={m.withdrawn ? '恢复' : '撤回'}
              disabled={busy}
              onPress={() =>
                confirm(
                  m.withdrawn ? '恢复文字' : '撤回文字',
                  m.isMain
                    ? '撤回主评会暂停回复；恢复后对话可以继续。历史版本仍对本线程双方可见。'
                    : '操作保留历史版本，只影响这条文字。',
                  () => change(m.withdrawn ? 'restore' : 'withdraw'),
                )
              }
            />
          </View>
        )
      )}
      {!m.hidden && (
        <Action title="查看版本" disabled={busy} onPress={versions} />
      )}
      {!m.hidden && m.authorId !== user?.id && (
        <Action title="举报此内容" disabled={busy} onPress={report} />
      )}
    </View>
  );
}
function Composer({
  main,
  busy,
  send,
}: {
  main: boolean;
  busy: boolean;
  send: (body: string, key: string) => void;
}) {
  const s = useStyles(stylesFor),
    [body, setBody] = useState('');
  const pending = useRef<{ body: string; key: string } | null>(null);
  return (
    <View style={s.card}>
      <Text style={s.heading}>{main ? '写一条主评' : '继续私密回复'}</Text>
      <TextInput
        accessibilityLabel={main ? '主评内容' : '回复内容'}
        value={body}
        multiline
        maxLength={2000}
        editable={!busy}
        onChangeText={setBody}
        style={[s.input, { minHeight: 120, textAlignVertical: 'top' }]}
      />
      <Text style={s.small}>{body.length}/2000 · 离开页面不保留草稿</Text>
      <Action
        title={main ? '发送主评' : '发送回复'}
        primary
        disabled={busy || !body.trim()}
        onPress={() => {
          const text = body.trim();
          if (pending.current?.body !== text)
            pending.current = { body: text, key: messageKey() };
          send(text, pending.current.key);
        }}
      />
    </View>
  );
}
export default function SocialReviewThreadScreen({
  route,
  navigation,
}: {
  route: any;
  navigation: any;
}) {
  const api = useSocialApi(),
    s = useStyles(stylesFor),
    id: number = route.params.threadId;
  const messageId: number | undefined = route.params.messageId;
  const [page, setPage] = useState<number | null>(null);
  const r = useSocialResource(
    useCallback(
      () => api.review(id, page ?? 1, page === null ? messageId : undefined),
      [api, id, page, messageId],
    ),
  );
  const d = r.value;
  return (
    <Page>
      <Status {...r} />
      {d && (
        <>
          <Text style={s.title}>
            与{d.otherPerson?.nickname || '对方'}的私密对话
          </Text>
          <Text selectable style={s.small}>
            {d.otherPerson?.id}
          </Text>
          <Text style={s.muted}>
            本页只有账单主人和这位评价者可见。其他评价者不能查看。
          </Text>
          <BillSnapshot bill={d.snapshot} />
          <Text style={s.heading}>
            {d.isOwner ? '对方的票' : '我的票'}：{voteLabels[d.vote]}
          </Text>
          {d.deleted && (
            <Text style={s.muted}>原账单已删除，以下为只读存档。</Text>
          )}
          {d.billModified && (
            <Text style={s.muted}>
              账单已修改；显示当前字段或删除前最后快照，原投票保留。
            </Text>
          )}
          {!d.canWrite && (
            <Text style={s.muted}>当前不可互动，可查看保留的历史内容。</Text>
          )}
          {d.mainWithdrawn && (
            <Text style={s.muted}>
              主评已撤回，对话暂停。作者恢复主评后可继续回复。
            </Text>
          )}
          {!d.isOwner && d.canWrite && (
            <View style={s.chipRow}>
              {(['hang', 'la'] as const).map(v => (
                <Action
                  key={v}
                  title={voteLabels[v]}
                  primary={d.vote === v}
                  disabled={r.busy}
                  onPress={() => {
                    void r.run(() => api.vote(d.originalBillId, v));
                  }}
                />
              ))}
            </View>
          )}
          {!d.hasMain && (
            <Text style={s.muted}>
              {d.isOwner ? '评价者尚未填写主评。' : '你还没有填写主评。'}
            </Text>
          )}
          {d.messages.map(m => (
            <MessageCard
              key={`${m.id}:${m.revision}`}
              message={m}
              detail={d}
              busy={r.busy}
              change={(action, body) => {
                void r.run(() =>
                  api.changeReview(id, m.id, m.revision, action, body),
                );
              }}
              report={() =>
                navigation.navigate('SocialReport', {
                  threadId: id,
                  messageId: m.id,
                })
              }
              versions={() =>
                navigation.navigate('SocialReviewVersions', {
                  threadId: id,
                  messageId: m.id,
                })
              }
            />
          ))}
          {d.readReceipt && (
            <Action
              title={`将本页 ${d.unreadOnPage} 条文字标为已读`}
              disabled={r.busy}
              onPress={() => {
                void r.run(() => api.readInbox(d.readReceipt!));
              }}
            />
          )}
          <Pager
            page={d.pageNumber}
            hasNext={d.messages.length === 20}
            change={setPage}
          />
          {d.canWrite && !d.mainWithdrawn && (d.hasMain || !d.isOwner) && (
            <Composer
              main={!d.hasMain}
              busy={r.busy}
              send={(body, key) => {
                void r.run(() => api.sendReview(id, !d.hasMain, body, key));
              }}
            />
          )}
          <Action title="刷新对话" disabled={r.busy} onPress={r.refresh} />
        </>
      )}
    </Page>
  );
}
