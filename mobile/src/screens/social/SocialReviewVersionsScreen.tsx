import React, { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useStyles } from '../../hooks/useStyles';
import {
  Page,
  Status,
  stylesFor,
  useSocialApi,
  useSocialResource,
} from './shared';
import { Pager } from './reviewShared';
export default function SocialReviewVersionsScreen({ route }: { route: any }) {
  const api = useSocialApi(),
    s = useStyles(stylesFor),
    { threadId, messageId } = route.params;
  const [page, setPage] = useState(1);
  const r = useSocialResource(
    useCallback(
      () => api.reviewVersions(threadId, messageId, page),
      [api, threadId, messageId, page],
    ),
  );
  const labels: Record<string, string> = {
    create: '创建',
    edit: '编辑',
    withdraw: '撤回',
    restore: '恢复',
  };
  return (
    <Page>
      <Text style={s.title}>文字历史版本</Text>
      <Text style={s.muted}>
        这是历史记录，可能与当前内容不同。违规隐藏内容不提供历史查看。
      </Text>
      <Status {...r} />
      {r.value?.map(v => (
        <View style={s.card} key={v.revision}>
          <Text style={s.heading}>
            版本 {v.revision} · {labels[v.action] || '更新'}
          </Text>
          <Text style={s.small}>
            {new Date(v.createdAt).toLocaleString()}
            {v.withdrawn ? ' · 当时已撤回' : ''}
          </Text>
          <Text selectable style={s.text}>
            {v.body}
          </Text>
        </View>
      ))}
      {r.value && (
        <Pager page={page} hasNext={r.value.length === 20} change={setPage} />
      )}
    </Page>
  );
}
