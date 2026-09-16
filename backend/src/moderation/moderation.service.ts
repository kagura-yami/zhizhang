import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewsService, visibleReviewMessage } from '../reviews/reviews.service';
import { SocialAccessService } from '../social/social-access.service';
import { SocialPageDto } from '../social/social.dto';
import { CreateReviewReportDto, DecideReviewReportDto, ModerationQueryDto, REPORT_DISCLOSURE_VERSION } from './moderation.dto';

const page = (q: SocialPageDto) => ({ skip: (q.page - 1) * q.pageSize, take: q.pageSize });
@Injectable()
export class ModerationService {
  constructor(private readonly prisma: PrismaService, private readonly reviews: ReviewsService, private readonly access: SocialAccessService) {}

  async preview(userId: string, threadId: number, messageId: number) {
    return this.reviews.withThread(userId, threadId, false, async tx => {
      const message = await tx.reviewMessage.findFirst({ where: { id: messageId, threadId } });
      if (!message) throw new NotFoundException('文字不存在');
      if (message.authorId === userId) throw new BadRequestException('不能举报自己的内容');
      if (message.hidden) throw new BadRequestException('内容已隐藏，无需重复举报');
      return { message: visibleReviewMessage(message), disclosureVersion: REPORT_DISCLOSURE_VERSION };
    });
  }

  async report(userId: string, threadId: number, messageId: number, dto: CreateReviewReportDto) {
    return this.reviews.withThread(userId, threadId, false, async (tx, thread) => {
      const message = await tx.reviewMessage.findFirst({ where: { id: messageId, threadId } });
      if (!message) throw new NotFoundException('文字不存在');
      if (message.authorId === userId) throw new BadRequestException('不能举报自己的内容');
      if (message.revision !== dto.expectedRevision) throw new ConflictException('内容已经更新，请查看后再举报');
      const key = { reporterId: userId, originalMessageId: messageId, reportedRevision: dto.expectedRevision };
      const existing = await tx.reviewReport.findUnique({ where: { reporterId_originalMessageId_reportedRevision: key } });
      if (existing) return { id: existing.id, status: existing.status };
      if (message.hidden) throw new BadRequestException('内容已隐藏，无需重复举报');
      // withThread holds the reporter's User row lock across count + evidence creation.
      // This serializes submissions across threads and backend processes, not just one instance.
      const now = Date.now();
      const [hour, day] = await Promise.all([
        tx.reviewReport.count({ where: { reporterId: userId, createdAt: { gt: new Date(now - 3600000) } } }),
        tx.reviewReport.count({ where: { reporterId: userId, createdAt: { gt: new Date(now - 86400000) } } }),
      ]);
      if (hour >= 5 || day >= 20) throw new HttpException(
        hour >= 5 ? '每小时最多提交 5 次新举报，请稍后重试' : '24 小时内最多提交 20 次新举报，请稍后重试',
        HttpStatus.TOO_MANY_REQUESTS,
      );
      const report = await tx.reviewReport.create({ data: { ...key, threadId, messageId, authorId: message.authorId,
        ownerId: thread.ownerId, reviewerId: thread.reviewerId, reason: dto.reason.trim(), disclosureVersion: dto.disclosureVersion } });
      let afterId = 0;
      // Freeze only this pair's thread, including versions; never fetch other reviewers or other bills.
      while (true) {
        const messages = await tx.reviewMessage.findMany({ where: { threadId, id: { gt: afterId } },
          orderBy: { id: 'asc' }, take: 100, include: { versions: { orderBy: { revision: 'asc' } } } });
        if (!messages.length) break;
        await tx.reviewReportEvidence.createMany({ data: messages.map(row => ({
          reportId: report.id, originalMessageId: row.id, authorId: row.authorId, isMain: row.mainSlot === 1,
          body: row.body, withdrawn: row.withdrawn, hidden: row.hidden, revision: row.revision,
          versions: row.versions.map(version => ({ revision: version.revision, body: version.body, withdrawn: version.withdrawn, action: version.action, createdAt: version.createdAt.toISOString() })),
          messageCreatedAt: row.createdAt,
        })) });
        afterId = messages[messages.length - 1].id;
      }
      return { id: report.id, status: report.status };
    });
  }

  async mine(userId: string, query: SocialPageDto) {
    return this.prisma.reviewReport.findMany({ where: { reporterId: userId },
      select: { id: true, originalMessageId: true, reportedRevision: true, reason: true, status: true, decisionReason: true, createdAt: true, decidedAt: true },
      orderBy: { id: 'desc' }, ...page(query) });
  }

  async list(query: ModerationQueryDto) {
    const where = { status: query.status };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.reviewReport.findMany({ where, orderBy: { id: 'desc' }, ...page(query) }),
      this.prisma.reviewReport.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize, pages: Math.max(1, Math.ceil(total / query.pageSize)) };
  }

  async evidence(id: number, actor: string, query: SocialPageDto) {
    return this.prisma.$transaction(async tx => {
      const report = await tx.reviewReport.findUnique({ where: { id } });
      if (!report) throw new NotFoundException('举报不存在');
      const [items, total] = await Promise.all([
        tx.reviewReportEvidence.findMany({ where: { reportId: id }, orderBy: { originalMessageId: 'asc' }, ...page(query) }),
        tx.reviewReportEvidence.count({ where: { reportId: id } }),
      ]);
      await tx.reviewModerationAudit.create({ data: { reportId: id, actor, action: 'view_evidence' } });
      return { report, items, total, page: query.page, pageSize: query.pageSize, pages: Math.max(1, Math.ceil(total / query.pageSize)) };
    });
  }

  async decide(id: number, actor: string, dto: DecideReviewReportDto) {
    const original = await this.prisma.reviewReport.findUnique({ where: { id } });
    if (!original) throw new NotFoundException('举报不存在');
    return this.prisma.$transaction(async tx => {
      await this.access.lockUsers(tx, [original.ownerId, original.reviewerId]);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM public.review_reports WHERE id = ${id} FOR UPDATE`);
      const report = await tx.reviewReport.findUnique({ where: { id } });
      if (!report) throw new NotFoundException('举报不存在');
      if (report.status !== 'pending') {
        if (report.status === dto.status && report.decisionReason === dto.reason.trim()) return report;
        throw new ConflictException('举报已由其他管理员处理，请刷新');
      }
      if (dto.status === 'upheld' && report.messageId) {
        await tx.reviewMessage.update({ where: { id: report.messageId }, data: { hidden: true } });
      }
      const updated = await tx.reviewReport.update({ where: { id }, data: { status: dto.status, decisionReason: dto.reason.trim(), decidedBy: actor, decidedAt: new Date() } });
      await tx.reviewModerationAudit.create({ data: { reportId: id, actor, action: dto.status, reason: dto.reason.trim() } });
      const recipients = new Set([report.reporterId, ...(dto.status === 'upheld' ? [report.authorId] : [])].filter(Boolean));
      for (const userId of recipients) {
        if (await tx.user.findUnique({ where: { id: userId }, select: { id: true } })) await tx.socialInboxEvent.create({ data: {
          userId, kind: 'review_report_decided', dedupeKey: `review-report:${id}:${userId}`,
          payload: { reportId: id, status: dto.status, reason: dto.reason.trim(), originalMessageId: report.originalMessageId },
        } });
      }
      return updated;
    });
  }
}
