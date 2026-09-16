import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClassifyBillDto, LedgerSummaryQueryDto } from './ledger.dto';
import { businessPeriod } from './ledger-period';
import { LedgerAccumulator } from './ledger-semantics';

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async classify(userId: string, id: number, dto: ClassifyBillDto) {
    try {
      return await this.prisma.$transaction(async (tx) => {
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
        return tx.billFinancialClassification.upsert({ where: { billId: id }, create: { billId: id, ...data }, update: data });
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
