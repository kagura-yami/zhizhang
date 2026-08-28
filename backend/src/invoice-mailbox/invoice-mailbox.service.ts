import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SaveInvoiceMailboxDto } from './dto/invoice-mailbox.dto';
import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail, Attachment } from 'mailparser';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve, sep } from 'path';
import { Decimal } from '@prisma/client/runtime/library';
import pdfParse = require('pdf-parse');
import AdmZip = require('adm-zip');
import archiver = require('archiver');
import { PassThrough } from 'stream';
import type { InvoiceMailboxQueryDto } from './dto/invoice-mailbox.dto';

type MailboxConfig = {
  email: string;
  provider: string;
  imapHost: string;
  imapPort: number;
  secure: boolean;
  username: string;
  credential: string;
  accessToken?: string;
};

type MailboxSyncResult = {
  imported: number;
  matched: number;
  skipped: number;
  scanned: number;
  candidateMessages: number;
  pdfAttachments: number;
  linkCandidates: number;
  linkedPdfAttachments: number;
  fullScan: boolean;
  inProgress?: boolean;
};

const PROVIDER_PRESETS: Record<string, { host: string; port: number; secure: boolean }> = {
  qq: { host: 'imap.qq.com', port: 993, secure: true },
  '163': { host: 'imap.163.com', port: 993, secure: true },
  outlook: { host: 'outlook.office365.com', port: 993, secure: true },
  gmail: { host: 'imap.gmail.com', port: 993, secure: true },
};

@Injectable()
export class InvoiceMailboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InvoiceMailboxService.name);
  private readonly activeSyncs = new Set<string>();
  private readonly usedOAuthStates = new Set<string>();
  private syncTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    const minutes = Math.max(5, Number(process.env.INVOICE_SYNC_INTERVAL_MINUTES || 10));
    // 服务启动后稍作等待再执行一次，避免用户必须手动点击同步才能收到新发票。
    setTimeout(() => void this.syncAllEnabled(), 15_000).unref();
    // 回填旧版本已保存但尚未读取内容的 PDF，避免哈希去重后无法重新解析。
    setTimeout(() => void this.reprocessLegacyInvoices(), 25_000).unref();
    this.syncTimer = setInterval(() => {
      void this.syncAllEnabled();
    }, minutes * 60_000);
    this.syncTimer.unref();
  }

  onModuleDestroy() {
    if (this.syncTimer) clearInterval(this.syncTimer);
  }

  async getMailbox(userId: string) {
    const mailbox = await this.prisma.invoiceMailbox.findUnique({
      where: { userId },
      include: { _count: { select: { invoices: true } } },
    });
    if (!mailbox) return null;
    return this.toResponse(mailbox);
  }

  async saveMailbox(userId: string, dto: SaveInvoiceMailboxDto) {
    const mailbox = this.normalizeConfig(dto);
    await this.testConnection(mailbox);
    const encrypted = this.encrypt(mailbox.credential);

    const saved = await this.prisma.invoiceMailbox.upsert({
      where: { userId },
      create: {
        userId,
        email: mailbox.email,
        provider: mailbox.provider,
        imapHost: mailbox.imapHost,
        imapPort: mailbox.imapPort,
        secure: mailbox.secure,
        username: mailbox.username,
        credentialEncrypted: encrypted,
        enabled: true,
        status: 'ready',
        lastFullScanAt: null,
        lastError: null,
      },
      update: {
        email: mailbox.email,
        provider: mailbox.provider,
        imapHost: mailbox.imapHost,
        imapPort: mailbox.imapPort,
        secure: mailbox.secure,
        username: mailbox.username,
        credentialEncrypted: encrypted,
        oauthRefreshTokenEncrypted: null,
        oauthExpiresAt: null,
        enabled: true,
        status: 'ready',
        lastFullScanAt: null,
        lastError: null,
      },
      include: { _count: { select: { invoices: true } } },
    });
    return this.toResponse(saved);
  }

  async startOutlookOAuth(userId: string, email?: string) {
    const clientId = process.env.OUTLOOK_OAUTH_CLIENT_ID?.trim();
    if (!clientId) throw new BadRequestException('服务端尚未配置 Outlook 登录，请联系管理员');
    const state = this.createOAuthState(userId, email?.trim().toLowerCase());
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: this.outlookRedirectUri(),
      response_mode: 'query',
      scope: 'openid profile email offline_access https://graph.microsoft.com/Mail.Read',
      state,
    });
    return { authUrl: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}` };
  }

  async completeOutlookOAuth(state: string, code: string) {
    const payload = this.consumeOAuthState(state);
    const clientId = process.env.OUTLOOK_OAUTH_CLIENT_ID?.trim();
    const clientSecret = process.env.OUTLOOK_OAUTH_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) throw new BadRequestException('服务端尚未配置 Outlook OAuth2 凭据');
    const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: this.outlookRedirectUri(),
        grant_type: 'authorization_code',
        scope: 'openid profile email offline_access https://graph.microsoft.com/Mail.Read',
      }).toString(),
    });
    const token = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string; error_description?: string };
    if (!response.ok || !token.access_token || !token.refresh_token) throw new BadRequestException(`Outlook 登录失败：${token.error_description || '未返回有效授权令牌'}`);
    const identity = this.decodeJwtPayload(token.id_token);
    const email = String(identity?.preferred_username || identity?.email || payload.email || '').trim().toLowerCase();
    if (!email) throw new BadRequestException('Outlook 登录成功但未返回邮箱地址');
    await this.testOutlookGraph(token.access_token);
    const saved = await this.prisma.invoiceMailbox.upsert({
      where: { userId: payload.userId },
      create: { userId: payload.userId, email, provider: 'outlook', imapHost: PROVIDER_PRESETS.outlook.host, imapPort: 993, secure: true, username: email, credentialEncrypted: this.encrypt(''), oauthRefreshTokenEncrypted: this.encrypt(token.refresh_token), oauthExpiresAt: new Date(Date.now() + Number(token.expires_in || 3600) * 1000), enabled: true, status: 'ready', lastFullScanAt: null, lastError: null },
      update: { email, provider: 'outlook', imapHost: PROVIDER_PRESETS.outlook.host, imapPort: 993, secure: true, username: email, credentialEncrypted: this.encrypt(''), oauthRefreshTokenEncrypted: this.encrypt(token.refresh_token), oauthExpiresAt: new Date(Date.now() + Number(token.expires_in || 3600) * 1000), enabled: true, status: 'ready', lastFullScanAt: null, lastError: null },
      include: { _count: { select: { invoices: true } } },
    });
    return { userId: payload.userId, email: saved.email };
  }

  async removeMailbox(userId: string) {
    const mailbox = await this.prisma.invoiceMailbox.findUnique({ where: { userId }, select: { id: true } });
    if (!mailbox) return { removed: false };
    await this.prisma.$transaction([
      this.prisma.invoice.updateMany({ where: { mailboxId: mailbox.id }, data: { mailboxId: null } }),
      this.prisma.invoiceMailbox.delete({ where: { id: mailbox.id } }),
    ]);
    return { removed: true };
  }

  async testMailbox(userId: string) {
    const mailbox = await this.prisma.invoiceMailbox.findUnique({ where: { userId } });
    if (!mailbox) throw new NotFoundException('请先绑定收票邮箱');
    const config = this.fromStored(mailbox);
    if (mailbox.provider === 'outlook' && mailbox.oauthRefreshTokenEncrypted) {
      const auth = await this.getStoredAuth(mailbox);
      config.accessToken = auth.accessToken;
    }
    if (mailbox.provider === 'outlook' && config.accessToken) await this.testOutlookGraph(config.accessToken);
    else await this.testConnection(config);
    await this.prisma.invoiceMailbox.update({
      where: { id: mailbox.id },
      data: { status: 'ready', lastError: null },
    });
    return { success: true, message: '邮箱连接成功' };
  }

  async syncMailbox(userId: string) {
    const mailbox = await this.prisma.invoiceMailbox.findUnique({ where: { userId } });
    if (!mailbox) throw new NotFoundException('请先绑定收票邮箱');
    // 全量回扫可能超过移动端 HTTP 超时时间。先返回任务已启动，扫描在后台执行，
    // 避免客户端看到“网络错误”后重复发起任务；activeSyncs 负责并发去重。
    const key = String(mailbox.id);
    if (this.activeSyncs.has(key)) {
      return { imported: 0, matched: 0, skipped: 0, scanned: 0, candidateMessages: 0, pdfAttachments: 0, linkCandidates: 0, linkedPdfAttachments: 0, fullScan: true, inProgress: true, mailbox: await this.getMailbox(userId) };
    }
    void this.syncOne(mailbox, true).catch((error) => this.logger.warn(`手动同步失败 mailbox=${mailbox.id}: ${error?.message || '未知错误'}`));
    await this.prisma.invoiceMailbox.update({ where: { id: mailbox.id }, data: { status: 'syncing', lastError: null } });
    return { imported: 0, matched: 0, skipped: 0, scanned: 0, candidateMessages: 0, pdfAttachments: 0, linkCandidates: 0, linkedPdfAttachments: 0, fullScan: true, inProgress: true, mailbox: await this.getMailbox(userId) };
  }

  async getInvoice(userId: string, id: number) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id, userId } });
    if (!invoice) throw new NotFoundException('发票不存在');
    return { ...invoice, amount: invoice.amount?.toNumber() ?? null };
  }

  async listInvoices(userId: string, query: Partial<InvoiceMailboxQueryDto> = {}) {
    const limit = Math.min(Math.max(Number(query.limit || 50), 1), 100);
    const page = Math.max(Number(query.page || 1), 1);
    const search = query.search?.trim();
    const and: any[] = [];
    if (query.status) and.push({ status: query.status });
    if (query.buyer?.trim()) and.push({ invoiceCategory: { contains: query.buyer.trim(), mode: 'insensitive' } });
    if (query.seller?.trim()) and.push({ seller: { contains: query.seller.trim(), mode: 'insensitive' } });
    if (query.from || query.to) and.push({ invoiceDate: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } });
    if (search) and.push({ OR: [
      { fileName: { contains: search, mode: 'insensitive' } },
      { subject: { contains: search, mode: 'insensitive' } },
      { invoiceNumber: { contains: search, mode: 'insensitive' } },
      { seller: { contains: search, mode: 'insensitive' } },
      { buyer: { contains: search, mode: 'insensitive' } },
      { invoiceCategory: { contains: search, mode: 'insensitive' } },
    ] });
    const where: any = { userId, ...(and.length ? { AND: and } : {}) };
    const [invoices, total, buyers, sellers, aggregate] = await Promise.all([
      this.prisma.invoice.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        subject: true,
        sender: true,
        seller: true,
        buyer: true,
        invoiceCategory: true,
        invoiceNumber: true,
        amount: true,
        invoiceDate: true,
        receivedAt: true,
        status: true,
        billId: true,
      },
      }),
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({ where: { userId }, distinct: ['invoiceCategory'], select: { invoiceCategory: true }, orderBy: { invoiceCategory: 'asc' } }),
      this.prisma.invoice.findMany({ where: { userId }, distinct: ['seller'], select: { seller: true }, orderBy: { seller: 'asc' } }),
      this.prisma.invoice.aggregate({ where, _sum: { amount: true } }),
    ]);
    return {
      items: invoices.map((invoice) => ({ ...invoice, amount: invoice.amount?.toNumber() ?? null })),
      total,
      page,
      limit,
      buyers: buyers.map((item) => item.invoiceCategory).filter(Boolean),
      sellers: sellers.map((item) => item.seller).filter(Boolean),
      totalAmount: aggregate._sum.amount?.toNumber() ?? 0,
    };
  }

  async createInvoiceArchive(userId: string, query: Partial<InvoiceMailboxQueryDto> = {}) {
    const ids = query.ids?.split(',').map((id) => Number(id.trim())).filter((id) => Number.isInteger(id) && id > 0) || [];
    if (ids.length > 500) throw new BadRequestException('单次最多打包下载500张发票');
    const limit = ids.length ? ids.length : 500;
    const filtered = await this.listInvoiceRecords(userId, query, ids.length ? ids : undefined, limit);
    if (!filtered.length) throw new NotFoundException('没有符合筛选条件的发票');
    const stream = new PassThrough();
    const archive = (archiver as any)('zip', { zlib: { level: 6 } });
    archive.on('error', (error) => stream.destroy(error));
    archive.pipe(stream);
    for (const invoice of filtered) {
      const filePath = resolve(process.cwd(), invoice.storagePath);
      if (existsSync(filePath)) archive.file(filePath, { name: `${this.safeFileName(invoice.invoiceCategory || '未分类')}/${invoice.id}-${invoice.fileName}` });
    }
    const csv = ['发票抬头,销方,发票号码,金额,开票日期,状态,文件名', ...filtered.map((invoice) => [
      invoice.invoiceCategory || '未识别抬头', invoice.seller || '', invoice.invoiceNumber || '',
      invoice.amount?.toString() || '', invoice.invoiceDate?.toISOString().slice(0, 10) || '',
      invoice.status === 'matched' ? '已关联' : '待整理', invoice.fileName,
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))].join('\n');
    archive.append(`\uFEFF${csv}`, { name: '发票清单.csv' });
    void archive.finalize();
    return { stream, fileName: `知帐-发票-${new Date().toISOString().slice(0, 10)}.zip` };
  }

  private async listInvoiceRecords(userId: string, query: Partial<InvoiceMailboxQueryDto>, ids?: number[], limit = 100) {
    const search = query.search?.trim();
    const and: any[] = [];
    if (ids?.length) and.push({ id: { in: ids } });
    if (query.status) and.push({ status: query.status });
    if (query.buyer?.trim()) and.push({ invoiceCategory: { contains: query.buyer.trim(), mode: 'insensitive' } });
    if (query.seller?.trim()) and.push({ seller: { contains: query.seller.trim(), mode: 'insensitive' } });
    if (query.from || query.to) and.push({ invoiceDate: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } });
    if (search) and.push({ OR: [
      { fileName: { contains: search, mode: 'insensitive' } }, { subject: { contains: search, mode: 'insensitive' } },
      { invoiceNumber: { contains: search, mode: 'insensitive' } }, { seller: { contains: search, mode: 'insensitive' } },
      { buyer: { contains: search, mode: 'insensitive' } }, { invoiceCategory: { contains: search, mode: 'insensitive' } },
    ] });
    return this.prisma.invoice.findMany({ where: { userId, ...(and.length ? { AND: and } : {}) }, orderBy: { receivedAt: 'desc' }, take: limit });
  }

  async getInvoiceFile(userId: string, id: number) {
    const invoice = await this.prisma.invoice.findFirst({ where: { id, userId } });
    if (!invoice) throw new NotFoundException('发票不存在');
    const root = resolve(process.cwd(), 'uploads', 'invoices');
    const filePath = resolve(process.cwd(), invoice.storagePath);
    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
      throw new BadRequestException('发票文件路径无效');
    }
    if (!existsSync(filePath)) throw new NotFoundException('发票文件已不存在');
    return { invoice, filePath };
  }

  private async syncAllEnabled() {
    const mailboxes = await this.prisma.invoiceMailbox.findMany({ where: { enabled: true } });
    for (const mailbox of mailboxes) {
      if (this.activeSyncs.has(String(mailbox.id))) continue;
      // 新绑定或旧版本遗留的邮箱先做一次历史回扫，之后只做增量同步。
      void this.syncOne(mailbox, !mailbox.lastFullScanAt).catch((error) => this.logger.warn(`后台同步失败 mailbox=${mailbox.id}: ${error.message}`));
    }
  }

  private async reprocessLegacyInvoices() {
    const invoices = await this.prisma.invoice.findMany({
      where: { contentText: null, fileName: { endsWith: '.pdf', mode: 'insensitive' } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    for (const invoice of invoices) {
      try {
        const filePath = resolve(process.cwd(), invoice.storagePath);
        if (!existsSync(filePath)) continue;
        const content = await import('fs/promises').then(({ readFile }) => readFile(filePath));
        const text = await this.extractAttachmentText(content, invoice.fileName);
        if (!text) continue;
        const sourceText = `${invoice.subject || ''}\n${invoice.fileName}\n${text}`;
        const buyer = this.extractField(sourceText, ['购买方信息名称', '购买方名称', '购方信息名称', '购方名称', '购买方', '购方', 'Buyer']);
        const seller = this.extractField(sourceText, ['销售方名称', '销方名称', '销售方', '销方', 'Seller']);
        await this.prisma.invoice.update({ where: { id: invoice.id }, data: {
          contentText: text.slice(0, 200_000), buyer: invoice.buyer || buyer,
          seller: invoice.seller || seller, invoiceCategory: invoice.invoiceCategory || buyer || invoice.buyer || '未识别抬头',
          invoiceNumber: invoice.invoiceNumber || this.extractInvoiceNumber(sourceText),
          amount: invoice.amount || this.extractAmount(sourceText),
          invoiceDate: invoice.invoiceDate || this.extractDate(sourceText),
        } });
      } catch (error: any) {
        this.logger.warn(`旧发票重新解析失败 invoice=${invoice.id}：${error?.message || '未知错误'}`);
      }
    }
  }

  private async syncOne(mailbox: any, fullScan = false): Promise<MailboxSyncResult> {
    if (mailbox.provider === 'outlook' && mailbox.oauthRefreshTokenEncrypted) {
      return this.syncOneOutlookGraph(mailbox, fullScan);
    }
    const key = String(mailbox.id);
    if (this.activeSyncs.has(key)) return { imported: 0, matched: 0, skipped: 0, scanned: 0, candidateMessages: 0, pdfAttachments: 0, linkCandidates: 0, linkedPdfAttachments: 0, fullScan, inProgress: true };
    this.activeSyncs.add(key);
    let imported = 0;
    let matched = 0;
    let skipped = 0;
    let scanned = 0;
    let candidateMessages = 0;
    let pdfAttachments = 0;
    let linkCandidates = 0;
    let linkedPdfAttachments = 0;
    let lastUid = mailbox.lastUid ? Number(mailbox.lastUid) : 0;
    try {
      await this.prisma.invoiceMailbox.update({ where: { id: mailbox.id }, data: { status: 'syncing', lastError: null } });
      const client = new ImapFlow({
        host: mailbox.imapHost,
        port: mailbox.imapPort,
        secure: mailbox.secure,
        auth: await this.getStoredAuth(mailbox),
        logger: false,
        socketTimeout: 20_000,
        greetingTimeout: 15_000,
      });
      await client.connect();
      try {
        const listedFolders = fullScan ? await client.list() : [{ path: 'INBOX' }];
        const folders = (listedFolders as any[]).filter((folder) => {
          if (!fullScan) return folder.path === 'INBOX';
          const path = String(folder.path || '').toLowerCase();
          const specialUse = String(folder.specialUse || '').toLowerCase();
          return !['\\junk', '\\trash', '\\deleted', '\\spam'].some((value) => specialUse.includes(value))
            && !/(垃圾|已删除|删除邮件|回收站|垃圾邮件|spam|trash|deleted|junk)/i.test(path);
        });
        for (const folder of folders) {
          const lock = await client.getMailboxLock(folder.path);
          try {
            const query: any = fullScan
              ? { or: [{ subject: '发票' }, { body: '发票' }] }
              : (lastUid > 0
                ? { uid: `${lastUid + 1}:*` }
                : { since: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) });
            const foundUids = await client.search(query, { uid: true });
            const uids = fullScan ? (foundUids || []) : (foundUids || []).slice(-100);
            for (const uid of uids) {
              const message = await client.fetchOne(uid, { source: true, envelope: true, internalDate: true }, { uid: true });
              if (!message || !message.source) continue;
              scanned += 1;
              lastUid = Math.max(lastUid, uid);
              if (message.source.length > 20 * 1024 * 1024) {
                skipped += 1;
                continue;
              }
              const parsed = await simpleParser(message.source);
              if (fullScan || this.isInvoiceMail(parsed)) candidateMessages += 1;
              const attachments = parsed.attachments.filter((attachment) => this.isInvoiceAttachment(attachment, parsed));
              for (const attachment of attachments) {
                for (const invoiceAttachment of await this.expandInvoiceAttachments(attachment)) {
                  if (this.isPdfAttachment(invoiceAttachment)) pdfAttachments += 1;
                  const result = await this.importAttachmentSafely(mailbox, parsed, invoiceAttachment, new Date(message.internalDate || Date.now()));
                  if (result === 'imported') imported += 1;
                  else if (result === 'matched') { imported += 1; matched += 1; }
                  else skipped += 1;
                }
              }
              const linked = await this.fetchLinkedInvoiceAttachments(parsed);
              linkCandidates += linked.candidates;
              for (const invoiceAttachment of linked.attachments) {
                linkedPdfAttachments += 1;
                const result = await this.importAttachmentSafely(mailbox, parsed, invoiceAttachment, new Date(message.internalDate || Date.now()));
                if (result === 'imported') imported += 1;
                else if (result === 'matched') { imported += 1; matched += 1; }
                else skipped += 1;
              }
            }
          } finally {
            lock.release();
          }
        }
      } finally {
        await client.logout().catch(() => undefined);
      }
      await this.prisma.invoiceMailbox.update({
        where: { id: mailbox.id },
        data: { status: 'ready', lastSyncedAt: new Date(), lastUid: String(lastUid), ...(fullScan ? { lastFullScanAt: new Date() } : {}), lastError: null },
      });
      return { imported, matched, skipped, scanned, candidateMessages, pdfAttachments, linkCandidates, linkedPdfAttachments, fullScan };
    } catch (error: any) {
      await this.prisma.invoiceMailbox.update({
        where: { id: mailbox.id },
        data: { status: 'error', lastError: String(error?.message || '邮箱同步失败').slice(0, 500), lastUid: String(lastUid) },
      });
      throw error;
    } finally {
      this.activeSyncs.delete(key);
    }
  }

  /** 使用 Microsoft Graph 读取个人 Outlook 邮箱，避免个人租户无法添加 Exchange Online IMAP 权限。 */
  private async syncOneOutlookGraph(mailbox: any, fullScan = false): Promise<MailboxSyncResult> {
    const key = String(mailbox.id);
    if (this.activeSyncs.has(key)) return { imported: 0, matched: 0, skipped: 0, scanned: 0, candidateMessages: 0, pdfAttachments: 0, linkCandidates: 0, linkedPdfAttachments: 0, fullScan, inProgress: true };
    this.activeSyncs.add(key);
    let imported = 0;
    let matched = 0;
    let skipped = 0;
    let scanned = 0;
    let candidateMessages = 0;
    let pdfAttachments = 0;
    let linkCandidates = 0;
    let linkedPdfAttachments = 0;
    try {
      await this.prisma.invoiceMailbox.update({ where: { id: mailbox.id }, data: { status: 'syncing', lastError: null } });
      const auth = await this.getStoredAuth(mailbox);
      const since = mailbox.lastSyncedAt
        ? new Date(new Date(mailbox.lastSyncedAt).getTime() - 24 * 60 * 60 * 1000)
        : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      let nextUrl = this.graphMessagesUrl(since, fullScan);
      let newestReceivedAt = mailbox.lastSyncedAt ? new Date(mailbox.lastSyncedAt) : new Date(0);
      let pages = 0;
      while (nextUrl && (fullScan || pages < 10)) {
        pages += 1;
        let reachedSince = false;
        const page = await this.graphRequest(
          nextUrl,
          auth.accessToken,
          fullScan ? { ConsistencyLevel: 'eventual' } : undefined,
        ) as { value?: any[]; ['@odata.nextLink']?: string };
        for (const message of page.value || []) {
          scanned += 1;
          const receivedAt = new Date(message.receivedDateTime || Date.now());
          if (!fullScan && receivedAt < since) {
            reachedSince = true;
            break;
          }
          if (receivedAt > newestReceivedAt) newestReceivedAt = receivedAt;
          if (!message.id) continue;
          const parsed = {
            subject: String(message.subject || ''),
            text: String(message.bodyPreview || ''),
            messageId: message.internetMessageId || null,
            from: { text: message.from?.emailAddress?.address || '' },
          } as ParsedMail;
          // 全量 URL 已由 Graph 搜索“发票”；增量扫描则在本地确认关键词。
          const invoiceMail = fullScan || this.isInvoiceMail(parsed);
          if (invoiceMail) candidateMessages += 1;
          if (invoiceMail) {
            const detail = await this.graphRequest(
              `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(message.id)}?$select=body`,
              auth.accessToken,
            ) as { body?: { contentType?: string; content?: string } };
            if (detail.body?.contentType?.toLowerCase() === 'html') parsed.html = detail.body.content || '';
            else if (detail.body?.content) parsed.text = detail.body.content;
          }
          if (message.hasAttachments) {
          // 附件集合返回的是抽象 attachment 类型，不能在集合查询中直接 $select=contentBytes。
          // 先读取元数据并筛选 PDF/压缩包，再通过 /$value 下载原始文件；这样既避免
          // attachment 抽象类型的 contentBytes 查询错误，也兼容较大的 PDF 附件。
          const attachmentUrl = `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(message.id)}/attachments?$select=id,name,contentType,size,isInline`;
          const attachments = await this.graphRequest(attachmentUrl, auth.accessToken) as { value?: any[] };
          for (const attachmentMeta of attachments.value || []) {
            if (!attachmentMeta.id || attachmentMeta.isInline) continue;
            // itemAttachment/referenceAttachment 没有文件内容，不参与发票解析。
            if (attachmentMeta['@odata.type'] && attachmentMeta['@odata.type'] !== '#microsoft.graph.fileAttachment') continue;
            const candidateMeta = {
              filename: attachmentMeta.name,
              contentType: attachmentMeta.contentType,
              content: Buffer.alloc(0),
            } as Attachment;
            if (!this.isInvoiceAttachment(candidateMeta, parsed, invoiceMail)) continue;
            if (Number(attachmentMeta.size || 0) > 20 * 1024 * 1024) {
              skipped += 1;
              continue;
            }
            const content = await this.graphRequestBuffer(
              `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(attachmentMeta.id)}/$value`,
              auth.accessToken,
            );
            const candidate = { ...candidateMeta, content } as Attachment;
            for (const invoiceAttachment of await this.expandInvoiceAttachments(candidate)) {
              if (this.isPdfAttachment(invoiceAttachment)) pdfAttachments += 1;
              const result = await this.importAttachmentSafely(mailbox, parsed, invoiceAttachment, receivedAt);
              if (result === 'imported') imported += 1;
              else if (result === 'matched') { imported += 1; matched += 1; }
              else skipped += 1;
            }
          }
          }
          const linked = await this.fetchLinkedInvoiceAttachments(parsed);
          linkCandidates += linked.candidates;
          for (const invoiceAttachment of linked.attachments) {
            linkedPdfAttachments += 1;
            const result = await this.importAttachmentSafely(mailbox, parsed, invoiceAttachment, receivedAt);
            if (result === 'imported') imported += 1;
            else if (result === 'matched') { imported += 1; matched += 1; }
            else skipped += 1;
          }
        }
        nextUrl = reachedSince ? '' : (page['@odata.nextLink'] || '');
      }
      await this.prisma.invoiceMailbox.update({
        where: { id: mailbox.id },
        data: { status: 'ready', lastSyncedAt: newestReceivedAt.getTime() ? newestReceivedAt : new Date(), ...(fullScan ? { lastFullScanAt: new Date() } : {}), lastError: null },
      });
      return { imported, matched, skipped, scanned, candidateMessages, pdfAttachments, linkCandidates, linkedPdfAttachments, fullScan };
    } catch (error: any) {
      await this.prisma.invoiceMailbox.update({ where: { id: mailbox.id }, data: { status: 'error', lastError: String(error?.message || '邮箱同步失败').slice(0, 500) } });
      throw error;
    } finally {
      this.activeSyncs.delete(key);
    }
  }

  private graphMessagesUrl(_since: Date, fullScan: boolean) {
    const params = new URLSearchParams({
      '$top': fullScan ? '100' : '50',
      '$select': 'id,subject,from,receivedDateTime,bodyPreview,hasAttachments,internetMessageId',
    });
    if (fullScan) {
      // /me/messages 覆盖全部邮件文件夹；Graph 搜索同时检查主题、正文与附件名。
      params.set('$search', '"发票"');
      return `https://graph.microsoft.com/v1.0/me/messages?${params.toString()}`;
    }
    params.set('$orderby', 'receivedDateTime desc');
    return `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?${params.toString()}`;
  }

  private async graphRequest(url: string, accessToken: string, headers?: Record<string, string>) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...headers } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Microsoft Graph 请求失败：${body?.error?.message || response.statusText}`);
    return body;
  }

  private async graphRequestBuffer(url: string, accessToken: string) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/octet-stream' } });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Microsoft Graph 附件下载失败：${body.slice(0, 200) || response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /** 从发票邮件正文中提取“下载电子发票”链接，兼容淘宝/阿里发票平台不直接附 PDF 的邮件。 */
  private async fetchLinkedInvoiceAttachments(mail: ParsedMail) {
    const source = `${typeof mail.html === 'string' ? mail.html : ''}\n${mail.text || ''}`
      .replace(/&amp;/gi, '&')
      .replace(/&#x2F;|&#47;/gi, '/');
    const links = new Set<string>();
    const urlPattern = /https?:\/\/[^\s"'<>]+/gi;
    let match: RegExpExecArray | null;
    while ((match = urlPattern.exec(source))) {
      const raw = match[0].replace(/[),.;\]}]+$/g, '');
      try {
        const url = new URL(raw);
        const context = source.slice(Math.max(0, match.index - 160), Math.min(source.length, match.index + raw.length + 160));
        const hostAllowed = /(taobao\.com|tmall\.com|alibaba\.com|alipay\.com|aliyun\.com|jd\.com|pinduoduo\.com|meituan\.com|ele\.me|fapiao|invoice)/i.test(url.hostname);
        const looksLikeInvoice = /(?:发票|电子票|数电票|invoice|开票|下载)/i.test(`${url.href} ${context}`);
        if (hostAllowed || /\.pdf(?:[?#]|$)/i.test(url.pathname) || looksLikeInvoice) links.add(url.href);
      } catch {
        // 邮件中的追踪链接可能被截断，忽略无效 URL，其他链接继续处理。
      }
    }

    const attachments: Attachment[] = [];
    for (const link of Array.from(links).slice(0, 10)) {
      try {
        const response = await fetch(link, {
          signal: AbortSignal.timeout(20_000),
          redirect: 'follow',
          headers: { Accept: 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.1', 'User-Agent': 'zhizhang-InvoiceSync/1.0' },
        });
        if (!response.ok) continue;
        const declaredLength = Number(response.headers.get('content-length') || 0);
        if (declaredLength > 20 * 1024 * 1024) continue;
        const content = Buffer.from(await response.arrayBuffer());
        if (content.length > 20 * 1024 * 1024) continue;
        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        if (!/application\/pdf/i.test(contentType) && content.subarray(0, 5).toString() !== '%PDF-') continue;
        const disposition = response.headers.get('content-disposition') || '';
        const fileNameMatch = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
        let fileName = fileNameMatch?.[1] ? decodeURIComponent(fileNameMatch[1]) : '';
        if (!fileName) fileName = decodeURIComponent(new URL(link).pathname.split('/').pop() || 'invoice.pdf');
        if (!/\.pdf$/i.test(fileName)) fileName += '.pdf';
        attachments.push({ filename: this.safeFileName(fileName), contentType: 'application/pdf', content } as Attachment);
      } catch (error: any) {
        this.logger.debug(`发票链接下载失败：${error?.message || '未知错误'}`);
      }
    }
    return { candidates: links.size, attachments };
  }

  private async testOutlookGraph(accessToken: string) {
    await this.graphRequest('https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=id,displayName', accessToken);
  }

  /** 单封异常附件不能中断整次邮箱同步，失败项留待下一次修复后重新导入。 */
  private async importAttachmentSafely(mailbox: any, mail: ParsedMail, attachment: Attachment, receivedAt: Date) {
    try {
      return await this.importAttachment(mailbox, mail, attachment, receivedAt);
    } catch (error: any) {
      this.logger.warn(`发票附件导入失败 file=${this.safeFileName(attachment.filename || 'unknown')}：${error?.message || '未知错误'}`);
      return 'skipped' as const;
    }
  }

  private async importAttachment(mailbox: any, mail: ParsedMail, attachment: Attachment, receivedAt: Date) {
    const hash = createHash('sha256').update(attachment.content).digest('hex');
    const exists = await this.prisma.invoice.findFirst({ where: { userId: mailbox.userId, attachmentHash: hash }, select: { status: true } });
    if (exists) return 'skipped';

    const fileName = this.safeFileName(attachment.filename || `invoice-${hash.slice(0, 10)}`);
    const relativePath = join('uploads', 'invoices', String(mailbox.userId), `${hash}-${fileName}`);
    const absolutePath = resolve(process.cwd(), relativePath);
    await mkdir(join(process.cwd(), 'uploads', 'invoices', String(mailbox.userId)), { recursive: true });
    await writeFile(absolutePath, attachment.content, { flag: 'wx' }).catch((error: any) => {
      if (error.code !== 'EEXIST') throw error;
    });

    const attachmentText = await this.extractAttachmentText(attachment.content, fileName);
    const sourceText = `${mail.subject || ''}\n${this.toPlainText(mail.text || '')}\n${fileName}\n${attachmentText}`;
    const amount = this.extractAmount(sourceText);
    const invoiceDate = this.extractDate(sourceText) || receivedAt;
    const invoiceNumber = this.extractInvoiceNumber(sourceText);
    const seller = this.extractField(sourceText, ['销售方名称', '销方名称', '销售方', '销方', 'Seller']);
    const buyer = this.extractField(sourceText, ['购买方信息名称', '购买方名称', '购方信息名称', '购方名称', '购买方', '购方', 'Buyer']);
    const bill = await this.matchBill(mailbox.userId, amount, invoiceDate, seller);
    await this.prisma.invoice.create({
      data: {
        userId: mailbox.userId,
        mailboxId: mailbox.id,
        billId: bill?.id,
        messageId: mail.messageId || null,
        attachmentHash: hash,
        fileName,
        storagePath: relativePath,
        mimeType: attachment.contentType || 'application/octet-stream',
        subject: mail.subject?.slice(0, 500),
        sender: mail.from?.text?.slice(0, 300),
        seller,
        buyer,
        invoiceCategory: buyer || '未识别抬头',
        invoiceNumber,
        amount: amount === null ? null : new Decimal(amount),
        invoiceDate,
        receivedAt,
        status: bill ? 'matched' : 'unmatched',
        contentText: attachmentText ? attachmentText.slice(0, 200_000) : null,
      },
    });
    return bill ? 'matched' : 'imported';
  }

  private async matchBill(userId: string, amount: number | null, date: Date, seller: string | null) {
    if (amount === null) return null;
    const candidates = await this.prisma.bill.findMany({
      where: {
        userId,
        type: 'expense',
        amount: { gte: new Decimal(amount - 0.01), lte: new Decimal(amount + 0.01) },
        date: { gte: new Date(date.getTime() - 7 * 86400000), lte: new Date(date.getTime() + 7 * 86400000) },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    if (candidates.length === 1) return candidates[0];
    if (seller) {
      const normalizedSeller = seller.toLowerCase();
      const matching = candidates.filter((candidate) => `${candidate.counterparty || ''} ${candidate.description || ''}`.toLowerCase().includes(normalizedSeller));
      if (matching.length === 1) return matching[0];
    }
    return null;
  }

  private normalizeConfig(dto: SaveInvoiceMailboxDto): MailboxConfig {
    const preset = PROVIDER_PRESETS[dto.provider];
    const imapHost = (dto.imapHost || preset?.host || '').trim().toLowerCase();
    const imapPort = dto.imapPort || preset?.port || 993;
    if (!imapHost || (!preset && dto.provider !== 'custom')) throw new BadRequestException('请填写 IMAP 服务器地址');
    if (!dto.credential.trim()) throw new BadRequestException('邮箱授权码不能为空');
    return {
      email: dto.email.trim().toLowerCase(),
      provider: dto.provider,
      imapHost,
      imapPort,
      secure: dto.secure ?? preset?.secure ?? true,
      username: (dto.username || dto.email).trim().toLowerCase(),
      credential: dto.credential,
    };
  }

  private fromStored(mailbox: any): MailboxConfig {
    return {
      email: mailbox.email,
      provider: mailbox.provider,
      imapHost: mailbox.imapHost,
      imapPort: mailbox.imapPort,
      secure: mailbox.secure,
      username: mailbox.username,
      credential: this.decrypt(mailbox.credentialEncrypted),
    };
  }

  private async getStoredAuth(mailbox: any) {
    if (mailbox.provider === 'outlook' && mailbox.oauthRefreshTokenEncrypted) {
      return { user: mailbox.username, accessToken: await this.refreshOutlookToken(mailbox) };
    }
    return { user: mailbox.username, pass: this.decrypt(mailbox.credentialEncrypted) };
  }

  private async refreshOutlookToken(mailbox: any) {
    const clientId = process.env.OUTLOOK_OAUTH_CLIENT_ID?.trim();
    const clientSecret = process.env.OUTLOOK_OAUTH_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) throw new Error('服务端尚未配置 Outlook OAuth2 凭据');
    const refreshToken = this.decrypt(mailbox.oauthRefreshTokenEncrypted);
    const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token', scope: 'openid profile email offline_access https://graph.microsoft.com/Mail.Read' }).toString(),
    });
    const token = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
    if (!response.ok || !token.access_token) throw new Error(`Outlook OAuth2 令牌刷新失败：${token.error_description || '请重新登录邮箱'}`);
    await this.prisma.invoiceMailbox.update({ where: { id: mailbox.id }, data: { ...(token.refresh_token ? { oauthRefreshTokenEncrypted: this.encrypt(token.refresh_token) } : {}), oauthExpiresAt: new Date(Date.now() + Number(token.expires_in || 3600) * 1000) } });
    return token.access_token;
  }

  private async testConnection(config: MailboxConfig) {
    const client = new ImapFlow({
      host: config.imapHost,
      port: config.imapPort,
      secure: config.secure,
      auth: config.accessToken ? { user: config.username, accessToken: config.accessToken } : { user: config.username, pass: config.credential },
      logger: false,
      socketTimeout: 15_000,
      greetingTimeout: 15_000,
    });
    try {
      await client.connect();
    } catch (error: any) {
      const hint = config.accessToken
        ? '请确认 Outlook OAuth2 权限包含 Microsoft Graph Mail.Read，并重新登录邮箱'
        : '请确认已开启 IMAP 并使用授权码';
      throw new BadRequestException(`邮箱连接失败，${hint}：${error?.message || '认证失败'}`);
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  private toResponse(mailbox: any) {
    return {
      id: mailbox.id,
      email: mailbox.email,
      provider: mailbox.provider,
      enabled: mailbox.enabled,
      status: mailbox.status,
      lastSyncedAt: mailbox.lastSyncedAt,
      lastFullScanAt: mailbox.lastFullScanAt,
      lastError: mailbox.lastError,
      invoiceCount: mailbox._count?.invoices ?? 0,
      oauthConnected: mailbox.provider === 'outlook' && !!mailbox.oauthRefreshTokenEncrypted,
    };
  }

  private outlookRedirectUri() {
    return process.env.OUTLOOK_OAUTH_REDIRECT_URI?.trim() || 'https://note.kagurayami.top/invoice-mailbox/oauth/outlook/callback';
  }

  private createOAuthState(userId: string, email?: string) {
    const payload = Buffer.from(JSON.stringify({ userId, email, exp: Date.now() + 10 * 60 * 1000, nonce: randomBytes(16).toString('base64url') })).toString('base64url');
    const signature = createHmac('sha256', this.encryptionKey()).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }

  private consumeOAuthState(state: string) {
    const [payloadText, signatureText] = String(state || '').split('.');
    if (!payloadText || !signatureText) throw new BadRequestException('Outlook 登录状态无效，请重新点击登录');
    const expected = createHmac('sha256', this.encryptionKey()).update(payloadText).digest();
    const received = Buffer.from(signatureText, 'base64url');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new BadRequestException('Outlook 登录状态无效，请重新点击登录');
    const payload = JSON.parse(Buffer.from(payloadText, 'base64url').toString('utf8')) as { userId?: string; email?: string; exp?: number; nonce?: string };
    if (!payload.userId || !payload.exp || payload.exp < Date.now() || !payload.nonce || this.usedOAuthStates.has(payload.nonce)) throw new BadRequestException('Outlook 登录已超时，请重新点击登录');
    this.usedOAuthStates.add(payload.nonce);
    setTimeout(() => this.usedOAuthStates.delete(payload.nonce!), 10 * 60 * 1000).unref();
    return { userId: payload.userId, email: payload.email };
  }

  private decodeJwtPayload(token?: string) {
    if (!token) return null;
    try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')); } catch { return null; }
  }

  private encrypt(value: string) {
    const key = this.encryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
  }

  private decrypt(value: string) {
    const [version, ivText, tagText, dataText] = value.split('.');
    if (version !== 'v1' || !ivText || !tagText || !dataText) throw new Error('邮箱授权信息格式无效');
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8');
  }

  private encryptionKey() {
    const secret = process.env.EMAIL_CREDENTIALS_KEY;
    if (!secret || secret.length < 32) throw new Error('服务端未配置 EMAIL_CREDENTIALS_KEY');
    return createHash('sha256').update(secret).digest();
  }

  private isInvoiceMail(mail: ParsedMail) {
    const text = `${mail.subject || ''} ${this.toPlainText(mail.text || '')} ${typeof mail.html === 'string' ? this.toPlainText(mail.html) : ''}`;
    return /(发票|电子票|数电票|增值税|invoice|开票|税务)/i.test(text);
  }

  private isPdfAttachment(attachment: Attachment) {
    const fileName = attachment.filename || '';
    const contentType = attachment.contentType || '';
    return /\.pdf$/i.test(fileName) || /application\/pdf/i.test(contentType);
  }

  private isInvoiceAttachment(attachment: Attachment, mail: ParsedMail, assumeInvoiceMail = false) {
    const fileName = (attachment.filename || '').toLowerCase();
    const text = `${mail.subject || ''} ${mail.text || ''} ${fileName}`.toLowerCase();
    const contentType = attachment.contentType || '';
    const supported = /\.(pdf|ofd|xml|zip|jpg|jpeg|png|webp)$/i.test(fileName)
      || /application\/(pdf|zip|xml|ofd)|text\/xml|image\/(jpeg|png|webp)/i.test(contentType);
    return supported && (assumeInvoiceMail || /(发票|电子票|数电票|增值税|invoice|开票|税务)/i.test(text));
  }

  private async expandInvoiceAttachments(attachment: Attachment): Promise<Attachment[]> {
    const fileName = (attachment.filename || '').toLowerCase();
    if (!fileName.endsWith('.zip')) return [attachment];
    try {
      const zip = new AdmZip(attachment.content);
      return zip.getEntries()
        .filter((entry) => !entry.isDirectory && /\.pdf$/i.test(entry.entryName) && entry.header.size <= 20 * 1024 * 1024)
        .map((entry) => ({
          filename: this.safeFileName(entry.entryName.split(/[\\/]/).pop() || 'invoice.pdf'),
          contentType: 'application/pdf',
          content: entry.getData(),
        } as Attachment));
    } catch (error: any) {
      this.logger.warn(`发票 ZIP 解析失败：${error?.message || '未知错误'}`);
      return [];
    }
  }

  private async extractAttachmentText(content: Buffer, fileName: string) {
    if (/\.pdf$/i.test(fileName)) {
      try {
        const parsed = await pdfParse(content);
        return parsed.text || '';
      } catch (error: any) {
        this.logger.warn(`发票 PDF 文本解析失败：${error?.message || '未知错误'}`);
        return '';
      }
    }
    if (/\.xml$/i.test(fileName)) return content.toString('utf8');
    if (/\.ofd$/i.test(fileName)) {
      try {
        const zip = new AdmZip(content);
        return zip.getEntries().filter((entry) => !entry.isDirectory && /\.xml$/i.test(entry.entryName))
          .map((entry) => entry.getData().toString('utf8')).join('\n');
      } catch (error: any) {
        this.logger.warn(`发票 OFD 文本解析失败：${error?.message || '未知错误'}`);
      }
    }
    return '';
  }

  private extractAmount(text: string): number | null {
    const match = text.match(/(?:价税合计|合计金额|发票金额|小写|total|amount)[^0-9]{0,60}(?:¥|￥|人民币|RMB)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i)
      || text.match(/(?:¥|￥|人民币|RMB)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i);
    const amount = match ? Number(match[1].replace(/,/g, '')) : NaN;
    // 发票金额列为 Decimal(15,4)，绝对值必须小于 10^11。长保单号、税号等
    // 可能紧跟在标题后面，不能让这类编号被当作金额并导致整次同步返回 500。
    return Number.isFinite(amount) && amount > 0 && amount < 100_000_000_000 ? amount : null;
  }

  private extractDate(text: string): Date | null {
    const match = text.match(/(20\d{2})[年\-/\.](\d{1,2})[月\-/\.](\d{1,2})/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private extractInvoiceNumber(text: string): string | null {
    const match = text.match(/(?:发票号码|发票号|invoice\s*(?:no|number)?)[：:\s#]*([0-9A-Z\-]{6,30})/i);
    return match?.[1]?.slice(0, 100) || null;
  }

  private extractField(text: string, labels: string[]) {
    const labelPattern = labels.join('|');
    const direct = new RegExp(`(?:${labelPattern})[：:\\s]*([^\\n,，;；]{2,120})`, 'i').exec(text)?.[1];
    const clean = (value?: string | null) => value?.replace(/[：:，,;；|]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 300) || null;
    if (direct?.trim()) return clean(direct);
    // 标准数电发票常把“购买方信息/销售方信息”和“名称”拆成两行。
    const section = new RegExp(`(?:${labelPattern})[\\s\\S]{0,100}?名称[：:\\s]*([^\\n,，;；]{2,100})`, 'i').exec(text)?.[1];
    return clean(section);
  }

  private safeFileName(fileName: string) {
    return fileName.replace(/[^\w\-.\u4e00-\u9fff]/g, '_').slice(0, 180) || 'invoice.bin';
  }

  private toPlainText(value: string) {
    return String(value || '')
      .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;/gi, ' ')
      .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/\s+/g, ' ').trim();
  }
}
