import { Prisma } from '@prisma/client';
import { LedgerAccumulator } from '../ledger/ledger-semantics';
import { datePeriodKey, rankingKeys, RankingKind, rankingPeriod, RANKING_KINDS } from './ranking-period';

type Tx = Prisma.TransactionClient;
const select = { id: true, amount: true, type: true, date: true, updatedAt: true,
  financialClassification: { select: { kind: true, currency: true, billUpdatedAt: true } },
  relatedBill: { select: { userId: true, type: true, date: true } } } as const;

async function aggregate(tx: Tx, userId: string, lower: Record<RankingKind, string>, upper: Record<RankingKind, string>) {
  const start = new Date(Math.min(...RANKING_KINDS.map(k => rankingPeriod(k, lower[k]).start.getTime())));
  const end = new Date(Math.max(...RANKING_KINDS.map(k => rankingPeriod(k, upper[k]).end.getTime())));
  const groups = new Map<string, { kind: RankingKind; period: string; accumulator: LedgerAccumulator }>();
  // Keep empty current periods too, so deleting the last bill clears an existing result.
  for (const kind of RANKING_KINDS) if (lower[kind] === upper[kind]) {
    const period = lower[kind], range = rankingPeriod(kind, period);
    groups.set(`${kind}:${period}`, { kind, period, accumulator: new LedgerAccumulator(userId, range.start, range.end) });
  }
  let id = 0;
  while (true) {
    const rows = await tx.bill.findMany({ where: { userId, id: { gt: id }, date: { gte: start, lte: end } }, select, orderBy: { id: 'asc' }, take: 500 });
    for (const row of rows) for (const kind of RANKING_KINDS) {
      const period = datePeriodKey(kind, row.date);
      if (period < lower[kind] || period > upper[kind]) continue;
      const key = `${kind}:${period}`;
      if (!groups.has(key)) {
        const range = rankingPeriod(kind, period);
        groups.set(key, { kind, period, accumulator: new LedgerAccumulator(userId, range.start, range.end) });
      }
      groups.get(key)!.accumulator.add(row);
    }
    if (rows.length < 500) break;
    id = rows[rows.length - 1].id;
  }
  return [...groups.values()];
}

async function save(tx: Tx, userId: string, groups: Awaited<ReturnType<typeof aggregate>>) {
  for (const { kind, period, accumulator } of groups) {
    const result = accumulator.result();
    const data = { surplus: result.cashSurplus, effectiveDays: result.effectiveDays, included: result.counts.included,
      needsReview: result.counts.needsReview, ruleVersion: result.ruleVersion };
    await tx.rankingResult.upsert({ where: { userId_kind_period: { userId, kind, period } }, create: { userId, kind, period, ...data }, update: data });
  }
}

/** Caller holds the user's row lock. Always run BEFORE a ledger mutation, even after worker downtime. */
export async function prepareRanking(tx: Tx, userId: string, now: Date) {
  const pref = await tx.socialPreference.findUnique({ where: { userId }, select: { rankingScope: true } });
  if (!pref || pref.rankingScope === 'none') return false;
  const current = rankingKeys(now);
  const state = await tx.rankingState.findUnique({ where: { userId } });
  if (!state) {
    await tx.rankingState.create({ data: { userId, joinedAt: now, dayKey: current.day, monthKey: current.month, yearKey: current.year } });
    return true;
  }
  const previous = { day: state.dayKey, month: state.monthKey, year: state.yearKey };
  if (RANKING_KINDS.some(k => previous[k] > current[k])) throw new Error('排行榜时钟回退，暂停写入以保护封榜数据');
  if (RANKING_KINDS.some(k => previous[k] < current[k])) {
    // Only periods at/after the last cursor can be rebuilt. Older results stay immutable.
    const groups = await aggregate(tx, userId, previous, current);
    await save(tx, userId, groups.filter(g => g.period < current[g.kind]));
    await tx.rankingState.update({ where: { userId }, data: { dayKey: current.day, monthKey: current.month, yearKey: current.year } });
  }
  return true;
}

/** Same transaction and same captured clock as prepareRanking: midnight cannot split a mutation. */
export async function refreshRanking(tx: Tx, userId: string, now: Date) {
  if (!await tx.rankingState.findUnique({ where: { userId }, select: { userId: true } })) return;
  const current = rankingKeys(now);
  await save(tx, userId, await aggregate(tx, userId, current, current));
  await tx.rankingState.update({ where: { userId }, data: { initialized: true } });
}

/** Call after saving explicit preferences, while holding the user's lock. */
export async function changeRankingParticipation(tx: Tx, userId: string, scope: string, now: Date) {
  if (scope === 'none') {
    // Deleting this participation removes all its old rows. Re-entry starts a fresh history.
    await tx.rankingState.deleteMany({ where: { userId } });
  } else {
    await prepareRanking(tx, userId, now);
    await refreshRanking(tx, userId, now);
  }
}
