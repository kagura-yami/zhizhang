import React, { useCallback } from 'react';
import { Switch, Text, View } from 'react-native';
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
import { scopeLabels } from './rankingShared';

export default function SocialRankingSettingsScreen() {
  const api = useSocialApi(),
    s = useStyles(stylesFor),
    { confirm } = useAlert();
  const r = useSocialResource(useCallback(() => api.status(), [api]));
  const pref = r.value?.preference;
  function scope(value: 'none' | 'friends' | 'global') {
    if (value === pref?.rankingScope) return;
    confirm(
      value === 'none' ? '退出排行榜' : `参与${scopeLabels[value]}排行`,
      value === 'none'
        ? '退出后，你将从当前及历史榜移除。以后重新参加也不会恢复过去已结束周期的记录。'
        : '排名与记账天数将对所选范围可见，包含当前日、月、年内已有的有效账单。隐藏金额仍可能通过名次推测相对结余。参榜不会公开账单明细。',
      () => {
        void r.run(() => api.preferences({ rankingScope: value }));
      },
      undefined,
      { confirmText: value === 'none' ? '确认退出' : '确认参与' },
    );
  }
  return (
    <Page>
      <Text style={s.title}>你的结余，由你决定可见范围</Text>
      <Text style={s.muted}>
        默认不参与，默认隐藏金额。设置也适用于历史榜。
      </Text>
      <Status {...r} />
      {pref && (
        <>
          <View style={s.card}>
            <Text style={s.heading}>
              参榜范围 · {scopeLabels[pref.rankingScope]}
            </Text>
            {(['none', 'friends', 'global'] as const).map(value => (
              <Action
                key={value}
                title={scopeLabels[value]}
                primary={pref.rankingScope === value}
                disabled={r.busy}
                onPress={() => scope(value)}
              />
            ))}
          </View>
          <View style={s.card}>
            <View style={s.row}>
              <Text style={[s.heading, s.grow]}>公开准确结余</Text>
              <Switch
                accessibilityLabel="公开准确结余"
                disabled={r.busy}
                value={pref.showRankingAmount}
                onValueChange={value => {
                  const save = () => {
                    void r.run(() =>
                      api.preferences({ showRankingAmount: value }),
                    );
                  };
                  if (value)
                    confirm(
                      '公开准确结余',
                      '其他人将能在你参与的当前与历史榜中看到准确结余金额。确认公开？',
                      save,
                      undefined,
                      { confirmText: '确认公开' },
                    );
                  else save();
                }}
              />
            </View>
            <Text style={s.muted}>
              关闭后，所有其他用户（包括互关好友）都看不到金额；你仍可查看自己的金额，名次仍可见。
            </Text>
          </View>
          <Text style={s.muted}>
            结余是期间有效收入及退款减支出，不是资产、银行余额或财富认证。封榜数据不会因后续改账重算。
          </Text>
        </>
      )}
    </Page>
  );
}
