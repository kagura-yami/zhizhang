import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BudgetHistoryService } from '../../budgets/budget-history.service';
import { closedReviewPeriod } from '../../ledger/ledger-period';
import { LedgerAccumulator, ledgerKind } from '../../ledger/ledger-semantics';

const billSelect = {
  id: true,
  amount: true,
  type: true,
  date: true,
  updatedAt: true,
  description: true,
  categoryId: true,
  category: { select: { name: true } },
  financialClassification: {
    select: { kind: true, currency: true, billUpdatedAt: true },
  },
  relatedBill: { select: { userId: true, type: true, date: true } },
} as const;
type Bill = Prisma.BillGetPayload<{ select: typeof billSelect }>;

/** No model calls or write tools. All inputs share one repeatable-read snapshot. */
@Injectable()
export class RetrospectiveEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly budgets: BudgetHistoryService,
  ) {}

  async collect(
    userId: string,
    kind: 'day' | 'month',
    key: string,
    now = new Date(),
  ) {
    if (!['day', 'month'].includes(kind))
      throw new BadRequestException('请选择日或月复盘');
    const { start, end } = closedReviewPeriod(kind, key, now);
    return this.prisma.$transaction(
      async (tx) => {
        const owner = await tx.user.findFirst({
          where: { id: userId, isActive: true },
          select: {
            socialPreference: {
              select: { allowAiFeedback: true, updatedAt: true },
            },
          },
        });
        if (!owner) throw new NotFoundException('用户不存在或已停用');
        const summary = new LedgerAccumulator(userId, start, end);
        const bills: Array<{
          ref: string;
          amount: string;
          type: string;
          date: string;
          category: string | null;
          description: string | null;
          classification: string;
          included: boolean;
        }> = [];
        const sources: Array<{
          ref: string;
          kind: 'bill' | 'message' | 'vote';
          id: number;
          version: string;
          authorId?: string;
          consentVersion?: string;
        }> = [];
        const categories = new Map<string, LedgerAccumulator>();
        const categoryNames = new Map<string, string | null>();
        const perBill = new Map<number, string>();
        let cursor = 0;
        while (true) {
          const rows = await tx.bill.findMany({
            where: {
              userId,
              date: { gte: start, lte: end },
              id: { gt: cursor },
            },
            select: billSelect,
            take: 500,
            orderBy: { id: 'asc' },
          });
          for (const row of rows) {
            summary.add(row);
            const one = new LedgerAccumulator(userId, start, end);
            one.add(row);
            const result = one.result(),
              ref = `B${bills.length + 1}`;
            const categoryKey =
              row.categoryId == null ? 'none' : String(row.categoryId);
            categoryNames.set(categoryKey, row.category?.name ?? null);
            let category = categories.get(categoryKey);
            if (!category) {
              category = new LedgerAccumulator(userId, start, end);
              categories.set(categoryKey, category);
            }
            category.add(row);
            perBill.set(row.id, ref);
            bills.push({
              ref,
              amount: row.amount.toFixed(4),
              type: row.type,
              date: row.date.toISOString().slice(0, 10),
              category: row.category?.name ?? null,
              description: row.description,
              classification: result.complete
                ? ledgerKind(row, userId)
                : 'needs_review',
              included: result.counts.included === 1,
            });
            sources.push({
              ref,
              kind: 'bill',
              id: row.id,
              version: createHash('sha256')
                .update(JSON.stringify(row))
                .digest('hex'),
            });
          }
          if (rows.length < 500) break;
          cursor = rows[rows.length - 1].id;
        }
        const feedback: Array<{
          ref: string;
          bill: string;
          author: string;
          role: 'owner' | 'reviewer';
          isMain: boolean;
          text: string;
        }> = [];
        const votes: Array<{
          ref: string;
          bill: string;
          author: string;
          vote: string;
        }> = [];
        const aliases = new Map<string, string>();
        const alias = (id: string) => {
          if (id === userId) return '本人';
          if (!aliases.has(id)) aliases.set(id, `评价者${aliases.size + 1}`);
          return aliases.get(id);
        };
        if (owner.socialPreference?.allowAiFeedback) {
          const authorFilter: Prisma.UserWhereInput = {
            isActive: true,
            socialPreference: { is: { allowAiAuthoredFeedback: true } },
          };
          let lastThread = 0;
          while (true) {
            // The owner retains access after grant revocation; archived/deleted bills are excluded.
            const threads = await tx.billReviewThread.findMany({
              where: {
                ownerId: userId,
                deletedAt: null,
                id: { gt: lastThread },
                bill: { is: { userId, date: { gte: start, lte: end } } },
              },
              select: {
                id: true,
                billId: true,
                reviewerId: true,
                vote: true,
                reviewer: {
                  select: {
                    isActive: true,
                    socialPreference: {
                      select: {
                        allowAiAuthoredFeedback: true,
                        updatedAt: true,
                      },
                    },
                  },
                },
              },
              take: 500,
              orderBy: { id: 'asc' },
            });
            for (const thread of threads) {
              const bill = perBill.get(thread.billId);
              if (!bill) continue;
              if (
                thread.reviewer.isActive &&
                thread.reviewer.socialPreference?.allowAiAuthoredFeedback
              ) {
                const voteRef = `V${votes.length + 1}`;
                votes.push({
                  ref: voteRef,
                  bill,
                  author: alias(thread.reviewerId),
                  vote: thread.vote,
                });
                sources.push({
                  ref: voteRef,
                  kind: 'vote',
                  id: thread.id,
                  version: thread.vote,
                  authorId: thread.reviewerId,
                  consentVersion:
                    thread.reviewer.socialPreference.updatedAt.toISOString(),
                });
              }
              let lastMessage = 0;
              while (true) {
                const messages = await tx.reviewMessage.findMany({
                  where: {
                    threadId: thread.id,
                    id: { gt: lastMessage },
                    withdrawn: false,
                    hidden: false,
                    author: { is: authorFilter },
                  },
                  select: {
                    id: true,
                    authorId: true,
                    author: {
                      select: {
                        socialPreference: { select: { updatedAt: true } },
                      },
                    },
                    body: true,
                    revision: true,
                    mainSlot: true,
                  },
                  take: 500,
                  orderBy: { id: 'asc' },
                });
                for (const message of messages) {
                  // Defensive against invalid participant rows; never include a third party's text.
                  if (![userId, thread.reviewerId].includes(message.authorId))
                    continue;
                  const ref = `M${feedback.length + 1}`;
                  feedback.push({
                    ref,
                    bill,
                    author: alias(message.authorId),
                    role: message.authorId === userId ? 'owner' : 'reviewer',
                    isMain: message.mainSlot === 1,
                    text: message.body,
                  });
                  sources.push({
                    ref,
                    kind: 'message',
                    id: message.id,
                    version: String(message.revision),
                    authorId: message.authorId,
                    consentVersion:
                      message.author.socialPreference.updatedAt.toISOString(),
                  });
                }
                if (messages.length < 500) break;
                lastMessage = messages[messages.length - 1].id;
              }
            }
            if (threads.length < 500) break;
            lastThread = threads[threads.length - 1].id;
          }
        }
        const periodEnd = new Date(end.getTime() + 86400000 - 8 * 3600000);
        const budgetEvidence: Array<{
          period: 'monthly' | 'yearly';
          startDate: string;
          endDate: string;
          coverage: 'available' | 'unavailable';
          changedBudgetCount: number;
          comparisons: Array<{
            revisionId: string;
            name: Prisma.JsonValue;
            amount: Prisma.JsonValue;
            basis: 'gross_expense';
            grossExpense: string;
            refundInflow: string;
            complete: boolean;
            overBudget: boolean | null;
          }>;
        }> = [];
        for (const period of ['monthly', 'yearly'] as const) {
          const from = new Date(
            `${key.slice(0, period === 'monthly' ? 7 : 4)}${period === 'monthly' ? '-01' : '-01-01'}T00:00:00.000Z`,
          );
          const evidence = await this.budgets.evidence(
            userId,
            new Date(from.getTime() - 8 * 3600000),
            periodEnd,
            now,
            tx,
          );
          const stable = evidence.budgets.filter(
            (b) =>
              b.status === 'stable' &&
              (b.snapshot as Prisma.JsonObject).period === period,
          );
          const accumulators = stable.map(
            () => new LedgerAccumulator(userId, from, end),
          );
          if (stable.length) {
            let lastId = 0;
            while (true) {
              const rows: Bill[] = await tx.bill.findMany({
                where: {
                  userId,
                  date: { gte: from, lte: end },
                  id: { gt: lastId },
                },
                select: billSelect,
                take: 500,
                orderBy: { id: 'asc' },
              });
              rows.forEach((row) =>
                stable.forEach((b, i) => {
                  const cat = (b.snapshot as Prisma.JsonObject).category_id;
                  if (cat == null || cat === row.categoryId)
                    accumulators[i].add(row);
                }),
              );
              if (rows.length < 500) break;
              lastId = rows[rows.length - 1].id;
            }
          }
          budgetEvidence.push({
            period,
            startDate: from.toISOString().slice(0, 10),
            endDate: end.toISOString().slice(0, 10),
            coverage: evidence.status,
            changedBudgetCount: evidence.budgets.filter(
              (b) => b.status === 'changed_in_period',
            ).length,
            comparisons: stable.map((b, i) => {
              const snapshot = b.snapshot as Prisma.JsonObject,
                amounts = accumulators[i].result();
              return {
                revisionId: b.revisionId,
                name: snapshot.name,
                amount: snapshot.amount,
                basis: 'gross_expense',
                grossExpense: amounts.grossExpense,
                refundInflow: amounts.refundInflow,
                complete: amounts.complete,
                overBudget: amounts.complete
                  ? new Prisma.Decimal(amounts.grossExpense).gt(
                      String(snapshot.amount),
                    )
                  : null,
              };
            }),
          });
        }
        const { pendingBillIds: _ids, ...totals } = summary.result();
        const payload = {
          kind,
          period: key,
          facts: {
            ...totals,
            bills,
            categories: [...categories].map(([id, accumulator]) => ({
              name: categoryNames.get(id),
              totals: (({ pendingBillIds, ...safe }) => safe)(
                accumulator.result(),
              ),
            })),
          },
          feedback,
          votes,
          budgets: budgetEvidence,
          gaps: [
            ...(!totals.complete ? ['部分账单数据异常，汇总可能不完整'] : []),
            ...(!feedback.some((m) => m.role === 'reviewer')
              ? ['暂无获准用于 AI 的有效好友文字反馈']
              : []),
            ...(budgetEvidence.some((b) => b.coverage === 'unavailable')
              ? ['部分周期无可核验的当期预算']
              : []),
          ],
        };
        return {
          capturedAt: now.toISOString(),
          inputDigest: createHash('sha256')
            .update(
              JSON.stringify({
                payload,
                sources,
                ownerConsentVersion:
                  owner.socialPreference?.updatedAt.toISOString(),
              }),
            )
            .digest('hex'),
          payload,
          sources,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 60000,
      },
    );
  }
}
