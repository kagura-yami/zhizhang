import React, { useCallback, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useStyles } from '../../hooks/useStyles';
import {
  currentRankingPeriod,
  RankingKind,
  RankingScope,
} from '../../services/api/rankings';
import { Action, Page, Status, stylesFor, useSocialResource } from './shared';
import SocialAvatar from './SocialAvatar';
import { Pager } from './reviewShared';
import { kindLabels, moneyText, useRankingApi } from './rankingShared';

const amountText = (amount: string) => { const value = moneyText(amount); return value.startsWith('-') ? `-¥${value.slice(1)}` : `¥${value}`; };

const explanations: Record<string, string> = {
  not_participating: '你尚未参加排行榜。可先查看规则，再决定是否参与。',
  friends_only: '你选择了仅好友参榜，可切换到好友榜查看自己的名次。',
  no_period_record: '本周期没有你的参榜记录；退出后重新加入不会恢复旧榜。',
  needs_review: '存在无法计算的异常数据，请编辑对应账单。',
  no_valid_entries: '本周期没有有效收支账单。只有转账、调账或误记时不上榜。',
};
export default function SocialRankingsScreen({
  navigation,
}: {
  navigation: any;
}) {
  const api = useRankingApi(),
    s = useStyles(stylesFor);
  const [kind, setKind] = useState<RankingKind>('month'),
    [period, setPeriod] = useState(currentRankingPeriod('month'));
  const [scope, setScope] = useState<RankingScope>('global'),
    [page, setPage] = useState(1);
  const [choosing, setChoosing] = useState(false),
    [periodPage, setPeriodPage] = useState(1);
  const periods = useSocialResource(
    useCallback(() => api.periods(kind, periodPage), [api, kind, periodPage]),
  );
  const r = useSocialResource(
    useCallback(
      () => api.ranking(kind, period, scope, page),
      [api, kind, period, scope, page],
    ),
  );
  const result = r.value;
  return (
    <Page>
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <View style={[s.tabs, { flex: 1 }]}>
          {(['global', 'friends'] as const).map(value => <TouchableOpacity key={value} accessibilityRole="tab" accessibilityState={{ selected: scope === value }} style={[s.tab, scope === value && s.tabActive]} onPress={() => { setScope(value); setPage(1); }}>
            <Text style={[s.buttonText, scope === value && s.primaryText]}>{value === 'global' ? '总榜' : '好友榜'}</Text>
          </TouchableOpacity>)}
        </View>
        <TouchableOpacity accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => navigation.navigate('SocialRankingSettings')}><Text style={s.muted}>参榜设置</Text></TouchableOpacity>
      </View>
      <View style={[s.row, { gap: 4, flexWrap: 'wrap' }]}>
        {(['day', 'month', 'year'] as const).map(value => <TouchableOpacity key={value} accessibilityRole="tab" accessibilityState={{ selected: kind === value }} style={[s.tab, { flexGrow: 0, flexShrink: 0, flexBasis: 46, minWidth: 46, paddingHorizontal: 6 }, kind === value && s.tabActive]} onPress={() => { setKind(value); setPeriod(currentRankingPeriod(value)); setPage(1); setPeriodPage(1); setChoosing(false); }}>
          <Text style={[s.buttonText, { fontSize: 14 }, kind === value && s.primaryText]}>{kindLabels[value]}</Text>
        </TouchableOpacity>)}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="选择排行周期" style={{ marginLeft: 'auto', minHeight: 44, justifyContent: 'center' }} onPress={() => setChoosing(!choosing)}><Text style={s.muted}>{period} ▾</Text></TouchableOpacity>
      </View>
      {choosing && (
        <View style={s.card}>
          <Text style={s.heading}>选择周期 · 北京时间</Text>
          <Status {...periods} />
          {periods.value?.items.map(item => (
            <Action
              key={item.period}
              title={`${item.period} · ${item.closed ? '已封榜' : '进行中'}`}
              primary={item.period === period}
              onPress={() => {
                setPeriod(item.period);
                setPage(1);
                setChoosing(false);
              }}
            />
          ))}
          <Pager
            page={periodPage}
            hasNext={periodPage * 12 < (periods.value?.total ?? 0)}
            change={setPeriodPage}
          />
        </View>
      )}
      <Status {...r} />
      {result && (
        <>
          <View style={[s.card, { padding: 14, gap: 6 }]}>
            <View style={[s.row, { minHeight: 32 }]}>
              <Text style={[s.heading, s.grow]}>{result.mine ? `我的名次 #${result.mine.rank}` : '我的排名'}</Text>
              <Text style={s.small}>{result.closed ? '已封榜' : '实时更新'}</Text>
            </View>
            {result.mine ? <View style={[s.row, { minHeight: 28 }]}>
              <Text style={[s.muted, s.grow]}>{result.mine.amount === null ? '金额已隐藏' : amountText(result.mine.amount)} · 记账 {result.mine.effectiveDays} 天</Text>
              {result.myPage !== null && page !== result.myPage && <TouchableOpacity accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => setPage(result.myPage!)}><Text style={s.buttonText}>定位 ›</Text></TouchableOpacity>}
            </View> : <Text style={s.muted}>{explanations[result.mineStatus] || '本周期暂无你的名次。'}</Text>}
          </View>
          <View style={[s.row, { minHeight: 32 }]}>
            <Text style={[s.heading, s.grow]}>结余排行 <Text style={s.small}>{result.total} 人</Text></Text>
            <TouchableOpacity accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center' }} onPress={r.refresh}><Text style={s.muted}>刷新</Text></TouchableOpacity>
          </View>
          <View style={[s.card, { padding: 0, gap: 0, overflow: 'hidden' }]}>
          {result.items.map((item, index) => (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`第${item.rank}名，${item.user.nickname || '未设置昵称'}，查看资料`} key={item.user.id}
              style={[s.row, { paddingVertical: 16, paddingHorizontal: 12, gap: 10, borderTopWidth: index ? 1 : 0, borderColor: s.card.borderColor }]}
              onPress={() => navigation.navigate('SocialPerson', { userId: item.user.id })}>
              <Text style={[s.heading, { width: 26, textAlign: 'center', fontSize: 16 }]}>{item.rank}</Text>
              <SocialAvatar avatar={item.user.avatar} nickname={item.user.nickname} />
              <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
                <Text numberOfLines={1} style={[s.heading, { fontSize: 16 }]}>{item.user.nickname || '未设置昵称'}</Text>
                <Text style={s.small}>记账 {item.effectiveDays} 天</Text>
                <Text style={[s.heading, { fontSize: 16 }]}>{item.amount === null ? '金额已隐藏' : amountText(item.amount)}</Text>
              </View>
              <Text style={s.muted}>›</Text>
            </TouchableOpacity>
          ))}
          </View>
          {result.items.length === 0 && (
            <Text style={s.muted}>当前页暂无参与者。切换周期或范围查看。</Text>
          )}
          {result.total > 20 && <Pager
            page={page}
            hasNext={page * 20 < result.total}
            change={setPage}
          />}
          <Text style={s.small}>
            结余 = 有效收入 + 退款 − 支出。仅反映本期记账收支，不代表资产。相同结余按记账天数排序；点击头像或昵称查看用户资料。
          </Text>
        </>
      )}
    </Page>
  );
}
