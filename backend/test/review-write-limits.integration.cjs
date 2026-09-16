const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = new URL(process.env.DATABASE_URL || 'http://missing');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '15451' || url.pathname !== '/zhizhang_reviews_test') throw new Error('Use isolated localhost:15451 zhizhang_reviews_test');
process.env.JWT_SECRET = 'review-limit-test-only';
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory, APP_GUARD } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { ReviewsModule } = require('../dist/reviews/reviews.module');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard');
class Root {}
Module({ imports: [ReviewsModule], providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }] })(Root);
(async () => {
  const app = await NestFactory.create(Root, { logger: ['error'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(), db = app.get(PrismaService), users = [], jwt = new JwtService();
  const call = async (u, path, method, body) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt.sign({ sub: u.id }, { secret: process.env.JWT_SECRET }) }, body: JSON.stringify(body) });
    const data = await r.json(); return { status: r.status, data: r.ok ? data.data : data };
  };
  const msg = () => ({ clientKey: randomUUID(), body: '合成评账文字' });
  try {
    for (let i = 0; i < 3; i++) {
      const u = await db.user.create({ data: { username: randomUUID(), password: 'test-only' } }); users.push(u);
      assert.equal((await call(u, '/social/enable', 'POST', { consentVersion: '2026-09-16' })).status, 201);
    }
    const [owner, ...reviewers] = users, threads = [];
    for (const reviewer of reviewers) {
      await call(owner, `/social/grants/given/${reviewer.id}`, 'PUT', { scope: 'expense', historyStart: '2020-01-01' });
      const bill = await db.bill.create({ data: { userId: owner.id, amount: 1, type: 'expense', date: new Date('2026-09-16') } });
      const t = (await call(reviewer, `/reviews/bills/${bill.id}/vote`, 'PUT', { vote: 'hang' })).data.threadId;
      threads.push(t); assert.equal((await call(reviewer, `/reviews/threads/${t}/main`, 'POST', msg())).status, 201);
    }
    const seedMessages = count => db.reviewMessage.createMany({ data: Array.from({ length: count }, () => ({ threadId: threads[0], authorId: owner.id, ...msg(), createdAt: new Date(Date.now() - 7200000) })) });
    await seedMessages(19);
    await db.reviewMessage.updateMany({ where: { authorId: owner.id }, data: { createdAt: new Date() } });
    const postRace = async () => {
      const bodies = threads.map(msg), events = await db.socialInboxEvent.count();
      const results = await Promise.all(threads.map((t, i) => call(owner, `/reviews/threads/${t}/replies`, 'POST', bodies[i])));
      assert.deepEqual(results.map(r => r.status).sort(), [201, 429]);
      const winner = results.findIndex(r => r.status === 201);
      assert.equal((await call(owner, `/reviews/threads/${threads[winner]}/replies`, 'POST', bodies[winner])).data.id, results[winner].data.id);
      assert.equal(await db.socialInboxEvent.count(), events + 1);
    };
    await postRace(); assert.equal(await db.reviewMessage.count({ where: { authorId: owner.id } }), 20);
    await db.reviewMessage.updateMany({ where: { authorId: owner.id }, data: { createdAt: new Date(Date.now() - 7200000) } });
    await seedMessages(179); await postRace();
    assert.equal(await db.reviewMessage.count({ where: { authorId: owner.id } }), 200);
    await db.reviewMessage.updateMany({ where: { authorId: owner.id }, data: { createdAt: new Date(Date.now() - 90000000) } });
    const editable = [];
    for (const t of threads) editable.push((await call(owner, `/reviews/threads/${t}/replies`, 'POST', msg())).data);
    const seedEdits = async count => {
      const row = await db.reviewMessage.findUnique({ where: { id: editable[0].id } });
      await db.reviewMessageVersion.createMany({ data: Array.from({ length: count }, (_, i) => ({ messageId: row.id, revision: row.revision + i + 1, action: 'edit', body: row.body, withdrawn: false, createdAt: new Date() })) });
      await db.reviewMessage.update({ where: { id: row.id }, data: { revision: row.revision + count } });
    };
    const patch = (row, action, body) => call(owner, `/reviews/threads/${row.threadId}/messages/${row.id}`, 'PATCH', { action, expectedRevision: row.revision, ...(body ? { body } : {}) });
    const editRace = async () => {
      const rows = await Promise.all(editable.map(m => db.reviewMessage.findUnique({ where: { id: m.id } })));
      const before = await db.reviewMessageVersion.count();
      const results = await Promise.all(rows.map(row => patch(row, 'edit', randomUUID())));
      assert.deepEqual(results.map(r => r.status).sort(), [200, 429]);
      assert.equal(await db.reviewMessageVersion.count(), before + 1);
    };
    await seedEdits(29); await editRace();
    await db.reviewMessageVersion.updateMany({ where: { message: { authorId: owner.id } }, data: { createdAt: new Date(Date.now() - 7200000) } });
    await seedEdits(169);
    await db.reviewMessageVersion.updateMany({ where: { message: { authorId: owner.id } }, data: { createdAt: new Date(Date.now() - 7200000) } });
    await editRace();
    let row = await db.reviewMessage.findUnique({ where: { id: editable[0].id } });
    assert.equal((await patch(row, 'edit', row.body)).status, 200); // No-op does not consume quota.
    assert.equal((await patch(row, 'withdraw')).status, 200); // Privacy action stays available.
    row = await db.reviewMessage.findUnique({ where: { id: row.id } });
    assert.equal((await patch(row, 'restore')).status, 429);
    await db.reviewMessageVersion.updateMany({ where: { message: { authorId: owner.id } }, data: { createdAt: new Date(Date.now() - 90000000) } });
    assert.equal((await patch(row, 'restore')).status, 200);
    assert.equal((await call(reviewers[0], `/reviews/threads/${threads[0]}/replies`, 'POST', msg())).status, 201);
    console.log('PASS review write limits: cross-thread minute/hour/day races, idempotency, atomic version/event counts, no-op, withdrawal, restoration, window expiry, independent authors');
  } finally { for (const u of users) await db.user.deleteMany({ where: { id: u.id } }); await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
