import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminIssueQueryDto,
  AdminUserQueryDto,
  CreateAdminIssueDto,
  CreateAdminUserDto,
  CreateAdminVersionDto,
  CreateSystemSettingDto,
  UpdateAdminIssueDto,
  UpdateAdminUserDto,
  UpdateAdminVersionDto,
  UpdateSystemSettingDto,
} from './dto/admin.dto';

const defaultSettings: CreateSystemSettingDto[] = [
  { key: 'general.registrationEnabled', value: true, category: 'general', description: '允许新用户注册' },
  { key: 'general.maintenanceMode', value: false, category: 'general', description: '开启维护模式提示' },
  { key: 'features.autoBookkeeping', value: true, category: 'features', description: '自动记账总开关' },
  { key: 'features.aiAssistant', value: true, category: 'features', description: 'AI 助手总开关' },
  { key: 'features.invoiceMailbox', value: true, category: 'features', description: '收票邮箱总开关' },
  { key: 'updates.autoCheck', value: true, category: 'updates', description: '客户端自动检查更新' },
  { key: 'updates.minimumSupportedVersion', value: '0.0.1', category: 'updates', description: '最低支持版本' },
  { key: 'support.email', value: 'kagura_yami@Outlook.com', category: 'support', description: '产品支持邮箱' },
];

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [
      users,
      activeUsers,
      newUsers7d,
      newUsers30d,
      bills,
      versions,
      openIssues,
      recentUsers,
      registrations,
      billSources,
      totals,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.user.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      this.prisma.user.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      this.prisma.bill.count(),
      this.prisma.appVersion.count(),
      this.prisma.adminIssue.count({ where: { status: { notIn: ['fixed', 'closed'] } } }),
      this.prisma.user.findMany({
        take: 6,
        orderBy: { createdAt: 'desc' },
        select: { id: true, username: true, nickname: true, email: true, isActive: true, createdAt: true, lastLoginAt: true },
      }),
      this.prisma.user.findMany({ where: { createdAt: { gte: thirtyDaysAgo } }, select: { createdAt: true } }),
      this.prisma.bill.groupBy({ by: ['source'], _count: { _all: true }, orderBy: { _count: { source: 'desc' } }, take: 6 }),
      this.prisma.bill.groupBy({ by: ['type'], _sum: { amount: true } }),
    ]);

    const daily = new Map<string, number>();
    for (let index = 13; index >= 0; index -= 1) {
      const date = new Date(now.getTime() - index * 24 * 60 * 60 * 1000);
      daily.set(date.toISOString().slice(0, 10), 0);
    }
    registrations.forEach(({ createdAt }) => {
      const key = createdAt.toISOString().slice(0, 10);
      if (daily.has(key)) daily.set(key, (daily.get(key) || 0) + 1);
    });

    return {
      metrics: { users, activeUsers, disabledUsers: users - activeUsers, newUsers7d, newUsers30d, bills, versions, openIssues },
      finance: Object.fromEntries(totals.map((item) => [item.type, Number(item._sum.amount || 0)])),
      registrations: Array.from(daily, ([date, count]) => ({ date, count })),
      billSources: billSources.map((item) => ({ source: item.source, count: item._count._all })),
      recentUsers,
    };
  }

  async listUsers(query: AdminUserQueryDto) {
    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 20;
    const where: Prisma.UserWhereInput = {
      ...(query.status === 'active' ? { isActive: true } : query.status === 'disabled' ? { isActive: false } : {}),
      ...(query.search ? {
        OR: [
          { username: { contains: query.search, mode: 'insensitive' } },
          { nickname: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
        ],
      } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, username: true, email: true, nickname: true, avatar: true, isActive: true,
          lastLoginAt: true, createdAt: true, updatedAt: true,
          _count: { select: { bills: true, chatSessions: true, invoices: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page, pageSize, pages: Math.ceil(total / pageSize) };
  }

  async createUser(dto: CreateAdminUserDto) {
    try {
      return await this.prisma.user.create({
        data: {
          username: dto.username,
          password: await bcrypt.hash(dto.password, 10),
          email: dto.email || null,
          nickname: dto.nickname || dto.username,
          isActive: dto.isActive ?? true,
        },
        select: { id: true, username: true, email: true, nickname: true, isActive: true, createdAt: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('用户名或邮箱已存在');
      throw error;
    }
  }

  async updateUser(id: string, dto: UpdateAdminUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw new NotFoundException('用户不存在');
    try {
      return await this.prisma.user.update({
        where: { id },
        data: {
          ...(dto.username !== undefined ? { username: dto.username } : {}),
          ...(dto.email !== undefined ? { email: dto.email || null } : {}),
          ...(dto.nickname !== undefined ? { nickname: dto.nickname } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.password ? { password: await bcrypt.hash(dto.password, 10) } : {}),
        },
        select: { id: true, username: true, email: true, nickname: true, isActive: true, updatedAt: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('用户名或邮箱已存在');
      throw error;
    }
  }

  async deleteUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw new NotFoundException('用户不存在');
    await this.prisma.user.delete({ where: { id } });
  }

  listVersions() {
    return this.prisma.appVersion.findMany({ orderBy: { versionCode: 'desc' } });
  }

  async createVersion(dto: CreateAdminVersionDto) {
    const versionCode = this.versionToCode(dto.version);
    return this.prisma.appVersion.create({ data: { ...dto, platform: dto.platform || 'android', forceUpdate: dto.forceUpdate ?? false, versionCode } });
  }

  async updateVersion(id: number, dto: UpdateAdminVersionDto) {
    const version = await this.prisma.appVersion.findUnique({ where: { id } });
    if (!version) throw new NotFoundException('版本记录不存在');
    return this.prisma.appVersion.update({
      where: { id },
      data: { ...dto, ...(dto.version ? { versionCode: this.versionToCode(dto.version) } : {}) },
    });
  }

  async deleteVersion(id: number) {
    const version = await this.prisma.appVersion.findUnique({ where: { id } });
    if (!version) throw new NotFoundException('版本记录不存在');
    await this.prisma.appVersion.delete({ where: { id } });
  }

  async listSettings() {
    await this.seedSettings();
    return this.prisma.systemSetting.findMany({ orderBy: [{ category: 'asc' }, { key: 'asc' }] });
  }

  createSetting(dto: CreateSystemSettingDto) {
    return this.prisma.systemSetting.create({ data: { ...dto, value: dto.value as Prisma.InputJsonValue } });
  }

  async updateSetting(id: number, dto: UpdateSystemSettingDto) {
    const setting = await this.prisma.systemSetting.findUnique({ where: { id } });
    if (!setting) throw new NotFoundException('配置不存在');
    const data: Prisma.SystemSettingUpdateInput = {
      ...(dto.category !== undefined ? { category: dto.category } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.isSecret !== undefined ? { isSecret: dto.isSecret } : {}),
      ...(dto.value !== undefined ? { value: dto.value as Prisma.InputJsonValue } : {}),
    };
    return this.prisma.systemSetting.update({
      where: { id },
      data,
    });
  }

  async deleteSetting(id: number) {
    const setting = await this.prisma.systemSetting.findUnique({ where: { id } });
    if (!setting) throw new NotFoundException('配置不存在');
    await this.prisma.systemSetting.delete({ where: { id } });
  }

  async listIssues(query: AdminIssueQueryDto) {
    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 20;
    const where: Prisma.AdminIssueWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.search ? { OR: [
        { title: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.adminIssue.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }] }),
      this.prisma.adminIssue.count({ where }),
    ]);
    return { items, total, page, pageSize, pages: Math.ceil(total / pageSize) };
  }

  createIssue(dto: CreateAdminIssueDto) {
    return this.prisma.adminIssue.create({ data: dto });
  }

  async updateIssue(id: number, dto: UpdateAdminIssueDto) {
    const issue = await this.prisma.adminIssue.findUnique({ where: { id } });
    if (!issue) throw new NotFoundException('Issue 不存在');
    const resolved = dto.status && ['fixed', 'closed'].includes(dto.status);
    return this.prisma.adminIssue.update({
      where: { id },
      data: { ...dto, ...(dto.status ? { resolvedAt: resolved ? issue.resolvedAt || new Date() : null } : {}) },
    });
  }

  async deleteIssue(id: number) {
    const issue = await this.prisma.adminIssue.findUnique({ where: { id } });
    if (!issue) throw new NotFoundException('Issue 不存在');
    await this.prisma.adminIssue.delete({ where: { id } });
  }

  private versionToCode(version: string) {
    const [major, minor, patch] = version.split('.').map(Number);
    return major * 10000 + minor * 100 + patch;
  }

  private async seedSettings() {
    await Promise.all(defaultSettings.map((setting) => this.prisma.systemSetting.upsert({
      where: { key: setting.key },
      create: { ...setting, value: setting.value as Prisma.InputJsonValue },
      update: {},
    })));
  }
}
