import { BadRequestException } from '@nestjs/common';
import type { RetrospectiveEvidence } from './retrospective-output';
import { validateRetrospectiveOutput } from './retrospective-output';

// A byte bound, not a claim about an arbitrary configured model's token window.
export const RETROSPECTIVE_INPUT_BYTES = 16000;
type Payload = RetrospectiveEvidence['payload'];
type Validated = ReturnType<typeof validateRetrospectiveOutput>;
export type ReviewNotes = Pick<
  Validated,
  'friendViews' | 'analysis' | 'actions'
>;
export interface ReviewBatch {
  payload: Payload & {
    phase?: 'partial' | 'synthesis';
    final?: boolean;
    synthesis?: ReviewNotes[];
  };
  evidence: RetrospectiveEvidence;
}
export const encodedBytes = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value), 'utf8');

function emptyPayload(input: RetrospectiveEvidence): Payload {
  return {
    ...input.payload,
    facts: { ...input.payload.facts, bills: [], categories: [] },
    feedback: [],
    votes: [],
    budgets: [],
  };
}
function batch(
  input: RetrospectiveEvidence,
  payload: ReviewBatch['payload'],
): ReviewBatch {
  return { payload, evidence: { ...input, payload } };
}

/** Every record appears in a model input; splitting never changes server totals. */
export function evidenceBatches(
  input: RetrospectiveEvidence,
  maxBytes = RETROSPECTIVE_INPUT_BYTES,
): ReviewBatch[] {
  if (encodedBytes(input.payload) <= maxBytes)
    return [batch(input, input.payload)];
  const batches: ReviewBatch[] = [];
  let payload: ReviewBatch['payload'] = {
      ...emptyPayload(input),
      phase: 'partial',
    },
    count = 0;
  if (encodedBytes(payload) >= maxBytes)
    throw new BadRequestException('复盘汇总信息超过单次模型输入限制');
  const add = (
    field: 'bills' | 'categories' | 'feedback' | 'votes' | 'budgets',
    value: unknown,
  ) => {
    const container =
      field === 'bills' || field === 'categories' ? payload.facts : payload;
    (container[field] as unknown[]).push(value);
    if (encodedBytes(payload) > maxBytes) {
      (container[field] as unknown[]).pop();
      if (count) batches.push(batch(input, payload));
      payload = { ...emptyPayload(input), phase: 'partial' };
      count = 0;
      const target =
        field === 'bills' || field === 'categories' ? payload.facts : payload;
      (target[field] as unknown[]).push(value);
      if (encodedBytes(payload) > maxBytes)
        throw new BadRequestException(
          '单条账单备注、评价或预算信息过长，无法完整送入模型',
        );
    }
    count++;
  };
  input.payload.facts.bills.forEach((value) => add('bills', value));
  input.payload.facts.categories?.forEach((value) => add('categories', value));
  input.payload.feedback.forEach((value) => add('feedback', value));
  input.payload.votes.forEach((value) => add('votes', value));
  // Split many budget comparisons without dropping coverage or period metadata.
  input.payload.budgets.forEach((value) => {
    if (!value.comparisons.length) add('budgets', value);
    else
      value.comparisons.forEach((comparison) =>
        add('budgets', { ...value, comparisons: [comparison] }),
      );
  });
  if (count) batches.push(batch(input, payload));
  return batches;
}

export function reportNotes(report: Validated): ReviewNotes {
  return {
    friendViews: report.friendViews,
    analysis: report.analysis,
    actions: report.actions,
  };
}

/** Reduction packets carry only already-validated notes and their allowed references.
 * Quotations remain exact excerpts; model-generated prose is never promoted to a fact. */
function synthesis(
  input: RetrospectiveEvidence,
  notes: ReviewNotes[],
): ReviewBatch {
  const refs = new Set<string>();
  const quoted = new Map<string, string[]>();
  notes.forEach((note) => {
    note.friendViews.forEach((view) => {
      refs.add(view.ref);
      if (!quoted.has(view.ref)) quoted.set(view.ref, []);
      if (!quoted.get(view.ref).includes(view.quote))
        quoted.get(view.ref).push(view.quote);
    });
    [...note.analysis, ...note.actions].forEach((item) =>
      item.citations.forEach((ref) => refs.add(ref)),
    );
  });
  const evidencePayload = {
    ...emptyPayload(input),
    facts: {
      ...input.payload.facts,
      bills: input.payload.facts.bills.filter((b) => refs.has(b.ref)),
      categories: [],
    },
    feedback: input.payload.feedback
      .filter((m) => refs.has(m.ref))
      .map((m) => ({ ...m, text: quoted.get(m.ref)?.join('\n…\n') ?? '' })),
    votes: input.payload.votes.filter((v) => refs.has(v.ref)),
  };
  // Full raw descriptions were seen in the leaf passes, not repeatedly re-sent at every level.
  const payload = {
    ...evidencePayload,
    phase: 'synthesis' as const,
    synthesis: notes,
    facts: {
      ...evidencePayload.facts,
      bills: evidencePayload.facts.bills.map((b) => ({
        ...b,
        description: null,
      })),
    },
  };
  return batch(input, payload);
}

export function synthesisBatches(
  input: RetrospectiveEvidence,
  notes: ReviewNotes[],
  maxBytes = RETROSPECTIVE_INPUT_BYTES,
): ReviewBatch[] {
  const result: ReviewBatch[] = [];
  let group: ReviewNotes[] = [];
  for (const note of notes) {
    const candidate = synthesis(input, [...group, note]);
    if (encodedBytes(candidate.payload) <= maxBytes) {
      group.push(note);
      continue;
    }
    if (!group.length)
      throw new BadRequestException('模型中间结果过长，无法完整合并复盘');
    result.push(synthesis(input, group));
    group = [note];
    if (encodedBytes(synthesis(input, group).payload) > maxBytes)
      throw new BadRequestException('模型中间结果过长，无法完整合并复盘');
  }
  if (group.length) result.push(synthesis(input, group));
  // Do not loop forever or silently drop a packet if the model refuses to compress.
  if (notes.length > 1 && result.length >= notes.length)
    throw new BadRequestException(
      '模型结果未能收敛，请换用支持更长上下文的模型后重试',
    );
  return result;
}

/** All leaves finish and validate before any final report can be accepted. */
export async function generateBatchedReport(
  input: RetrospectiveEvidence,
  invoke: (payload: ReviewBatch['payload']) => Promise<string>,
  maxBytes = RETROSPECTIVE_INPUT_BYTES,
) {
  const leaves = evidenceBatches(input, maxBytes);
  let calls = 0,
    levels = 0;
  const run = async (packet: ReviewBatch, final: boolean) => {
    const payload =
      final && packet.payload.phase
        ? { ...packet.payload, final: true }
        : packet.payload;
    // Reserve a little room for the final marker; the model input must still respect the bound.
    if (encodedBytes(payload) > maxBytes)
      throw new BadRequestException('复盘合并包超过模型输入限制');
    calls++;
    const content = await invoke(payload);
    const validated = validateRetrospectiveOutput(content, packet.evidence);
    // Never accept a quote spanning artificial excerpt separators at a reduction level.
    for (const view of validated.friendViews) {
      if (
        !input.payload.feedback.some(
          (m) =>
            m.ref === view.ref &&
            m.role === 'reviewer' &&
            m.text.includes(view.quote),
        )
      ) {
        throw new BadRequestException('复盘合并引用与原文不一致');
      }
    }
    if (!final) {
      const notes = reportNotes(validated);
      if (
        notes.friendViews.length > 1 ||
        notes.analysis.length > 1 ||
        notes.actions.length > 1 ||
        notes.friendViews.some((v) => v.quote.length > 80) ||
        [...notes.analysis, ...notes.actions].some(
          (v) => v.text.length > 80 || v.citations.length > 2,
        )
      ) {
        throw new BadRequestException('模型中间结果不够精炼，请重试');
      }
    }
    return { content, validated };
  };
  let finalContent: string;
  if (leaves.length === 1 && !leaves[0].payload.phase) {
    finalContent = (await run(leaves[0], true)).content;
  } else {
    let notes: ReviewNotes[] = [];
    for (const leaf of leaves)
      notes.push(reportNotes((await run(leaf, false)).validated));
    while (true) {
      levels++;
      // maxBytes minus marker reserve prevents a full packet growing over the byte bound.
      const packets = synthesisBatches(input, notes, maxBytes - 32);
      if (packets.length === 1) {
        finalContent = (await run(packets[0], true)).content;
        break;
      }
      const next: ReviewNotes[] = [];
      for (const packet of packets)
        next.push(reportNotes((await run(packet, false)).validated));
      notes = next;
    }
  }
  return {
    report: validateRetrospectiveOutput(finalContent, input),
    generation: {
      strategy: leaves.length > 1 ? 'hierarchical' : 'single',
      leafBatches: leaves.length,
      calls,
      levels,
      coveredBills: input.payload.facts.bills.length,
      coveredMessages: input.payload.feedback.length,
      coveredVotes: input.payload.votes.length,
    },
  };
}
