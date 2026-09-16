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
export default function SocialReportsScreen() {
  const api = useSocialApi(),
    s = useStyles(stylesFor),
    [page, setPage] = useState(1);
  const r = useSocialResource(
    useCallback(() => api.reports(page), [api, page]),
  );
  const labels = {
    pending: '待审核',
    upheld: '举报成立',
    dismissed: '未认定违规',
  };
  return (
    <Page>
      <Text style={s.title}>我的举报</Text>
      <Text style={s.muted}>
        这里只显示你提交的举报与处理结果，不展示审核证据。
      </Text>
      <Status {...r} />
      {r.value?.map(row => (
        <View key={row.id} style={s.card}>
          <Text style={s.heading}>
            #{row.id} · {labels[row.status]}
          </Text>
          <Text style={s.small}>
            文字 #{row.originalMessageId} · 版本 {row.reportedRevision}
            {'\n'}
            {new Date(row.createdAt).toLocaleString()}
          </Text>
          <Text selectable style={s.text}>
            原因：{row.reason}
          </Text>
          {row.decisionReason && (
            <Text selectable style={s.text}>
              处理说明：{row.decisionReason}
            </Text>
          )}
          {row.decidedAt && (
            <Text style={s.small}>
              处理时间：{new Date(row.decidedAt).toLocaleString()}
            </Text>
          )}
        </View>
      ))}
      {r.value?.length === 0 && <Text style={s.muted}>暂无举报记录。</Text>}
      {r.value && (
        <Pager page={page} hasNext={r.value.length === 20} change={setPage} />
      )}
      <Action
        title="刷新处理状态"
        disabled={r.busy || r.loading}
        onPress={r.refresh}
      />
    </Page>
  );
}
