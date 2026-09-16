import React from 'react';
import { Text, View } from 'react-native';
import { SharedBill } from '../../services/api/social';
import { useStyles } from '../../hooks/useStyles';
import { Action, stylesFor } from './shared';
export const voteLabels = { hang: '夯 · 值得', la: '拉 · 可再想想' };
export function BillSnapshot({ bill }: { bill: SharedBill }) {
  const s = useStyles(stylesFor);
  return (
    <View style={s.card}>
      <Text style={s.heading}>
        {bill.type === 'income' ? '收入' : '支出'} ¥{bill.amount}
      </Text>
      <Text style={s.text}>{bill.category || '未分类'}</Text>
      <Text style={s.muted}>
        {bill.date}
        {bill.time ? ' ' + new Date(bill.time).toLocaleTimeString() : ''}
      </Text>
    </View>
  );
}
export function Pager({
  page,
  hasNext,
  change,
}: {
  page: number;
  hasNext: boolean;
  change: (value: number) => void;
}) {
  const s = useStyles(stylesFor);
  return (
    <View style={s.row}>
      <View style={s.grow}>
        <Action
          title="上一页"
          disabled={page === 1}
          onPress={() => change(page - 1)}
        />
      </View>
      <Text style={s.text}>{page}</Text>
      <View style={s.grow}>
        <Action
          title="下一页"
          disabled={!hasNext}
          onPress={() => change(page + 1)}
        />
      </View>
    </View>
  );
}
// A deduplication identifier, never used as an authentication token.
export function messageKey() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}
