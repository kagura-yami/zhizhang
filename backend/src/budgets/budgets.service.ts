import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBudgetDto, UpdateBudgetDto } from './dto/budget.dto';
import { LedgerAccumulator } from '../ledger/ledger-semantics';

@Injectable()
export class BudgetsService {
  constructor(private prisma: PrismaService) {}

  private async validateCategory(
    tx: Prisma.TransactionClient,
    userId: string,
    id?: number | null,
  ) {
    if (id == null) return;
    await tx.$queryRaw`SELECT id FROM categories WHERE id = ${id} FOR SHARE`;
    const category = await tx.category.findFirst({
      where: { id, type: 'expense', OR: [{ userId }, { isDefault: true }] },
      select: { id: true },
    });
    if (!category)
      throw new BadRequestException('请选择本人或系统提供的支出分类');
  }

  async create(userId: string, createBudgetDto: CreateBudgetDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.validateCategory(tx, userId, createBudgetDto.categoryId);
      return tx.budget.create({
        data: {
          ...createBudgetDto,
          userId,
        },
        include: {
          category: true,
        },
      });
    });
  }

  async findAll(userId: string) {
    return this.prisma.budget.findMany({
      where: { userId, isActive: true },
      include: {
        category: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: number, userId: string) {
    return this.prisma.budget.findFirst({
      where: { id, userId },
      include: {
        category: true,
      },
    });
  }

  async update(id: number, userId: string, updateBudgetDto: UpdateBudgetDto) {
    return this.prisma.$transaction(async (tx) => {
      const budget = await tx.budget.findFirst({
        where: { id, userId },
        select: { id: true },
      });
      if (!budget) return { count: 0 };
      await this.validateCategory(tx, userId, updateBudgetDto.categoryId);
      return tx.budget.updateMany({
        where: { id, userId },
        data: updateBudgetDto,
      });
    });
  }

  async remove(id: number, userId: string) {
    return this.prisma.budget.deleteMany({
      where: { id, userId },
    });
  }

  async getBudgetProgress(userId: string) {
    const budgets = await this.prisma.budget.findMany({
      where: { userId, isActive: true },
      include: {
        category: true,
      },
    });

    const now = new Date();
    const results = [];

    for (const budget of budgets) {
      let startDate: Date;
      let endDate: Date;

      if (budget.period === 'monthly') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      } else {
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear(), 11, 31);
      }

      // 查询该周期内的支出
      const whereClause: any = {
        userId,
        type: 'expense',
        date: {
          gte: startDate,
          lte: endDate,
        },
      };

      if (budget.categoryId) {
        whereClause.categoryId = budget.categoryId;
      }

      const spent = await this.prisma.bill.aggregate({
        where: whereClause,
        _sum: {
          amount: true,
        },
      });

      const spentAmount = Number(spent._sum.amount || 0);
      const budgetAmount = Number(budget.amount);
      const progress =
        budgetAmount > 0 ? (spentAmount / budgetAmount) * 100 : 0;
      const remaining = budgetAmount - spentAmount;

      results.push({
        ...budget,
        spent: spentAmount,
        remaining,
        progress: Math.min(progress, 100),
        isOverBudget: spentAmount > budgetAmount,
        needsAlert: progress >= budget.alertAt,
      });
    }

    return results;
  }

  /** Current settings, not reconstructed historical budgets. One snapshot for settings and bills. */
  async getLedgerProgress(userId: string, now = new Date()) {
    const day = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
    const year = Number(day.slice(0, 4)), month = Number(day.slice(5, 7));
    return this.prisma.$transaction(async tx => {
      const budgets = await tx.budget.findMany({ where: { userId, isActive: true },
        include: { category: { select: { id: true, name: true, icon: true } } }, orderBy: { id: 'asc' } });
      const windows = new Map<string, { start: Date; end: Date; groups: Map<number | null, LedgerAccumulator> }>();
      for (const budget of budgets) {
        if (!['monthly', 'yearly'].includes(budget.period)) throw new BadRequestException('预算周期无效，请修正预算设置');
        let window = windows.get(budget.period);
        if (!window) {
          const start = new Date(Date.UTC(year, budget.period === 'monthly' ? month - 1 : 0, 1));
          const end = new Date(Date.UTC(year, budget.period === 'monthly' ? month : 12, 0));
          window = { start, end, groups: new Map() }; windows.set(budget.period, window);
        }
        if (!window.groups.has(budget.categoryId)) window.groups.set(budget.categoryId, new LedgerAccumulator(userId, window.start, window.end));
      }
      if (windows.size) {
        const start = new Date(Math.min(...[...windows.values()].map(w => w.start.getTime())));
        const end = new Date(Math.max(...[...windows.values()].map(w => w.end.getTime())));
        let cursor = 0;
        while (true) {
          const rows = await tx.bill.findMany({ where: { userId, date: { gte: start, lte: end }, id: { gt: cursor } },
            orderBy: { id: 'asc' }, take: 500,
            select: { id: true, amount: true, type: true, date: true, updatedAt: true, categoryId: true,
              financialClassification: { select: { kind: true, currency: true, billUpdatedAt: true } },
              relatedBill: { select: { userId: true, type: true, date: true } } } });
          for (const row of rows) for (const window of windows.values()) {
            if (row.date < window.start || row.date > window.end) continue;
            window.groups.get(null)?.add(row);
            if (row.categoryId != null) window.groups.get(row.categoryId)?.add(row);
          }
          if (rows.length < 500) break;
          cursor = rows[rows.length - 1].id;
        }
      }
      return budgets.map(budget => {
        const ledger = windows.get(budget.period).groups.get(budget.categoryId).result();
        const spent = new Prisma.Decimal(ledger.grossExpense), amount = budget.amount;
        const valid = amount.isFinite() && amount.gte(0);
        const ratio = valid && amount.gt(0) ? spent.div(amount).times(100) : null;
        const over = valid ? spent.gt(amount) : null;
        return { id: budget.id, name: budget.name, period: budget.period, categoryId: budget.categoryId, category: budget.category,
          amount: amount.toFixed(4), alertAt: budget.alertAt, updatedAt: budget.updatedAt,
          configurationBasis: 'current', spendingBasis: 'gross_expense', ledger,
          spent: ledger.grossExpense, refundInflow: ledger.refundInflow,
          remaining: valid ? amount.minus(spent).toFixed(4) : null,
          progressPercent: ratio?.toFixed(4) ?? null,
          comparisonStatus: !valid ? 'invalid_budget' : ledger.complete ? 'complete' : 'incomplete',
          confirmedOverBudget: over,
          isOverBudget: valid && ledger.complete ? over : null,
          needsAlert: valid && (amount.eq(0) ? spent.gt(0) : ratio.gte(budget.alertAt)),
        };
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
  }
}
