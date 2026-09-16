import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BillReviewThread, ReviewMessage } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SocialAccessService, SocialTx } from '../social/social-access.service';
import { ChangeReviewMessageDto, NewReviewMessageDto, ReviewPageDto } from './reviews.dto';
import { reviewSnapshot } from './review-snapshot';

const minimalBill = { id: true, userId: true, amount: true, type: true, date: true, time: true, updatedAt: true, category: { select: { name: true } } } as const;
const profile = { id: true, nickname: true, avatar: true } as const;
const page = (dto: ReviewPageDto) => ({ skip: (dto.page - 1) * dto.pageSize, take: dto.pageSize });

export function visibleReviewMessage(message: ReviewMessage) {
  return { id: message.id, authorId: message.authorId, isMain: message.mainSlot === 1,
    body: message.hidden || message.withdrawn ? null : message.body,
    withdrawn: message.withdrawn, hidden: message.hidden, revision: message.revision,
    createdAt: message.createdAt, updatedAt: message.updatedAt };
}

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService, private readonly access: SocialAccessService) {}

  async withThread<T>(userId: string, id: number, write: boolean, run: (tx: SocialTx, thread: BillReviewThread) => Promise<T>): Promise<T> {
    const identity = await this.prisma.billReviewThread.findUnique({ where: { id }, select: { ownerId: true, reviewerId: true } });
    if (!identity || ![identity.ownerId, identity.reviewerId].includes(userId)) throw new NotFoundException('评价不存在');
    return this.prisma.$transaction(async tx => {
      await this.access.lockUsers(tx, [identity.ownerId, identity.reviewerId]);
      await this.access.enabled(tx, userId);
      const thread = await tx.billReviewThread.findUnique({ where: { id } });
      if (!thread) throw new NotFoundException('评价不存在');
      if (write || userId !== thread.ownerId) {
        if (!thread.billId || thread.deletedAt) throw new ForbiddenException('原账单已删除，仅主人可查看存档');
        const grant = await this.access.grant(tx, thread.ownerId, thread.reviewerId);
        const visible = await tx.bill.findFirst({ where: { ...this.access.billWhere(grant), id: thread.billId }, select: { id: true } });
        if (!visible) throw new ForbiddenException('账单已不在授权范围内');
      }
      return run(tx, thread);
    });
  }

  async vote(userId: string, billId: number, vote: string) {
    const identity = await this.prisma.bill.findUnique({ where: { id: billId }, select: { userId: true } });
    if (!identity) throw new NotFoundException('账单不存在');
    return this.prisma.$transaction(async tx => {
      await this.access.lockUsers(tx, [identity.userId, userId]);
      const grant = await this.access.grant(tx, identity.userId, userId);
      const bill = await tx.bill.findFirst({ where: { ...this.access.billWhere(grant), id: billId }, select: minimalBill });
      if (!bill) throw new ForbiddenException('账单已不在授权范围内');
      const result = await tx.billReviewThread.upsert({ where: { originalBillId_reviewerId: { originalBillId: billId, reviewerId: userId } },
        create: { ownerId: bill.userId, reviewerId: userId, billId, originalBillId: billId, vote, snapshot: reviewSnapshot(bill), initialBillUpdatedAt: bill.updatedAt, snapshotUpdatedAt: bill.updatedAt },
        update: { vote },
      });
      // No vote events or totals: a reviewer may only see their own choice.
      return { threadId: result.id, vote: result.vote };
    });
  }

  async detail(userId: string, id: number, query: ReviewPageDto) {
    return this.withThread(userId, id, false, async (tx, thread) => {
      const bill = thread.billId ? await tx.bill.findUnique({ where: { id: thread.billId }, select: minimalBill }) : null;
      const messages = await tx.reviewMessage.findMany({ where: { threadId: id }, orderBy: { id: 'asc' }, ...page(query) });
      const main = await tx.reviewMessage.findUnique({ where: { threadId_mainSlot: { threadId: id, mainSlot: 1 } } });
      return { id, originalBillId: thread.originalBillId, vote: thread.vote,
        snapshot: bill ? reviewSnapshot(bill) : thread.snapshot, deleted: !bill,
        billModified: (bill?.updatedAt ?? thread.snapshotUpdatedAt).getTime() !== thread.initialBillUpdatedAt.getTime(),
        mainWithdrawn: Boolean(main?.withdrawn && !main?.hidden), messages: messages.map(visibleReviewMessage) };
    });
  }

  async ownerSummary(userId: string, billId: number, query: ReviewPageDto) {
    return this.prisma.$transaction(async tx => {
      await this.access.lockUsers(tx, [userId]);
      await this.access.enabled(tx, userId);
      const where = { ownerId: userId, originalBillId: billId };
      const bill = await tx.bill.findFirst({ where: { id: billId, userId }, select: { id: true } });
      if (!bill && !await tx.billReviewThread.findFirst({ where, select: { id: true } })) throw new NotFoundException('账单不存在');
      const groups = await tx.billReviewThread.groupBy({ by: ['vote'], where, _count: true });
      const threads = await tx.billReviewThread.findMany({ where, select: { id: true, vote: true, reviewer: { select: profile } }, orderBy: { id: 'asc' }, ...page(query) });
      return { hang: groups.find(g => g.vote === 'hang')?._count ?? 0, la: groups.find(g => g.vote === 'la')?._count ?? 0, threads };
    });
  }

  async mine(userId: string, query: ReviewPageDto) {
    await this.access.enabled(this.prisma, userId);
    return this.prisma.billReviewThread.findMany({ where: { ownerId: userId },
      select: { id: true, originalBillId: true, vote: true, snapshot: true, deletedAt: true, reviewer: { select: profile } }, orderBy: { id: 'desc' }, ...page(query) });
  }

  private async main(tx: SocialTx, threadId: number) {
    return tx.reviewMessage.findUnique({ where: { threadId_mainSlot: { threadId, mainSlot: 1 } } });
  }

  async createMessage(userId: string, threadId: number, dto: NewReviewMessageDto, isMain: boolean) {
    return this.withThread(userId, threadId, true, async (tx, thread) => {
      const existing = await tx.reviewMessage.findUnique({ where: { threadId_authorId_clientKey: { threadId, authorId: userId, clientKey: dto.clientKey } } });
      if (existing) {
        if ((existing.mainSlot === 1) !== isMain || existing.body !== dto.body.trim()) throw new ConflictException('重复请求的内容不一致');
        return visibleReviewMessage(existing);
      }
      const main = await this.main(tx, threadId);
      if (isMain) {
        if (userId !== thread.reviewerId) throw new ForbiddenException('主人不能给自己的账单写主评');
        if (main) throw new ConflictException('每位评价者只能有一条主评，请编辑原评或回复');
      } else {
        if (!main) throw new ConflictException('请先发布主评');
        if (main.withdrawn && !main.hidden) throw new ConflictException('主评已撤回，对话暂为只读');
      }
      const message = await tx.reviewMessage.create({ data: { threadId, authorId: userId, clientKey: dto.clientKey,
        mainSlot: isMain ? 1 : null, body: dto.body.trim(),
        versions: { create: { revision: 1, body: dto.body.trim(), withdrawn: false, action: 'create' } },
      } });
      await tx.socialInboxEvent.create({ data: {
        userId: userId === thread.ownerId ? thread.reviewerId : thread.ownerId,
        kind: isMain ? 'review_main_created' : 'review_reply_created', dedupeKey: `review-message:${message.id}`,
        payload: { threadId, messageId: message.id, originalBillId: thread.originalBillId },
      } });
      return visibleReviewMessage(message);
    });
  }

  async changeMessage(userId: string, threadId: number, messageId: number, dto: ChangeReviewMessageDto) {
    return this.withThread(userId, threadId, true, async (tx) => {
      const message = await tx.reviewMessage.findFirst({ where: { id: messageId, threadId } });
      if (!message) throw new NotFoundException('文字不存在');
      if (message.authorId !== userId) throw new ForbiddenException('只能修改自己的文字');
      if (message.hidden) throw new ForbiddenException('违规隐藏内容不可自行恢复或修改');
      if (message.revision !== dto.expectedRevision) throw new ConflictException('文字已更新，请刷新后操作');
      const main = await this.main(tx, threadId);
      if (message.mainSlot !== 1 && main?.withdrawn && !main.hidden) throw new ConflictException('主评已撤回，对话暂为只读');
      if (dto.action === 'edit' && message.withdrawn) throw new ConflictException('请先恢复文字再编辑');
      const withdrawn = dto.action === 'withdraw' ? true : dto.action === 'restore' ? false : message.withdrawn;
      const body = dto.action === 'edit' ? dto.body.trim() : message.body;
      if (withdrawn === message.withdrawn && body === message.body) return visibleReviewMessage(message);
      const updated = await tx.reviewMessage.update({ where: { id: messageId }, data: {
        body, withdrawn, revision: { increment: 1 },
        versions: { create: { revision: message.revision + 1, body, withdrawn, action: dto.action } },
      } });
      return visibleReviewMessage(updated); // Edits/withdrawals/restores never create unread notifications.
    });
  }

  async versions(userId: string, threadId: number, messageId: number, query: ReviewPageDto) {
    return this.withThread(userId, threadId, false, async tx => {
      const message = await tx.reviewMessage.findFirst({ where: { id: messageId, threadId } });
      if (!message) throw new NotFoundException('文字不存在');
      if (message.hidden) throw new ForbiddenException('违规内容历史仅供后台审核');
      return tx.reviewMessageVersion.findMany({ where: { messageId }, select: { revision: true, body: true, withdrawn: true, action: true, createdAt: true }, orderBy: { revision: 'asc' }, ...page(query) });
    });
  }
}
