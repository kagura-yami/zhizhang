import { httpService } from '../http';
import type { ApiResponse } from '../../types/api';
import type { InvoiceDocument, InvoiceMailbox, InvoiceMailboxProvider } from '../../types/invoice';
import RNFS from 'react-native-fs';
import env from '../../config/env';
import { getAuthSession } from '../security';

export interface SaveInvoiceMailboxData {
  email: string;
  provider: InvoiceMailboxProvider;
  credential: string;
  username?: string;
  imapHost?: string;
  imapPort?: number;
  secure?: boolean;
}

class InvoiceMailboxService {
  async startOutlookOAuth(email?: string): Promise<ApiResponse<{ authUrl: string }>> {
    const query = email ? `?email=${encodeURIComponent(email)}` : '';
    return httpService.get(`/invoice-mailbox/oauth/outlook/start${query}`);
  }

  async getMailbox(): Promise<ApiResponse<InvoiceMailbox | null>> {
    return httpService.get('/invoice-mailbox');
  }

  async saveMailbox(data: SaveInvoiceMailboxData): Promise<ApiResponse<InvoiceMailbox>> {
    return httpService.put('/invoice-mailbox', data);
  }

  async testConnection(): Promise<ApiResponse<{ success: boolean; message: string }>> {
    return httpService.post('/invoice-mailbox/test');
  }

  async sync(): Promise<ApiResponse<{
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
    mailbox: InvoiceMailbox;
  }>> {
    return httpService.post('/invoice-mailbox/sync');
  }

  async removeMailbox(): Promise<ApiResponse<{ removed: boolean }>> {
    return httpService.delete('/invoice-mailbox');
  }

  async listInvoices(params: Record<string, string | number | undefined> = {}): Promise<ApiResponse<{ items: InvoiceDocument[]; total: number; page: number; limit: number; buyers: string[]; sellers: string[]; totalAmount: number }>> {
    return httpService.get('/invoice-mailbox/invoices', { params });
  }

  async getInvoice(id: number): Promise<ApiResponse<InvoiceDocument>> {
    return httpService.get(`/invoice-mailbox/invoices/${id}`);
  }

  async downloadFile(id: number) {
    const session = await getAuthSession();
    const target = `${RNFS.CachesDirectoryPath}/zhizhang-invoice-${id}`;
    const result = await RNFS.downloadFile({
      fromUrl: `${env.getApiBaseUrl().replace(/\/$/, '')}/invoice-mailbox/invoices/${id}/file`,
      toFile: target,
      headers: session?.token ? { Authorization: `Bearer ${session.token}` } : undefined,
    }).promise;
    if (result.statusCode !== 200) throw new Error(`附件下载失败（${result.statusCode}）`);
    return target;
  }

  async downloadArchive(params: Record<string, string | number | undefined> = {}) {
    const session = await getAuthSession();
    const query = Object.entries(params).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&');
    const target = `${RNFS.DownloadDirectoryPath}/知帐-发票-${new Date().toISOString().slice(0, 10)}.zip`;
    const result = await RNFS.downloadFile({
      fromUrl: `${env.getApiBaseUrl().replace(/\/$/, '')}/invoice-mailbox/invoices/export${query ? `?${query}` : ''}`,
      toFile: target,
      headers: session?.token ? { Authorization: `Bearer ${session.token}` } : undefined,
    }).promise;
    if (result.statusCode !== 200) throw new Error(`下载失败（${result.statusCode}）`);
    await RNFS.scanFile(target).catch(() => undefined);
    return target;
  }
}

export const invoiceMailboxService = new InvoiceMailboxService();
