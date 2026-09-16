const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = new URL(process.env.DATABASE_URL || 'http://missing');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/zhizhang_inbox_test') throw new Error('Use isolated localhost zhizhang_inbox_test');
process.env.JWT_SECRET = 'inbox-test-secret';
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory, APP_GUARD } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { InboxService } = require('../dist/inbox/inbox.service');
const { InboxModule } = require('../dist/inbox/inbox.module');
const { BillsModule } = require('../dist/bills/bills.module');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard');
class Root {}
Module({ imports: [InboxModule, BillsModule], providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }] })(Root);
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
    const service = app.get(InboxService), eventId = initial.items[0].id;
    const resolveEvent = (user, id = eventId) => call(user, `${inbox}/events/${id}`);
    assert.equal((await resolveEvent(null)).status, 401);
    assert.equal((await resolveEvent(c)).status, 404);
    for (const invalid of [0, -1, 2147483648]) assert.equal((await resolveEvent(a, invalid)).status, 404);
    const resolved = (await resolveEvent(a)).data;
    assert.equal(resolved.target.threadId, t);
    assert.equal(resolved.preview, null);
    assert.equal(await service.systemNotification(c.id, eventId), null);
    assert.deepEqual(await service.systemNotification(a.id, eventId), {
      eventId, title: '收到新的评账文字', body: '打开知账查看详情',
    });
    await call(a, '/social/preferences', 'PATCH', { notificationPreview: true });
    assert.equal((await service.systemNotification(a.id, eventId)).body, '第一条私密文字');
    await call(a, '/social/preferences', 'PATCH', { notifyInteractions: false });
    assert.equal(await service.systemNotification(a.id, eventId), null);
    assert.equal((await resolveEvent(a)).status, 200); // Delivery preference does not erase inbox access.
    await call(a, '/social/preferences', 'PATCH', { notifyInteractions: true, notificationPreview: false });
    assert.equal((await service.systemNotification(a.id, eventId)).body, '打开知账查看详情');
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
    assert.equal(await service.systemNotification(a.id, eventId), null); // Already read, still a valid click.
    assert.equal((await resolveEvent(a)).status, 200);
    const newerEventId = page2.items[0].id;
    assert.equal((await service.systemNotification(a.id, newerEventId)).eventId, newerEventId);
    assert.equal(page1.hasMore, true); assert.equal(page2.hasMore, false);
    assert.notEqual(page1.items[0].id, page2.items[0].id); assert.equal(page2.items[0].unread, true);
    assert.equal((await call(a, inbox + '/read', 'POST', { receipt: initial.receipt })).data.count, 0);
    // Preference controls preview and downstream system delivery, not stored inbox history.
    assert.equal((await call(a, '/social/preferences', 'PATCH', { notificationPreview: true, notifyInteractions: false })).status, 200);
    const preview = (await call(a, inbox)).data.items;
    assert.equal(preview[0].preview, '第一条私密文字'); assert.equal(preview[0].systemNotificationEnabled, false);
    await call(b, `/reviews/threads/${t}/messages/${newer.id}`, 'PATCH', { action: 'withdraw', expectedRevision: 1 });
    assert.equal((await resolveEvent(a, newerEventId)).status, 404);
    assert.equal(await service.systemNotification(a.id, newerEventId), null);
    assert.equal((await call(a, `${inbox}/threads/${t}`)).data.unread, 0);
    assert.equal((await call(a, inbox)).data.items.length, 1);
    await db.reviewMessage.update({ where: { id: main.id }, data: { hidden: true } });
    assert.equal((await resolveEvent(a)).status, 404);
    const hiddenPage = (await call(a, inbox + '?limit=1')).data;
    assert.equal(hiddenPage.items.length, 0); assert.equal(hiddenPage.hasMore, true); assert(hiddenPage.nextAfter > 0);
    // Hidden main does not prevent replies. Revoking blocks reviewer notification previews and read deep links.
    await call(a, `/reviews/threads/${t}/replies`, 'POST', message('主人给评价者的回复'));
    const bInbox = (await call(b, inbox)).data;
    assert.equal(bInbox.items.filter(i => i.kind === 'review_reply_created').length, 1);
    const replyEventId = bInbox.items.find(i => i.kind === 'review_reply_created').id;
    assert.equal((await resolveEvent(b, replyEventId)).status, 200);
    assert(await service.systemNotification(b.id, replyEventId));
    const bBoundary = (await call(b, `${inbox}/threads/${t}`)).data;
    await call(a, '/social/grants/given/' + b.id, 'DELETE');
    assert.equal((await resolveEvent(b, replyEventId)).status, 404);
    assert.equal(await service.systemNotification(b.id, replyEventId), null);
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
    // Home summaries expose only the owner's counters; never another reviewer's aggregate.
    const summarize = u => call(u, inbox + '/bills/summary', 'POST', { billIds: [bill.id] });
    assert.deepEqual((await summarize(a)).data, [{ billId: bill.id, hang: 1, la: 0, hasUnreadText: false }]);
    assert.deepEqual((await summarize(b)).data, []);
    assert.equal((await call(b, `${inbox}/bills/${bill.id}`)).status, 404);
    assert.equal((await call(a, inbox + '/bills/summary', 'POST', { billIds: [] })).status, 400);
    await call(a, '/social/blocks/' + c.id, 'DELETE');
    await call(a, '/social/grants/given/' + c.id, 'PUT', { scope: 'expense', historyStart: '2020-01-01' });
    const ct = (await call(c, `/reviews/bills/${bill.id}/vote`, 'PUT', { vote: 'la' })).data.threadId;
    await call(c, `/reviews/threads/${ct}/main`, 'POST', message('第二位评价者的文字'));
    assert.deepEqual((await summarize(a)).data, [{ billId: bill.id, hang: 1, la: 1, hasUnreadText: true }]);
    const anotherBill = await db.bill.create({ data: { userId: a.id, amount: '7', type: 'expense', date: new Date('2026-09-16') } });
    const anotherThread = (await call(c, `/reviews/bills/${anotherBill.id}/vote`, 'PUT', { vote: 'la' })).data.threadId;
    await call(c, `/reviews/threads/${anotherThread}/main`, 'POST', message('另一账单仍应保持未读'));
    const billBoundary = (await call(a, `${inbox}/bills/${bill.id}`)).data;
    await call(b, `/reviews/threads/${t}/replies`, 'POST', message('账单边界之后到达'));
    assert.equal((await call(b, inbox + '/read', 'POST', { receipt: billBoundary.receipt })).status, 403);
    await call(a, inbox + '/read', 'POST', { receipt: billBoundary.receipt });
    assert.equal((await summarize(a)).data[0].hasUnreadText, true);
    const finalBoundary = (await call(a, `${inbox}/bills/${bill.id}`)).data;
    await call(a, inbox + '/read', 'POST', { receipt: finalBoundary.receipt });
    assert.equal((await summarize(a)).data[0].hasUnreadText, false);
    assert.equal((await call(a, inbox + '/bills/summary', 'POST', { billIds: [anotherBill.id] })).data[0].hasUnreadText, true);
    await call(c, `/reviews/bills/${bill.id}/vote`, 'PUT', { vote: 'hang' });
    assert.deepEqual((await summarize(a)).data, [{ billId: bill.id, hang: 2, la: 0, hasUnreadText: false }]);
    // Repeat follows are idempotent; refollow has a fresh generation and cannot revive the old event.
    await Promise.all([call(c, '/social/following/' + a.id, 'PUT'), call(c, '/social/following/' + a.id, 'PUT')]);
    const follows = () => db.socialInboxEvent.findMany({ where: { userId: a.id, kind: 'social_follow_created' } });
    assert.equal((await follows()).length, 1);
    const oldFollowId = (await follows())[0].id;
    await call(c, '/social/following/' + a.id, 'DELETE');
    assert(!(await call(a, inbox)).data.items.some(i => i.id === oldFollowId));
    await call(c, '/social/following/' + a.id, 'PUT');
    const followItems = (await call(a, inbox)).data.items.filter(i => i.kind === 'social_follow_created');
    assert.equal(followItems.length, 1); assert.notEqual(followItems[0].id, oldFollowId);
    // Opening historical access creates one summary, not an event for every old bill.
    const grants = await db.socialInboxEvent.count({ where: { userId: c.id, kind: 'review_grant_updated' } });
    const grant = await db.reviewGrant.findUnique({ where: { ownerId_reviewerId: { ownerId: a.id, reviewerId: c.id } } });
    const noChange = await call(a, '/social/grants/given/' + c.id, 'PUT', { expectedVersion: grant.version, scope: grant.scope, historyStart: '2020-01-01' });
    assert.equal(noChange.data.version, grant.version);
    assert.equal(await db.socialInboxEvent.count({ where: { userId: c.id, kind: 'review_grant_updated' } }), grants);
    assert.equal((await call(a, `/bills/${bill.id}`, 'DELETE')).status, 200);
    assert.deepEqual((await summarize(a)).data, [{ billId: bill.id, hang: 2, la: 0, hasUnreadText: false }]);
    assert.equal((await call(a, `${inbox}/bills/${bill.id}`)).status, 200);
    assert.equal((await call(c, `${inbox}/bills/${bill.id}`)).status, 404);
    const firstMessages = (await call(a, `/reviews/threads/${anotherThread}?pageSize=1`)).data;
    assert.equal(firstMessages.unreadOnPage, 1);
    assert.equal((await call(b, inbox + '/read', 'POST', { receipt: firstMessages.readReceipt })).status, 403);
    await call(c, `/reviews/threads/${anotherThread}/replies`, 'POST', message('分页读取后新增的回复'));
    await call(a, inbox + '/read', 'POST', { receipt: firstMessages.readReceipt });
    assert.equal((await call(a, `${inbox}/threads/${anotherThread}`)).data.unread, 1);
    const secondMessages = (await call(a, `/reviews/threads/${anotherThread}?pageSize=1&page=2`)).data;
    assert.equal(secondMessages.unreadOnPage, 1);
    await call(c, `/reviews/threads/${anotherThread}/replies`, 'POST', message('更晚到达的回复'));
    await call(a, inbox + '/read', 'POST', { receipt: secondMessages.readReceipt });
    assert.equal((await call(a, `${inbox}/threads/${anotherThread}`)).data.unread, 1);
    const newest = (await call(a, inbox + '?before=2147483647&limit=1')).data;
    const linked = (await call(a, `/reviews/threads/${anotherThread}?pageSize=1&aroundMessageId=${newest.items[0].target.messageId}`)).data;
    assert.equal(linked.pageNumber, 3);
    assert.equal(linked.messages[0].id, newest.items[0].target.messageId);
    assert.equal((await call(a, `/reviews/threads/${anotherThread}?aroundMessageId=${main.id}`)).status, 404);
    const older = (await call(a, inbox + '?before=' + newest.nextBefore + '&limit=1')).data;
    assert(newest.items[0].id > older.items[0].id);
    assert.equal((await call(a, inbox + '/read', 'POST', { receipt: newest.items[0].readReceipt })).data.count, 1);
    assert.equal((await call(a, inbox + '?before=0')).status, 400);
    await db.user.update({ where: { id: a.id }, data: { isActive: false } });
    assert.equal(await service.systemNotification(a.id, eventId), null);
    await db.user.update({ where: { id: a.id }, data: { isActive: true } });
    console.log('PASS inbox: event resolution and fresh push projection, auth, default privacy, opt-in current preview, switches, page cursors, signed user-bound receipts, concurrent unread boundary, idempotency, hidden/withdrawn filtering, revoked deep links');
  } finally {
    for (const u of users) await db.user.deleteMany({ where: { id: u.id } });
    await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
