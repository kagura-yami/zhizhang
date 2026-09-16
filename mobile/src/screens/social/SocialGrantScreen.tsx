import React, { useCallback, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { ReviewGrant, SocialPerson } from '../../services/api/social';
import { billsService } from '../../services/api/bills';
import type { BillData } from '../../types/bill';
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

interface GrantData {
  person: SocialPerson;
  grant: ReviewGrant | null;
  sample?: BillData;
}
function GrantForm({
  data,
  busy,
  save,
}: {
  data: GrantData;
  busy: boolean;
  save: (scope: ReviewGrant['scope'], date?: string) => void;
}) {
  const s = useStyles(stylesFor);
  const [scope, setScope] = useState<ReviewGrant['scope']>(
    data.grant?.scope || 'expense',
  );
  const [history, setHistory] = useState(!!data.grant?.historyStart),
    [date, setDate] = useState(data.grant?.historyStart?.slice(0, 10) || '');
  const [accepted, setAccepted] = useState(false);
  const parsed = new Date(date + 'T00:00:00Z');
  const dateValid =
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date;
  return (
    <>
      <View style={s.card}>
        <Text style={s.heading}>允许谁查看</Text>
        <Text style={s.text}>{data.person.nickname || '未设置昵称'}</Text>
        <Text selectable style={s.small}>
          {data.person.id}
        </Text>
        <Text style={s.muted}>
          请核对 ID。此授权是单向的，不会自动获得对方的账单权限。
        </Text>
      </View>
      <View style={s.card}>
        <Text style={s.heading}>允许查看哪些账单</Text>
        <View style={s.chipRow}>
          {(
            [
              ['expense', '仅支出'],
              ['income', '仅收入'],
              ['both', '收入与支出'],
            ] as const
          ).map(([key, label]) => (
            <Action
              key={key}
              title={label}
              primary={scope === key}
              disabled={busy}
              onPress={() => {
                setScope(key);
                setAccepted(false);
              }}
            />
          ))}
        </View>
        <Consent
          checked={history}
          onChange={v => {
            setHistory(v);
            setAccepted(false);
          }}
          text="同时开放指定日期起的历史账单"
        />
        {history ? (
          <>
            <Text style={s.text}>最早日期（YYYY-MM-DD）</Text>
            <TextInput
              accessibilityLabel="最早历史日期"
              style={s.input}
              value={date}
              maxLength={10}
              autoCapitalize="none"
              placeholder="例如 2026-09-01"
              onChangeText={v => {
                setDate(v);
                setAccepted(false);
              }}
            />
            {!!date && !dateValid && (
              <Text style={s.error}>请填写真实日期，例如 2026-09-01。</Text>
            )}
          </>
        ) : (
          <Text style={s.muted}>
            仅开放授权生效后创建、且发生日期不早于授权当日的新账单。补录过去账单不会因此开放。
            {data.grant?.status === 'active'
              ? `当前授权生效于 ${new Date(
                  data.grant.activatedAt,
                ).toLocaleString()}；修改范围不会重置生效时间。`
              : ''}
          </Text>
        )}
      </View>
      <View style={s.card}>
        <Text style={s.heading}>对方会看到的四个字段</Text>
        <Text style={s.muted}>以下取自你的一笔账单，仅用于说明字段格式。</Text>
        {data.sample ? (
          <Text style={s.text}>
            {data.sample.type === 'income' ? '收入' : '支出'} · ¥
            {String(data.sample.amount)}
            {'\n'}分类：{data.sample.category?.name || '未分类'}
            {'\n'}发生时间：{data.sample.date.slice(0, 10)}
            {data.sample.time
              ? ' ' + new Date(data.sample.time).toLocaleTimeString()
              : ''}
          </Text>
        ) : (
          <Text style={s.text}>
            你目前没有账单。新增账单也只分享收支类型、金额、分类和发生时间。
          </Text>
        )}
        <Text style={s.muted}>
          不会分享商户、备注、余额、原始通知、发票或邮箱资料。自定义分类名称可能含隐私，确认前请检查。
        </Text>
      </View>
      <Consent
        checked={accepted}
        onChange={setAccepted}
        text="我已核对用户和范围，同意分享上述四个字段"
      />
      <Action
        title={busy ? '正在保存…' : '确认授权范围'}
        primary
        disabled={busy || !accepted || (history && !dateValid)}
        onPress={() => save(scope, history ? date : undefined)}
      />
    </>
  );
}
export default function SocialGrantScreen({
  route,
  navigation,
}: {
  route: any;
  navigation: any;
}) {
  const api = useSocialApi();
  const id: string = route.params.userId;
  const r = useSocialResource(
    useCallback(async (): Promise<GrantData> => {
      const [person, grants, sample] = await Promise.all([
        api.person(id),
        api.grants(id),
        billsService.getBills({ page: 1, limit: 1 }),
      ]);
      if (!sample.success)
        throw new Error(sample.message || '无法读取字段示例');
      return { person, grant: grants.given, sample: sample.data?.[0] };
    }, [api, id]),
  );
  return (
    <Page>
      <Status {...r} />
      {r.value && (
        <GrantForm
          data={r.value}
          busy={r.busy}
          save={(scope, historyStart) => {
            void r.run(
              () =>
                api.grant(id, {
                  scope,
                  historyStart,
                  ...(r.value?.grant
                    ? { expectedVersion: r.value.grant.version }
                    : {}),
                }),
              () => navigation.goBack(),
            );
          }}
        />
      )}
    </Page>
  );
}
