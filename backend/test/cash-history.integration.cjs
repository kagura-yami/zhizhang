const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const database = new URL(process.env.DATABASE_URL || 'http://missing');
if (database.hostname !== '127.0.0.1' || database.port !== '15451' || database.pathname !== '/zhizhang_cash_history_test') throw Error('Requires isolated cash history DB');
process.env.JWT_SECRET = 'synthetic-cash-history-secret';
const { NestFactory, APP_GUARD } = require('@nestjs/core');
const { Module, ValidationPipe } = require('@nestjs/common');
const { JwtService } = require('@nestjs/jwt');
const { LedgerModule } = require('../dist/ledger/ledger.module');
const { LedgerService } = require('../dist/ledger/ledger.service');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard');
class Root {}
Module({ imports: [LedgerModule], providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }] })(Root);
(async () => {
  const app = await NestFactory.create(Root, { logger: ['error'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(), db = app.get(PrismaService), service = app.get(LedgerService), users = [];
  try {
    for (let i = 0; i < 2; i++) users.push(await db.user.create({ data: { username: 'cash-' + randomUUID(), password: 'test-only' } }));
    const [owner, other] = users;
    const request = async user => {
      const token = user && new JwtService().sign({ sub: user.id }, { secret: process.env.JWT_SECRET });
      const res = await fetch(base + '/ledger/cash-history', { headers: token ? { Authorization: 'Bearer ' + token } : {} });
      return { status: res.status, body: await res.json() };
    };
    assert.equal((await request(null)).status, 401);
    const empty = (await request(owner)).body.data;
    assert.equal(empty.summary.cashSurplus, '0.0000'); assert.equal(empty.summary.complete, true);
    assert.equal(empty.monthly.length, 12); assert.equal(empty.categories.length, 0);
    assert(empty.monthly.every(m => m.cumulativeCashSurplus === '0.0000' && m.cumulativeComplete));
    const start = new Date(empty.window.startDate), end = new Date(empty.window.endDate);
    const old = new Date(start); old.setUTCFullYear(old.getUTCFullYear() - 3);
    const next = new Date(end.getTime() + 86400000);
    const cat = await db.category.create({ data: { userId: owner.id, name: '历史消费', type: 'expense' } });
    const make = async (amount, type, date, kind = 'ordinary', userId = owner.id, extra = {}) => {
      const bill = await db.bill.create({ data: { userId, amount, type, date, description: '不应返回的原文', notes: '不应返回的备注', ...extra } });
      if (kind) await db.billFinancialClassification.create({ data: { billId: bill.id, kind, currency: 'CNY', billUpdatedAt: bill.updatedAt, reviewedAt: new Date() } });
      return bill;
    };
    await make('1000.1234', 'income', old);
    const original = await make('200.1234', 'expense', old, 'ordinary', owner.id, { categoryId: cat.id });
    await make('100.0001', 'income', start);
    const expense = await make('50.0002', 'expense', end, 'ordinary', owner.id, { categoryId: cat.id });
    await make('20.0003', 'income', end, 'refund', owner.id, { relatedBillId: original.id });
    await make('300', 'expense', end, 'internal_transfer');
    await make('5', 'income', end, 'ignored');
    await make('100', 'income', end, 'adjustment');
    await make('777', 'income', next); // Excluded until its month is in scope.
    await make('99999', 'income', old, 'ordinary', other.id);
    const full = (await request(owner)).body.data;
    assert.equal(full.basis, 'reconstructed_cash_surplus'); assert.equal(full.classificationBasis, 'current');
    assert.equal(full.summary.cashSurplus, '870.0002'); assert.equal(full.summary.counts.total, 8);
    assert.equal(full.opening.cashSurplus, '800.0000'); assert.equal(full.window.cashSurplus, '70.0002');
    assert.equal(full.monthly[0].cumulativeCashSurplus, '900.0001');
    assert.equal(full.monthly[10].cashSurplus, '0.0000'); assert.equal(full.monthly[10].cumulativeCashSurplus, '900.0001');
    assert.equal(full.monthly[11].cashSurplus, '-29.9999'); assert.equal(full.monthly[11].cumulativeCashSurplus, full.summary.cashSurplus);
    assert.equal(full.window.refundsFromOtherPeriods, '20.0003');
    assert.equal(full.summary.refundsFromSamePeriod, '20.0003');
    assert.equal(full.categories.find(c => c.categoryId === cat.id).grossExpense, '50.0002');
    assert.equal((await request(other)).body.data.summary.cashSurplus, '99999.0000');
    assert(!JSON.stringify(full).includes('不应返回'));
    // Historical unknown entries must propagate into every cumulative point, not only recent months.
    await db.bill.createMany({ data: Array.from({ length: 501 }, () => ({ userId: owner.id, type: 'expense', amount: '1', date: old })) });
    await make('1', 'expense', end, null);
    const partial = (await request(owner)).body.data;
    assert.equal(partial.summary.counts.total, 510); assert.equal(partial.summary.counts.needsReview, 0);
    assert.equal(partial.summary.cashSurplus, '368.0002'); assert.equal(partial.opening.counts.needsReview, 0);
    assert.equal(partial.window.counts.needsReview, 0); assert.equal(partial.window.pendingBillIds.length, 0);
    assert.equal(partial.monthly[0].counts.needsReview, 0); assert.equal(partial.monthly[0].cumulativeNeedsReview, 0);
    assert.equal(partial.monthly[0].cumulativeComplete, true); assert.equal(partial.monthly[11].cumulativeNeedsReview, 0);
    // December used to produce a 24-month client range. Check December and UTC+8 January rollover.
    const edgeYear = end.getUTCFullYear() + 2;
    const december = await service.cashHistory(owner.id, new Date(`${edgeYear}-12-15T00:00:00Z`));
    assert.equal(december.window.startDate, `${edgeYear}-01-01`); assert.equal(december.window.endDate, `${edgeYear}-12-31`);
    const january = await service.cashHistory(owner.id, new Date(`${edgeYear}-12-31T16:00:00Z`));
    assert.equal(january.window.startDate, `${edgeYear}-02-01`); assert.equal(january.window.endDate, `${edgeYear + 1}-01-31`);
    assert.equal(january.monthly.length, 12); assert.equal(january.summary.cashSurplus, '1145.0002');
    await db.bill.update({ where: { id: expense.id }, data: { updatedAt: new Date(expense.updatedAt.getTime() + 1000) } });
    const stale = (await request(owner)).body.data;
    assert.equal(stale.summary.cashSurplus, '368.0002'); assert.equal(stale.summary.counts.needsReview, 0);
    console.log('PASS cash history: auth/isolation, 510 rows, exact reconstructed cumulative values, carried unknown history, zero months, refund periods, future cutoff, December/UTC+8 boundary and stale confirmation');
  } finally { for (const user of users) await db.user.deleteMany({ where: { id: user.id } }); await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
