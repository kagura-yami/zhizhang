import React, { useCallback, useState } from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';
import { useStyles } from '../../hooks/useStyles';
import {
  currentRankingPeriod,
  RankingKind,
  RankingScope,
  rankingDates,
} from '../../services/api/rankings';
import { Action, Page, Status, stylesFor, useSocialResource } from './shared';
import { Pager } from './reviewShared';
import { kindLabels, moneyText, useRankingApi } from './rankingShared';

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
      <View style={s.row}>
        <Text style={[s.title, s.grow]}>结余排行榜</Text>
        <Action
          title="参榜设置"
          onPress={() => navigation.navigate('SocialRankingSettings')}
        />
      </View>
      <Text style={s.muted}>
        期间有效收入及退款 − 支出。不是资产、银行余额或真实财富认证。
      </Text>
      <View style={s.row}>
        {(['global', 'friends'] as const).map(value => (
          <View style={s.grow} key={value}>
            <Action
              title={value === 'global' ? '全站' : '仅好友'}
              primary={scope === value}
              onPress={() => {
                setScope(value);
                setPage(1);
              }}
            />
          </View>
        ))}
      </View>
      <View style={s.row}>
        {(['day', 'month', 'year'] as const).map(value => (
          <View style={s.grow} key={value}>
            <Action
              title={kindLabels[value]}
              primary={kind === value}
              onPress={() => {
                setKind(value);
                setPeriod(currentRankingPeriod(value));
                setPage(1);
                setPeriodPage(1);
                setChoosing(false);
              }}
            />
          </View>
        ))}
      </View>
      <Action
        title={`${period} · 选择周期 ▾`}
        onPress={() => setChoosing(!choosing)}
      />
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
          <View style={s.card}>
            <Text style={s.heading}>
              {result.closed ? '已封榜 · 金额不再重算' : '进行中 · 随账本更新'}
            </Text>
            {result.mine ? (
              <>
                <Text style={s.title}>我的名次 #{result.mine.rank}</Text>
                <Text style={s.text}>
                  ¥{moneyText(result.mine.amount!)} · 有效记账{' '}
                  {result.mine.effectiveDays} 天
                </Text>
                <Action
                  title="定位我的名次"
                  disabled={page === result.myPage}
                  onPress={() => setPage(result.myPage!)}
                />
              </>
            ) : (
              <Text style={s.text}>
                {explanations[result.mineStatus] || '本周期暂无你的名次。'}
              </Text>
            )}

          </View>
          <View style={s.row}>
            <Text style={[s.muted, s.grow]}>
              {result.total} 人参与 · 同额按记账天数排序
            </Text>
            <Action title="刷新" onPress={r.refresh} />
          </View>
          {result.items.map(item => (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`第${item.rank}名，${
                item.user.nickname || '未设置昵称'
              }，查看资料`}
              key={item.user.id}
              style={[s.card, s.row]}
              onPress={() =>
                navigation.navigate('SocialPerson', { userId: item.user.id })
              }
            >
              <Text style={s.heading}>#{item.rank}</Text>
              {item.user.avatar ? (
                <Image
                  source={{ uri: item.user.avatar }}
                  style={{ width: 36, height: 36, borderRadius: 18 }}
                />
              ) : null}
              <View style={s.grow}>
                <Text style={s.heading}>
                  {item.user.nickname || '未设置昵称'}
                </Text>
                <Text style={s.muted}>有效记账 {item.effectiveDays} 天</Text>
                <Text style={s.text}>
                  {item.amount === null
                    ? '金额已隐藏'
                    : `¥${moneyText(item.amount)}`}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
          {result.items.length === 0 && (
            <Text style={s.muted}>当前页暂无参与者。切换周期或范围查看。</Text>
          )}
          <Pager
            page={page}
            hasNext={page * 20 < result.total}
            change={setPage}
          />
          <Text style={s.small}>
            好友榜按当前互关关系显示。查看资料不会公开对方账单；同额且有效天数相同为并列。
          </Text>
        </>
      )}
    </Page>
  );
}
