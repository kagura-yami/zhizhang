const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = new URL(process.env.DATABASE_URL || 'http://missing');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/zhizhang_reviews_test') throw new Error('Use isolated localhost zhizhang_reviews_test');
process.env.JWT_SECRET = 'private-reviews-test-secret';
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory, APP_GUARD } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { ReviewsModule } = require('../dist/reviews/reviews.module');
const { BillsModule } = require('../dist/bills/bills.module');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard');
class Root {}
Module({ imports: [ReviewsModule, BillsModule], providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }] })(Root);
(async () => {
  const app = await NestFactory.create(Root, { logger: ['error'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(), db = app.get(PrismaService), users = [], jwt = new JwtService();
  const call = async (u, path, method = 'GET', body) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(u ? { Authorization: 'Bearer ' + jwt.sign({ sub: u.id }, { secret: process.env.JWT_SECRET }) } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json(); return { status: response.status, data: response.ok ? data.data : data };
  };
  const msg = body => ({ clientKey: randomUUID(), body });
  try {
    for (let i = 0; i < 4; i++) {
      const user = await db.user.create({ data: { username: `review-${Date.now()}-${i}`, password: 'test-only', nickname: `测试${i}` } });
      users.push(user); await call(user, '/social/enable', 'POST', { consentVersion: '2026-09-16' });
    }
    const [a, b, c, d] = users;
    for (const u of [b, c]) await call(a, '/social/grants/given/' + u.id, 'PUT', { scope: 'expense', historyStart: '2020-01-01' });
    const bill = await db.bill.create({ data: { userId: a.id, amount: '168', type: 'expense', date: new Date('2026-09-16'), description: 'secret-description', notes: 'secret-raw', counterparty: 'secret-merchant' } });
    const votePath = `/reviews/bills/${bill.id}/vote`;
    assert.equal((await call(null, votePath, 'PUT', { vote: 'hang' })).status, 401);
    assert.equal((await call(a, votePath, 'PUT', { vote: 'hang' })).status, 400);
    assert.equal((await call(d, votePath, 'PUT', { vote: 'hang' })).status, 403);
    assert.equal((await call(b, votePath, 'PUT', { vote: 'cancel' })).status, 400);
    assert.equal((await call(b, '/reviews/threads/999999/main', 'POST', msg('先写后投'))).status, 404);
    const bt = (await call(b, votePath, 'PUT', { vote: 'la' })).data.threadId;
    const ct = (await call(c, votePath, 'PUT', { vote: 'hang' })).data.threadId;
    assert.equal((await call(b, votePath, 'PUT', { vote: 'hang' })).data.threadId, bt);
    assert.equal(await db.socialInboxEvent.count({ where: { userId: a.id } }), 0);
    const bmainBody = msg('B 的私密主评');
    const bm = (await call(b, `/reviews/threads/${bt}/main`, 'POST', bmainBody)).data;
    assert.equal((await call(b, `/reviews/threads/${bt}/main`, 'POST', bmainBody)).data.id, bm.id);
    const cm = (await call(c, `/reviews/threads/${ct}/main`, 'POST', msg('C 的私密主评'))).data;
    assert.equal((await call(b, `/reviews/threads/${bt}/main`, 'POST', msg('第二条主评'))).status, 409);
    assert.equal((await call(a, `/reviews/threads/${ct}/main`, 'POST', msg('主人自评'))).status, 403);
    assert.equal((await call(b, `/reviews/threads/${ct}`)).status, 404);
    assert.equal((await call(b, `/reviews/threads/${ct}/messages/${cm.id}/versions`)).status, 404);
    assert.equal((await call(b, `/reviews/threads/${bt}/messages/${cm.id}/versions`)).status, 404);
    assert.equal((await call(b, `/reviews/bills/${bill.id}/summary`)).status, 404);
    const summary = (await call(a, `/reviews/bills/${bill.id}/summary`)).data;
    assert.equal(summary.hang, 2); assert.equal(summary.la, 0); assert.equal(summary.threads.length, 2);
    const detail = (await call(b, `/reviews/threads/${bt}`)).data;
    assert(!JSON.stringify(detail).includes('secret-')); assert(!JSON.stringify(detail).includes('C 的'));
    assert(!Object.hasOwn(detail, 'hang')); assert.equal(detail.messages.length, 1);
    const reply = (await call(a, `/reviews/threads/${bt}/replies`, 'POST', msg('A 回复 B'))).data;
    assert.equal((await call(c, `/reviews/threads/${bt}/replies`, 'POST', msg('越权'))).status, 404);
    assert.equal((await call(a, `/reviews/threads/${bt}/messages/${bm.id}`, 'PATCH', { action: 'edit', expectedRevision: 1, body: '替别人改' })).status, 403);
    const changed = await call(b, `/reviews/threads/${bt}/messages/${bm.id}`, 'PATCH', { action: 'edit', expectedRevision: 1, body: 'B 编辑后' });
    assert.equal(changed.data.revision, 2);
    assert.equal((await call(b, `/reviews/threads/${bt}/messages/${bm.id}`, 'PATCH', { action: 'edit', expectedRevision: 1, body: '旧版本覆盖' })).status, 409);
    assert.equal((await call(a, `/reviews/threads/${bt}/messages/${bm.id}/versions`)).data.length, 2);
    const beforeEdits = await db.socialInboxEvent.count();
    const withdrawn = await call(b, `/reviews/threads/${bt}/messages/${bm.id}`, 'PATCH', { action: 'withdraw', expectedRevision: 2 });
    assert.equal(withdrawn.data.body, null);
    assert.equal((await call(a, `/reviews/threads/${bt}/replies`, 'POST', msg('撤回时回复'))).status, 409);
    assert.equal((await call(a, `/reviews/threads/${bt}/messages/${reply.id}`, 'PATCH', { action: 'edit', expectedRevision: 1, body: '撤回时改回复' })).status, 409);
    await call(b, `/reviews/threads/${bt}/messages/${bm.id}`, 'PATCH', { action: 'restore', expectedRevision: 3 });
    assert.equal(await db.socialInboxEvent.count(), beforeEdits);
    assert.equal((await call(a, `/reviews/threads/${bt}/messages/${bm.id}/versions`)).data.length, 4);
    assert.equal((await call(a, `/reviews/threads/${bt}/replies`, 'POST', msg('恢复后继续'))).status, 201);
    // A moderation-hidden main is different from self-withdrawal: no historical disclosure, replies remain open.
    await db.reviewMessage.update({ where: { id: bm.id }, data: { hidden: true, withdrawn: true } });
    assert.equal((await call(b, `/reviews/threads/${bt}`)).data.messages[0].body, null);
    assert.equal((await call(a, `/reviews/threads/${bt}/messages/${bm.id}/versions`)).status, 403);
    assert.equal((await call(b, `/reviews/threads/${bt}/messages/${bm.id}`, 'PATCH', { action: 'restore', expectedRevision: 4 })).status, 403);
    assert.equal((await call(a, `/reviews/threads/${bt}/replies`, 'POST', msg('违规占位后仍能回复'))).status, 201);
    await call(a, '/social/grants/given/' + b.id, 'DELETE');
    assert.equal((await call(b, `/reviews/threads/${bt}`)).status, 403);
    assert.equal((await call(b, `/reviews/threads/${bt}/messages/${reply.id}/versions`)).status, 403);
    assert.equal((await call(a, `/reviews/threads/${bt}`)).status, 200);
    assert.equal((await call(a, `/reviews/threads/${bt}/replies`, 'POST', msg('撤权后发言'))).status, 403);
    await call(a, `/bills/${bill.id}`, 'PATCH', { type: 'income', amount: 200 });
    assert.equal((await call(c, `/reviews/threads/${ct}`)).status, 403);
    await call(a, `/bills/${bill.id}`, 'PATCH', { type: 'expense' });
    assert.equal((await call(c, `/reviews/threads/${ct}`)).data.billModified, true);
    assert.equal((await call(a, `/reviews/bills/${bill.id}/summary`)).data.hang, 2);
    assert.equal((await call(a, `/bills/${bill.id}`, 'DELETE')).status, 200);
    assert.equal((await call(c, `/reviews/threads/${ct}`)).status, 403);
    const archived = (await call(a, `/reviews/threads/${ct}`)).data;
    assert.equal(archived.deleted, true); assert.equal(archived.snapshot.amount, '200.0000'); assert.equal(archived.messages[0].body, 'C 的私密主评');
    assert.equal((await call(a, `/reviews/threads/${ct}/replies`, 'POST', msg('删除后回复'))).status, 403);
    assert.equal((await call(a, `/reviews/bills/${bill.id}/summary`)).data.hang, 2);
    assert.equal(await db.billReviewThread.count({ where: { originalBillId: bill.id } }), 2);
    assert.equal((await call(a, '/reviews/mine')).data.length, 2);
    const raceBill = await db.bill.create({ data: { userId: a.id, amount: '12', type: 'expense', date: new Date('2026-09-16') } });
    const raceVotes = await Promise.all(['hang', 'la'].map(vote => call(c, `/reviews/bills/${raceBill.id}/vote`, 'PUT', { vote })));
    assert(raceVotes.every(r => r.status === 200));
    assert.equal(raceVotes[0].data.threadId, raceVotes[1].data.threadId);
    const raceThread = raceVotes[0].data.threadId;
    const raceMains = await Promise.all(['第一条', '另一条'].map(body => call(c, `/reviews/threads/${raceThread}/main`, 'POST', msg(body))));
    assert.deepEqual(raceMains.map(r => r.status).sort(), [201, 409]);
    const deleteRace = await Promise.all([
      call(a, `/bills/${raceBill.id}`, 'DELETE'),
      call(c, `/reviews/threads/${raceThread}/replies`, 'POST', msg('与删除同时提交')),
    ]);
    assert.equal(deleteRace[0].status, 200);
    assert([201, 403].includes(deleteRace[1].status));
    assert.equal((await call(a, `/reviews/threads/${raceThread}`)).data.deleted, true);
    assert.equal((await call(c, `/reviews/threads/${raceThread}`)).status, 403);
    console.log('PASS private reviews: independent votes, one main, author-only edits, idempotency, version history, withdrawn/hidden rules, reviewer isolation, grant changes, bill updates and deleted owner-only archive');
  } finally {
    for (const u of users) await db.user.deleteMany({ where: { id: u.id } });
    await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
