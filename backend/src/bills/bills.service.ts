import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateBillWithUserDto,
  UpdateBillDto,
  BillQueryDto,
} from './dto/bill.dto';
import { Decimal } from '@prisma/client/runtime/library';
import { PaginatedResponse } from '../common/interfaces/api-response.interface';

@Injectable()
export class BillsService {
  private readonly logger = new Logger(BillsService.name);

  constructor(private prisma: PrismaService) {}

  private buildDateRange(startDate?: string, endDate?: string) {
    if (!startDate && !endDate) {
      return undefined;
    }

    const dateRange: { gte?: Date; lte?: Date } = {};

    if (startDate) {
      dateRange.gte = new Date(`${startDate}T00:00:00.000`);
    }

    if (endDate) {
      dateRange.lte = new Date(`${endDate}T23:59:59.999`);
    }

    return dateRange;
  }

  /**
   * 创建账单
   */
  async create(userId: string, createBillDto: CreateBillWithUserDto) {
    const {
      amount,
      type,
      description,
      date,
      time,
      paymentChannel,
      counterparty,
      source,
      sourceApp,
      categoryId,
      relatedBillId,
      isRefund,
      dedupeKey,
      dedupeMeta,
    } = createBillDto;

    // 确保用户存在，如果不存在则创建
    await this.ensureUserExists(userId);

    // 自动记账请求可能在服务端已成功后因网络超时被客户端重试。
    // 将幂等键写入 notes，避免为此新增数据库迁移，同时不影响用户手动备注。
    const dedupeMarker = source === 'notification' && dedupeKey
      ? `auto-dedupe:${dedupeKey}`
      : undefined;
    if (dedupeMarker) {
      const existing = await this.prisma.bill.findFirst({
        where: { userId, source: 'notification', notes: { startsWith: dedupeMarker } },
        include: {
          category: true,
          relatedBill: { select: { id: true, amount: true, type: true, description: true, date: true, time: true } },
        },
      });
      if (existing) return existing;

      // 客户端可能在不同设备/不同通知来源上生成不同指纹；
      // 对最近窗口内具备“同金额+同方向+同商户”或“同卡尾号”的通知再做一次服务端保护。
      const eventTime = new Date(time || Date.now()).getTime();
      // 银行通知可能晚到，但正文携带的真实交易时间会早于支付应用通知时间；
      // 使用对称窗口，不能只查“当前交易时间之前”的记录。
      const recentWindowStart = new Date(eventTime - 10 * 60 * 1000);
      const recentWindowEnd = new Date(eventTime + 10 * 60 * 1000);
      const candidates = await this.prisma.bill.findMany({
        where: {
          userId,
          source: 'notification',
          type,
          amount: new Decimal(amount),
          time: { gte: recentWindowStart, lte: recentWindowEnd },
        },
        orderBy: [{ time: 'desc' }, { createdAt: 'desc' }],
        take: 30,
        include: { category: true, relatedBill: { select: { id: true, amount: true, type: true, description: true, date: true, time: true } } },
      });
      const meta = this.parseDedupeMeta(dedupeMeta);
      const normalize = (value?: string | null) => (value || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      const duplicate = candidates.find(candidate => {
        const candidateMeta = this.parseDedupeMeta(candidate.notes);
        const sameRef = meta.ref && candidateMeta.ref && normalize(meta.ref) === normalize(candidateMeta.ref);
        const sameNotification = meta.notification && candidateMeta.notification && meta.notification === candidateMeta.notification;
        const sameCard = meta.card && candidateMeta.card && meta.card === candidateMeta.card;
        const conflictingBalance = sameCard && meta.balance != null && candidateMeta.balance != null &&
          Math.abs(meta.balance - candidateMeta.balance) > 0.01;
        const left = normalize(candidate.counterparty);
        const right = normalize(counterparty);
        const sameMerchant = left && right && (left === right || left.includes(right) || right.includes(left));
        const candidateTime = candidate.time?.getTime() ?? candidate.createdAt.getTime();
        const sameSourceShortWindow = sourceApp && candidate.sourceApp &&
          sourceApp === candidate.sourceApp && Math.abs(candidateTime - eventTime) <= 2 * 60 * 1000;
        const bankPair = ['bank_sms', 'bank_app'].includes(sourceApp || '') &&
          ['bank_sms', 'bank_app'].includes(candidate.sourceApp || '');
        const sameMerchantShortWindow = sameMerchant && Math.abs(candidateTime - eventTime) <= 90 * 1000;
        const isBankSource = (value?: string | null) => ['bank_sms', 'bank_app'].includes(value || '');
        const isPaymentSource = (value?: string | null) => ['wechat', 'alipay'].includes(value || '');
        const bankPaymentPair = (isBankSource(sourceApp) && isPaymentSource(candidate.sourceApp)) ||
          (isPaymentSource(sourceApp) && isBankSource(candidate.sourceApp));
        const channelGroup = (value?: string | null) => {
          const normalized = normalize(value);
          if (normalized.includes('财付通') || normalized.includes('微信')) return 'wechat';
          if (normalized.includes('支付宝')) return 'alipay';
          if (normalized.includes('银联') || normalized.includes('云闪付')) return 'unionpay';
          if (!normalized || normalized === '银行卡' || normalized === '银行支付') return 'generic_bank';
          return normalized;
        };
        const leftChannel = channelGroup(candidate.paymentChannel);
        const rightChannel = channelGroup(paymentChannel);
        const channelCompatible = leftChannel === rightChannel || leftChannel === 'generic_bank' || rightChannel === 'generic_bank';
        const isLowConfidenceMerchant = (value?: string | null) => {
          const normalized = normalize(value);
          return !normalized || /^(?:已)?(?:支付|付款|扣款|扣费|实付|消费)(?:成功)?[0-9]+(?:元)?$/u.test(normalized);
        };
        const bankPaymentFallback = bankPaymentPair && channelCompatible &&
          (isLowConfidenceMerchant(candidate.counterparty) || isLowConfidenceMerchant(counterparty)) &&
          Math.abs(candidateTime - eventTime) <= 2 * 60 * 1000;
        if (conflictingBalance) return false;
        return Boolean(sameRef || sameNotification || bankPaymentFallback ||
          (sameMerchant && (sameCard || sameSourceShortWindow || bankPair || sameMerchantShortWindow)));
      });
      if (duplicate) return duplicate;
    }

    const resolvedRelatedBillId = relatedBillId ?? await this.findRefundSourceBillId({
      userId,
      amount,
      type,
      source,
      sourceApp,
      counterparty,
      time,
      isRefund,
    });

    return this.prisma.bill.create({
      data: {
        amount: new Decimal(amount),
        type,
        description,
        date: new Date(date),
        time: time ? new Date(time) : new Date(),
        paymentChannel,
        counterparty,
        source: source || 'manual',
        sourceApp,
        categoryId,
        relatedBillId: resolvedRelatedBillId,
        notes: dedupeMarker ? [dedupeMarker, dedupeMeta].filter(Boolean).join(';') : undefined,
        userId,
      },
      include: {
        category: true,
        relatedBill: { select: { id: true, amount: true, type: true, description: true, date: true, time: true } },
      },
    });
  }

  private parseDedupeMeta(value?: string | null): { ref?: string; card?: string; balance?: number; notification?: string } {
    if (!value) return {};
    const ref = value.match(/(?:^|;)ref=([^;]+)/)?.[1];
    const card = value.match(/(?:^|;)card=([^;]+)/)?.[1];
    const notification = value.match(/(?:^|;)nk=([^;]+)/)?.[1];
    const balanceValue = value.match(/(?:^|;)bal=([0-9]+(?:\.[0-9]{1,2})?)/)?.[1];
    const balance = balanceValue ? Number(balanceValue) : undefined;
    return { ref, card, balance, notification };
  }

  /** 为通知产生的退款收入寻找同一用户近期同额原支出，建立可追溯关联。 */
  private async findRefundSourceBillId(input: {
    userId: string;
    amount: number;
    type: string;
    source?: string;
    sourceApp?: string;
    counterparty?: string;
    time?: string;
    isRefund?: boolean;
  }): Promise<number | undefined> {
    if (!input.isRefund || input.type !== 'income' || input.source !== 'notification') return undefined;
    const refundTime = input.time ? new Date(input.time) : new Date();
    const from = new Date(refundTime.getTime() - 90 * 24 * 60 * 60 * 1000);
    const candidates = await this.prisma.bill.findMany({
      where: {
        userId: input.userId,
        type: 'expense',
        amount: new Decimal(input.amount),
        date: { gte: from, lte: refundTime },
        source: 'notification',
        ...(input.sourceApp ? { sourceApp: input.sourceApp } : {}),
      },
      orderBy: [{ time: 'desc' }, { createdAt: 'desc' }],
      take: 20,
      select: { id: true, counterparty: true, description: true },
    });
    if (candidates.length === 0) return undefined;
    const normalize = (value?: string | null) => (value || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const counterparty = normalize(input.counterparty);
    const matched = counterparty
      ? candidates.find(candidate => {
          const existing = normalize(candidate.counterparty || candidate.description);
          return existing && (existing === counterparty || existing.includes(counterparty) || counterparty.includes(existing));
        })
      : candidates[0];
    return matched?.id;
  }

  /**
   * 确保用户存在，如果不存在则创建测试用户
   */
  private async ensureUserExists(userId: string) {
    const existingUser = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      await this.prisma.user.create({
        data: {
          id: userId,
          username: 'testuser',
          password: '$2b$10$EpRnTzVlqHNP0.fUbXUwSOyuiXe/QLSUG6xNekdHgTGmrpHEfIoxm', // 123456
          email: 'test@example.com',
          nickname: '测试用户',
        },
      });
    }
  }

  /**
   * 获取用户的账单列表
   */
  async findAll(userId: string, query: BillQueryDto) {
    const {
      page = 1,
      limit = 20,
      type,
      categoryId,
      startDate,
      endDate,
      orderBy = 'date',
      orderDirection = 'desc',
    } = query;

    const skip = (page - 1) * limit;

    const where: any = { userId };

    if (type) {
      where.type = type;
    }

    if (categoryId) {
      where.categoryId = categoryId;
    }

    const dateRange = this.buildDateRange(startDate, endDate);
    if (dateRange) {
      where.date = dateRange;
    }

    const [bills, total, summaryBills] = await Promise.all([
      this.prisma.bill.findMany({
        where,
        include: {
          category: true,
          relatedBill: { select: { id: true, amount: true, type: true, description: true, date: true, time: true } },
        },
        orderBy: orderBy === 'date'
          ? [
              { date: orderDirection },
              { time: orderDirection },
              { createdAt: orderDirection },
            ]
          : { [orderBy]: orderDirection },
        skip,
        take: limit,
      }),
      this.prisma.bill.count({ where }),
      this.prisma.bill.findMany({
        where,
        select: {
          date: true,
          type: true,
          amount: true,
        },
      }),
    ]);

    const monthlySummaryMap = new Map<string, { income: number; expense: number; net: number }>();

    summaryBills.forEach((bill) => {
      const date = new Date(bill.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const existing = monthlySummaryMap.get(monthKey) || { income: 0, expense: 0, net: 0 };
      const amount = bill.amount.toNumber();

      if (bill.type === 'income') {
        existing.income += amount;
        existing.net += amount;
      } else {
        existing.expense += amount;
        existing.net -= amount;
      }

      monthlySummaryMap.set(monthKey, existing);
    });

    const monthlySummary = Array.from(monthlySummaryMap.entries())
      .sort(([monthA], [monthB]) => monthB.localeCompare(monthA))
      .map(([month, summary]) => ({
        month,
        income: summary.income,
        expense: summary.expense,
        net: summary.net,
      }));

    return {
      data: bills,
      monthlySummary,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * 获取单个账单详情
   */
  async findOne(userId: string, id: number) {
    const bill = await this.prisma.bill.findFirst({
      where: {
        id,
        userId,
      },
      include: {
        category: true,
        relatedBill: { select: { id: true, amount: true, type: true, description: true, date: true, time: true } },
      },
    });

    if (!bill) {
      throw new Error('账单不存在');
    }

    return bill;
  }

  /**
   * 更新账单
   */
  async update(userId: string, id: number, updateBillDto: UpdateBillDto) {
    // 先检查账单是否存在且属于该用户
    await this.findOne(userId, id);

    const updateData: any = {};

    if (updateBillDto.amount !== undefined) {
      updateData.amount = new Decimal(updateBillDto.amount);
    }
    if (updateBillDto.type !== undefined) {
      updateData.type = updateBillDto.type;
    }
    if (updateBillDto.description !== undefined) {
      updateData.description = updateBillDto.description;
    }
    if (updateBillDto.date !== undefined) {
      updateData.date = new Date(updateBillDto.date);
    }
    if (updateBillDto.time !== undefined) {
      updateData.time = new Date(updateBillDto.time);
    }
    if (updateBillDto.paymentChannel !== undefined) {
      updateData.paymentChannel = updateBillDto.paymentChannel;
    }
    if (updateBillDto.counterparty !== undefined) {
      updateData.counterparty = updateBillDto.counterparty;
    }
    if (updateBillDto.categoryId !== undefined) {
      updateData.categoryId = updateBillDto.categoryId;
    }
    if (updateBillDto.relatedBillId !== undefined) {
      updateData.relatedBillId = updateBillDto.relatedBillId;
    }

    return this.prisma.bill.update({
      where: { id },
      data: updateData,
      include: {
        category: true,
        relatedBill: { select: { id: true, amount: true, type: true, description: true, date: true, time: true } },
      },
    });
  }

  /**
   * 删除账单
   */
  async remove(userId: string, id: number) {
    // 先检查账单是否存在且属于该用户
    await this.findOne(userId, id);

    return this.prisma.bill.delete({
      where: { id },
    });
  }

  /**
   * 获取用户的账单统计信息
   */
  async getStatistics(userId: string, startDate?: string, endDate?: string, granularity?: 'daily' | 'monthly') {
    this.logger.log(`[getStatistics] 开始查询统计数据 - userId: ${userId}, startDate: ${startDate}, endDate: ${endDate}, granularity: ${granularity}`);

    const where: any = { userId };

    const dateRange = this.buildDateRange(startDate, endDate);
    if (dateRange) {
      where.date = dateRange;
    }

    this.logger.log(`[getStatistics] 查询条件: ${JSON.stringify(where)}`);

    // 获取总体统计
    const [incomeStats, expenseStats] = await Promise.all([
      this.prisma.bill.aggregate({
        where: { ...where, type: 'income' },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.bill.aggregate({
        where: { ...where, type: 'expense' },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    this.logger.log(`[getStatistics] 收入统计: count=${incomeStats._count}, sum=${incomeStats._sum.amount}`);
    this.logger.log(`[getStatistics] 支出统计: count=${expenseStats._count}, sum=${expenseStats._sum.amount}`);

    // 获取支出分类统计
    const expenseCategoryStats = await this.prisma.bill.groupBy({
      by: ['categoryId'],
      where: { ...where, type: 'expense' },
      _sum: { amount: true },
      _count: true,
    });

    // 获取收入分类统计
    const incomeCategoryStats = await this.prisma.bill.groupBy({
      by: ['categoryId'],
      where: { ...where, type: 'income' },
      _sum: { amount: true },
      _count: true,
    });

    // 获取所有相关分类详细信息（过滤掉未分类的 null 值）
    const allCategoryIds = [
      ...expenseCategoryStats.map((stat) => stat.categoryId),
      ...incomeCategoryStats.map((stat) => stat.categoryId),
    ].filter((id): id is number => id !== null);
    const categories = await this.prisma.category.findMany({
      where: { id: { in: allCategoryIds } },
      select: { id: true, name: true, icon: true },
    });

    // 组装支出分类统计数据
    const totalExpenseAmount = expenseStats._sum.amount || new Decimal(0);
    const expenseCategoryData = expenseCategoryStats
      .map((stat) => {
        const category = categories.find((c) => c.id === stat.categoryId);
        const amount = stat._sum.amount || new Decimal(0);
        const percentage =
          totalExpenseAmount.toNumber() > 0
            ? (amount.toNumber() / totalExpenseAmount.toNumber()) * 100
            : 0;

        return {
          categoryId: stat.categoryId,
          categoryName: category?.name || '未分类',
          categoryIcon: category?.icon || '📊',
          amount: amount.toNumber(),
          percentage: parseFloat(percentage.toFixed(1)),
          count: stat._count,
        };
      })
      .sort((a, b) => b.amount - a.amount);

    // 组装收入分类统计数据
    const totalIncomeAmount = incomeStats._sum.amount || new Decimal(0);
    const incomeCategoryData = incomeCategoryStats
      .map((stat) => {
        const category = categories.find((c) => c.id === stat.categoryId);
        const amount = stat._sum.amount || new Decimal(0);
        const percentage =
          totalIncomeAmount.toNumber() > 0
            ? (amount.toNumber() / totalIncomeAmount.toNumber()) * 100
            : 0;

        return {
          categoryId: stat.categoryId,
          categoryName: category?.name || '未分类',
          categoryIcon: category?.icon || '💰',
          amount: amount.toNumber(),
          percentage: parseFloat(percentage.toFixed(1)),
          count: stat._count,
        };
      })
      .sort((a, b) => b.amount - a.amount);

    // 获取月度趋势数据 - 根据 granularity 参数或日期范围自动判断
    const monthlyTrends = [];

    // 计算查询日期范围
    const startDateObj = startDate ? new Date(startDate) : new Date();
    const endDateObj = endDate ? new Date(endDate) : new Date();
    const daysDiff = Math.ceil((endDateObj.getTime() - startDateObj.getTime()) / (1000 * 60 * 60 * 24));

    // 决定是否返回月度趋势：显式指定 granularity=monthly 或自动判断 >90 天
    const shouldReturnMonthly = granularity === 'monthly' || (!granularity && daysDiff > 90);
    if (shouldReturnMonthly) {
      const monthStart = new Date(startDateObj.getFullYear(), startDateObj.getMonth(), 1);
      const monthEnd = new Date(endDateObj.getFullYear(), endDateObj.getMonth() + 1, 0, 23, 59, 59);

      // 一次性查询日期范围内的所有账单
      const monthlyBills = await this.prisma.bill.findMany({
        where: {
          userId,
          date: {
            gte: monthStart,
            lte: monthEnd,
          },
        },
        select: {
          date: true,
          type: true,
          amount: true,
        },
      });

      // 在应用层按月份分组
      const monthlyMap = new Map<string, { income: number; expense: number }>();

      monthlyBills.forEach((bill) => {
        const date = new Date(bill.date);
        const monthKey = `${date.getFullYear()}-${date.getMonth() + 1}`;
        if (!monthlyMap.has(monthKey)) {
          monthlyMap.set(monthKey, { income: 0, expense: 0 });
        }
        const monthData = monthlyMap.get(monthKey);
        if (bill.type === 'income') {
          monthData.income += bill.amount.toNumber();
        } else {
          monthData.expense += bill.amount.toNumber();
        }
      });

      // 生成完整的月份序列（从 startDate 到 endDate）
      const currentMonth = new Date(startDateObj.getFullYear(), startDateObj.getMonth(), 1);
      const endMonth = new Date(endDateObj.getFullYear(), endDateObj.getMonth(), 1);

      while (currentMonth <= endMonth) {
        const monthKey = `${currentMonth.getFullYear()}-${currentMonth.getMonth() + 1}`;
        const monthData = monthlyMap.get(monthKey) || { income: 0, expense: 0 };

        monthlyTrends.push({
          month: `${currentMonth.getMonth() + 1}月`,
          year: currentMonth.getFullYear(),
          income: monthData.income,
          expense: monthData.expense,
        });

        currentMonth.setMonth(currentMonth.getMonth() + 1);
      }
    }

    // 获取每日趋势数据 - 根据 granularity 参数或日期范围自动判断
    const dailyTrends = [];
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

      this.logger.log(`[getStatistics] 计算每日趋势 - 天数差: ${daysDiff}`);

      // 决定是否返回每日趋势：显式指定 granularity=daily 或自动判断 ≤90 天（且未指定 monthly）
      const shouldReturnDaily = granularity === 'daily' || (!granularity && daysDiff <= 90);
      // 上限放宽到 366 天（支持全年每日数据）
      if (shouldReturnDaily && daysDiff <= 366) {
        // 一次性查询所有账单数据
        const bills = await this.prisma.bill.findMany({
          where,
          select: {
            date: true,
            type: true,
            amount: true,
          },
        });

        // 在应用层按日期分组
        const dailyMap = new Map<string, { income: number; expense: number }>();

        bills.forEach((bill) => {
          const dateKey = bill.date.toISOString().split('T')[0];
          if (!dailyMap.has(dateKey)) {
            dailyMap.set(dateKey, { income: 0, expense: 0 });
          }
          const dayData = dailyMap.get(dateKey);
          if (bill.type === 'income') {
            dayData.income += bill.amount.toNumber();
          } else {
            dayData.expense += bill.amount.toNumber();
          }
        });

        // 生成完整的日期序列（包括没有数据的日期）
        for (let i = 0; i <= daysDiff; i++) {
          const dayDate = new Date(start);
          dayDate.setDate(start.getDate() + i);
          const dateKey = dayDate.toISOString().split('T')[0];
          const dayData = dailyMap.get(dateKey) || { income: 0, expense: 0 };

          dailyTrends.push({
            date: dateKey,
            income: dayData.income,
            expense: dayData.expense,
          });
        }

        this.logger.log(`[getStatistics] 每日趋势数据生成完成 - 共 ${dailyTrends.length} 天`);
      } else if (shouldReturnDaily) {
        this.logger.warn(`[getStatistics] 天数差超过366天，跳过每日趋势计算`);
      }
    } else {
      this.logger.log(`[getStatistics] 未提供日期范围，跳过每日趋势计算`);
    }

    const totalIncome = incomeStats._sum.amount || new Decimal(0);
    const totalExpense = expenseStats._sum.amount || new Decimal(0);
    const balance = totalIncome.minus(totalExpense);

    const result = {
      // 总体统计
      totalIncome: totalIncome.toNumber(),
      totalExpense: totalExpense.toNumber(),
      balance: balance.toNumber(),
      incomeCount: incomeStats._count,
      expenseCount: expenseStats._count,
      // 分类统计（用于饼图和分类占比）
      expenseCategoryStats: expenseCategoryData,
      incomeCategoryStats: incomeCategoryData,
      // 月度趋势（用于折线图）
      monthlyTrends,
      // 每日趋势（用于日趋势图）
      dailyTrends,
    };

    this.logger.log(`[getStatistics] 统计完成 - 收入: ${result.totalIncome}, 支出: ${result.totalExpense}, 每日趋势: ${dailyTrends.length}条`);

    return result;
  }
}
