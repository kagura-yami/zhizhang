import { BadRequestException } from '@nestjs/common';
import { businessDate } from '../ledger/ledger-period';

export const RANKING_KINDS = ['day', 'month', 'year'] as const;
export type RankingKind = typeof RANKING_KINDS[number];
export function rankingKeys(now: Date) {
  const day = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  return { day, month: day.slice(0, 7), year: day.slice(0, 4) };
}
export function rankingPeriod(kind: RankingKind, key: string) {
  if (!RANKING_KINDS.includes(kind) || !({ day: /^\d{4}-\d{2}-\d{2}$/, month: /^\d{4}-\d{2}$/, year: /^\d{4}$/ }[kind].test(key))) {
    throw new BadRequestException('排行榜周期格式不正确');
  }
  const start = businessDate(kind === 'day' ? key : kind === 'month' ? `${key}-01` : `${key}-01-01`);
  const next = new Date(start);
  if (kind === 'day') next.setUTCDate(next.getUTCDate() + 1);
  else if (kind === 'month') next.setUTCMonth(next.getUTCMonth() + 1);
  else next.setUTCFullYear(next.getUTCFullYear() + 1);
  return { start, end: new Date(next.getTime() - 86400000) };
}
export function datePeriodKey(kind: RankingKind, date: Date) {
  return date.toISOString().slice(0, kind === 'day' ? 10 : kind === 'month' ? 7 : 4);
}
