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
}
