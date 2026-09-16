import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Modal, SafeAreaView, Text, TextInput, View } from 'react-native';
import { useAlert, useAuth } from '../../providers';
import { useStyles } from '../../hooks/useStyles';
import {
  createRetrospectiveApi,
  defaultReviewPeriod,
  ReviewJob,
  ReviewKind,
  ReviewReference,
} from '../../services/api/retrospectives';
import {
  Action,
  Consent,
  Page,
  Status,
  stylesFor,
  useSocialResource,
} from '../social/shared';
import { messageKey, Pager } from '../social/reviewShared';

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
              正在后台处理，你可以返回聊天。完成后可在复盘记录中查看。
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
              {job.attempts < 3 && (
                <Action
                  title="重试生成"
                  disabled={resource.busy}
                  onPress={() => {
                    void resource.run(() => api.retry(id));
                  }}
                />
              )}
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
              title="按当前数据重新生成"
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

function Content({
  token,
  onClose,
  navigation,
}: {
  token: string;
  onClose: () => void;
  navigation: any;
}) {
  const s = useStyles(stylesFor),
    { confirm } = useAlert();
  const api = useMemo(() => createRetrospectiveApi(token), [token]);
  const [kind, setKind] = useState<ReviewKind>('day'),
    [period, setPeriod] = useState(defaultReviewPeriod('day'));
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState<string | null>(null),
    [modelId, setModelId] = useState<number | null>(null),
    [accepted, setAccepted] = useState(false);
  const key = useRef<{ fingerprint: string; value: string } | null>(null);
  const resource = useSocialResource(
    useCallback(async () => {
      const [history, models] = await Promise.all([
        api.list(page),
        api.models(),
      ]);
      return { history, models };
    }, [api, page]),
  );
  useEffect(() => {
    if (
      resource.value &&
      !resource.value.models.some(model => model.id === modelId)
    )
      setModelId(
        resource.value.models.find(model => model.isDefault)?.id ??
          resource.value.models[0]?.id ??
          null,
      );
  }, [resource.value, modelId]);
  useEffect(() => {
    setAccepted(false);
  }, [kind, period, modelId]);
  const leave = (screen: string, params?: object) => {
    onClose();
    navigation.navigate(screen, params);
  };
  const openReference = (ref: ReviewReference) => {
    if (ref.kind === 'bill') leave('BillDetail', { billId: ref.id });
    else if (ref.kind === 'vote' || ref.threadId)
      leave('SocialReviewThread', {
        threadId: ref.threadId ?? ref.id,
        ...(ref.kind === 'message' ? { messageId: ref.id } : {}),
      });
  };
  const generate = () => {
    if (!modelId || !accepted) return;
    const fingerprint = `${kind}:${period.trim()}:${modelId}`;
    if (key.current?.fingerprint !== fingerprint)
      key.current = { fingerprint, value: messageKey() };
    let job: ReviewJob;
    void resource.run(
      async () => {
        job = await api.create({
          kind,
          period: period.trim(),
          configId: modelId,
          clientKey: key.current!.value,
        });
      },
      () => {
        key.current = null;
        setAccepted(false);
        setSelected(job.id);
      },
    );
  };
  return (
    <SafeAreaView style={s.screen}>
      <View style={[s.row, { paddingHorizontal: 20 }]}>
        <Text style={[s.heading, s.grow]}>账单复盘</Text>
        <Action title="返回聊天" onPress={onClose} />
      </View>
      <Page>
        {selected ? (
          <ReportView
            key={selected}
            id={selected}
            api={api}
            back={() => {
              setSelected(null);
              void resource.refresh();
            }}
            openReference={openReference}
            regenerate={job => {
              setKind(job.kind);
              setPeriod(job.period);
              setAccepted(false);
              setSelected(null);
              void resource.refresh();
            }}
          />
        ) : (
          <>
            <Text style={s.title}>回看账单，安排下一步</Text>
            <Text style={s.muted}>
              选择已结束的自然日或自然月。完整账单参与复盘，没有好友评价也能生成。
            </Text>
            <Status {...resource} />
            <View style={s.card}>
              <Text style={s.heading}>新建复盘</Text>
              <View style={s.chipRow}>
                {(['day', 'month'] as const).map(value => (
                  <Action
                    key={value}
                    title={value === 'day' ? '按日' : '按月'}
                    primary={kind === value}
                    onPress={() => {
                      setKind(value);
                      setPeriod(defaultReviewPeriod(value));
                    }}
                  />
                ))}
              </View>
              <Text style={s.text}>
                {kind === 'day' ? '日期（YYYY-MM-DD）' : '月份（YYYY-MM）'}
              </Text>
              <TextInput
                accessibilityLabel="复盘周期"
                style={s.input}
                value={period}
                onChangeText={setPeriod}
                autoCapitalize="none"
                maxLength={10}
              />
              <Text style={s.small}>
                按北京时间划分周期；当天和当月结束后才可复盘。
              </Text>
              <Text style={s.text}>使用的模型</Text>
              <View style={s.chipRow}>
                {resource.value?.models.map(model => (
                  <Action
                    key={model.id}
                    title={model.name}
                    primary={modelId === model.id}
                    onPress={() => setModelId(model.id)}
                  />
                ))}
              </View>
              {resource.value && !resource.value.models.length && (
                <Text style={s.error}>请先在模型设置中添加配置。</Text>
              )}
              <Action
                title="模型设置"
                onPress={() => leave('GeneralSettings')}
              />
              <Consent
                checked={accepted}
                onChange={setAccepted}
                text="我同意将所选周期的账单信息及获准的反馈发送给所选 AI 服务生成复盘"
              />
              <Action
                primary
                title={resource.busy ? '正在提交…' : '生成复盘'}
                disabled={
                  !accepted || !modelId || resource.busy || resource.loading
                }
                onPress={generate}
              />
            </View>
            <Action
              title="评价用于 AI 的授权设置"
              onPress={() => leave('SocialSettings')}
            />
            <Text style={s.heading}>复盘记录</Text>
            <Text style={s.small}>
              仅本人可见。生成任务可离开页面后继续；按需刷新查看最新状态。
            </Text>
            <Action
              title="刷新记录"
              onPress={() => {
                void resource.refresh();
              }}
              disabled={resource.loading}
            />
            {resource.value?.history.total === 0 && (
              <Text style={s.muted}>还没有复盘记录，从已结束的一天开始。</Text>
            )}
            {resource.value?.history.items.map(job => (
              <View key={job.id} style={s.card}>
                <Text style={s.heading}>
                  {job.period} · {job.kind === 'day' ? '日复盘' : '月复盘'}
                </Text>
                <Text style={s.muted}>{labels[job.status]}</Text>
                <Action title="查看复盘" onPress={() => setSelected(job.id)} />
              </View>
            ))}
            {resource.value && (
              <Pager
                page={page}
                hasNext={page * 10 < resource.value.history.total}
                change={setPage}
              />
            )}
          </>
        )}
      </Page>
    </SafeAreaView>
  );
}

export default function RetrospectivePanel({
  onClose,
  navigation,
}: {
  onClose: () => void;
  navigation: any;
}) {
  const { token } = useAuth();
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <Content
        key={token || ''}
        token={token || ''}
        onClose={onClose}
        navigation={navigation}
      />
    </Modal>
  );
}
