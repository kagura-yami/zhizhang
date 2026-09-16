import { Decimal } from '@prisma/client/runtime/library';
import { LedgerAccumulator, LedgerEntry } from './ledger-semantics';
import { businessDate, businessPeriod, closedReviewPeriod } from './ledger-period';
import { ClassifyBillDto } from './ledger.dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

describe('复盘与排行榜统一账务口径', () => {
  const start = new Date('2026-09-01Z');
  const end = new Date('2026-09-30Z');
  const updatedAt = new Date('2026-09-16T02:00:00Z');
  const entry = (id: number, amount: string, type = 'expense', kind = 'ordinary'): LedgerEntry => ({
    id, amount: new Decimal(amount), type, date: start, updatedAt, relatedBill: null,
    financialClassification: { kind, currency: 'CNY', billUpdatedAt: updatedAt },
  });
  const summarize = (...rows: LedgerEntry[]) => {
    const a = new LedgerAccumulator('owner', start, end);
    rows.forEach(row => a.add(row));
    return a.result();
  };

  it('收入减消费加退款，仅计一次，排除已确认内部转账', () => {
    const result = summarize(entry(1, '1000', 'income'), entry(2, '200'), entry(3, '50', 'income', 'refund'), entry(4, '300', 'expense', 'internal_transfer'));
    expect(result).toMatchObject({ ordinaryIncome: '1000.0000', grossExpense: '200.0000', refundInflow: '50.0000', cashSurplus: '850.0000', complete: true, effectiveDays: 1 });
    expect(result.counts).toMatchObject({ total: 4, included: 3, internalTransfer: 1 });
  });
  it('跨期退款与同期退款单列，不篡改毛支出', () => {
    const same = entry(2, '30', 'income', 'refund');
    same.relatedBill = { userId: 'owner', type: 'expense', date: start };
    const previous = entry(3, '50', 'income', 'refund');
    previous.relatedBill = { userId: 'owner', type: 'expense', date: new Date('2026-08-01Z') };
    expect(summarize(entry(1, '200'), same, previous)).toMatchObject({ grossExpense: '200.0000', refundsFromSamePeriod: '30.0000', refundsFromOtherPeriods: '50.0000', cashSurplus: '-120.0000' });
  });
  it('金额保持四位小数，避免浮点结余误差', () => {
    expect(summarize(entry(1, '0.3', 'income'), entry(2, '0.1'), entry(3, '0.2')).cashSurplus).toBe('0.0000');
    expect(summarize(entry(1, '0.0001')).cashSurplus).toBe('-0.0001');
  });
  it('旧账单无需额外确认即可参与统计', () => {
    const row = entry(1, '123'); row.financialClassification = null;
    expect(summarize(row)).toMatchObject({ cashSurplus: '-123.0000', complete: true, pendingBillIds: [], counts: { needsReview: 0 } });
  });
  it('修改账单后继续自动统计', () => {
    const row = entry(1, '123'); row.updatedAt = new Date(updatedAt.getTime() + 1);
    expect(summarize(row).counts.needsReview).toBe(0);
  });
  it.each(['USD', 'USDC', 'MON'])('不把 %s 与人民币加总', currency => {
    const row = entry(1, '123'); row.financialClassification.currency = currency;
    expect(summarize(row)).toMatchObject({ cashSurplus: '0.0000', complete: false });
  });
  it('不把支出或关联他人账单当作有效退款', () => {
    const wrongType = entry(1, '5', 'expense', 'refund');
    const otherUser = entry(2, '5', 'income', 'refund');
    otherUser.relatedBill = { userId: 'other', type: 'expense', date: start };
    expect(summarize(wrongType, otherUser).counts.needsReview).toBe(2);
  });
  it('调账和误记排除，实际给他人的支出正常计入', () => {
    expect(summarize(entry(1, '200', 'expense', 'adjustment'), entry(2, '5', 'income', 'ignored'), entry(3, '118'))).toMatchObject({ grossExpense: '118.0000', cashSurplus: '-118.0000', counts: { adjustment: 1, ignored: 1, included: 1 } });
  });
  it.each(['NaN', 'Infinity', '-1', '0'])('历史坏金额 %s 不污染全部统计', value => {
    expect(summarize(entry(1, value))).toMatchObject({ complete: false, cashSurplus: '0.0000' });
  });
  it('空周期与零结余的有效记录能够区分', () => {
    expect(summarize()).toMatchObject({ counts: { included: 0 }, effectiveDays: 0 });
    expect(summarize(entry(1, '5', 'income'), entry(2, '5'))).toMatchObject({ counts: { included: 2 }, cashSurplus: '0.0000', effectiveDays: 1 });
  });
  it('跨页旧账单无需确认，完整自动计入', () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({ ...entry(i + 1, '1'), financialClassification: null }));
    const r = summarize(...rows);
    expect(r.counts.needsReview).toBe(0); expect(r.cashSurplus).toBe('-501.0000'); expect(r.pendingBillIds).toHaveLength(0);
  });
});

describe('UTC+8 自然周期与输入约束', () => {
  it('严格校验业务日期，拒绝自动滚到下个月', () => {
    expect(() => businessDate('2026-02-30')).toThrow();
    expect(() => businessDate('2026-09-01T23:00:00Z')).toThrow();
    expect(businessDate('2024-02-29').toISOString()).toBe('2024-02-29T00:00:00.000Z');
  });
  it('拒绝倒序和跨多个年份，允许完整闰年', () => {
    expect(() => businessPeriod('2026-10-01', '2026-09-01')).toThrow();
    expect(() => businessPeriod('2024-01-01', '2026-01-01')).toThrow();
    expect(businessPeriod('2024-01-01', '2024-12-31').end.toISOString()).toContain('2024-12-31');
  });
  it('北京时间午夜才允许前一天复盘', () => {
    expect(() => closedReviewPeriod('day', '2026-09-16', new Date('2026-09-16T15:59:59Z'))).toThrow();
    expect(closedReviewPeriod('day', '2026-09-16', new Date('2026-09-16T16:00:00Z')).start.toISOString()).toContain('2026-09-16');
  });
  it('结束月边界包括闰日，不允许本月', () => {
    const now = new Date('2024-02-29T16:00:00Z');
    expect(closedReviewPeriod('month', '2024-02', now).end.toISOString()).toBe('2024-02-29T00:00:00.000Z');
    expect(() => closedReviewPeriod('month', '2024-03', now)).toThrow();
    expect(() => closedReviewPeriod('month', '2024-13', now)).toThrow();
  });
  it('确认必须给出类型、币种和带时区的账单版本', async () => {
    const good = { kind: 'refund', currency: 'CNY', expectedUpdatedAt: '2026-09-16T02:00:00.000Z' };
    expect(await validate(plainToInstance(ClassifyBillDto, good))).toHaveLength(0);
    for (const invalid of [{ ...good, currency: 'USDC' }, { ...good, kind: 'whatever' }, { ...good, expectedUpdatedAt: '2026-09-16' }]) {
      expect((await validate(plainToInstance(ClassifyBillDto, invalid))).length).toBeGreaterThan(0);
    }
  });
});
