const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = new URL(process.env.DATABASE_URL || 'http://missing');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/zhizhang_notices_test') throw new Error('Use isolated localhost zhizhang_notices_test');
process.env.JWT_SECRET = 'new-bill-test-secret';
process.env.NEW_BILL_NOTICE_WORKER_DISABLED = '1';
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory, APP_GUARD } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { InboxService } = require('../dist/inbox/inbox.service');
const { InboxModule } = require('../dist/inbox/inbox.module');
const { BillsModule } = require('../dist/bills/bills.module');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard');
const { NewBillWorker } = require('../dist/inbox/new-bill-worker.service');
const { SocialAccessService } = require('../dist/social/social-access.service');
class Root {}
Module({ imports: [InboxModule, BillsModule], providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }] })(Root);
(async () => {
  const app = await NestFactory.create(Root, { logger: ['error'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(), db = app.get(PrismaService), users = [], jwt = new JwtService();
  const worker = app.get(NewBillWorker);
  const call = async (u, path, method = 'GET', body) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt.sign({ sub: u.id }, { secret: process.env.JWT_SECRET }) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await r.json(); return { status: r.status, data: r.ok ? data.data : data };
  };
  const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const billBody = { amount: 12, type: 'expense', date, description: '不应出现在提醒的备注', counterparty: '不应披露的商户' };
  const notices = async u => (await call(u, '/social/inbox?limit=50')).data.items.filter(i => i.kind === 'review_bills_created');
  const due = () => db.newBillNotice.updateMany({ where: { processedAt: null }, data: { dueAt: new Date(0) } });
  try {
    for (let i = 0; i < 3; i++) {
      const u = await db.user.create({ data: { username: 'notice-' + randomUUID(), password: 'test-only' } });
      users.push(u); await call(u, '/social/enable', 'POST', { consentVersion: '2026-09-16' });
    }
    const [a, b, c] = users;
    await call(a, '/social/grants/given/' + b.id, 'PUT', { scope: 'expense' });
    const first = (await call(a, '/bills', 'POST', billBody)).data;
    const second = (await call(a, '/bills', 'POST', { ...billBody, amount: 30 })).data;
    assert(first.id && second.id);
    await call(a, '/bills', 'POST', { ...billBody, type: 'income' });
    await call(a, '/bills', 'POST', { ...billBody, date: '2000-01-01' });
    assert.equal(await db.newBillNotice.count(), 1);
    assert.equal(await db.newBillNoticeItem.count(), 2);
    assert.equal((await notices(b)).length, 0);
    assert.equal((await call(b, '/social/owners/' + a.id + '/bills')).data.items.length, 2);
    await worker.drain(); assert.equal((await notices(b)).length, 0);
    await call(a, '/social/grants/given/' + c.id, 'PUT', { scope: 'both', historyStart: '1999-01-01' });
    assert.equal(await db.newBillNotice.count({ where: { reviewerId: c.id } }), 0);
    await due();
    await Promise.all([worker.drain(), new NewBillWorker(db, new SocialAccessService()).drain()]);
    let items = await notices(b);
    assert.equal(items.length, 1); assert.equal(items[0].target.count, 2); assert.equal(items[0].preview, null);
    assert(!JSON.stringify(items).includes('不应')); assert.equal(await db.socialInboxEvent.count({ where: { kind: 'review_bills_created' } }), 1);
    const service = app.get(InboxService), eventId = items[0].id;
    assert.equal((await service.systemNotification(b.id, eventId)).body, '打开知账查看详情');
    await call(b, '/social/preferences', 'PATCH', { notifyInteractions: false });
    assert(await service.systemNotification(b.id, eventId)); // New-bill toggle is independent.
    await call(b, '/social/preferences', 'PATCH', { notifyNewBills: false, notificationPreview: true });
    assert.equal(await service.systemNotification(b.id, eventId), null);
    assert.equal((await call(b, '/social/inbox/events/' + eventId)).status, 200);
    assert.equal((await notices(b))[0].systemNotificationEnabled, false);
    await call(a, `/bills/${first.id}`, 'PATCH', { type: 'income' });
    items = await notices(b); assert.equal(items[0].target.count, 1); assert(items[0].preview.includes('30.0000'));
    await call(b, '/social/preferences', 'PATCH', { notifyNewBills: true });
    assert((await service.systemNotification(b.id, eventId)).body.includes('30.0000'));
    await call(a, `/bills/${second.id}`, 'DELETE');
    assert.equal(await service.systemNotification(b.id, eventId), null);
    assert.equal((await call(b, '/social/inbox/events/' + eventId)).status, 404);
    assert.equal((await notices(b)).length, 0);
    assert.equal(await db.newBillNotice.count(), 1); // Edits/deletes do not enqueue fresh notices.
    const helperBill = await db.createBill({ userId: a.id, amount: 5, type: 'expense', date: new Date(date) });
    assert.equal(await db.newBillNoticeItem.count({ where: { billId: helperBill.id } }), 2);
    await call(a, '/social/grants/given/' + b.id, 'DELETE');
    await call(a, '/social/grants/given/' + b.id, 'PUT', { scope: 'expense', expectedVersion: 2 });
    await due(); await new NewBillWorker(db, new SocialAccessService()).drain();
    assert.equal((await notices(b)).length, 0); // Old grants cannot revive queued notifications.
    assert.equal((await notices(c)).length, 1);
    const key = randomUUID();
    const auto = { ...billBody, amount: 77, source: 'notification', sourceApp: 'bank_app', dedupeKey: key };
    const results = await Promise.all([call(a, '/bills', 'POST', auto), call(a, '/bills', 'POST', auto)]);
    assert.equal(results[0].status, 201); assert.equal(results[1].status, 201);
    assert.equal(results[0].data.id, results[1].data.id);
    assert.equal(await db.newBillNoticeItem.count({ where: { billId: results[0].data.id } }), 2);
    const prefix = randomUUID();
    const longer = await call(a, '/bills', 'POST', { ...auto, amount: 80, dedupeKey: prefix + '-long' });
    const shorter = await call(a, '/bills', 'POST', { ...auto, amount: 81, dedupeKey: prefix });
    assert.equal(shorter.status, 201); assert.notEqual(shorter.data.id, longer.data.id);
    // A persisted queue remains pending when inbox insertion fails; later retry delivers it once.
    await due();
    await db.$executeRawUnsafe(`CREATE FUNCTION fail_notice_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind = 'review_bills_created' THEN RAISE EXCEPTION 'injected event failure'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER fail_notice_event BEFORE INSERT ON social_inbox_events FOR EACH ROW EXECUTE FUNCTION fail_notice_event()`);
    await worker.drain();
    assert.equal(await db.newBillNotice.count({ where: { processedAt: null } }), 2);
    assert.equal(await db.newBillNotice.count({ where: { processedAt: null, attempts: 1, retryAt: { gt: new Date() } } }), 2);
    await db.$executeRawUnsafe('DROP TRIGGER fail_notice_event ON social_inbox_events');
    await db.$executeRawUnsafe('DROP FUNCTION fail_notice_event()');
    await db.newBillNotice.updateMany({ where: { processedAt: null }, data: { retryAt: null } });
    await worker.drain(); await worker.drain();
    assert.equal(await db.newBillNotice.count({ where: { processedAt: null } }), 0);
    assert.equal((await notices(b)).length, 1);
    // Fail notice capture itself: the bill must roll back together with the batch.
    await db.$executeRawUnsafe(`CREATE FUNCTION fail_notice_item() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected capture failure'; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER fail_notice_item BEFORE INSERT ON new_bill_notice_items FOR EACH ROW EXECUTE FUNCTION fail_notice_item()`);
    const before = await db.bill.count();
    assert.equal((await call(a, '/bills', 'POST', { ...billBody, amount: 999 })).status, 400);
    assert.equal(await db.bill.count(), before);
    await db.$executeRawUnsafe('DROP TRIGGER fail_notice_item ON new_bill_notice_items');
    await db.$executeRawUnsafe('DROP FUNCTION fail_notice_item()');
    const extra = Array.from({ length: 105 }, () => ({ id: randomUUID(), username: 'fanout-' + randomUUID(), password: 'test-only' }));
    await db.user.createMany({ data: extra }); users.push(...extra);
    const activatedAt = new Date(Date.now() - 60000);
    await db.socialPreference.createMany({ data: extra.map(u => ({ userId: u.id, enabledAt: activatedAt, consentVersion: '2026-09-16' })) });
    await db.reviewGrant.createMany({ data: extra.map(u => ({ ownerId: a.id, reviewerId: u.id, activatedAt, scope: 'expense' })) });
    const fanoutBill = (await call(a, '/bills', 'POST', { ...billBody, amount: 51 })).data;
    assert(fanoutBill.id); assert.equal(await db.newBillNoticeItem.count({ where: { billId: fanoutBill.id } }), 107);
    await due();
    for (let i = 0; i < 6; i++) await worker.drain();
    assert.equal(await db.newBillNotice.count({ where: { processedAt: null } }), 0);
    assert.equal((await notices(extra[104])).length, 1);
    console.log('PASS new-bill notices: transactional capture/rollback, immediate bill visibility, delayed rolling merge, scope/history, no retroactive recipients, concurrent workers/retries, live privacy, grant generations, persistent retry and helper path');
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_notice_event ON social_inbox_events');
    await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_notice_event()');
    await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_notice_item ON new_bill_notice_items');
    await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_notice_item()');
    await db.user.deleteMany({ where: { id: { in: users.map(u => u.id) } } });
    await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
