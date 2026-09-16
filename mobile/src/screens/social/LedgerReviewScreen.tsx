import React, { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useStyles } from '../../hooks/useStyles';
import { Action, Page, Status, stylesFor, useSocialResource } from './shared';
import { Pager } from './reviewShared';
import { moneyText, useRankingApi } from './rankingShared';
import {
  currentRankingPeriod,
  rankingDates,
} from '../../services/api/rankings';

export default function LedgerReviewScreen({
  route,
  navigation,
}: {
  route: any;
  navigation: any;
}) {
  const api = useRankingApi(),
    s = useStyles(stylesFor);
  const { startDate, endDate } =
    route.params || rankingDates('month', currentRankingPeriod('month'));
  const [cursors, setCursors] = useState([0]),
    cursor = cursors[cursors.length - 1];
  const r = useSocialResource(
    useCallback(async () => {
      const [summary, pending] = await Promise.all([
        api.summary(startDate, endDate),
        api.pending(startDate, endDate, cursor),
      ]);
      return { summary, pending };
    }, [api, startDate, endDate, cursor]),
  );
  return (
    <Page>
      <Text style={s.title}>确认账务口径</Text>
      <Text style={s.muted}>
        {startDate} 至 {endDate} · 人民币
      </Text>
      <Text style={s.muted}>
        区分真实收支、退款和转账，避免充值或优惠券被计入结余。账单内容修改后需要重新确认。
      </Text>
      <Status {...r} />
      {r.value && (
        <>
          <View style={s.card}>
            <Text style={s.heading}>
              待确认 {r.value.summary.counts.needsReview} 笔
            </Text>
            <Text style={s.text}>
              {r.value.summary.complete ? '期间有效结余' : '已确认部分结余'} ¥
              {moneyText(r.value.summary.cashSurplus)}
            </Text>
            <Text style={s.muted}>
              有效 {r.value.summary.counts.included} 笔 · 转账{' '}
              {r.value.summary.counts.internalTransfer} 笔 · 调账{' '}
              {r.value.summary.counts.adjustment} 笔 · 忽略{' '}
              {r.value.summary.counts.ignored} 笔
            </Text>
            {!r.value.summary.complete && (
              <Text style={s.muted}>
                待确认处理完之前，不使用这部分金额参榜。
              </Text>
            )}
          </View>
          {r.value.pending.items.map(item => (
            <View style={s.card} key={item.id}>
              <Text style={s.heading}>
                {item.type === 'income' ? '收入' : '支出'} ¥
                {moneyText(item.amount)}
              </Text>
              <Text style={s.text}>
                {item.description || item.category || '未填写说明'}
              </Text>
              <Text style={s.muted}>
                {item.date} · {item.category || '未分类'}
              </Text>
              <Action
                title="核对并确认"
                primary
                onPress={() =>
                  navigation.navigate('LedgerClassification', {
                    billId: item.id,
                  })
                }
              />
            </View>
          ))}
          {r.value.pending.items.length === 0 && (
            <Text style={s.text}>
              {r.value.summary.complete
                ? '本期账务已全部确认。'
                : '当前页没有待确认账单，可返回第一页检查。'}
            </Text>
          )}
          <Pager
            page={cursors.length}
            hasNext={r.value.pending.hasMore}
            change={value =>
              setCursors(
                value < cursors.length
                  ? cursors.slice(0, -1)
                  : [...cursors, r.value!.pending.nextAfterId],
              )
            }
          />
          <Action
            title="从第一页重新检查"
            onPress={() => {
              setCursors([0]);
              if (cursor === 0) void r.refresh();
            }}
          />
        </>
      )}
    </Page>
  );
}
