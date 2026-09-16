import React, { useCallback, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import {
  SOCIAL_CONSENT_VERSION,
  SocialPreferences,
} from '../../services/api/social';
import { useAlert, useAuth } from '../../providers';
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
}: {
  navigation: any;
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
      <Text style={s.title}>分享之前，由你决定</Text>
      <Text style={s.muted}>
        关注不等于授权。你可以按人选择允许评价的账单范围，并随时撤销。
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
            默认不参加排行榜、不公开关系名单，也不允许将好友文字用于 AI
            复盘。授权不涉及银行或支付账户。
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
              void resource.run(api.enable);
            }}
          />
        </View>
      )}
      {status?.enabled && status.preference && (
        <>
          <View style={s.card}>
            <Text style={s.heading}>我的用户 ID</Text>
            <Text selectable style={s.small}>
              {user?.id}
            </Text>
            <Text style={s.muted}>昵称可能重名；添加关系时请核对完整 ID。</Text>
            <Action
              primary
              title="查找用户与管理关系"
              onPress={() => navigation.navigate('SocialPeople')}
            />
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
                  '允许好友文字用于 AI 复盘',
                  '你的复盘可使用你有权读取的好友评价；相关文字可能发送给你配置的 AI 服务。',
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
                    value={status.preference![key]}
                    onValueChange={value => update(key, value, description)}
                  />
                </View>
                <Text style={s.muted}>{description}</Text>
              </View>
            ))}
          </View>
          <Action
            title="我的举报"
            onPress={() => navigation.navigate('SocialReports')}
          />
          <Action
            title="收到的评账"
            onPress={() => navigation.navigate('SocialReceivedReviews')}
          />
          <Action
            title="评账申请"
            onPress={() => navigation.navigate('SocialRequests')}
          />
          <Action
            title="管理已拉黑用户"
            onPress={() =>
              navigation.navigate('SocialPeople', { mode: 'blocks' })
            }
          />
        </>
      )}
    </Page>
  );
}
