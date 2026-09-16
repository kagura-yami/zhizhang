import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReviewGrant } from '@prisma/client';

export type SocialTx = Prisma.TransactionClient;

@Injectable()
export class SocialAccessService {
  /** All relationship writes and protected reads acquire user locks in the same order. */
  async lockUsers(tx: SocialTx, ids: string[]) {
    const sorted = [...new Set(ids.map(id => id.toLowerCase()))].sort();
    await tx.$queryRaw(Prisma.sql`SELECT id FROM public.users WHERE id::text IN (${Prisma.join(sorted)}) ORDER BY id FOR UPDATE`);
  }

  async enabled(tx: SocialTx, id: string) {
    const user = await tx.user.findUnique({ where: { id }, select: { isActive: true, socialPreference: true } });
    if (!user?.isActive) throw new NotFoundException('用户不存在');
    if (!user.socialPreference) throw new ForbiddenException('请先阅读并启用社群');
    return user.socialPreference;
  }

  async pair(tx: SocialTx, a: string, b: string) {
    if (a.toLowerCase() === b.toLowerCase()) throw new BadRequestException('不能对自己执行此操作');
    await this.enabled(tx, a);
    await this.enabled(tx, b);
    if (await tx.socialBlock.findFirst({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } })) {
      throw new ForbiddenException('双方当前无法互动');
    }
  }

  async grant(tx: SocialTx, ownerId: string, reviewerId: string) {
    await this.pair(tx, ownerId, reviewerId);
    const grant = await tx.reviewGrant.findUnique({ where: { ownerId_reviewerId: { ownerId, reviewerId } } });
    if (!grant || grant.status !== 'active') throw new ForbiddenException('没有有效的评账授权');
    return grant;
  }

  billWhere(grant: ReviewGrant): Prisma.BillWhereInput {
    const activatedDay = new Date(grant.activatedAt.getTime() + 8 * 3600000).toISOString().slice(0, 10);
    return {
      userId: grant.ownerId,
      ...(grant.scope === 'both' ? {} : { type: grant.scope }),
      ...(grant.historyStart ? { date: { gte: grant.historyStart } } : {
        createdAt: { gte: grant.activatedAt },
        date: { gte: new Date(`${activatedDay}T00:00:00Z`) },
      }),
    };
  }
}
