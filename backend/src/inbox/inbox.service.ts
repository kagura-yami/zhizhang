import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, SocialInboxEvent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SocialAccessService, SocialTx } from '../social/social-access.service';
import { ReviewsService } from '../reviews/reviews.service';
import { InboxQueryDto } from './inbox.dto';
import { visibleNotice } from './new-bill-notice';

const audience = 'zhizhang-social-read';
const interactions = ['review_main_created', 'review_reply_created'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const payloadOf = (event: SocialInboxEvent) => event.payload as Record<string, any>;

@Injectable()
export class InboxService {
  constructor(private readonly prisma: PrismaService, private readonly access: SocialAccessService,
    private readonly reviews: ReviewsService, private readonly jwt: JwtService) {}

  private receipt(userId: string, value: object) {
    // No sub claim: read receipts must never double as authentication tokens.
    return this.jwt.sign({ purpose: 'social-read', userId, ...value }, { audience, expiresIn: '15m' });
  }

  private async project(tx: SocialTx, userId: string, event: SocialInboxEvent, preview: boolean) {
    const p = payloadOf(event);
    let title: string, target: object, body: string | null = null;
    if (interactions.includes(event.kind)) {
      const thread = await tx.billReviewThread.findUnique({ where: { id: p.threadId } });
      if (!thread || ![thread.ownerId, thread.reviewerId].includes(userId)) return null;
      if (userId !== thread.ownerId) {
        if (!thread.billId || thread.deletedAt) return null;
        try {
          const grant = await this.access.grant(tx, thread.ownerId, thread.reviewerId);
          if (!await tx.bill.findFirst({ where: { ...this.access.billWhere(grant), id: thread.billId }, select: { id: true } })) return null;
        } catch (error) {
          if (error?.getStatus?.() === 403 || error?.getStatus?.() === 404) return null;
          throw error;
        }
      }
      const message = await tx.reviewMessage.findFirst({ where: { id: p.messageId, threadId: thread.id } });
      if (!message || message.hidden || message.withdrawn || message.authorId === userId) return null;
      title = event.kind === 'review_main_created' ? '收到新的评账文字' : '收到私密回复';
      target = { type: 'review', threadId: thread.id, billId: thread.originalBillId, messageId: message.id };
      if (preview) body = message.body.slice(0, 120);
    } else if (event.kind === 'review_bills_created') {
      const notice = await visibleNotice(tx, userId, p.noticeId);
      if (!notice) return null;
      title = '收到新的可评账单';
      target = { type: 'bills', ownerId: notice.ownerId, noticeId: notice.noticeId, count: notice.count };
      if (preview) {
        const first = await tx.bill.findFirst({ where: notice.where, orderBy: { id: 'asc' }, select: { amount: true, type: true, category: { select: { name: true } } } });
        body = notice.count === 1 && first ? `${first.type === 'income' ? '收入' : '支出'} ¥${first.amount.toFixed(4)} · ${first.category?.name || '未分类'}` : `有 ${notice.count} 笔新的可评账单`;
      }
    } else if (event.kind === 'friend_request_created' || event.kind === 'friend_request_accepted') {
      try { await this.access.pair(tx, userId, p.followerId); }
      catch (error) { if ([403,404].includes(error?.getStatus?.())) return null; throw error; }
      const edge = await tx.socialFollow.findUnique({ where: { followerId_followeeId: { followerId: p.followerId, followeeId: userId } } });
      if (!edge || edge.generation !== p.generation) return null;
      const reverse = await tx.socialFollow.findUnique({ where: { followerId_followeeId: { followerId: userId, followeeId: p.followerId } } });
      const person = await tx.user.findUnique({ where: { id: p.followerId }, select: { nickname: true, avatar: true } });
      if (event.kind === 'friend_request_accepted') {
        if (!reverse) return null;
        title = '好友申请已通过'; target = { type: 'profile', userId: p.followerId };
      } else {
        const pending = !p.accepted && !reverse;
        title = pending ? '收到好友申请' : '好友申请已处理';
        target = { type: 'friendRequest', userId: p.followerId, requestId: event.id, pending, nickname: person?.nickname, avatar: person?.avatar };
      }
      if (preview) body = person?.nickname || '一位社群用户';
    } else if (event.kind === 'social_follow_created'  || event.kind === 'review_grant_updated') {
      const otherId = event.kind === 'social_follow_created' ? p.followerId : p.ownerId;
      try { await this.access.pair(tx, userId, otherId); }
      catch (error) {
        if (error?.getStatus?.() === 403 || error?.getStatus?.() === 404) return null;
        throw error;
      }
      if (event.kind === 'social_follow_created') {
        const follow = await tx.socialFollow.findUnique({ where: { followerId_followeeId: { followerId: otherId, followeeId: userId } } });
        if (!follow || follow.generation !== p.generation) return null;
        title = '收到新的关注'; target = { type: 'profile', userId: otherId };
      } else {
        if (p.reviewerId !== userId) return null;
        const grant = await tx.reviewGrant.findUnique({ where: { ownerId_reviewerId: { ownerId: otherId, reviewerId: userId } } });
        if (!grant || grant.status !== 'active' || grant.version !== p.version) return null;
        title = grant.historyStart ? '评账授权已更新，含历史账单' : '收到评账授权';
        target = { type: 'grant', ownerId: otherId, version: grant.version, scope: grant.scope,
          historyStart: grant.historyStart?.toISOString().slice(0, 10) ?? null };
      }
    } else if (event.kind.startsWith('review_request_')) {
      if (![p.ownerId, p.applicantId].includes(userId)) return null;
      try { await this.access.pair(tx, p.ownerId, p.applicantId); }
      catch (error) {
        if (error?.getStatus?.() === 403 || error?.getStatus?.() === 404) return null;
        throw error;
      }
      const request = await tx.reviewRequest.findUnique({ where: { ownerId_applicantId: { ownerId: p.ownerId, applicantId: p.applicantId } } });
      if (!request || request.version !== p.version || request.status !== p.status) return null;
      title = ({ pending: '收到评账申请', approved: '评账申请已批准', rejected: '评账申请已拒绝', withdrawn: '评账申请已撤回', system_cancelled: '评账申请已取消' })[request.status];
      if (!title) return null;
      target = { type: 'request', ownerId: p.ownerId, applicantId: p.applicantId, status: request.status };
    } else if (event.kind === 'review_report_decided') {
      const report = await tx.reviewReport.findUnique({ where: { id: p.reportId } });
      if (!report || (report.reporterId !== userId && !(report.status === 'upheld' && report.authorId === userId))) return null;
      title = '举报审核结果已更新';
      target = { type: 'report', reportId: report.id, status: report.status, reason: report.decisionReason };
      // An admin's reason may quote private text. Never put it in a lock-screen preview.
    } else return null;
    return { id: event.id, kind: event.kind, createdAt: event.createdAt, unread: !event.readAt, title, target, preview: body };
  }

  private async participants(userId: string, rows: SocialInboxEvent[]) {
    const identities = await this.prisma.billReviewThread.findMany({ where: { id: { in: rows.filter(e => interactions.includes(e.kind)).map(e => payloadOf(e).threadId) } }, select: { ownerId: true, reviewerId: true } });
    return [userId, ...identities.flatMap(t => [t.ownerId, t.reviewerId]), ...rows.flatMap(e => {
      const p = payloadOf(e); return [p.ownerId, p.applicantId, p.followerId].filter(v => typeof v === 'string' && uuid.test(v));
    })];
  }

  private async resolve(userId: string, eventId: number, delivery: boolean) {
    // IDs originate from untrusted deep links. Invalid and foreign IDs look identical.
    if (!Number.isInteger(eventId) || eventId < 1 || eventId > 2147483647) return null;
    const candidate = await this.prisma.socialInboxEvent.findFirst({ where: { id: eventId, userId } });
    if (!candidate) return null;
    const ids = await this.participants(userId, [candidate]);
    try {
      return await this.prisma.$transaction(async tx => {
        await this.access.lockUsers(tx, ids);
        const preference = await this.access.enabled(tx, userId);
        const event = await tx.socialInboxEvent.findFirst({ where: { id: eventId, userId } });
        if (!event) return null;
        const systemNotificationEnabled = event.kind === 'review_bills_created'
          ? preference.notifyNewBills : preference.notifyInteractions;
        if (delivery && (event.readAt || !systemNotificationEnabled)) return null;
        const item = await this.project(tx, userId, event, preference.notificationPreview);
        return item ? { ...item, systemNotificationEnabled,
          readReceipt: this.receipt(userId, { scope: 'events', ids: [item.id] }) } : null;
      });
    } catch (error) {
      if (error?.getStatus?.() === 403 || error?.getStatus?.() === 404) return null;
      throw error; // Infrastructure failures must remain retryable, not look like suppressed events.
    }
  }

  /** Resolve after login; never trust a target or a preview cached in a push payload. */
  async event(userId: string, eventId: number) {
    const item = await this.resolve(userId, eventId, false);
    if (!item) throw new NotFoundException('通知不存在或已不可访问');
    return item;
  }

  /** Provider-independent projection, not a delivery acknowledgement. Call just before sending. */
  async systemNotification(userId: string, eventId: number) {
    const item = await this.resolve(userId, eventId, true);
    if (!item) return null;
    // No navigation target, read capability, account IDs or moderation reason leaves this boundary.
    return { eventId: item.id, title: item.title, body: item.preview ?? '打开知账查看详情' };
  }

  async list(userId: string, query: InboxQueryDto) {
    // Stable forward scan: hidden entries still advance the cursor, so a client can finish scanning.
    const descending = query.before !== undefined;
    const candidates = await this.prisma.socialInboxEvent.findMany({ where: { userId, id: descending ? { lt: query.before } : { gt: query.after } }, orderBy: { id: descending ? 'desc' : 'asc' }, take: query.limit + 1 });
    const rows = candidates.slice(0, query.limit);
    const ids = await this.participants(userId, rows);
    return this.prisma.$transaction(async tx => {
      await this.access.lockUsers(tx, ids);
      const preference = await this.access.enabled(tx, userId);
      const fresh = await tx.socialInboxEvent.findMany({ where: { userId, id: { in: rows.map(e => e.id) } }, orderBy: { id: descending ? 'desc' : 'asc' } });
      const items = [];
      for (const event of fresh) {
        const item = await this.project(tx, userId, event, preference.notificationPreview);
        if (item) items.push({ ...item, readReceipt: this.receipt(userId, { scope: 'events', ids: [item.id] }), systemNotificationEnabled: event.kind === 'review_bills_created' ? preference.notifyNewBills : preference.notifyInteractions });
      }
      return { items, nextAfter: rows.at(-1)?.id ?? query.after, nextBefore: rows.at(-1)?.id ?? query.before, hasMore: candidates.length > query.limit,
        receipt: items.length ? this.receipt(userId, { scope: 'events', ids: items.map(item => item.id) }) : null };
    });
  }

  async feedback(userId: string, threadId: number) {
    return this.reviews.withThread(userId, threadId, false, async (tx, thread) => {
      // Capture under the same participant locks used by message writers.
      const events = await tx.socialInboxEvent.findMany({ where: { userId, kind: { in: interactions }, payload: { path: ['threadId'], equals: thread.id } }, orderBy: { id: 'desc' }, take: 1 });
      const through = events[0]?.id ?? 0;
      const counts = await tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`
        SELECT COUNT(*) AS count FROM public.social_inbox_events e
        JOIN public.review_messages m ON e.payload->>'messageId' = m.id::text
        WHERE e.user_id = ${userId}::uuid AND e.read_at IS NULL AND e.id <= ${through}
          AND e.kind IN ('review_main_created', 'review_reply_created')
          AND e.payload->>'threadId' = ${String(thread.id)} AND m.thread_id = ${thread.id}
          AND m.hidden = false AND m.withdrawn = false AND m.author_id <> ${userId}::uuid`);
      const unread = Number(counts[0].count);
      return { through, unread, receipt: this.receipt(userId, { scope: 'thread', threadId, through }) };
    });
  }

  async read(userId: string, receipt: string) {
    let claim: any;
    try { claim = this.jwt.verify(receipt, { audience }); }
    catch { throw new ForbiddenException('已读凭证已失效，请刷新后重试'); }
    if (claim.purpose !== 'social-read' || claim.userId !== userId) throw new ForbiddenException('已读凭证不属于当前用户');
    if (claim.scope === 'bill') {
      return this.prisma.$transaction(async tx => {
        await this.access.lockUsers(tx, [userId]); await this.access.enabled(tx, userId);
        await this.ownedBill(tx, userId, claim.billId);
        return tx.socialInboxEvent.updateMany({ where: { userId, readAt: null, id: { lte: claim.through }, kind: { in: interactions },
          payload: { path: ['originalBillId'], equals: claim.billId } }, data: { readAt: new Date() } });
      });
    }
    if (claim.scope === 'thread') {
      return this.reviews.withThread(userId, claim.threadId, false, tx => tx.socialInboxEvent.updateMany({
        where: { userId, readAt: null, id: { lte: claim.through }, kind: { in: interactions }, payload: { path: ['threadId'], equals: claim.threadId } }, data: { readAt: new Date() },
      }));
    }
    if (claim.scope !== 'events' || !Array.isArray(claim.ids)) throw new ForbiddenException('已读凭证无效');
    return this.prisma.$transaction(async tx => {
      await this.access.lockUsers(tx, [userId]); await this.access.enabled(tx, userId);
      return tx.socialInboxEvent.updateMany({ where: { userId, readAt: null, id: { in: claim.ids } }, data: { readAt: new Date() } });
    });
  }

  private async ownedBill(tx: SocialTx, userId: string, billId: number) {
    if (!await tx.bill.findFirst({ where: { id: billId, userId }, select: { id: true } }) &&
      !await tx.billReviewThread.findFirst({ where: { ownerId: userId, originalBillId: billId }, select: { id: true } })) {
      throw new NotFoundException('账单不存在');
    }
  }

  private async summaries(tx: SocialTx, userId: string, billIds: number[]) {
    const bills = await tx.bill.findMany({ where: { userId, id: { in: billIds } }, select: { id: true } });
    const groups = await tx.billReviewThread.groupBy({ by: ['originalBillId', 'vote'], where: { ownerId: userId, originalBillId: { in: billIds } }, _count: true });
    const ownIds = new Set([...bills.map(b => b.id), ...groups.map(g => g.originalBillId)]);
    const unread = await tx.$queryRaw<{ billId: number }[]>(Prisma.sql`
      SELECT DISTINCT t.original_bill_id AS "billId" FROM public.social_inbox_events e
      JOIN public.review_messages m ON e.payload->>'messageId' = m.id::text
      JOIN public.bill_review_threads t ON m.thread_id = t.id
      WHERE e.user_id = ${userId}::uuid AND t.owner_id = ${userId}::uuid
        AND t.original_bill_id IN (${Prisma.join(billIds)}) AND e.read_at IS NULL
        AND e.kind IN ('review_main_created', 'review_reply_created')
        AND e.payload->>'threadId' = t.id::text AND m.author_id <> ${userId}::uuid
        AND m.hidden = false AND m.withdrawn = false`);
    const unreadIds = new Set(unread.map(row => row.billId));
    return billIds.filter(id => ownIds.has(id)).map(billId => ({ billId,
      hang: groups.find(g => g.originalBillId === billId && g.vote === 'hang')?._count ?? 0,
      la: groups.find(g => g.originalBillId === billId && g.vote === 'la')?._count ?? 0,
      hasUnreadText: unreadIds.has(billId) }));
  }

  async billSummaries(userId: string, billIds: number[]) {
    return this.prisma.$transaction(async tx => {
      await this.access.lockUsers(tx, [userId]); await this.access.enabled(tx, userId);
      return this.summaries(tx, userId, billIds);
    });
  }

  async billFeedback(userId: string, billId: number) {
    return this.prisma.$transaction(async tx => {
      await this.access.lockUsers(tx, [userId]); await this.access.enabled(tx, userId);
      await this.ownedBill(tx, userId, billId);
      const latest = await tx.socialInboxEvent.findFirst({ where: { userId, kind: { in: interactions }, payload: { path: ['originalBillId'], equals: billId } }, orderBy: { id: 'desc' }, select: { id: true } });
      const through = latest?.id ?? 0;
      return { ...(await this.summaries(tx, userId, [billId]))[0], through,
        receipt: this.receipt(userId, { scope: 'bill', billId, through }) };
    });
  }
}
