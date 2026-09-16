import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { businessDate } from '../ledger/ledger-period';
import { SocialAccessService, SocialTx } from './social-access.service';
import { EnableSocialDto, SaveGrantDto, SearchSocialDto, SocialPageDto, SocialPreferencesDto, SOCIAL_CONSENT_VERSION } from './social.dto';
import { recordRequestEvent } from './review-request.service';

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
    return this.locked([userId], tx => tx.socialPreference.upsert({ where: { userId },
      create: { userId, consentVersion, enabledAt: new Date(), ...preferences },
      update: { consentVersion, ...preferences },
    }));
  }

  async updatePreferences(userId: string, dto: SocialPreferencesDto) {
    return this.locked([userId], async tx => {
      await this.access.enabled(tx, userId);
      return tx.socialPreference.update({ where: { userId }, data: dto });
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
      return { ...user, following: edges.some(e => e.followerId === userId), followedBy: edges.some(e => e.followerId === targetId),
        friend: userId !== targetId && edges.length === 2 };
    });
  }

  async follow(userId: string, targetId: string, followed: boolean) {
    return this.locked([userId, targetId], async tx => {
      await this.access.pair(tx, userId, targetId);
      const key = { followerId: userId, followeeId: targetId };
      if (followed) await tx.socialFollow.upsert({ where: { followerId_followeeId: key }, create: key, update: {} });
      else await tx.socialFollow.deleteMany({ where: key });
      return { following: followed };
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
      const result = await tx.reviewGrant.upsert({ where: { ownerId_reviewerId: key },
        create: { ...key, scope: dto.scope, historyStart, activatedAt: new Date() },
        update: { scope: dto.scope, historyStart, status: 'active', version: { increment: 1 },
          ...(previous?.status !== 'active' ? { activatedAt: new Date() } : {}) },
      });
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
    return this.prisma.reviewGrant.findMany({ where: direction === 'given' ? { ownerId: userId } : { reviewerId: userId },
      include: { owner: { select: publicProfile }, reviewer: { select: publicProfile } },
      orderBy: [{ updatedAt: 'desc' }, { ownerId: 'asc' }, { reviewerId: 'asc' }], ...pagination(query) });
  }

  async reviewableBills(reviewerId: string, ownerId: string, query: SocialPageDto) {
    return this.locked([ownerId, reviewerId], async tx => {
      const grant = await this.access.grant(tx, ownerId, reviewerId);
      const rows = await tx.bill.findMany({ where: this.access.billWhere(grant), orderBy: [{ date: 'desc' }, { time: 'desc' }, { id: 'desc' }],
        select: { id: true, amount: true, type: true, date: true, time: true, category: { select: { name: true } } }, ...pagination(query) });
      return { grantVersion: grant.version, items: rows.map(row => ({ id: row.id, amount: row.amount.toFixed(4), type: row.type,
        date: row.date.toISOString().slice(0, 10), time: row.time?.toISOString() ?? null, category: row.category?.name ?? null })) };
    });
  }
}
