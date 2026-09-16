const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = new URL(process.env.DATABASE_URL || 'http://missing');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/zhizhang_inbox_test') throw new Error('Use isolated localhost zhizhang_inbox_test');
process.env.JWT_SECRET = 'inbox-test-secret';
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory, APP_GUARD } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { InboxModule } = require('../dist/inbox/inbox.module');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard');
class Root {}
Module({ imports: [InboxModule], providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }] })(Root);
(async () => {
  const app = await NestFactory.create(Root, { logger: ['error'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(), db = app.get(PrismaService), users = [], jwt = new JwtService();
  const call = async (u, path, method = 'GET', body, overrideToken) => {
    const token = overrideToken || (u ? jwt.sign({ sub: u.id }, { secret: process.env.JWT_SECRET }) : '');
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await r.json(); return { status: r.status, data: r.ok ? data.data : data };
  };
  const message = body => ({ clientKey: randomUUID(), body });
  const inbox = '/social/inbox';
  try {
    for (let i = 0; i < 3; i++) {
      const u = await db.user.create({ data: { username: 'inbox-' + randomUUID(), password: 'test-only' } });
      users.push(u); await call(u, '/social/enable', 'POST', { consentVersion: '2026-09-16' });
    }
    const [a, b, c] = users;
    assert.equal((await call(null, inbox)).status, 401);
    await call(a, '/social/grants/given/' + b.id, 'PUT', { scope: 'expense', historyStart: '2020-01-01' });
    const bill = await db.bill.create({ data: { userId: a.id, amount: '12', type: 'expense', date: new Date('2026-09-16'), notes: '不能出现在通知的备注' } });
    const t = (await call(b, `/reviews/bills/${bill.id}/vote`, 'PUT', { vote: 'hang' })).data.threadId;
    assert.equal((await call(a, inbox)).data.items.length, 0);
    const main = (await call(b, `/reviews/threads/${t}/main`, 'POST', message('第一条私密文字'))).data;
    const initial = (await call(a, inbox)).data;
    assert.equal(initial.items.length, 1); assert.equal(initial.items[0].unread, true);
    assert.equal(initial.items[0].preview, null);
    assert(!JSON.stringify(initial).includes('第一条私密文字')); assert(!JSON.stringify(initial).includes('不能出现在通知'));
    assert.equal((await call(c, inbox + '/read', 'POST', { receipt: initial.receipt })).status, 403);
    assert.equal((await call(a, inbox + '/read', 'POST', { receipt: 'forged' })).status, 403);
    const expired = jwt.sign({ purpose: 'social-read', userId: a.id, scope: 'events', ids: [initial.items[0].id] }, { secret: process.env.JWT_SECRET, audience: 'zhizhang-social-read', expiresIn: -1 });
    assert.equal((await call(a, inbox + '/read', 'POST', { receipt: expired })).status, 403);
    assert.equal((await call(a, inbox, 'GET', undefined, initial.receipt)).status, 401);
    const boundary = (await call(a, `${inbox}/threads/${t}`)).data;
    assert.equal(boundary.unread, 1);
    const newer = (await call(b, `/reviews/threads/${t}/replies`, 'POST', message('边界之后的新回复'))).data;
    assert.equal((await call(a, inbox + '/read', 'POST', { receipt: boundary.receipt })).data.count, 1);
    assert.equal((await call(a, `${inbox}/threads/${t}`)).data.unread, 1);
    assert.equal((await call(a, inbox + '/read', 'POST', { receipt: boundary.receipt })).data.count, 0);
    const page1 = (await call(a, inbox + '?limit=1')).data;
    const page2 = (await call(a, inbox + '?limit=1&after=' + page1.nextAfter)).data;
    assert.equal(page1.hasMore, true); assert.equal(page2.hasMore, false);
    assert.notEqual(page1.items[0].id, page2.items[0].id); assert.equal(page2.items[0].unread, true);
    assert.equal((await call(a, inbox + '/read', 'POST', { receipt: initial.receipt })).data.count, 0);
    // Preference controls preview and downstream system delivery, not stored inbox history.
    assert.equal((await call(a, '/social/preferences', 'PATCH', { notificationPreview: true, notifyInteractions: false })).status, 200);
    const preview = (await call(a, inbox)).data.items;
    assert.equal(preview[0].preview, '第一条私密文字'); assert.equal(preview[0].systemNotificationEnabled, false);
    await call(b, `/reviews/threads/${t}/messages/${newer.id}`, 'PATCH', { action: 'withdraw', expectedRevision: 1 });
    assert.equal((await call(a, `${inbox}/threads/${t}`)).data.unread, 0);
    assert.equal((await call(a, inbox)).data.items.length, 1);
    await db.reviewMessage.update({ where: { id: main.id }, data: { hidden: true } });
    const hiddenPage = (await call(a, inbox + '?limit=1')).data;
    assert.equal(hiddenPage.items.length, 0); assert.equal(hiddenPage.hasMore, true); assert(hiddenPage.nextAfter > 0);
    // Hidden main does not prevent replies. Revoking blocks reviewer notification previews and read deep links.
    await call(a, `/reviews/threads/${t}/replies`, 'POST', message('主人给评价者的回复'));
    const bInbox = (await call(b, inbox)).data;
    assert.equal(bInbox.items.length, 1);
    const bBoundary = (await call(b, `${inbox}/threads/${t}`)).data;
    await call(a, '/social/grants/given/' + b.id, 'DELETE');
    assert.equal((await call(b, inbox)).data.items.length, 0);
    assert.equal((await call(b, `${inbox}/threads/${t}`)).status, 403);
    assert.equal((await call(b, inbox + '/read', 'POST', { receipt: bBoundary.receipt })).status, 403);
    assert.equal((await call(c, `${inbox}/threads/${t}`)).status, 404);
    // A page receipt only marks explicitly delivered ids; a concurrently inserted event survives it.
    await call(a, '/social/grants/given/' + b.id, 'PUT', { expectedVersion: 2, scope: 'expense', historyStart: '2020-01-01' });
    await call(a, `/reviews/threads/${t}/replies`, 'POST', message('新的未读'));
    await call(b, inbox + '/read', 'POST', { receipt: bInbox.receipt });
    assert.equal((await call(b, `${inbox}/threads/${t}`)).data.unread, 1);
    const request = await call(c, '/social/requests/to/' + a.id, 'POST', {});
    assert.equal(request.status, 201);
    assert((await call(a, inbox)).data.items.some(i => i.kind === 'review_request_pending'));
    await call(a, '/social/requests/from/' + c.id + '/reject', 'POST', { expectedVersion: request.data.version });
    assert(!(await call(a, inbox)).data.items.some(i => i.kind === 'review_request_pending'));
    assert((await call(c, inbox)).data.items.some(i => i.kind === 'review_request_rejected'));
    await call(a, '/social/blocks/' + c.id, 'PUT');
    assert.equal((await call(c, inbox)).data.items.length, 0);
    const simultaneousBoundary = (await call(b, `${inbox}/threads/${t}`)).data;
    const race = await Promise.all([
      call(b, inbox + '/read', 'POST', { receipt: simultaneousBoundary.receipt }),
      call(a, `/reviews/threads/${t}/replies`, 'POST', message('同时写入仍未读')),
    ]);
    assert.equal(race[0].status, 201); assert.equal(race[1].status, 201);
    assert.equal((await call(b, `${inbox}/threads/${t}`)).data.unread, 1);
    console.log('PASS inbox: auth, default privacy, opt-in current preview, switches, page cursors, signed user-bound receipts, concurrent unread boundary, idempotency, hidden/withdrawn filtering, revoked deep links');
  } finally {
    for (const u of users) await db.user.deleteMany({ where: { id: u.id } });
    await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
