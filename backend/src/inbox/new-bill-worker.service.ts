import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SocialAccessService } from '../social/social-access.service';
import { visibleNotice } from './new-bill-notice';

@Injectable()
export class NewBillWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NewBillWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  constructor(private readonly prisma: PrismaService, private readonly access: SocialAccessService) {}
  onModuleInit() {
    if (process.env.NEW_BILL_NOTICE_WORKER_DISABLED === '1') return;
    this.timer = setInterval(() => { void this.run(); }, 5000);
    this.timer.unref();
  }
  async onModuleDestroy() { if (this.timer) clearInterval(this.timer); await this.running; }
  run() {
    if (!this.running) this.running = this.drain().catch(error => this.logger.error(`账单通知重试：${error.message}`)).finally(() => { this.running = undefined; });
    return this.running;
  }
  async drain() {
    const now = new Date();
    const notices = await this.prisma.newBillNotice.findMany({ where: { processedAt: null, dueAt: { lte: now }, OR: [{ retryAt: null }, { retryAt: { lte: now } }] }, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }], take: 20 });
    for (const original of notices) {
      try { await this.prisma.$transaction(async tx => {
        await this.access.lockUsers(tx, [original.ownerId, original.reviewerId]);
        const notice = await tx.newBillNotice.findUnique({ where: { id: original.id } });
        if (!notice || notice.processedAt || notice.dueAt > new Date() || (notice.retryAt && notice.retryAt > new Date())) return;
        const visible = await visibleNotice(tx, notice.reviewerId, notice.id);
        if (visible) await tx.socialInboxEvent.create({ data: { userId: notice.reviewerId, kind: 'review_bills_created',
          dedupeKey: `new-bill-notice:${notice.id}`, payload: { ownerId: notice.ownerId, noticeId: notice.id } } });
        await tx.newBillNotice.update({ where: { id: notice.id }, data: { processedAt: new Date(), retryAt: null } });
      }); } catch (error) {
        // Keep this batch pending, but let unrelated recipients make progress in the same pass.
        this.logger.error(`账单通知批次 ${original.id} 处理失败，将重试：${error.message}`);
        await this.prisma.newBillNotice.updateMany({ where: { id: original.id, processedAt: null },
          data: { attempts: { increment: 1 }, retryAt: new Date(Date.now() + Math.min(300000, 5000 * 2 ** Math.min(original.attempts, 6))) } });
      }
    }
  }
}
