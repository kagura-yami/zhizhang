import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SocialAccessService, lockSocialUsers } from '../social/social-access.service';
import { rankingKeys, rankingPeriod, datePeriodKey } from './ranking-period';
import { prepareRanking, refreshRanking } from './ranking-projection';
import { RankingPeriodsQuery, RankingQuery } from './rankings.dto';

@Injectable()
export class RankingsService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private warming?: Promise<void>;
  private readonly logger = new Logger(RankingsService.name);
  constructor(private readonly prisma: PrismaService, private readonly access: SocialAccessService) {}
  onModuleInit() {
    if (process.env.RANKING_WORKER_DISABLED === '1') return;
    this.timer = setInterval(() => {
      if (!this.warming) this.warming = this.synchronize(new Date()).catch(() => {
        this.logger.error('排行榜跨周期预计算失败，将重试；读取不会返回半成品榜单');
      }).finally(() => { this.warming = undefined; });
    }, 60000);
    this.timer.unref();
  }
  async onModuleDestroy() { if (this.timer) clearInterval(this.timer); await this.warming; }

  /** Only stale participants need scanning. Current rankings read indexed aggregate rows. */
  async synchronize(now: Date) {
    const current = rankingKeys(now);
    let after: string | undefined;
    while (true) {
      const rows = await this.prisma.rankingState.findMany({ where: {
        ...(after ? { userId: { gt: after } } : {}),
        OR: [{ initialized: false }, { dayKey: { lt: current.day } }, { monthKey: { lt: current.month } }, { yearKey: { lt: current.year } }],
      }, orderBy: { userId: 'asc' }, take: 100, select: { userId: true } });
      for (const row of rows) await this.prisma.$transaction(async tx => {
        await lockSocialUsers(tx, [row.userId]);
        const state = await tx.rankingState.findUnique({ where: { userId: row.userId } });
        if (!state || (state.initialized && state.dayKey >= current.day && state.monthKey >= current.month && state.yearKey >= current.year)) return;
        // Capture after the lock. Another writer may have crossed midnight while we waited.
        const captured = new Date(Math.max(now.getTime(), Date.now()));
        if (await prepareRanking(tx, row.userId, captured)) await refreshRanking(tx, row.userId, captured);
      }, { timeout: 30000 });
      if (rows.length < 100) return;
      after = rows[rows.length - 1].userId;
    }
  }

  private async launch() {
    // Normal deployments insert this in the migration; useful for clean test databases as well.
    const existing = await this.prisma.rankingLaunch.findUnique({ where: { id: 1 } });
    if (existing) return existing;
    await this.prisma.rankingLaunch.createMany({ data: [{ id: 1 }], skipDuplicates: true });
    return this.prisma.rankingLaunch.findUniqueOrThrow({ where: { id: 1 } });
  }

  async periods(userId: string, query: RankingPeriodsQuery) {
    await this.access.enabled(this.prisma, userId);
    const launch = await this.launch(), current = rankingKeys(new Date());
    const first = rankingKeys(launch.launchedAt)[query.kind];
    const all: string[] = [];
    let key = current[query.kind];
    while (key >= first) {
      all.push(key);
      key = datePeriodKey(query.kind, new Date(rankingPeriod(query.kind, key).start.getTime() - 86400000));
    }
    const offset = (query.page - 1) * query.pageSize;
    return { items: all.slice(offset, offset + query.pageSize).map(period => ({ period, closed: period < current[query.kind] })),
      total: all.length, page: query.page, pageSize: query.pageSize, timezone: 'Asia/Shanghai' };
  }

  async list(userId: string, query: RankingQuery) {
    await this.access.enabled(this.prisma, userId);
    rankingPeriod(query.kind, query.period);
    const launch = await this.launch(), now = new Date(), current = rankingKeys(now);
    if (query.period < rankingKeys(launch.launchedAt)[query.kind] || query.period > current[query.kind]) {
      throw new BadRequestException('该周期尚未开放；上线前已结束的周期不补榜');
    }
    await this.synchronize(now);
    return this.prisma.$transaction(async tx => {
      const pref = await this.access.enabled(tx, userId);
      const scope = query.scope === 'global' ? Prisma.sql`p.ranking_scope = 'global'` : Prisma.sql`
        p.ranking_scope IN ('global','friends') AND (u.id = ${userId}::uuid OR (
          EXISTS (SELECT 1 FROM public.social_follows f WHERE f.follower_id = ${userId}::uuid AND f.followee_id = u.id)
          AND EXISTS (SELECT 1 FROM public.social_follows f WHERE f.followee_id = ${userId}::uuid AND f.follower_id = u.id)))`;
      const offset = (query.page - 1) * query.pageSize;
      const [result] = await tx.$queryRaw<Array<{ data: any }>>(Prisma.sql`
        WITH visible AS (
          SELECT u.id, u.nickname, u.avatar, r.surplus, r.effective_days, p.show_ranking_amount,
            rank() OVER (ORDER BY r.surplus DESC, r.effective_days DESC)::int AS rank,
            row_number() OVER (ORDER BY r.surplus DESC, r.effective_days DESC, u.id)::int AS position
          FROM public.ranking_results r JOIN public.users u ON u.id = r.user_id
          JOIN public.social_preferences p ON p.user_id = u.id
          WHERE r.kind = ${query.kind} AND r.period = ${query.period} AND r.included > 0 AND r.needs_review = 0
            AND u.is_active AND ${scope}
            AND NOT EXISTS (SELECT 1 FROM public.social_blocks b WHERE
              (b.blocker_id = ${userId}::uuid AND b.blocked_id = u.id) OR (b.blocked_id = ${userId}::uuid AND b.blocker_id = u.id))
        ), projected AS (
          SELECT position, jsonb_build_object('user', jsonb_build_object('id', id, 'nickname', nickname, 'avatar', avatar),
            'rank', rank, 'position', position, 'effectiveDays', effective_days,
            'amount', CASE WHEN show_ranking_amount OR id = ${userId}::uuid THEN surplus::text ELSE NULL END,
            'amountHidden', NOT show_ranking_amount AND id <> ${userId}::uuid) AS item FROM visible
        ) SELECT jsonb_build_object(
          'items', COALESCE((SELECT jsonb_agg(item ORDER BY position) FROM (SELECT * FROM projected ORDER BY position OFFSET ${offset} LIMIT ${query.pageSize}) page), '[]'::jsonb),
          'total', (SELECT count(*)::int FROM visible),
          'mine', (SELECT item FROM projected WHERE item->'user'->>'id' = ${userId}),
          'myPage', (SELECT ((position - 1) / ${query.pageSize} + 1)::int FROM visible WHERE id = ${userId}::uuid)
        ) AS data`);
      const own = await tx.rankingResult.findUnique({ where: { userId_kind_period: { userId, kind: query.kind, period: query.period } } });
      const mineStatus = result.data.mine ? 'ranked' : pref.rankingScope === 'none' ? 'not_participating' :
        query.scope === 'global' && pref.rankingScope === 'friends' ? 'friends_only' : !own ? 'no_period_record' :
        own.needsReview > 0 ? 'needs_review' : 'no_valid_entries';
      return { ...result.data, mineStatus, myPendingCount: own?.needsReview ?? 0, kind: query.kind, period: query.period,
        scope: query.scope, page: query.page, pageSize: query.pageSize, closed: query.period < current[query.kind],
        currency: 'CNY', timezone: 'Asia/Shanghai', meaning: '期间有效收入及退款减支出；不是资产或银行余额，也不认证真实财富' };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 });
  }
}
