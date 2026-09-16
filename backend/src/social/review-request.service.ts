import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ReviewRequest } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { businessDate } from '../ledger/ledger-period';
import { SocialAccessService, SocialTx } from './social-access.service';
import { ApproveRequestDto, RequestVersionDto, SocialPageDto, SubmitRequestDto } from './social.dto';
import { recordGrantEvent } from './grant-event';

export async function recordRequestEvent(tx: SocialTx, request: ReviewRequest, userId: string) {
  await tx.socialInboxEvent.create({ data: {
    userId, kind: `review_request_${request.status}`,
    dedupeKey: `request:${request.ownerId}:${request.applicantId}:${request.version}:${userId}`,
    payload: { ownerId: request.ownerId, applicantId: request.applicantId, status: request.status, version: request.version },
  } });
}

@Injectable()
export class ReviewRequestService {
  constructor(private readonly prisma: PrismaService, private readonly access: SocialAccessService) {}

  private locked<T>(ownerId: string, applicantId: string, action: (tx: SocialTx) => Promise<T>) {
    return this.prisma.$transaction(async tx => {
      await this.access.lockUsers(tx, [ownerId, applicantId]);
      return action(tx);
    });
  }

  async list(userId: string, direction: string, query: SocialPageDto) {
    if (!['incoming', 'outgoing'].includes(direction)) throw new BadRequestException('申请方向不正确');
    await this.access.enabled(this.prisma, userId);
    return this.prisma.reviewRequest.findMany({ where: direction === 'incoming' ? { ownerId: userId } : { applicantId: userId },
      include: { owner: { select: { id: true, nickname: true, avatar: true } }, applicant: { select: { id: true, nickname: true, avatar: true } } },
      orderBy: [{ requestedAt: 'desc' }, { ownerId: 'asc' }, { applicantId: 'asc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize });
  }

  async submit(applicantId: string, ownerId: string, dto: SubmitRequestDto) {
    return this.locked(ownerId, applicantId, async tx => {
      await this.access.pair(tx, ownerId, applicantId);
      const preference = await this.access.enabled(tx, applicantId);
      const now = new Date();
      if (preference.requestCooldownUntil && preference.requestCooldownUntil > now) {
        throw new ForbiddenException({ message: '评账申请处于冷却中', cooldownUntil: preference.requestCooldownUntil.toISOString() });
      }
      const key = { ownerId, applicantId };
      const existing = await tx.reviewRequest.findUnique({ where: { ownerId_applicantId: key } });
      if (existing?.status === 'pending') return existing; // Retry never duplicates or renotifies.
      if (existing && dto.expectedVersion !== existing.version) throw new ConflictException('请刷新申请状态后重新申请');
      if (!existing && dto.expectedVersion != null) throw new ConflictException('申请尚不存在');
      const grant = await tx.reviewGrant.findUnique({ where: { ownerId_reviewerId: { ownerId, reviewerId: applicantId } } });
      if (grant?.status === 'active') throw new ConflictException('已经具有有效评账授权');
      if (await tx.reviewRequest.count({ where: { applicantId, status: 'pending' } }) >= 10) {
        throw new ConflictException('最多同时保留十条待处理申请');
      }
      if (preference.requestCooldownUntil) {
        await tx.socialPreference.update({ where: { userId: applicantId }, data: { requestRejectStreak: 0, requestCooldownUntil: null } });
      }
      const request = await tx.reviewRequest.upsert({ where: { ownerId_applicantId: key },
        create: key, update: { status: 'pending', version: { increment: 1 }, requestedAt: now, decidedAt: null } });
      await recordRequestEvent(tx, request, ownerId);
      return request;
    });
  }

  private async pending(tx: SocialTx, ownerId: string, applicantId: string, expectedVersion: number, terminal: string) {
    const request = await tx.reviewRequest.findUnique({ where: { ownerId_applicantId: { ownerId, applicantId } } });
    if (!request) throw new NotFoundException('申请不存在');
    // Retrying the same terminal action is idempotent. Earlier cycles cannot act on a new request.
    if (request.status === terminal && request.version === expectedVersion + 1) return { request, done: true };
    if (request.status !== 'pending' || request.version !== expectedVersion) throw new ConflictException('申请已处理，请刷新');
    return { request, done: false };
  }

  async withdraw(applicantId: string, ownerId: string, dto: RequestVersionDto) {
    return this.locked(ownerId, applicantId, async tx => {
      await this.access.enabled(tx, applicantId);
      const state = await this.pending(tx, ownerId, applicantId, dto.expectedVersion, 'withdrawn');
      if (state.done) return state.request;
      return tx.reviewRequest.update({ where: { ownerId_applicantId: { ownerId, applicantId } },
        data: { status: 'withdrawn', version: { increment: 1 }, decidedAt: new Date() } });
    });
  }

  async approve(ownerId: string, applicantId: string, dto: ApproveRequestDto) {
    const historyStart = dto.historyStart ? businessDate(dto.historyStart) : null;
    return this.locked(ownerId, applicantId, async tx => {
      await this.access.pair(tx, ownerId, applicantId);
      const state = await this.pending(tx, ownerId, applicantId, dto.expectedVersion, 'approved');
      if (state.done) return state.request;
      const key = { ownerId, reviewerId: applicantId };
      // A separate direct grant must not be overwritten by an obsolete approval screen.
      const previous = await tx.reviewGrant.findUnique({ where: { ownerId_reviewerId: key } });
      if (previous?.status === 'active') throw new ConflictException('授权已生效，请在授权管理中修改');
      const grant = await tx.reviewGrant.upsert({ where: { ownerId_reviewerId: key },
        create: { ...key, scope: dto.scope, historyStart, activatedAt: new Date() },
        update: { scope: dto.scope, historyStart, activatedAt: new Date(), status: 'active', version: { increment: 1 } } });
      await recordGrantEvent(tx, grant);
      await tx.socialPreference.update({ where: { userId: applicantId }, data: { requestRejectStreak: 0, requestCooldownUntil: null } });
      const request = await tx.reviewRequest.update({ where: { ownerId_applicantId: { ownerId, applicantId } },
        data: { status: 'approved', version: { increment: 1 }, decidedAt: new Date() } });
      await recordRequestEvent(tx, request, applicantId);
      return request;
    });
  }

  async reject(ownerId: string, applicantId: string, dto: RequestVersionDto) {
    return this.locked(ownerId, applicantId, async tx => {
      await this.access.pair(tx, ownerId, applicantId);
      const state = await this.pending(tx, ownerId, applicantId, dto.expectedVersion, 'rejected');
      if (state.done) return state.request;
      const preference = await this.access.enabled(tx, applicantId);
      const now = new Date(), streak = preference.requestRejectStreak + 1;
      await tx.socialPreference.update({ where: { userId: applicantId }, data: {
        requestRejectStreak: streak, requestCooldownUntil: streak >= 3 ? new Date(now.getTime() + 24 * 3600000) : null,
      } });
      const request = await tx.reviewRequest.update({ where: { ownerId_applicantId: { ownerId, applicantId } },
        data: { status: 'rejected', version: { increment: 1 }, decidedAt: now } });
      await recordRequestEvent(tx, request, applicantId);
      if (streak >= 3) {
        const cancelled = await tx.reviewRequest.findMany({ where: { applicantId, status: 'pending' } });
        await tx.reviewRequest.updateMany({ where: { applicantId, status: 'pending' }, data: { status: 'system_cancelled', version: { increment: 1 }, decidedAt: now } });
        for (const row of cancelled) await recordRequestEvent(tx, { ...row, status: 'system_cancelled', version: row.version + 1, decidedAt: now }, row.ownerId);
      }
      return request;
    });
  }
}
