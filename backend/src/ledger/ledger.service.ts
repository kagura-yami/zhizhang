import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClassifyBillDto, LedgerPendingQueryDto, LedgerSummaryQueryDto } from './ledger.dto';
import { businessPeriod } from './ledger-period';
import { LedgerAccumulator } from './ledger-semantics';
import { lockSocialUsers } from '../social/social-access.service';
import { prepareRanking, refreshRanking } from '../rankings/ranking-projection';

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly detailSelect = {
    id: true, amount: true, type: true, date: true, updatedAt: true, description: true,
    category: { select: { name: true } },
    financialClassification: { select: { kind: true, currency: true, billUpdatedAt: true } },
    relatedBill: { select: { userId: true, type: true, date: true } },
  } as const;

  async context(userId: string, id: number) {
    const bill = await this.prisma.bill.findFirst({ where: { id, userId }, select: this.detailSelect });
    if (!bill) throw new NotFoundException('账单不存在');
    const accumulator = new LedgerAccumulator(userId, bill.date, bill.date);
    accumulator.add(bill);
    const { relatedBill, ...safe } = bill;
    return { ...safe, amount: bill.amount.toFixed(4), date: bill.date.toISOString().slice(0, 10),
      needsReview: !accumulator.result().complete,
      canBeRefund: bill.type === 'income' && (!relatedBill || (relatedBill.userId === userId && relatedBill.type === 'expense')) };
  }

  async pending(userId: string, query: LedgerPendingQueryDto) {
    const { start, end } = businessPeriod(query.startDate, query.endDate);
    return this.prisma.$transaction(async tx => {
      const items: Array<{ id: number; amount: string; type: string; date: string; description: string | null; category: string | null }> = [];
      let cursor = query.afterId;
      while (items.length < 21) {
        const rows = await tx.bill.findMany({ where: { userId, id: { gt: cursor }, date: { gte: start, lte: end } },
          select: this.detailSelect, orderBy: { id: 'asc' }, take: 500 });
        const accumulator = new LedgerAccumulator(userId, start, end);
        rows.forEach(row => accumulator.add(row));
        const pending = new Set(accumulator.result().pendingBillIds);
        for (const row of rows) if (pending.has(row.id)) {
          items.push({ id: row.id, amount: row.amount.toFixed(4), type: row.type, date: row.date.toISOString().slice(0, 10), description: row.description, category: row.category?.name ?? null });
          if (items.length === 21) break;
        }
        if (rows.length < 500) break;
        cursor = rows[rows.length - 1].id;
      }
      const page = items.slice(0, 20);
      return { items: page, hasMore: items.length > 20, nextAfterId: page[page.length - 1]?.id ?? query.afterId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
  }

  async classify(userId: string, id: number, dto: ClassifyBillDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockSocialUsers(tx, [userId]);
        const rankingTime = new Date();
        await prepareRanking(tx, userId, rankingTime);
        const bill = await tx.bill.findFirst({
          where: { id, userId },
          select: { id: true, type: true, updatedAt: true, relatedBill: { select: { userId: true, type: true } } },
        });
        if (!bill) throw new NotFoundException('账单不存在');
        if (bill.updatedAt.getTime() !== new Date(dto.expectedUpdatedAt).getTime()) {
          throw new ConflictException('账单已经修改，请刷新后重新确认');
        }
        if (dto.kind === 'refund' && (bill.type !== 'income' ||
            (bill.relatedBill && (bill.relatedBill.userId !== userId || bill.relatedBill.type !== 'expense')))) {
          throw new BadRequestException('退款必须为收入，且关联原账单必须为本人的支出');
        }
        const data = { kind: dto.kind, currency: dto.currency, billUpdatedAt: bill.updatedAt, reviewedAt: new Date() };
        const result = await tx.billFinancialClassification.upsert({ where: { billId: id }, create: { billId: id, ...data }, update: data });
        await refreshRanking(tx, userId, rankingTime);
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error?.code === 'P2034') throw new ConflictException('账单正在更新，请刷新后重新确认');
      throw error;
    }
  }

  async summary(userId: string, query: LedgerSummaryQueryDto) {
    const { start, end } = businessPeriod(query.startDate, query.endDate);
    // Every page observes the same database snapshot, including classification revisions.
    return this.prisma.$transaction(async (tx) => {
      const accumulator = new LedgerAccumulator(userId, start, end);
      let lastId = 0;
      while (true) {
        const rows = await tx.bill.findMany({
          where: { userId, date: { gte: start, lte: end }, id: { gt: lastId } },
          orderBy: { id: 'asc' }, take: 500,
          select: {
            id: true, amount: true, type: true, date: true, updatedAt: true,
            financialClassification: { select: { kind: true, currency: true, billUpdatedAt: true } },
            relatedBill: { select: { userId: true, type: true, date: true } },
          },
        });
        for (const row of rows) accumulator.add(row);
        if (rows.length < 500) break;
        lastId = rows[rows.length - 1].id;
      }
      return accumulator.result();
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
  }

  /** Reconstructed cash surplus, never an account balance or net worth snapshot. */
  async cashHistory(userId: string, now = new Date()) {
    const local = new Date(now.getTime() + 8 * 3600000);
    const year = local.getUTCFullYear(), month = local.getUTCMonth();
    const start = new Date(Date.UTC(year, month - 11, 1));
    const end = new Date(Date.UTC(year, month + 1, 0));
    return this.prisma.$transaction(async tx => {
      const earliest = await tx.bill.aggregate({ where: { userId, date: { lte: end } }, _min: { date: true } });
      const first = earliest._min.date && earliest._min.date < start ? earliest._min.date : start;
      const openingEnd = new Date(start.getTime() - 86400000);
      const opening = new LedgerAccumulator(userId, first < start ? first : openingEnd, openingEnd);
      const summary = new LedgerAccumulator(userId, first, end);
      const windowSummary = new LedgerAccumulator(userId, start, end);
      const monthly = new Map<string, LedgerAccumulator>();
      const categories = new Map<number | null, { name: string | null; accumulator: LedgerAccumulator }>();
      for (let i = 0; i < 12; i++) {
        const monthStart = new Date(Date.UTC(year, month - 11 + i, 1));
        const monthEnd = new Date(Date.UTC(year, month - 10 + i, 0));
        monthly.set(monthStart.toISOString().slice(0, 7), new LedgerAccumulator(userId, monthStart, monthEnd));
      }
      let cursor = 0;
      while (true) {
        const rows = await tx.bill.findMany({
          where: { userId, date: { lte: end }, id: { gt: cursor } },
          orderBy: { id: 'asc' }, take: 500,
          select: {
            id: true, amount: true, type: true, date: true, updatedAt: true, categoryId: true,
            category: { select: { name: true } },
            financialClassification: { select: { kind: true, currency: true, billUpdatedAt: true } },
            relatedBill: { select: { userId: true, type: true, date: true } },
          },
        });
        for (const row of rows) {
          summary.add(row);
          if (row.date < start) { opening.add(row); continue; }
          windowSummary.add(row);
          monthly.get(row.date.toISOString().slice(0, 7)).add(row);
          if (!categories.has(row.categoryId)) categories.set(row.categoryId, {
            name: row.category?.name ?? null, accumulator: new LedgerAccumulator(userId, start, end),
          });
          categories.get(row.categoryId).accumulator.add(row);
        }
        if (rows.length < 500) break;
        cursor = rows[rows.length - 1].id;
      }
      const openingFacts = opening.result();
      let cumulative = new Prisma.Decimal(openingFacts.cashSurplus);
      let cumulativeNeedsReview = openingFacts.counts.needsReview;
      return {
        basis: 'reconstructed_cash_surplus', classificationBasis: 'current',
        summary: summary.result(), opening: openingFacts, window: windowSummary.result(),
        monthly: [...monthly].map(([monthKey, accumulator]) => {
          const facts = accumulator.result();
          cumulative = cumulative.plus(facts.cashSurplus);
          cumulativeNeedsReview += facts.counts.needsReview;
          return { month: monthKey, ...facts, cumulativeCashSurplus: cumulative.toFixed(4),
            cumulativeNeedsReview, cumulativeComplete: cumulativeNeedsReview === 0 };
        }),
        categories: [...categories].sort(([a], [b]) => (a ?? -1) - (b ?? -1))
          .map(([categoryId, { name, accumulator }]) => ({ categoryId, name, ...accumulator.result() })),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
  }

  async analytics(userId: string, query: LedgerSummaryQueryDto) {
    const { start, end } = businessPeriod(query.startDate, query.endDate);
    return this.prisma.$transaction(async tx => {
      const summary = new LedgerAccumulator(userId, start, end);
      const daily = new Map<string, LedgerAccumulator>();
      const monthly = new Map<string, LedgerAccumulator>();
      const categories = new Map<number | null, { id: number | null; name: string | null; accumulator: LedgerAccumulator }>();
      // Pre-fill empty natural days/months so chart lines never bridge missing periods.
      for (let time = start.getTime(); time <= end.getTime(); time += 86400000) {
        const day = new Date(time), key = day.toISOString().slice(0, 10), month = key.slice(0, 7);
        daily.set(key, new LedgerAccumulator(userId, day, day));
        if (!monthly.has(month)) {
          const first = new Date(`${month}-01T00:00:00.000Z`);
          const next = new Date(first); next.setUTCMonth(next.getUTCMonth() + 1);
          const last = new Date(next.getTime() - 86400000);
          monthly.set(month, new LedgerAccumulator(userId, first < start ? start : first, last > end ? end : last));
        }
      }
      let cursor = 0;
      while (true) {
        const rows = await tx.bill.findMany({
          where: { userId, date: { gte: start, lte: end }, id: { gt: cursor } },
          orderBy: { id: 'asc' }, take: 500,
          select: {
            id: true, amount: true, type: true, date: true, updatedAt: true, categoryId: true,
            category: { select: { name: true } },
            financialClassification: { select: { kind: true, currency: true, billUpdatedAt: true } },
            relatedBill: { select: { userId: true, type: true, date: true } },
          },
        });
        for (const row of rows) {
          summary.add(row);
          const date = row.date.toISOString().slice(0, 10);
          daily.get(date).add(row);
          monthly.get(date.slice(0, 7)).add(row);
          if (!categories.has(row.categoryId)) categories.set(row.categoryId, {
            id: row.categoryId, name: row.category?.name ?? null,
            accumulator: new LedgerAccumulator(userId, start, end),
          });
          categories.get(row.categoryId).accumulator.add(row);
        }
        if (rows.length < 500) break;
        cursor = rows[rows.length - 1].id;
      }
      return {
        summary: summary.result(),
        daily: [...daily].map(([date, accumulator]) => ({ date, ...accumulator.result() })),
        monthly: [...monthly].map(([month, accumulator]) => ({ month, ...accumulator.result() })),
        categories: [...categories.values()].sort((a, b) => (a.id ?? -1) - (b.id ?? -1))
          .map(({ id, name, accumulator }) => ({ categoryId: id, name, ...accumulator.result() })),
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
  }
}
