import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { businessDate } from '../ledger/ledger-period';
import { SocialAccessService, SocialTx } from './social-access.service';
import { EnableSocialDto, ReviewableBillsQuery, SaveGrantDto, SearchSocialDto, SocialPageDto, SocialPreferencesDto, SOCIAL_CONSENT_VERSION } from './social.dto';
import { recordRequestEvent } from './review-request.service';
import { recordGrantEvent } from './grant-event';
import { changeRankingParticipation } from '../rankings/ranking-projection';

const publicProfile = { id: true, nickname: true, avatar: true } as const;
const pagination = (q: SocialPageDto) => ({ skip: (q.page - 1) * q.pageSize, take: q.pageSize });

@Injectable()
export class SocialService {
  constructor(private readonly prisma: PrismaService, private readonly access: SocialAccessService) {}

  private async locked<T>(ids: string[], operation: (tx: SocialTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async tx => {
      await this.access.lockUsers(tx, ids);
      return operation(tx);
    });
  }

  async preferences(userId: string) {
    const preference = await this.prisma.socialPreference.findUnique({ where: { userId } });
    return { enabled: Boolean(preference), requiredConsentVersion: SOCIAL_CONSENT_VERSION, preference };
  }

  async enable(userId: string, dto: EnableSocialDto) {
    if (dto.consentVersion !== SOCIAL_CONSENT_VERSION) throw new BadRequestException('请阅读当前社群说明');
    const { consentVersion, ...preferences } = dto;
    return this.locked([userId], async tx => {
      const now = new Date();
      const result = await tx.socialPreference.upsert({ where: { userId },
        create: { userId, consentVersion, enabledAt: now, rankingScope: 'global', ...preferences }, update: { consentVersion, ...preferences } });
      await changeRankingParticipation(tx, userId, result.rankingScope, now);
      return result;
    });
  }

  async updatePreferences(userId: string, dto: SocialPreferencesDto) {
    return this.locked([userId], async tx => {
      await this.access.enabled(tx, userId);
      const now = new Date();
      const result = await tx.socialPreference.update({ where: { userId }, data: dto });
      await changeRankingParticipation(tx, userId, result.rankingScope, now);
      return result;
    });
  }

  async disable(userId: string) {
    return this.locked([userId], async tx => {
      await tx.reviewGrant.updateMany({ where: { status: 'active', OR: [{ ownerId: userId }, { reviewerId: userId }] },
        data: { status: 'revoked', version: { increment: 1 } } });
      await tx.reviewRequest.updateMany({ where: { status: 'pending', OR: [{ ownerId: userId }, { applicantId: userId }] },
        data: { status: 'system_cancelled', version: { increment: 1 }, decidedAt: new Date() } });
      await tx.socialFollow.deleteMany({ where: { OR: [{ followerId: userId }, { followeeId: userId }] } });
      await changeRankingParticipation(tx, userId, 'none', new Date());
      // Existing consent-deletion trigger invalidates derived AI reports.
      await tx.socialPreference.deleteMany({ where: { userId } });
      return { enabled: false };
    });
  }

  private visibleUsers(viewerId: string): Prisma.UserWhereInput {
    return { isActive: true, socialPreference: { isNot: null },
      blockedBy: { none: { blockerId: viewerId } }, blockedUsers: { none: { blockedId: viewerId } } };
  }

  async search(userId: string, query: SearchSocialDto) {
    await this.access.enabled(this.prisma, userId);
    const term = query.query.trim();
    if (!term) throw new BadRequestException('请输入昵称或完整用户 ID');
    const exactId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(term);
    return this.prisma.user.findMany({ where: { ...this.visibleUsers(userId),
      ...(exactId ? { id: term } : { nickname: { contains: term, mode: 'insensitive' } }) },
      select: publicProfile, orderBy: { id: 'asc' }, ...pagination(query) });
  }

  async profile(userId: string, targetId: string) {
    return this.locked([userId, targetId], async tx => {
      if (userId !== targetId) await this.access.pair(tx, userId, targetId);
      else await this.access.enabled(tx, userId);
      const user = await tx.user.findUnique({ where: { id: targetId }, select: publicProfile });
      const edges = await tx.socialFollow.findMany({ where: { OR: [
        { followerId: userId, followeeId: targetId }, { followerId: targetId, followeeId: userId },
      ] } });
      const sentEdge = edges.find(e => e.followerId === userId);
      const receivedEdge = edges.find(e => e.followerId === targetId);
      const sent = sentEdge ? await tx.socialInboxEvent.findUnique({ where: { dedupeKey: `friend-request:${sentEdge.generation}` } }) : null;
      const received = receivedEdge ? await tx.socialInboxEvent.findUnique({ where: { dedupeKey: `friend-request:${receivedEdge.generation}` } }) : null;
      return { ...user, friendRequestSent: Boolean(sent && !(sent.payload as any).accepted), incomingFriendRequestId: received && !(received.payload as any).accepted && edges.length !== 2 ? received.id : null, following: edges.some(e => e.followerId === userId), followedBy: edges.some(e => e.followerId === targetId),
        friend: userId !== targetId && edges.length === 2 };
    });
  }

  async follow(userId: string, targetId: string, followed: boolean) {
    return this.locked([userId, targetId], async tx => {
      await this.access.pair(tx, userId, targetId);
      const key = { followerId: userId, followeeId: targetId };
      if (followed) {
        const previous = await tx.socialFollow.findUnique({ where: { followerId_followeeId: key } });
        if (!previous) {
          const follow = await tx.socialFollow.create({ data: key });
          await tx.socialInboxEvent.create({ data: { userId: targetId, kind: 'social_follow_created',
            dedupeKey: `follow:${follow.generation}`, payload: { followerId: userId, generation: follow.generation } } });
        }
      }
      else await tx.socialFollow.deleteMany({ where: key });
      return { following: followed };
    });
  }

  async requestFriend(userId: string, targetId: string) {
    return this.locked([userId, targetId], async tx => {
      await this.access.pair(tx, userId, targetId);
      const key = { followerId: userId, followeeId: targetId };
      let edge = await tx.socialFollow.upsert({ where: { followerId_followeeId: key }, create: key, update: {} });
      const reverse = await tx.socialFollow.findUnique({ where: { followerId_followeeId: { followerId: targetId, followeeId: userId } } });
      if (reverse) return { following: true, friend: true };
      const previous = await tx.socialInboxEvent.findUnique({ where: { dedupeKey: `friend-request:${edge.generation}` } });
      if ((previous?.payload as any)?.accepted) edge = await tx.socialFollow.update({ where: { followerId_followeeId: key }, data: { generation: randomUUID() } });
      const event = await tx.socialInboxEvent.upsert({ where: { dedupeKey: `friend-request:${edge.generation}` }, create: {
        userId: targetId, kind: 'friend_request_created', dedupeKey: `friend-request:${edge.generation}`,
        payload: { followerId: userId, generation: edge.generation },
      }, update: {} });
      return { following: true, requestId: event.id };
    });
  }

  async acceptFriend(userId: string, eventId: number) {
    if (!Number.isInteger(eventId) || eventId < 1 || eventId > 2147483647) throw new NotFoundException('好友申请不存在');
    const event = await this.prisma.socialInboxEvent.findFirst({ where: { id: eventId, userId, kind: 'friend_request_created' } });
    if (!event) throw new NotFoundException('好友申请不存在');
    const payload = event.payload as { followerId: string; generation: string; accepted?: boolean };
    return this.locked([userId, payload.followerId], async tx => {
      await this.access.pair(tx, userId, payload.followerId);
      const source = await tx.socialFollow.findUnique({ where: { followerId_followeeId: { followerId: payload.followerId, followeeId: userId } } });
      if (!source || source.generation !== payload.generation) throw new ConflictException('该申请已失效，请刷新');
      const current = await tx.socialInboxEvent.findUnique({ where: { id: eventId } });
      if ((current!.payload as any).accepted) return { accepted: true };
      const key = { followerId: userId, followeeId: payload.followerId };
      const reverse = await tx.socialFollow.upsert({ where: { followerId_followeeId: key }, create: key, update: {} });
      await tx.socialInboxEvent.update({ where: { id: eventId }, data: { readAt: new Date(), payload: { ...payload, accepted: true } } });
      await tx.socialInboxEvent.upsert({ where: { dedupeKey: `friend-accepted:${eventId}` }, create: {
        userId: payload.followerId, kind: 'friend_request_accepted', dedupeKey: `friend-accepted:${eventId}`,
        payload: { followerId: userId, generation: reverse.generation },
      }, update: {} });
      return { accepted: true, friend: true };
    });
  }

  async relations(userId: string, targetId: string, kind: string, query: SocialPageDto) {
    if (!['following', 'followers', 'friends'].includes(kind)) throw new BadRequestException('关系类型不正确');
    return this.locked([userId, targetId], async tx => {
      if (userId !== targetId) await this.access.pair(tx, userId, targetId);
      const pref = await this.access.enabled(tx, targetId);
      if (userId !== targetId && !pref.publicRelations) throw new ForbiddenException('对方未公开关系名单');
      return tx.user.findMany({ where: { ...this.visibleUsers(userId),
        ...(kind === 'following' || kind === 'friends' ? { followers: { some: { followerId: targetId } } } : {}),
        ...(kind === 'followers' || kind === 'friends' ? { following: { some: { followeeId: targetId } } } : {}),
      }, select: publicProfile, orderBy: { id: 'asc' }, ...pagination(query) });
    });
  }

  async block(userId: string, targetId: string, blocked: boolean) {
    if (userId.toLowerCase() === targetId.toLowerCase()) throw new BadRequestException('不能拉黑自己');
    return this.locked([userId, targetId], async tx => {
      await this.access.enabled(tx, userId);
      if (!await tx.user.findUnique({ where: { id: targetId }, select: { id: true } })) throw new NotFoundException('用户不存在');
      const key = { blockerId: userId, blockedId: targetId };
      if (blocked) {
        await tx.socialBlock.upsert({ where: { blockerId_blockedId: key }, create: key, update: {} });
        await tx.socialFollow.deleteMany({ where: { OR: [{ followerId: userId, followeeId: targetId }, { followerId: targetId, followeeId: userId }] } });
        await tx.reviewGrant.updateMany({ where: { OR: [{ ownerId: userId, reviewerId: targetId }, { ownerId: targetId, reviewerId: userId }] }, data: { status: 'revoked', version: { increment: 1 } } });
        // Blocked relationships cannot retain actionable applications.
        await tx.reviewRequest.updateMany({ where: { status: 'pending', OR: [{ ownerId: userId, applicantId: targetId }, { ownerId: targetId, applicantId: userId }] },
          data: { status: 'system_cancelled', version: { increment: 1 }, decidedAt: new Date() } });
      } else await tx.socialBlock.deleteMany({ where: key });
      return { blocked };
    });
  }

  async blocks(userId: string, query: SocialPageDto) {
    await this.access.enabled(this.prisma, userId);
    const rows = await this.prisma.socialBlock.findMany({ where: { blockerId: userId }, select: { blocked: { select: publicProfile } }, orderBy: { blockedId: 'asc' }, ...pagination(query) });
    return rows.map(row => row.blocked);
  }

  async saveGrant(ownerId: string, reviewerId: string, dto: SaveGrantDto) {
    const historyStart = dto.historyStart ? businessDate(dto.historyStart) : null;
    return this.locked([ownerId, reviewerId], async tx => {
      await this.access.pair(tx, ownerId, reviewerId);
      const key = { ownerId, reviewerId };
      const previous = await tx.reviewGrant.findUnique({ where: { ownerId_reviewerId: key } });
      if (previous && dto.expectedVersion !== previous.version) throw new ConflictException('授权已存在或已更新，请刷新后修改');
      if (!previous && dto.expectedVersion != null) throw new ConflictException('授权尚不存在');
      const unchanged = previous?.status === 'active' && previous.scope === dto.scope && (previous.historyStart?.getTime() ?? null) === (historyStart?.getTime() ?? null);
      const result = unchanged ? previous : await tx.reviewGrant.upsert({ where: { ownerId_reviewerId: key },
        create: { ...key, scope: dto.scope, historyStart, activatedAt: new Date() },
        update: { scope: dto.scope, historyStart, status: 'active', version: { increment: 1 },
          ...(previous?.status !== 'active' ? { activatedAt: new Date() } : {}) },
      });
      if (!unchanged) await recordGrantEvent(tx, result);
      const requestKey = { ownerId, applicantId: reviewerId };
      const pending = await tx.reviewRequest.findUnique({ where: { ownerId_applicantId: requestKey } });
      if (pending?.status === 'pending') {
        const approved = await tx.reviewRequest.update({ where: { ownerId_applicantId: requestKey }, data: { status: 'approved', version: { increment: 1 }, decidedAt: new Date() } });
        await tx.socialPreference.update({ where: { userId: reviewerId }, data: { requestRejectStreak: 0, requestCooldownUntil: null } });
        await recordRequestEvent(tx, approved, reviewerId);
      }
      return result;
    });
  }

  async endGrant(userId: string, otherId: string, exit: boolean) {
    return this.locked([userId, otherId], async tx => {
      await this.access.enabled(tx, userId);
      const key = exit ? { ownerId: otherId, reviewerId: userId } : { ownerId: userId, reviewerId: otherId };
      await tx.reviewGrant.updateMany({ where: { ...key, status: 'active' }, data: { status: exit ? 'exited' : 'revoked', version: { increment: 1 } } });
      return { active: false };
    });
  }

  async grants(userId: string, direction: string, query: SocialPageDto) {
    await this.access.enabled(this.prisma, userId);
    if (!['given', 'received'].includes(direction)) throw new BadRequestException('授权方向不正确');
    return this.prisma.reviewGrant.findMany({ where: direction === 'given' ? { ownerId: userId, reviewer: this.visibleUsers(userId) } : { reviewerId: userId, owner: this.visibleUsers(userId) },
      include: { owner: { select: publicProfile }, reviewer: { select: publicProfile } },
      orderBy: [{ updatedAt: 'desc' }, { ownerId: 'asc' }, { reviewerId: 'asc' }], ...pagination(query) });
  }

  async grantsWith(userId: string, otherId: string) {
    return this.locked([userId, otherId], async tx => {
      await this.access.pair(tx, userId, otherId);
      const [given, received] = await Promise.all([
        tx.reviewGrant.findUnique({ where: { ownerId_reviewerId: { ownerId: userId, reviewerId: otherId } } }),
        tx.reviewGrant.findUnique({ where: { ownerId_reviewerId: { ownerId: otherId, reviewerId: userId } } }),
      ]);
      return { given, received };
    });
  }

  async reviewableOwners(reviewerId: string, query: SocialPageDto) {
    return this.prisma.$transaction(async tx => {
      await this.access.enabled(tx, reviewerId);
      const where = { reviewerId, status: 'active', owner: this.visibleUsers(reviewerId) };
      const total = await tx.reviewGrant.count({ where });
      const grants = await tx.reviewGrant.findMany({ where, include: { owner: { select: publicProfile } }, orderBy: { ownerId: 'asc' }, ...pagination(query) });
      const items = [];
      for (const grant of grants) {
        const bills = this.access.billWhere(grant);
        const pendingCount = await tx.bill.count({ where: { ...bills, reviewThreads: { none: { reviewerId } } } });
        const reviewedCount = await tx.bill.count({ where: { ...bills, reviewThreads: { some: { reviewerId } } } });
        items.push({ owner: grant.owner, scope: grant.scope, historyStart: grant.historyStart, pendingCount, reviewedCount });
      }
      return { items, total };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
  }

  async reviewableBills(reviewerId: string, ownerId: string, query: ReviewableBillsQuery) {
    return this.locked([ownerId, reviewerId], async tx => {
      const grant = await this.access.grant(tx, ownerId, reviewerId);
      const where: Prisma.BillWhereInput = { ...this.access.billWhere(grant),
        ...(query.state === 'pending' ? { reviewThreads: { none: { reviewerId } } } : query.state === 'reviewed' ? { reviewThreads: { some: { reviewerId } } } : {}) };
      const total = await tx.bill.count({ where });
      const rows = await tx.bill.findMany({ where, orderBy: [{ date: 'desc' }, { time: 'desc' }, { id: 'desc' }],
        select: { id: true, amount: true, type: true, date: true, time: true, category: { select: { name: true } } }, ...pagination(query) });
      return { grantVersion: grant.version, total, items: rows.map(row => ({ id: row.id, amount: row.amount.toFixed(4), type: row.type,
        date: row.date.toISOString().slice(0, 10), time: row.time?.toISOString() ?? null, category: row.category?.name ?? null })) };
    });
  }
}
