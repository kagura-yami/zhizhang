import { createHash } from 'node:crypto';
import { RetrospectiveJobsService } from './retrospective-jobs.service';
import { Injectable, Logger } from '@nestjs/common';
import { BillsService } from '../../bills/bills.service';
import { CategoriesService } from '../../categories/categories.service';

/**
 * 工具执行服务
 * 执行 AI 调用的工具，操作账单和分类数据
 */
@Injectable()
export class ToolExecutorService {
  private readonly logger = new Logger(ToolExecutorService.name);

  constructor(
    private readonly billsService: BillsService,
    private readonly categoriesService: CategoriesService,
    private readonly retrospectiveJobs: RetrospectiveJobsService,
  ) {}

  /**
   * 执行工具调用
   */
  async executeTool(
    userId: string,
    toolName: string,
    args: Record<string, any>,
    context?: { configId: number; turnKey: string },
  ): Promise<{ success: boolean; data: any; message: string }> {
    this.logger.log(`执行工具: ${toolName}, 参数: ${JSON.stringify(args)}`);

    switch (toolName) {
      case 'create_retrospective': {
        try {
          if (!context?.configId || !context.turnKey) throw new Error('缺少当前聊天模型，请重新发送请求');
          if (!['day', 'month'].includes(args.kind) || typeof args.period !== 'string') throw new Error('请明确需要复盘的日期或月份');
          // 同一条用户消息中的重复工具调用复用任务，不接受模型传来的账号、模型或幂等键。
          const hex = createHash('sha256').update(JSON.stringify([userId, context.turnKey, args.kind, args.period, context.configId])).digest('hex');
          const clientKey = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
          const job = await this.retrospectiveJobs.create(userId, { kind: args.kind, period: args.period, configId: context.configId, clientKey });
          return { success: true, data: job, message: `${job.period} 的复盘任务已创建。后台生成后自动保存在“我的 → 财务 → 复盘”。当前状态：${job.status}；请勿将排队或生成中描述为已完成。` };
        } catch (error) {
          return { success: false, data: null, message: `复盘未创建：${error.message}` };
        }
      }
      case 'create_bills':
        return this.executeCreateBills(userId, args);
      case 'query_bills':
        return this.executeQueryBills(userId, args);
      case 'delete_bills':
        return this.executeDeleteBills(userId, args);
      case 'get_statistics':
        return this.executeGetStatistics(userId, args);
      default:
        return {
          success: false,
          data: null,
          message: `未知工具: ${toolName}`,
        };
    }
  }

  /**
   * create_bills: 仅做数据补全（categoryName → categoryId），不入库
   * 返回补全后的账单数据，由前端展示和确认后手动保存
   */
  private async executeCreateBills(
    userId: string,
    args: any,
  ): Promise<{ success: boolean; data: any; message: string }> {
    try {
      const categories = await this.categoriesService.findAll(userId);

      const bills = (args.bills || []).map((bill: any) => {
        const category = categories.find(
          (c) => c.name === bill.categoryName && c.type === bill.type,
        );
        return {
          amount: Number(bill.amount),
          type: bill.type,
          description: bill.description || '',
          categoryName: bill.categoryName,
          categoryId: category?.id || null,
          categoryIcon: category?.icon || null,
          date: bill.date,
        };
      });

      return {
        success: true,
        data: { bills },
        message: `识别到 ${bills.length} 条账单`,
      };
    } catch (error) {
      this.logger.error(`create_bills 执行失败: ${error.message}`);
      return {
        success: false,
        data: null,
        message: `创建账单失败: ${error.message}`,
      };
    }
  }

  /**
   * query_bills: 查询账单记录
   */
  private async executeQueryBills(
    userId: string,
    args: any,
  ): Promise<{ success: boolean; data: any; message: string }> {
    try {
      let categoryId: number | undefined;
      if (args.categoryName) {
        const categories = await this.categoriesService.findAll(userId);
        const cat = categories.find((c) => c.name === args.categoryName);
        categoryId = cat?.id;
      }

      const result = await this.billsService.findAll(userId, {
        startDate: args.startDate,
        endDate: args.endDate,
        type: args.type,
        categoryId,
        limit: Math.min(args.limit || 20, 50),
        page: 1,
        orderBy: 'date',
        orderDirection: 'desc',
      });

      return {
        success: true,
        data: result,
        message: `查询到 ${result.data.length} 条账单`,
      };
    } catch (error) {
      this.logger.error(`query_bills 执行失败: ${error.message}`);
      return {
        success: false,
        data: null,
        message: `查询账单失败: ${error.message}`,
      };
    }
  }

  /**
   * delete_bills: 删除账单
   */
  private async executeDeleteBills(
    userId: string,
    args: any,
  ): Promise<{ success: boolean; data: any; message: string }> {
    try {
      const results: { id: number; deleted: boolean; error?: string }[] = [];
      for (const id of args.billIds || []) {
        try {
          await this.billsService.remove(userId, id);
          results.push({ id, deleted: true });
        } catch (e) {
          results.push({ id, deleted: false, error: e.message });
        }
      }
      const successCount = results.filter((r) => r.deleted).length;
      return {
        success: true,
        data: { results, successCount },
        message: `成功删除 ${successCount} 条账单`,
      };
    } catch (error) {
      this.logger.error(`delete_bills 执行失败: ${error.message}`);
      return {
        success: false,
        data: null,
        message: `删除账单失败: ${error.message}`,
      };
    }
  }

  /**
   * get_statistics: 获取统计数据
   */
  private async executeGetStatistics(
    userId: string,
    args: any,
  ): Promise<{ success: boolean; data: any; message: string }> {
    try {
      const stats = await this.billsService.getStatistics(
        userId,
        args.startDate,
        args.endDate,
      );
      return {
        success: true,
        data: stats,
        message: '统计数据获取成功',
      };
    } catch (error) {
      this.logger.error(`get_statistics 执行失败: ${error.message}`);
      return {
        success: false,
        data: null,
        message: `获取统计失败: ${error.message}`,
      };
    }
  }
}
