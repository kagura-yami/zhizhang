import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, RetrospectiveJob } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { lockSocialUsers } from '../../social/social-access.service';
import { closedReviewPeriod } from '../../ledger/ledger-period';
import { RetrospectiveGeneratorService } from './retrospective-generator.service';
import { RetrospectiveEvidenceService } from './retrospective-evidence.service';
import {
  CreateRetrospectiveDto,
  RetrospectivePageDto,
} from '../dto/retrospective.dto';
import type { RetrospectiveEvidence } from './retrospective-output';

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function metadata(job: RetrospectiveJob) {
  return {
    id: job.id,
    kind: job.kind,
    period: job.period,
    status: job.status,
    attempts: job.attempts,
    errorCode: job.errorCode,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

@Injectable()
export class RetrospectiveJobsService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private stopping = false;
  private lastWorkerWarning = 0;
  private readonly logger = new Logger(RetrospectiveJobsService.name);
  private readonly running = new Map<string, AbortController>();
  constructor(
    private readonly prisma: PrismaService,
    private readonly generator: RetrospectiveGeneratorService,
    private readonly evidence: RetrospectiveEvidenceService,
  ) {}

  onModuleInit() {
    if (process.env.RETROSPECTIVE_WORKER_DISABLED === '1') return;
    this.timer = setInterval(() => {
      if (this.busy || this.stopping) return;
      this.busy = true;
      void this.runOne()
        .catch(() => {
          if (Date.now() - this.lastWorkerWarning > 60000) {
            this.lastWorkerWarning = Date.now();
            this.logger.warn(
              '复盘队列暂不可用，将继续重试；中断任务按租约恢复',
            );
          }
        })
        .finally(() => {
          this.busy = false;
        });
    }, 3000);
    this.timer.unref();
  }
  onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    for (const controller of this.running.values()) controller.abort();
  }

  private async owner(tx: Prisma.TransactionClient, userId: string) {
    if (
      !(await tx.user.findFirst({
        where: { id: userId, isActive: true },
        select: { id: true },
      }))
    )
      throw new NotFoundException('用户不存在');
  }
  private async capacity(tx: Prisma.TransactionClient, userId: string) {
    if (
      await tx.retrospectiveJob.count({
        where: { userId, status: { in: ['queued', 'running'] } },
      })
    ) {
      throw new ConflictException('已有复盘正在生成，请等待完成');
    }
  }
  async create(userId: string, dto: CreateRetrospectiveDto) {
    closedReviewPeriod(dto.kind, dto.period);
    return this.prisma.$transaction(async (tx) => {
      await lockSocialUsers(tx, [userId]);
      await this.owner(tx, userId);
      const existing = await tx.retrospectiveJob.findUnique({
        where: { userId_clientKey: { userId, clientKey: dto.clientKey } },
      });
      if (existing) {
        if (
          existing.kind !== dto.kind ||
          existing.period !== dto.period ||
          (dto.configId !== undefined && existing.configId !== dto.configId)
        )
          throw new ConflictException('该请求标识已用于其他复盘');
        return metadata(existing);
      }
      await this.capacity(tx, userId);
      if (
        (await tx.retrospectiveJob.count({
          where: {
            userId,
            createdAt: { gte: new Date(Date.now() - 86400000) },
          },
        })) >= 20
      )
        throw new BadRequestException('最近二十四小时最多创建二十次复盘');
      const config = await tx.aIModelConfig.findFirst({
        where: {
          userId,
          ...(dto.configId === undefined
            ? { isDefault: true }
            : { id: dto.configId }),
        },
        select: { id: true },
      });
      if (!config) throw new BadRequestException('请先选择本人的 AI 模型配置');
      return metadata(
        await tx.retrospectiveJob.create({
          data: {
            userId,
            clientKey: dto.clientKey,
            kind: dto.kind,
            period: dto.period,
            configId: config.id,
          },
        }),
      );
    });
  }

  async list(userId: string, page: RetrospectivePageDto) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.owner(tx, userId);
        const where = { userId, status: { not: 'deleted' } };
        const total = await tx.retrospectiveJob.count({ where });
        const items = await tx.retrospectiveJob.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page.page - 1) * page.pageSize,
          take: page.pageSize,
          // Do not load or expose historical text in list responses.
          select: {
            id: true,
            kind: true,
            period: true,
            status: true,
            attempts: true,
            errorCode: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        return { items, total };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async detail(userId: string, id: string) {
    const initial = await this.prisma.retrospectiveJob.findFirst({
      where: { id, userId, status: { not: 'deleted' } },
    });
    if (!initial) throw new NotFoundException('复盘不存在');
    const current =
      initial.status === 'succeeded'
        ? await this.evidence.collect(
            userId,
            initial.kind as 'day' | 'month',
            initial.period,
          )
        : null;
    const initialSources = (
      Array.isArray(initial.sources) ? initial.sources : []
    ) as RetrospectiveEvidence['sources'];
    return this.prisma.$transaction(
      async (tx) => {
        await lockSocialUsers(tx, [
          userId,
          ...initialSources.map((s) => s.authorId).filter(Boolean),
        ]);
        await this.owner(tx, userId);
        const job = await tx.retrospectiveJob.findFirst({
          where: { id, userId, status: { not: 'deleted' } },
        });
        if (!job) throw new NotFoundException('复盘不存在');
        if (job.status !== 'succeeded')
          return { ...metadata(job), result: null, sourceChanged: false };
        // A completion that raced the initial read is inspected on the next request, never returned unchecked.
        if (!current || initial.updatedAt.getTime() !== job.updatedAt.getTime())
          throw new ConflictException('复盘状态已变化，请刷新');
        const sources = job.sources as RetrospectiveEvidence['sources'];
        let invalid = !Array.isArray(sources);
        const social = sources?.filter((s) => s.kind !== 'bill') ?? [];
        if (social.length) {
          const preference = await tx.socialPreference.findUnique({
            where: { userId },
          });
          if (!preference?.allowAiFeedback) invalid = true;
          for (let i = 0; i < social.length; i += 500) {
            const batch = social.slice(i, i + 500);
            const authors = [
              ...new Set(batch.map((s) => s.authorId).filter(Boolean)),
            ];
            if (authors.length !== new Set(batch.map((s) => s.authorId)).size)
              invalid = true;
            const allowed = await tx.user.count({
              where: {
                id: { in: authors },
                isActive: true,
                socialPreference: { is: { allowAiAuthoredFeedback: true } },
              },
            });
            if (allowed !== authors.length) invalid = true;
            const messageIds = batch
              .filter((s) => s.kind === 'message')
              .map((s) => s.id);
            if (
              messageIds.length &&
              (await tx.reviewMessage.count({
                where: {
                  id: { in: messageIds },
                  hidden: false,
                  withdrawn: false,
                  thread: { ownerId: userId },
                },
              })) !== messageIds.length
            )
              invalid = true;
          }
        }
        if (invalid) {
          const hidden = await tx.retrospectiveJob.update({
            where: { id },
            data: {
              status: 'invalidated',
              result: Prisma.DbNull,
              errorCode: 'evidence_unavailable',
            },
          });
          return { ...metadata(hidden), result: null, sourceChanged: true };
        }
        const result = job.result as Prisma.JsonObject;
        const { sources: _internalSources, ...publicResult } = result;
        const report = result.report as Prisma.JsonObject;
        const cited = new Set<string>();
        for (const item of (report.friendViews as Prisma.JsonObject[]) ?? [])
          cited.add(String(item.ref));
        for (const item of [
          ...((report.analysis as Prisma.JsonObject[]) ?? []),
          ...((report.actions as Prisma.JsonObject[]) ?? []),
        ]) {
          for (const ref of (item.citations as string[]) ?? []) cited.add(ref);
        }
        const messageTargets = await tx.reviewMessage.findMany({
          where: {
            id: {
              in: sources
                .filter(
                  (source) =>
                    source.kind === 'message' && cited.has(source.ref),
                )
                .map((source) => source.id),
            },
            thread: { ownerId: userId },
          },
          select: { id: true, threadId: true },
        });
        return {
          ...metadata(job),
          result: {
            ...publicResult,
            references: sources
              .filter((source) => cited.has(source.ref))
              .map((source) => ({
                ref: source.ref,
                kind: source.kind,
                id: source.id,
                ...(source.kind === 'message'
                  ? {
                      threadId: messageTargets.find(
                        (message) => message.id === source.id,
                      )?.threadId,
                    }
                  : {}),
              })),
          },
          sourceChanged: result.inputDigest !== current.inputDigest,
        };
      },
      { timeout: 30000 },
    );
  }

  async retry(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockSocialUsers(tx, [userId]);
      await this.owner(tx, userId);
      const job = await tx.retrospectiveJob.findFirst({
        where: { id, userId },
      });
      if (!job || job.status === 'deleted')
        throw new NotFoundException('复盘不存在');
      if (job.status === 'queued' || job.status === 'running')
        return metadata(job);
      if (job.status !== 'failed' || job.attempts >= 3)
        throw new ConflictException('该复盘不能重试，请创建新的复盘');
      await this.capacity(tx, userId);
      return metadata(
        await tx.retrospectiveJob.update({
          where: { id },
          data: {
            status: 'queued',
            errorCode: null,
            sources: Prisma.DbNull,
            result: Prisma.DbNull,
          },
        }),
      );
    });
  }
  async remove(userId: string, id: string) {
    await this.prisma.$transaction(async (tx) => {
      await lockSocialUsers(tx, [userId]);
      await this.owner(tx, userId);
      const changed = await tx.retrospectiveJob.updateMany({
        where: { id, userId },
        data: {
          status: 'deleted',
          result: Prisma.DbNull,
          sources: Prisma.DbNull,
          errorCode: null,
          leaseToken: null,
          leaseUntil: null,
        },
      });
      if (!changed.count) throw new NotFoundException('复盘不存在');
    });
    this.running.get(id)?.abort();
    return { deleted: true };
  }

  async runOne() {
    if (this.stopping) return false;
    await this.prisma.retrospectiveJob.updateMany({
      where: { status: 'running', leaseUntil: { lt: new Date() } },
      data: {
        status: 'failed',
        errorCode: 'interrupted',
        leaseToken: null,
        leaseUntil: null,
      },
    });
    const token = randomUUID();
    const job = await this.prisma.$transaction(async (tx) => {
      const queued = await tx.retrospectiveJob.findFirst({
        where: { status: 'queued' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      if (!queued) return null;
      const claim = await tx.retrospectiveJob.updateMany({
        where: { id: queued.id, status: 'queued' },
        data: {
          status: 'running',
          attempts: { increment: 1 },
          leaseToken: token,
          leaseUntil: new Date(Date.now() + 600000),
        },
      });
      return claim.count ? queued : null;
    });
    if (!job) return false;
    const controller = new AbortController();
    this.running.set(job.id, controller);
    const ownership = { id: job.id, status: 'running', leaseToken: token };
    let renewing = false;
    const heartbeat = setInterval(() => {
      if (renewing) return;
      renewing = true;
      void this.prisma.retrospectiveJob
        .updateMany({
          where: ownership,
          data: { leaseUntil: new Date(Date.now() + 600000) },
        })
        .then((updated) => {
          if (!updated.count) controller.abort();
        })
        .catch(() => controller.abort())
        .finally(() => {
          renewing = false;
        });
    }, 30000);
    heartbeat.unref();
    try {
      const result = await this.generator.generate(
        job.userId,
        job.kind as 'day' | 'month',
        job.period,
        job.configId,
        controller.signal,
        async (input) => {
          const saved = await this.prisma.retrospectiveJob.updateMany({
            where: ownership,
            data: { sources: json(input.sources) },
          });
          if (!saved.count) {
            controller.abort();
            throw new ConflictException('复盘任务已结束');
          }
        },
      );
      await this.prisma.retrospectiveJob.updateMany({
        where: ownership,
        data: {
          status: 'succeeded',
          result: json(result),
          leaseToken: null,
          leaseUntil: null,
        },
      });
    } catch (error) {
      await this.prisma.retrospectiveJob.updateMany({
        where: ownership,
        data: {
          status: 'failed',
          result: Prisma.DbNull,
          errorCode:
            error?.getStatus?.() === 409
              ? 'input_changed'
              : 'generation_failed',
          leaseToken: null,
          leaseUntil: null,
        },
      });
    } finally {
      clearInterval(heartbeat);
      this.running.delete(job.id);
    }
    return true;
  }
}
