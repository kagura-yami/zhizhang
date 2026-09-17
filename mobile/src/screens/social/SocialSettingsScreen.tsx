import React, { useCallback, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import {
  SOCIAL_CONSENT_VERSION,
  SocialPreferences,
} from '../../services/api/social';
import { useAlert, useAuth } from '../../providers';
import { saveCommunityState } from '../../services/communityState';
import { useStyles } from '../../hooks/useStyles';
import {
  Action,
  Consent,
  Page,
  Status,
  stylesFor,
  useSocialApi,
  useSocialResource,
} from './shared';

export default function SocialSettingsScreen({
  navigation,
  onEnabled,
  privacy = false,
}: {
  navigation: any;
  onEnabled?: () => void;
  privacy?: boolean;
}) {
  const api = useSocialApi();
  const s = useStyles(stylesFor),
    { confirm } = useAlert(),
    { user } = useAuth();
  const [accepted, setAccepted] = useState(false);
  const resource = useSocialResource(useCallback(() => api.status(), [api]));
  const status = resource.value;
  const update = (
    key: keyof SocialPreferences,
    value: boolean,
    disclosure: string,
  ) => {
    const save = () => {
      void resource.run(() => api.preferences({ [key]: value }));
    };
    if (value)
      confirm('确认隐私设置', disclosure, save, undefined, {
        confirmText: '确认开启',
      });
    else save();
  };
  return (
    <Page>
      <Text style={s.title}>{privacy ? '社群隐私' : '启用社群'}</Text>
      <Text style={s.muted}>
        {privacy ? '关注不等于授权。你可以按人选择允许评价的账单范围，并随时撤销。' : '社群是可选扩展，关闭不影响普通记账。互动和排行榜位于底部社群栏目；隐私选项可在设置中管理。'}
      </Text>
      <Status {...resource} />
      {status && !status.enabled && (
        <View style={s.card}>
          <Text style={s.heading}>启用社群前，请先了解</Text>
          <Text style={s.text}>
            启用后，其他已启用社群的用户可以通过昵称或完整用户 ID
            找到你，看到昵称、头像和用户 ID。
          </Text>
          <Text style={s.text}>
            账单仍然私密；只有你明确授权的人能看到收支类型、金额、分类和时间。不同评价者的文字对话相互隔离。
          </Text>
          <Text style={s.text}>
            日常账单会自动参与社群排行榜，无需逐笔确认；默认隐藏具体结余金额。
            不公开关系名单，也不允许将好友文字用于 AI 复盘。你可以随时关闭社群，普通记账不受影响。
          </Text>
          <Consent
            checked={accepted}
            onChange={setAccepted}
            text="我已了解社群可见范围，愿意启用"
          />
          {status.requiredConsentVersion !== SOCIAL_CONSENT_VERSION && (
            <Text style={s.error}>社群说明已更新，请先升级客户端。</Text>
          )}
          <Action
            title={resource.busy ? '正在启用…' : '启用社群'}
            primary
            disabled={
              !accepted ||
              resource.busy ||
              status.requiredConsentVersion !== SOCIAL_CONSENT_VERSION
            }
            onPress={() => {
              void resource.run(async () => { await api.enable(); if (user?.id) await saveCommunityState(user.id, true); }, () => { void resource.refresh(); onEnabled?.(); });
            }}
          />
        </View>
      )}
      {status?.enabled && status.preference && (
        <>
          {!privacy && <View style={s.card}>
            <View style={s.row}>
              <Text style={[s.heading, s.grow]}>启用社群</Text>
              <Switch accessibilityLabel="启用社群" value disabled={resource.busy} onValueChange={() => confirm('关闭社群', '将退出排行榜并撤销评账授权和关注关系。你的账单、收支统计和自动记账继续保留。再次开启需重新授权。', () => { void resource.run(async () => { await api.disable(); if (user?.id) await saveCommunityState(user.id, false); }, () => { setAccepted(false); void resource.refresh(); }); })} />
            </View>
            <Text style={s.muted}>社群是可选扩展，不影响日常记账。</Text>
          </View>}
          {privacy && <><View style={s.card}>
            <Text style={s.heading}>我的用户 ID</Text>
            <Text selectable style={s.small}>
              {user?.id}
            </Text>
            <Text style={s.muted}>昵称可能重名；添加关系时请核对完整 ID。</Text>
          </View>
          <View style={s.card}>
            <Text style={s.heading}>隐私设置</Text>
            {(
              [
                [
                  'publicRelations',
                  '公开关系名单',
                  '其他用户可以查看你的关注、粉丝和好友名单。',
                ],
                [
                  'allowAiFeedback',
                  '我的复盘使用收到的评价',
                  '仅使用作者另行同意的评价和投票，发送给你选择的 AI 服务。关闭后，涉及这些反馈的旧复盘会失效。',
                ],
                [
                  'allowAiAuthoredFeedback',
                  '允许我的评价用于对方 AI 复盘',
                  '你写的评价、回复和投票可发送给账单主人选择的 AI 服务。关闭后，相关旧复盘失效；已经发送给模型的内容无法收回。',
                ],
                [
                  'notificationPreview',
                  '系统通知显示内容预览',
                  '锁屏等系统通知可能展示金额、分类或私密文字。请确认设备使用环境。',
                ],
              ] as const
            ).map(([key, title, description]) => (
              <View key={key}>
                <View style={s.row}>
                  <Text style={[s.text, s.grow]}>{title}</Text>
                  <Switch
                    accessibilityLabel={title}
                    disabled={resource.busy}
                    value={!!status.preference![key]}
                    onValueChange={value => update(key, value, description)}
                  />
                </View>
                <Text style={s.muted}>{description}</Text>
              </View>
            ))}
          </View>
          </>}
        </>
      )}
    </Page>
  );
}

export function SocialPrivacyScreen(props: { navigation: any }) {
  return <SocialSettingsScreen {...props} privacy />;
}
