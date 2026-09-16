import { Decimal } from '@prisma/client/runtime/library';

export const LEDGER_RULE_VERSION = '2026-09-17.auto';
export const CLASSIFICATION_KINDS = ['ordinary', 'refund', 'internal_transfer', 'adjustment', 'ignored'] as const;
export type ClassificationKind = typeof CLASSIFICATION_KINDS[number];
export interface LedgerEntry {
  id: number;
  amount: Decimal;
  type: string;
  date: Date;
  updatedAt: Date;
  financialClassification: { kind: string; currency: string; billUpdatedAt: Date } | null;
  relatedBill: { userId: string; type: string; date: Date } | null;
}

/** Saved bills participate immediately; legacy explicit overrides remain optional. */
export function ledgerKind(entry: LedgerEntry, userId: string): ClassificationKind {
  const c = entry.financialClassification;
  if (c && c.currency === 'CNY' &&
      (CLASSIFICATION_KINDS as readonly string[]).includes(c.kind)) return c.kind as ClassificationKind;
  return entry.type === 'income' && entry.relatedBill?.userId === userId && entry.relatedBill.type === 'expense'
    ? 'refund' : 'ordinary';
}

/** Incremental decimal aggregation. No raw bill descriptions are exposed by this projection. */
export class LedgerAccumulator {
  private income = new Decimal(0);
  private expense = new Decimal(0);
  private refunds = new Decimal(0);
  private samePeriodRefunds = new Decimal(0);
  private otherPeriodRefunds = new Decimal(0);
  private unlinkedRefunds = new Decimal(0);
  private days = new Set<string>();
  private counts = { total: 0, included: 0, needsReview: 0, internalTransfer: 0, adjustment: 0, ignored: 0 };
  private pendingBillIds: number[] = [];

  constructor(private readonly userId: string, private readonly start: Date, private readonly end: Date) {}

  add(entry: LedgerEntry) {
    this.counts.total++;
    const kind = ledgerKind(entry, this.userId);
    const refundInvalid = kind === 'refund' && (entry.type !== 'income' ||
      (entry.relatedBill && (entry.relatedBill.userId !== this.userId || entry.relatedBill.type !== 'expense')));
    if ((entry.financialClassification && entry.financialClassification.currency !== 'CNY') ||
        !['income', 'expense'].includes(entry.type) || !entry.amount.isFinite() || !entry.amount.greaterThan(0) || refundInvalid) {
      this.counts.needsReview++;
      if (this.pendingBillIds.length < 50) this.pendingBillIds.push(entry.id);
      return;
    }
    if (kind === 'internal_transfer') { this.counts.internalTransfer++; return; }
    if (kind === 'adjustment') { this.counts.adjustment++; return; }
    if (kind === 'ignored') { this.counts.ignored++; return; }
    this.counts.included++;
    this.days.add(entry.date.toISOString().slice(0, 10));
    if (kind === 'refund') {
      this.refunds = this.refunds.plus(entry.amount);
      if (!entry.relatedBill) this.unlinkedRefunds = this.unlinkedRefunds.plus(entry.amount);
      else if (entry.relatedBill.date >= this.start && entry.relatedBill.date <= this.end) {
        this.samePeriodRefunds = this.samePeriodRefunds.plus(entry.amount);
      } else this.otherPeriodRefunds = this.otherPeriodRefunds.plus(entry.amount);
    } else if (entry.type === 'income') this.income = this.income.plus(entry.amount);
    else this.expense = this.expense.plus(entry.amount);
  }

  result() {
    return {
      ruleVersion: LEDGER_RULE_VERSION,
      currency: 'CNY',
      startDate: this.start.toISOString().slice(0, 10), endDate: this.end.toISOString().slice(0, 10),
      ordinaryIncome: this.income.toFixed(4), grossExpense: this.expense.toFixed(4),
      refundInflow: this.refunds.toFixed(4),
      cashSurplus: this.income.plus(this.refunds).minus(this.expense).toFixed(4),
      refundsFromSamePeriod: this.samePeriodRefunds.toFixed(4),
      refundsFromOtherPeriods: this.otherPeriodRefunds.toFixed(4),
      refundsWithoutSource: this.unlinkedRefunds.toFixed(4),
      counts: { ...this.counts }, effectiveDays: this.days.size,
      complete: this.counts.needsReview === 0,
      pendingBillIds: [...this.pendingBillIds],
      pendingIdsTruncated: this.counts.needsReview > this.pendingBillIds.length,
    };
  }
}
