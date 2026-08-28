import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, StreamableFile, Res } from '@nestjs/common';
import { createReadStream } from 'fs';
import type { Response } from 'express';
import { InvoiceMailboxService } from './invoice-mailbox.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { SaveInvoiceMailboxDto, InvoiceMailboxQueryDto } from './dto/invoice-mailbox.dto';

@Controller('invoice-mailbox')
export class InvoiceMailboxController {
  constructor(private readonly service: InvoiceMailboxService) {}

  @Get()
  async get(@CurrentUser('id') userId: string) {
    return { success: true, data: await this.service.getMailbox(userId) };
  }

  @Put()
  async save(@CurrentUser('id') userId: string, @Body() dto: SaveInvoiceMailboxDto) {
    return { success: true, message: '收票邮箱已绑定', data: await this.service.saveMailbox(userId, dto) };
  }

  @Get('oauth/outlook/start')
  async startOutlookOAuth(@CurrentUser('id') userId: string, @Query('email') email?: string) {
    return { success: true, data: await this.service.startOutlookOAuth(userId, email) };
  }

  @Public()
  @Get('oauth/outlook/callback')
  async outlookCallback(@Query('state') state: string, @Query('code') code: string, @Query('error') error: string, @Res() response: Response) {
    const deepLink = (params: string) => response.redirect(302, `zhizhang://invoice-mailbox/oauth/callback?${params}`);
    if (error) return deepLink(`status=error&message=${encodeURIComponent('Microsoft 登录未完成')}`);
    try {
      if (!state || !code) throw new Error('回调参数不完整');
      const result = await this.service.completeOutlookOAuth(state, code);
      return deepLink(`status=success&email=${encodeURIComponent(result.email)}`);
    } catch (oauthError: any) {
      return deepLink(`status=error&message=${encodeURIComponent(oauthError?.message || 'Outlook 登录失败')}`);
    }
  }

  @Post('test')
  async test(@CurrentUser('id') userId: string) {
    return { success: true, data: await this.service.testMailbox(userId) };
  }

  @Post('sync')
  async sync(@CurrentUser('id') userId: string) {
    return { success: true, message: '发票同步完成', data: await this.service.syncMailbox(userId) };
  }

  @Delete()
  async remove(@CurrentUser('id') userId: string) {
    return { success: true, message: '收票邮箱已解绑', data: await this.service.removeMailbox(userId) };
  }

  @Get('invoices')
  async invoices(@CurrentUser('id') userId: string, @Query() query: InvoiceMailboxQueryDto) {
    return { success: true, data: await this.service.listInvoices(userId, query) };
  }

  @Get('invoices/export')
  async exportInvoices(@CurrentUser('id') userId: string, @Query() query: InvoiceMailboxQueryDto, @Res({ passthrough: true }) response: Response): Promise<StreamableFile> {
    const { stream, fileName } = await this.service.createInvoiceArchive(userId, query);
    response.setHeader('Content-Type', 'application/zip');
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return new StreamableFile(stream);
  }

  @Get('invoices/:id')
  async invoice(@CurrentUser('id') userId: string, @Param('id', ParseIntPipe) id: number) {
    return { success: true, data: await this.service.getInvoice(userId, id) };
  }

  @Get('invoices/:id/file')
  async file(@CurrentUser('id') userId: string, @Param('id', ParseIntPipe) id: number): Promise<StreamableFile> {
    const { invoice, filePath } = await this.service.getInvoiceFile(userId, id);
    return new StreamableFile(createReadStream(filePath), {
      type: invoice.mimeType || 'application/octet-stream',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(invoice.fileName)}`,
    });
  }
}
