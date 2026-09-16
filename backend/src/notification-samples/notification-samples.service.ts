import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationSampleQueryDto, UploadNotificationSamplesDto } from './notification-samples.dto';

@Injectable()
export class NotificationSamplesService {
  constructor(private readonly prisma: PrismaService) {}

  async upload(userId: string, dto: UploadNotificationSamplesDto) {
    if (dto.samples.some((sample) => Buffer.byteLength(JSON.stringify(sample)) > 128 * 1024)) {
      throw new BadRequestException('单条通知样本不能超过 128KB');
    }
    await this.prisma.notificationSample.createMany({
      data: dto.samples.map((sample) => ({
        ...sample, userId, postedAt: new Date(sample.postedAt), capturedAt: new Date(sample.capturedAt),
        raw: sample.raw as Prisma.InputJsonObject,
        parsed: sample.parsed ? sample.parsed as Prisma.InputJsonObject : Prisma.DbNull,
      })),
      skipDuplicates: true,
    });
    return { acceptedIds: dto.samples.map((sample) => sample.sampleId) };
  }

  private where(query: NotificationSampleQueryDto): Prisma.NotificationSampleWhereInput {
    return { userId: query.userId, status: query.status, packageName: query.packageName, ruleVersion: query.ruleVersion };
  }

  async list(query: NotificationSampleQueryDto) {
    const where = this.where(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notificationSample.findMany({ where, orderBy: { id: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize,
        include: { user: { select: { username: true, nickname: true } } } }),
      this.prisma.notificationSample.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize, pages: Math.max(1, Math.ceil(total / query.pageSize)) };
  }

  async export(query: NotificationSampleQueryDto) {
    const items = await this.prisma.notificationSample.findMany({
      where: { ...this.where(query), id: { gt: query.afterId } }, orderBy: { id: 'asc' }, take: 1000,
    });
    return { items, nextAfterId: items.length === 1000 ? items[items.length - 1].id : null };
  }
}
