import React, { useCallback, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useStyles } from '../../hooks/useStyles';
import {
  REPORT_DISCLOSURE_VERSION,
  ReviewMessage,
} from '../../services/api/social';
import {
  Action,
  Consent,
  Page,
  Status,
  stylesFor,
  useSocialApi,
  useSocialResource,
} from './shared';
function Form({
  message,
  busy,
  submit,
}: {
  message: ReviewMessage;
  busy: boolean;
  submit: (reason: string) => void;
}) {
  const s = useStyles(stylesFor),
    [reason, setReason] = useState(''),
    [accepted, setAccepted] = useState(false);
  return (
    <>
      <View style={s.card}>
        <Text style={s.heading}>举报目标 · 版本 {message.revision}</Text>
        <Text selectable style={s.text}>
          {message.withdrawn
            ? '作者已撤回此文字；审核可查看留存版本。'
            : message.body}
        </Text>
      </View>
      <View style={s.card}>
        <Text style={s.heading}>管理员会查看什么</Text>
        <Text style={s.text}>
          提交后，会向管理员披露这位账单主人与这位评价者之间的整条私密对话，包括双方全部文字、撤回内容和历史版本，不只是上面这一条。
        </Text>
        <Text style={s.muted}>
          不会披露其他评价者的对话、账单备注或原始通知。审核证据单独留存，不随撤回文字、删除账单或账号自动删除。
        </Text>
        <Text style={s.muted}>
          举报不代表已经认定违规。管理员处理后，你可以在“我的举报”中查看结论。
        </Text>
      </View>
      <Text style={s.heading}>举报原因</Text>
      <TextInput
        accessibilityLabel="举报原因"
        multiline
        maxLength={1000}
        value={reason}
        editable={!busy}
        onChangeText={setReason}
        style={[s.input, { minHeight: 120, textAlignVertical: 'top' }]}
      />
      <Text style={s.small}>{reason.length}/1000 · 离开不保留草稿</Text>
      <Consent
        checked={accepted}
        onChange={v => {
          if (!busy) setAccepted(v);
        }}
        text="我了解并同意向管理员披露本线程及全部历史文字版本"
      />
      <Action
        title={busy ? '正在提交…' : '确认披露并提交举报'}
        primary
        disabled={busy || !accepted || !reason.trim()}
        onPress={() => submit(reason.trim())}
      />
    </>
  );
}
export default function SocialReportScreen({
  route,
  navigation,
}: {
  route: any;
  navigation: any;
}) {
  const api = useSocialApi(),
    s = useStyles(stylesFor),
    { threadId, messageId } = route.params;
  const [submitted, setSubmitted] = useState<number | null>(null);
  const r = useSocialResource(
    useCallback(
      () => api.reportPreview(threadId, messageId),
      [api, threadId, messageId],
    ),
  );
  return (
    <Page>
      <Text style={s.title}>举报前确认披露范围</Text>
      {submitted ? (
        <View style={s.card}>
          <Text style={s.heading}>举报已提交 · 编号 {submitted}</Text>
          <Text style={s.muted}>
            同一版本重复提交会返回已有记录。可在我的举报中查看当前状态。
          </Text>
          <Action
            title="查看我的举报"
            primary
            onPress={() => navigation.navigate('SocialReports')}
          />
        </View>
      ) : (
        <>
          <Status {...r} />
          {r.value &&
            (r.value.disclosureVersion === REPORT_DISCLOSURE_VERSION ? (
              <Form
                message={r.value.message}
                busy={r.busy}
                submit={reason => {
                  let reportId: number;
                  void r.run(
                    async () => {
                      reportId = (
                        await api.reportReview(
                          threadId,
                          messageId,
                          r.value!.message.revision,
                          reason,
                        )
                      ).id;
                    },
                    () => setSubmitted(reportId),
                  );
                }}
              />
            ) : (
              <Text style={s.error}>举报说明已更新，请升级客户端后提交。</Text>
            ))}
        </>
      )}
    </Page>
  );
}
