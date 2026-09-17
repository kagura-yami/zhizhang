import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Text, View } from 'react-native';
import { useAlert, useAuth } from '../../providers';
import { useStyles } from '../../hooks/useStyles';
import {
  createRetrospectiveApi,
  ReviewJob,
  ReviewReference,
} from '../../services/api/retrospectives';
import {
  Action,
  Page,
  Status,
  stylesFor,
  useSocialResource,
} from '../social/shared';
import { Pager } from '../social/reviewShared';

const labels: Record<ReviewJob['status'], string> = {
  queued: '等待生成',
  running: '正在生成',
  succeeded: '已完成',
  failed: '生成失败',
  invalidated: '内容已失效',
  deleted: '已删除',
};
const money = (value: string) =>
  `${value.startsWith('-') ? '-¥' : '¥'}${value
    .replace(/^-/, '')
    .replace(/(\.\d{2})00$/, '$1')}`;
type Api = ReturnType<typeof createRetrospectiveApi>;

function ReportView({
  id,
  api,
  back,
  openReference,
  regenerate,
}: {
  id: string;
  api: Api;
  back: () => void;
  openReference: (ref: ReviewReference) => void;
  regenerate: (job: ReviewJob) => void;
}) {
  const s = useStyles(stylesFor),
    { confirm } = useAlert();
  const resource = useSocialResource(
    useCallback(() => api.detail(id), [api, id]),
  );
  const job = resource.value;
  useEffect(() => {
    if (job?.status !== 'queued' && job?.status !== 'running') return;
    const timer = setTimeout(() => {
      void resource.refresh();
    }, 4000);
    return () => clearTimeout(timer);
  }, [job, resource.refresh]);
  const result = job?.result,
    report = result?.report;
  const cite = (refs: string[]) => (
    <View style={s.chipRow}>
      {refs.map(ref => {
        const target = result?.references.find(item => item.ref === ref);
        return target ? (
          <Action
            key={ref}
            title={`查看依据 ${ref}`}
            onPress={() => openReference(target)}
          />
        ) : null;
      })}
    </View>
  );
  return (
    <>
      <Action title="返回复盘记录" onPress={back} />
      <Action
        title="核验最新状态"
        disabled={resource.loading}
        onPress={() => {
          void resource.refresh();
        }}
      />
      <Status {...resource} />
      {job && (
        <>
          <Text style={s.title}>
            {job.period} · {job.kind === 'day' ? '日复盘' : '月复盘'}
          </Text>
          <Text accessibilityLiveRegion="polite" style={s.heading}>
            {labels[job.status]}
          </Text>
          {(job.status === 'queued' || job.status === 'running') && (
            <Text style={s.muted}>
              正在后台生成。完成后会自动保存在“我的 → 财务 → 复盘”。
            </Text>
          )}
          {job.status === 'failed' && (
            <View style={s.card}>
              <Text style={s.text}>
                {job.errorCode === 'interrupted'
                  ? '上次生成被中断。'
                  : job.errorCode === 'input_changed'
                  ? '生成期间账单或授权发生变化。'
                  : '本次未能生成有效报告，请检查模型配置后重试。'}
              </Text>

            </View>
          )}
          {job.status === 'invalidated' && (
            <View style={s.card}>
              <Text style={s.heading}>这份复盘已失效</Text>
              <Text style={s.text}>
                所用评价已隐藏、撤回或撤销授权。旧内容不再展示；你可以按当前有效数据重新生成。
              </Text>
            </View>
          )}
          {job.sourceChanged && job.status === 'succeeded' && (
            <Text accessibilityRole="alert" style={s.error}>
              来源已更新。以下保留生成时的结论，可重新生成以使用最新数据。
            </Text>
          )}
          {report && result && (
            <>
              <View style={s.card}>
                <Text style={s.heading}>财务事实</Text>
                <Text style={s.muted}>按服务端账务口径计算 · 人民币</Text>
                {(
                  [
                    ['普通收入', report.facts.ordinaryIncome],
                    ['毛支出', report.facts.grossExpense],
                    ['退款流入', report.facts.refundInflow],
                    ['现金结余', report.facts.cashSurplus],
                  ] as const
                ).map(([name, value]) => (
                  <View key={name} style={s.row}>
                    <Text style={[s.text, s.grow]}>{name}</Text>
                    <Text selectable style={s.heading}>
                      {money(value)}
                    </Text>
                  </View>
                ))}
                <Text style={s.muted}>
                  共 {report.facts.counts.total} 笔，计入{' '}
                  {report.facts.counts.included} 笔，数据异常{' '}
                  {report.facts.counts.needsReview} 笔。
                </Text>
                <Text style={s.small}>
                  已排除：内部转账 {report.facts.counts.internalTransfer}{' '}
                  笔、调账 {report.facts.counts.adjustment} 笔、误记{' '}
                  {report.facts.counts.ignored} 笔。现金结余不等于资产余额。
                </Text>
                {!report.facts.complete && (
                  <Text style={s.error}>
                    部分账单数据异常，本次金额可能不完整。
                  </Text>
                )}
              </View>
              <View style={s.card}>
                <Text style={s.heading}>好友观点 · 原文节选</Text>
                {!report.friendViews.length && (
                  <Text style={s.muted}>
                    本次没有引用好友文字，不据此推测好友态度。
                  </Text>
                )}
                {report.friendViews.map(view => (
                  <View key={view.ref}>
                    <Text style={s.small}>{view.author}</Text>
                    <Text selectable style={s.text}>
                      “{view.quote}”
                    </Text>
                    {cite([view.ref])}
                  </View>
                ))}
              </View>
              <View style={s.card}>
                <Text style={s.heading}>AI 分析与建议</Text>
                <Text style={s.muted}>
                  以下为模型解释，请结合实际情况判断。
                </Text>
                {!report.analysis.length && (
                  <Text style={s.text}>本次没有额外分析。</Text>
                )}
                {report.analysis.map((item, index) => (
                  <View key={index}>
                    <Text selectable style={s.text}>
                      {item.text}
                    </Text>
                    {cite(item.citations)}
                  </View>
                ))}
              </View>
              <View style={s.card}>
                <Text style={s.heading}>接下来可以做</Text>
                {!report.actions.length && (
                  <Text style={s.muted}>本次没有需要补充的行动。</Text>
                )}
                {report.actions.map((item, index) => (
                  <View key={index}>
                    <Text selectable style={s.text}>
                      {index + 1}. {item.text}
                    </Text>
                    {cite(item.citations)}
                  </View>
                ))}
              </View>
              <View style={s.card}>
                <Text style={s.heading}>预算依据</Text>
                {report.budgets.map(budget => (
                  <View key={budget.period}>
                    <Text style={s.text}>
                      {budget.period === 'monthly' ? '月预算' : '年预算'} ·{' '}
                      {budget.startDate} 至 {budget.endDate}
                    </Text>
                    {budget.coverage !== 'available' && (
                      <Text style={s.muted}>无可核验的当期预算。</Text>
                    )}
                    {!!budget.changedBudgetCount && (
                      <Text style={s.muted}>
                        期间存在预算调整，相关规则未用于超支结论。
                      </Text>
                    )}
                    {budget.coverage === 'available' &&
                      !budget.comparisons.length && (
                        <Text style={s.muted}>没有可比较的稳定预算。</Text>
                      )}
                    {budget.comparisons.map((item, i) => (
                      <Text key={i} style={s.text}>
                        {item.name}：累计毛支出 {money(item.grossExpense)} /
                        额度 {money(item.amount)} ·{' '}
                        {item.overBudget === null
                          ? '账务数据异常'
                          : item.overBudget
                          ? '已超过额度'
                          : '未超过额度'}
                      </Text>
                    ))}
                  </View>
                ))}
              </View>
              {!!report.gaps.length && (
                <View style={s.card}>
                  <Text style={s.heading}>数据缺口</Text>
                  {report.gaps.map(gap => (
                    <Text key={gap} style={s.text}>
                      {gap}
                    </Text>
                  ))}
                </View>
              )}
              <Text style={s.small}>
                生成于 {new Date(result.generatedAt).toLocaleString()} ·{' '}
                {result.provider} / {result.model}
              </Text>
            </>
          )}
          {['succeeded', 'failed', 'invalidated'].includes(job.status) && (
            <Action
              title="在 AI 助手中重新生成"
              onPress={() => regenerate(job)}
            />
          )}
          <Action
            title="删除这份复盘"
            disabled={resource.busy}
            onPress={() =>
              confirm(
                '删除复盘',
                '报告内容将被删除；正在生成的任务也会停止。账单和评价不会删除。',
                () => {
                  void resource.run(() => api.remove(id), back);
                },
                undefined,
                { confirmText: '删除复盘' },
              )
            }
          />
        </>
      )}
    </>
  );
}

export default function RetrospectivesScreen({ navigation, route }: { navigation: any; route?: any }) {
  const { token } = useAuth();
  return <History key={token || ''} token={token || ''} navigation={navigation} initialId={route?.params?.id} />;
}
function History({ token, navigation, initialId }: { token: string; navigation: any; initialId?: string }) {
  const s = useStyles(stylesFor);
  const api = useMemo(() => createRetrospectiveApi(token), [token]);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(initialId || null);
  const resource = useSocialResource(useCallback(() => api.list(page), [api, page]));
  useEffect(() => { if (initialId) setSelected(initialId); }, [initialId]);
  useEffect(() => {
    if (!resource.value?.items.some(job => ['queued', 'running'].includes(job.status))) return;
    const timer = setTimeout(() => { void resource.refresh(); }, 4000);
    return () => clearTimeout(timer);
  }, [resource.value, resource.refresh]);
  const openReference = (ref: ReviewReference) => {
    if (ref.kind === 'bill') navigation.navigate('BillDetail', { billId: ref.id });
    else if (ref.kind === 'vote' || ref.threadId) navigation.navigate('SocialReviewThread', { threadId: ref.threadId ?? ref.id, ...(ref.kind === 'message' ? { messageId: ref.id } : {}) });
  };
  return <Page>
    {selected ? <ReportView key={selected} id={selected} api={api} back={() => { setSelected(null); void resource.refresh(); }} openReference={openReference} regenerate={job => navigation.navigate('AIChat', { prompt: `请重新生成 ${job.period} 的${job.kind === 'day' ? '日' : '月'}复盘报告` })} /> : <>
      <Text style={s.title}>我的复盘</Text>
      <Text style={s.muted}>在 AI 助手对话中提出复盘需求，生成的报告会自动保存在这里，仅自己可见。</Text>
      <Action title="去 AI 助手聊聊" onPress={() => navigation.navigate('AIChat')} />
      <Status {...resource} />
      {resource.value?.total === 0 && <View style={s.empty}><Text style={s.heading}>还没有复盘报告</Text><Text style={s.muted}>试着对 AI 助手说：“帮我生成上个月的消费复盘”。</Text></View>}
      {resource.value?.items.map(job => <View key={job.id} style={s.card}>
        <Text style={s.heading}>{job.period} · {job.kind === 'day' ? '日复盘' : '月复盘'}</Text>
        <Text style={s.muted}>{labels[job.status]}</Text>
        <Text style={s.small}>{new Date(job.createdAt).toLocaleString()}</Text>
        <Action title="查看复盘" onPress={() => setSelected(job.id)} />
      </View>)}
      {resource.value && <Pager page={page} hasNext={page * 10 < resource.value.total} change={setPage} />}
      <Action title="刷新记录" disabled={resource.loading} onPress={resource.refresh} />
    </>}
  </Page>;
}
