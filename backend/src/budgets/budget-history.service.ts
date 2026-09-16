import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Internal evidence API. Call with the full monthly/yearly budget comparison window,
 * not only the day being reviewed. Bounds are instants [start, end) in UTC+8. */
@Injectable()
export class BudgetHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async evidence(
    userId: string,
    start: Date,
    end: Date,
    now = new Date(),
    transaction?: Prisma.TransactionClient,
  ) {
    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      start >= end ||
      end > now ||
      end.getTime() - start.getTime() > 366 * 86400000
    ) {
      throw new BadRequestException(
        '预算证据只能查询已结束且不超过一年的时间范围',
      );
    }
    const read = async (tx: Prisma.TransactionClient) => {
      const launch = await tx.budgetHistoryLaunch.findUnique({
        where: { id: 1 },
      });
      if (!launch || launch.startedAt > start) {
        return {
          status: 'unavailable' as const,
          reason: '无可核验的当期预算',
          budgets: [],
        };
      }
      const rows = await tx.$queryRaw<
        Array<{
          budget_id: number;
          snapshot: Prisma.JsonValue;
          action: string;
          changed: boolean;
          revision_id: string;
        }>
      >`
        WITH initial AS (
          SELECT DISTINCT ON (budget_id) budget_id, snapshot, action, id
          FROM budget_revisions WHERE user_id = ${userId}::uuid AND recorded_at <= ${start}
          ORDER BY budget_id, recorded_at DESC, id DESC
        ), changed AS (
          SELECT DISTINCT budget_id FROM budget_revisions
          WHERE user_id = ${userId}::uuid AND recorded_at > ${start} AND recorded_at < ${end}
        )
        SELECT COALESCE(i.budget_id,c.budget_id) AS budget_id,
          i.snapshot, i.action, i.id::text AS revision_id, c.budget_id IS NOT NULL AS changed
        FROM initial i FULL JOIN changed c ON c.budget_id = i.budget_id
        ORDER BY COALESCE(i.budget_id,c.budget_id)
      `;
      return {
        status: 'available' as const,
        budgets: rows
          .filter(
            (r) =>
              r.changed ||
              (r.action !== 'delete' &&
                (r.snapshot as Prisma.JsonObject)?.is_active === true),
          )
          .map((r) => ({
            budgetId: r.budget_id,
            status: r.changed
              ? ('changed_in_period' as const)
              : ('stable' as const),
            // Do not hand a model a changed rule as a usable budget amount.
            revisionId: r.changed ? null : r.revision_id,
            snapshot: r.changed ? null : r.snapshot,
          })),
      };
    };
    if (transaction) return read(transaction);
    return this.prisma.$transaction(read, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }
}
