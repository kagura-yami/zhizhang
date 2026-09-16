// Run against an isolated test database after npm run build and schema migration.
// DATABASE_URL must explicitly point at localhost / zhizhang_ledger_test.
const assert = require('node:assert/strict');
const database = new URL(process.env.DATABASE_URL || 'http://missing');
if (!['127.0.0.1', 'localhost'].includes(database.hostname) || database.pathname !== '/zhizhang_ledger_test') {
  throw new Error('This test only accepts an explicit localhost zhizhang_ledger_test database');
}
process.env.JWT_SECRET = 'isolated-ledger-integration-secret';
const { NestFactory, APP_GUARD } = require('@nestjs/core');
const { Module, ValidationPipe } = require('@nestjs/common');
const { JwtService } = require('@nestjs/jwt');
const { LedgerModule } = require('../dist/ledger/ledger.module');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard');
class Root {}
Module({ imports: [LedgerModule], providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }] })(Root);

(async () => {
  const app = await NestFactory.create(Root, { logger: ['error'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const prisma = app.get(PrismaService);
  const users = [];
  try {
    for (const name of ['owner', 'other']) users.push(await prisma.user.create({ data: { username: `ledger-${name}-${Date.now()}`, password: 'not-a-real-user-password' } }));
    const [owner, other] = users;
    const jwt = new JwtService();
    const token = jwt.sign({ sub: owner.id }, { secret: process.env.JWT_SECRET });
    const otherToken = jwt.sign({ sub: other.id }, { secret: process.env.JWT_SECRET });
    const request = async (path, auth = token, body) => {
      const response = await fetch(base + path, {
        method: body ? 'PUT' : 'GET', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    };
    const summaryUrl = '/ledger/summary?startDate=2026-09-01&endDate=2026-09-30';
    assert.equal((await request(summaryUrl, null)).status, 401);
    assert.equal((await request('/ledger/summary?startDate=2026-02-30&endDate=2026-03-01')).status, 400);
    const createBill = (amount, type = 'expense', userId = owner.id, date = '2026-09-10', extra = {}) => prisma.bill.create({ data: { amount, type, userId, date: new Date(date), ...extra } });
    const salary = await createBill('1000', 'income');
    const purchase = await createBill('200');
    const refund = await createBill('50', 'income', owner.id, '2026-09-11', { relatedBillId: purchase.id });
    const transfer = await createBill('300');
    const misread = await createBill('5', 'income');
    const classify = (bill, kind = 'ordinary', auth = token, extra = {}) => request(`/ledger/bills/${bill.id}/classification`, auth, { kind, currency: 'CNY', expectedUpdatedAt: bill.updatedAt.toISOString(), ...extra });
    assert.equal((await classify(purchase, 'ordinary', otherToken)).status, 404);
    assert.equal((await classify(purchase, 'refund')).status, 400);
    assert.equal((await classify(salary, 'ordinary', token, { currency: 'USDC' })).status, 400);
    for (const [bill, kind] of [[salary, 'ordinary'], [purchase, 'ordinary'], [refund, 'refund'], [transfer, 'internal_transfer'], [misread, 'ignored']]) {
      assert.equal((await classify(bill, kind)).status, 200);
    }
    assert.equal((await classify(salary)).status, 200); // Repeat is an upsert, not a second financial entry.
    const s = (await request(summaryUrl)).body.data;
    assert.equal(s.cashSurplus, '850.0000'); assert.equal(s.counts.total, 5); assert.equal(s.counts.included, 3); assert.equal(s.complete, true);
    assert.equal((await request(summaryUrl, otherToken)).body.data.counts.total, 0);
    // Legacy bills that were never reviewed are visible as incomplete, not silently guessed.
    await prisma.bill.createMany({ data: Array.from({ length: 501 }, () => ({ amount: '1', type: 'expense', userId: owner.id, date: new Date('2026-09-12') })) });
    const large = (await request(summaryUrl)).body.data;
    assert.equal(large.counts.total, 506); assert.equal(large.counts.needsReview, 501); assert.equal(large.pendingBillIds.length, 50); assert.equal(large.cashSurplus, '850.0000');
    assert.equal((await request(`/ledger/bills/${purchase.id}`, otherToken)).status, 404);
    const context = (await request(`/ledger/bills/${purchase.id}`)).body.data;
    assert.equal(context.needsReview, false); assert.equal(context.canBeRefund, false);
    assert.equal(context.amount, '200.0000'); assert.equal('relatedBill' in context, false);
    const pendingUrl = '/ledger/pending?startDate=2026-09-01&endDate=2026-09-30';
    assert.equal((await request(pendingUrl + '&afterId=-1')).status, 400);
    assert.equal((await request(pendingUrl, otherToken)).body.data.items.length, 0);
    const pendingIds = []; let afterId = 0;
    do {
      const page = (await request(pendingUrl + '&afterId=' + afterId)).body.data;
      assert(page.items.length <= 20);
      pendingIds.push(...page.items.map(item => item.id));
      if (!page.hasMore) break;
      assert(page.nextAfterId > afterId); afterId = page.nextAfterId;
    } while (true);
    assert.equal(pendingIds.length, 501); assert.equal(new Set(pendingIds).size, 501);
    // Editing the bill invalidates its old classification and stale confirmations fail.
    const changed = await prisma.bill.update({ where: { id: purchase.id }, data: { amount: '250' } });
    assert.equal((await classify(purchase)).status, 409);
    assert.equal((await request(`/ledger/bills/${purchase.id}`)).body.data.needsReview, true);
    assert.equal((await request(summaryUrl)).body.data.counts.needsReview, 502);
    assert.equal((await classify(changed)).status, 200);
    assert.equal((await request(summaryUrl)).body.data.cashSurplus, '800.0000');
    const foreignSource = await createBill('10', 'expense', other.id);
    const wrongRefund = await createBill('10', 'income', owner.id, '2026-09-12', { relatedBillId: foreignSource.id });
    assert.equal((await classify(wrongRefund, 'refund')).status, 400);
    // Concurrent classification calls remain one record; explicit conflicts are retryable by the user.
    const results = await Promise.all([classify(salary), classify(salary)]);
    assert(results.every(r => [200, 409].includes(r.status)));
    assert.equal(await prisma.billFinancialClassification.count({ where: { billId: salary.id } }), 1);
    await prisma.bill.delete({ where: { id: transfer.id } });
    assert.equal(await prisma.billFinancialClassification.count({ where: { billId: transfer.id } }), 0);
    console.log('PASS ledger integration: authentication, ownership, Decimal totals, all 506 rows, stale versions, refund isolation, idempotency, concurrent confirmation and FK cleanup');
  } finally {
    for (const user of users) await prisma.user.deleteMany({ where: { id: user.id } });
    await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
