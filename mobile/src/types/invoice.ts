export type InvoiceMailboxProvider = 'qq' | '163' | 'outlook' | 'gmail' | 'custom';

export interface InvoiceMailbox {
  id: number;
  email: string;
  provider: InvoiceMailboxProvider;
  enabled: boolean;
  status: 'ready' | 'syncing' | 'error' | string;
  lastSyncedAt?: string | null;
  lastFullScanAt?: string | null;
  lastError?: string | null;
  invoiceCount: number;
  oauthConnected?: boolean;
  syncProgress?: InvoiceSyncProgress | null;
}

export interface InvoiceSyncProgress {
  phase: 'starting' | 'scanning' | 'completed' | 'error' | string;
  scanned: number;
  total: number;
  imported: number;
  matched: number;
  candidateMessages: number;
  pdfAttachments: number;
  linkCandidates: number;
  linkedPdfAttachments: number;
  startedAt?: string;
  updatedAt?: string;
  error?: string;
}

export interface InvoiceDocument {
  id: number;
  fileName: string;
  mimeType?: string | null;
  subject?: string | null;
  sender?: string | null;
  seller?: string | null;
  buyer?: string | null;
  invoiceCategory?: string | null;
  invoiceNumber?: string | null;
  amount?: number | null;
  invoiceDate?: string | null;
  receivedAt: string;
  status: 'matched' | 'unmatched' | string;
  billId?: number | null;
  contentText?: string | null;
  storagePath?: string | null;
}
