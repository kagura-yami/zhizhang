import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
    console.log('🗄️ Database connected successfully');

    // 初始化默认分类数据
    await this.initializeDefaultCategories();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  private async initializeDefaultCategories() {
    try {
      // 使用“按名称+类型查找后补齐”的方式初始化，兼容已经运行过旧版本的数据库。
      // 旧版本只在默认分类数量为 0 时初始化，导致线上缺少“其他”分类，自动账单只能落成 null。
      const defaultCategories = [
          // 收入分类
          { name: '工资', type: 'income', icon: '💰', color: '#4CAF50', isDefault: true, sortOrder: 1 },
          { name: '奖金', type: 'income', icon: '🎁', color: '#8BC34A', isDefault: true, sortOrder: 2 },
          { name: '投资', type: 'income', icon: '📈', color: '#009688', isDefault: true, sortOrder: 3 },
          { name: '退款', type: 'income', icon: '↩️', color: '#2E9B72', isDefault: true, sortOrder: 4 },
          { name: '其他收入', type: 'income', icon: '💵', color: '#43A047', isDefault: true, sortOrder: 5 },

          // 支出分类（包含自动记账兜底分类）
          { name: '餐饮', type: 'expense', icon: '🍽️', color: '#FF5722', isDefault: true, sortOrder: 1 },
          { name: '交通', type: 'expense', icon: '🚗', color: '#FF9800', isDefault: true, sortOrder: 2 },
          { name: '购物', type: 'expense', icon: '🛍️', color: '#E91E63', isDefault: true, sortOrder: 3 },
          { name: '居住', type: 'expense', icon: '🏠', color: '#795548', isDefault: true, sortOrder: 4 },
          { name: '娱乐', type: 'expense', icon: '🎮', color: '#9C27B0', isDefault: true, sortOrder: 5 },
          { name: '医疗', type: 'expense', icon: '💊', color: '#F44336', isDefault: true, sortOrder: 6 },
          { name: '教育', type: 'expense', icon: '📚', color: '#3F51B5', isDefault: true, sortOrder: 7 },
          { name: '其他', type: 'expense', icon: '📝', color: '#607D8B', isDefault: true, sortOrder: 8 },
        ];

      for (const category of defaultCategories) {
        const exists = await this.category.findFirst({
          where: { name: category.name, type: category.type, isDefault: true },
          select: { id: true },
        });
        if (!exists) {
          await this.category.create({ data: category });
        }
      }

      await this.backfillNotificationBillCategories();
      console.log('✅ Default categories checked successfully');
    } catch (error) {
      console.error('❌ Error initializing default categories:', error);
    }
  }

  /**
   * 为旧版本已经创建但没有 categoryId 的自动账单补全分类。
   * 只处理 source=notification 且 categoryId=null 的记录，不覆盖用户手动选择过的分类。
   */
  private async backfillNotificationBillCategories() {
    const expenseCategories = await this.category.findMany({
      where: { type: 'expense', isDefault: true },
      select: { id: true, name: true },
    });
    const byName = new Map(expenseCategories.map((category) => [category.name, category.id]));
    const otherId = byName.get('其他');
    if (!otherId) return;

    const rules: Array<{ name: string; keywords: string[] }> = [
      { name: '餐饮', keywords: ['美团外卖', '饿了么', '外卖', '餐饮', '餐厅', '饭店', '咖啡', '奶茶', '星巴克', '肯德基', '麦当劳', '美团支付'] },
      { name: '交通', keywords: ['滴滴', '打车', '地铁', '公交', '加油', '停车', '12306', '高铁', '机票'] },
      { name: '医疗', keywords: ['医院', '药房', '药店', '医疗', '挂号', '门诊', '体检'] },
      { name: '教育', keywords: ['学费', '培训', '课程', '教育', '书店', '考试'] },
      { name: '居住', keywords: ['房租', '租房', '物业', '水费', '电费', '燃气', '宽带', '话费'] },
      { name: '娱乐', keywords: ['游戏', '电影', '影院', '视频会员', '音乐会员', '会员充值', 'KTV', '演出', '门票'] },
      { name: '购物', keywords: ['拼多多', '淘宝', '天猫', '京东', '唯品会', '商城', '购物', '超市', '商场', '快递'] },
    ];

    const uncategorized = await this.bill.findMany({
      where: { source: 'notification', type: 'expense', categoryId: null },
      select: { id: true, description: true, counterparty: true, sourceApp: true },
    });

    for (const bill of uncategorized) {
      const text = `${bill.sourceApp || ''} ${bill.counterparty || ''} ${bill.description || ''}`.toLowerCase();
      const matchedRule = rules.find((rule) => rule.keywords.some((keyword) => text.includes(keyword.toLowerCase())));
      const categoryId = matchedRule ? byName.get(matchedRule.name) : otherId;
      if (categoryId) {
        await this.bill.update({ where: { id: bill.id }, data: { categoryId } });
      }
    }
  }

  // 分类相关方法
  async getCategories(userId?: string) {
    return this.category.findMany({
      where: userId ? { userId } : { userId: null },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });
  }

  async getCategoryById(id: number, userId?: string) {
    return this.category.findFirst({
      where: {
        id,
        userId: userId || null,
      },
    });
  }

  async createCategory(data: {
    name: string;
    type: string;
    icon?: string;
    color?: string;
    userId?: string;
  }) {
    return this.category.create({
      data,
    });
  }

  async updateCategory(
    id: number,
    data: {
      name?: string;
      type?: string;
      icon?: string;
      color?: string;
    },
    userId?: string,
  ) {
    return this.category.update({
      where: {
        id,
        userId: userId || null,
      },
      data,
    });
  }

  async deleteCategory(id: number, userId?: string) {
    return this.category.delete({
      where: {
        id,
        userId: userId || null,
      },
    });
  }

  // 账单相关方法
  async getBills(userId: string) {
    return this.bill.findMany({
      where: { userId },
      include: {
        category: true,
      },
      orderBy: {
        date: 'desc',
      },
    });
  }

  async getBillById(id: number, userId: string) {
    return this.bill.findFirst({
      where: {
        id,
        userId,
      },
      include: {
        category: true,
      },
    });
  }

  async createBill(data: {
    amount: number;
    type: string;
    description?: string;
    date: Date;
    categoryId?: number;
    userId: string;
  }) {
    return this.bill.create({
      data: {
        ...data,
        amount: data.amount,
      },
      include: {
        category: true,
      },
    });
  }

  async updateBill(
    id: number,
    data: {
      amount?: number;
      type?: string;
      description?: string;
      date?: Date;
      categoryId?: number;
    },
    userId: string,
  ) {
    return this.bill.update({
      where: {
        id,
        userId,
      },
      data,
      include: {
        category: true,
      },
    });
  }

  async deleteBill(id: number, userId: string) {
    return this.bill.delete({
      where: {
        id,
        userId,
      },
    });
  }

  // 统计相关方法
  async getStatistics(userId: string) {
    const where = { userId };

    const [incomeSum, expenseSum, billCount] = await Promise.all([
      this.bill.aggregate({
        where: { ...where, type: 'income' },
        _sum: { amount: true },
      }),
      this.bill.aggregate({
        where: { ...where, type: 'expense' },
        _sum: { amount: true },
      }),
      this.bill.count({ where }),
    ]);

    const totalIncome = Number(incomeSum._sum.amount || 0);
    const totalExpense = Number(expenseSum._sum.amount || 0);

    return {
      data: {
        totalIncome,
        totalExpense,
        balance: totalIncome - totalExpense,
        billCount,
      },
      error: null,
    };
  }
}
