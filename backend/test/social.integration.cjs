const assert = require('node:assert/strict');
const url = new URL(process.env.DATABASE_URL || 'http://missing');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/zhizhang_social_test') throw new Error('Use an isolated localhost zhizhang_social_test database');
process.env.JWT_SECRET = 'isolated-social-test-secret';
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory, APP_GUARD } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { SocialModule } = require('../dist/social/social.module');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard');
class Root {}
Module({ imports: [SocialModule], providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }] })(Root);
(async () => {
  const app = await NestFactory.create(Root, { logger: ['error'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(), db = app.get(PrismaService), users = [], jwt = new JwtService();
  const call = async (u, path, method = 'GET', body) => {
    const token = u ? jwt.sign({ sub: u.id }, { secret: process.env.JWT_SECRET }) : null;
    const r = await fetch(base + '/social' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const payload = await r.json();
    return { status: r.status, data: r.ok ? payload.data : payload };
  };
  try {
    for (let i = 0; i < 4; i++) users.push(await db.user.create({ data: { username: `social-${Date.now()}-${i}`, nickname: '社群测试同名', email: `secret-${Date.now()}-${i}@example.invalid`, password: 'test-only' } }));
    const [a, b, c, d] = users;
    assert.equal((await call(null, '/me')).status, 401);
    assert.equal((await call(a, '/me')).data.enabled, false);
    assert.equal((await call(a, '/users?query=test')).status, 403);
    assert.equal((await call(a, '/enable', 'POST', { consentVersion: 'old' })).status, 400);
    for (const u of [a, b, c]) {
      const pref = await call(u, '/enable', 'POST', { consentVersion: '2026-09-16' });
      assert.equal(pref.status, 201); assert.equal(pref.data.rankingScope, 'none'); assert.equal(pref.data.allowAiFeedback, false);
      assert.equal(pref.data.notificationPreview, false); assert.equal(pref.data.showRankingAmount, false);
    }
    assert.equal((await call(a, '/preferences', 'PATCH', { allowAiFeedback: null })).status, 400);
    const results = (await call(a, '/users?query=' + encodeURIComponent('社群测试同名'))).data;
    assert.equal(results.length, 3); assert(!JSON.stringify(results).includes('@example.invalid'));
    assert.deepEqual(Object.keys(results[0]).sort(), ['avatar', 'id', 'nickname']);
    assert.equal((await call(a, '/users?query=' + b.id)).data[0].id, b.id);
    assert.equal((await call(a, '/users?query=' + d.id)).data.length, 0);
    assert.equal((await call(a, '/following/' + a.id, 'PUT')).status, 400);
    assert.equal((await call(a, '/following/' + a.id.toUpperCase(), 'PUT')).status, 400);
    assert.equal((await call(a, '/blocks/' + a.id.toUpperCase(), 'PUT')).status, 400);
    assert.equal((await call(a, '/following/' + b.id, 'PUT')).status, 200);
    assert.equal((await call(a, '/following/' + b.id, 'PUT')).status, 200);
    assert.equal(await db.socialFollow.count({ where: { followerId: a.id } }), 1);
    await call(b, '/following/' + a.id, 'PUT');
    assert.equal((await call(a, '/users/' + b.id)).data.friend, true);
    assert.equal((await call(b, '/owners/' + a.id + '/bills')).status, 403); // mutual follow is not a grant
    assert.equal((await call(c, '/users/' + a.id + '/relations/friends')).status, 403);
    await call(a, '/preferences', 'PATCH', { publicRelations: true });
    assert.equal((await call(c, '/users/' + a.id + '/relations/friends')).data[0].id, b.id);
    const old = await db.bill.create({ data: { userId: a.id, type: 'expense', amount: 1, date: new Date('2020-01-01'), description: 'private-description', notes: 'private-notification', counterparty: 'private-merchant' } });
    let grant = (await call(a, '/grants/given/' + b.id, 'PUT', { scope: 'expense' })).data;
    assert.equal(grant.status, 'active');
    const ownerPair = (await call(a, '/grants/with/' + b.id)).data;
    assert.equal(ownerPair.given.ownerId, a.id);
    assert.equal(ownerPair.received, null);
    const reviewerPair = (await call(b, '/grants/with/' + a.id)).data;
    assert.equal(reviewerPair.given, null);
    assert.equal(reviewerPair.received.reviewerId, b.id);
    assert.deepEqual((await call(c, '/grants/with/' + a.id)).data, { given: null, received: null });
    assert.equal((await call(a, '/grants/with/' + a.id)).status, 400);
    assert.equal((await call(a, '/owners/' + b.id + '/bills')).status, 403); // one way
    const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const expense = await db.bill.create({ data: { userId: a.id, type: 'expense', amount: 32, date: new Date(day), description: 'private-description', counterparty: 'private-merchant', notes: 'private-notification' } });
    await db.bill.create({ data: { userId: a.id, type: 'income', amount: 99, date: new Date(day) } });
    await db.bill.create({ data: { userId: a.id, type: 'expense', amount: 2, date: new Date('2020-01-01') } }); // late imported history
    const visible = (await call(b, '/owners/' + a.id + '/bills')).data;
    assert.deepEqual(visible.items.map(x => x.id), [expense.id]);
    assert.deepEqual(Object.keys(visible.items[0]).sort(), ['amount', 'category', 'date', 'id', 'time', 'type']);
    assert(!JSON.stringify(visible).includes('private-'));
    const owners = (await call(b, '/reviewable-owners')).data;
    assert.equal(owners.total, 1); assert.equal(owners.items[0].owner.id, a.id);
    assert.equal(owners.items[0].pendingCount, 1); assert.equal(owners.items[0].reviewedCount, 0);
    assert(!JSON.stringify(owners).includes('private-'));
    assert.equal((await call(c, '/reviewable-owners')).data.total, 0);
    assert.equal((await call(b, '/owners/' + a.id + '/bills?state=reviewed')).data.total, 0);
    assert.equal((await call(b, '/owners/' + a.id + '/bills?state=pending')).data.total, 1);
    assert.equal((await call(b, '/owners/' + a.id + '/bills?state=invalid')).status, 400);
    assert.equal((await call(c, '/owners/' + a.id + '/bills')).status, 403);
    assert.equal((await call(a, '/grants/given/' + b.id, 'PUT', { scope: 'both' })).status, 409);
    assert.equal((await call(a, '/grants/given/' + b.id, 'PUT', { scope: 'both', historyStart: '2026-02-30', expectedVersion: grant.version })).status, 400);
    grant = (await call(a, '/grants/given/' + b.id, 'PUT', { scope: 'both', historyStart: '2020-01-01', expectedVersion: grant.version })).data;
    assert.equal((await call(b, '/owners/' + a.id + '/bills')).data.items.length, 4);
    const sameTime = await Promise.all([
      call(a, '/grants/given/' + b.id, 'PUT', { scope: 'income', historyStart: '2020-01-01', expectedVersion: grant.version }),
      call(a, '/grants/given/' + b.id, 'PUT', { scope: 'expense', historyStart: '2020-01-01', expectedVersion: grant.version }),
    ]);
    assert.deepEqual(sameTime.map(x => x.status).sort(), [200, 409]);
    await call(b, '/grants/received/' + a.id, 'DELETE');
    assert.equal((await call(b, '/reviewable-owners')).data.total, 0);
    assert.equal((await call(b, '/owners/' + a.id + '/bills')).status, 403);
    const previous = await db.reviewGrant.findUnique({ where: { ownerId_reviewerId: { ownerId: a.id, reviewerId: b.id } } });
    await call(a, '/grants/given/' + b.id, 'PUT', { scope: 'expense', historyStart: '2020-01-01', expectedVersion: previous.version });
    await call(b, '/grants/given/' + a.id, 'PUT', { scope: 'expense' });
    const racing = await Promise.all([call(a, '/following/' + b.id, 'PUT'), call(b, '/blocks/' + a.id, 'PUT')]);
    assert(racing.every(r => [200, 403].includes(r.status)));
    assert.equal((await call(b, '/owners/' + a.id + '/bills')).status, 403);
    assert.equal(await db.socialFollow.count({ where: { OR: [{ followerId: a.id }, { followerId: b.id }] } }), 0);
    assert.equal(await db.reviewGrant.count({ where: { status: 'active' } }), 0);
    assert.equal((await call(a, '/users?query=' + b.id)).data.length, 0);
    assert.equal((await call(a, '/following/' + b.id, 'PUT')).status, 403);
    assert.equal((await call(a, '/grants/with/' + b.id)).status, 403);
    assert.equal((await call(b, '/reviewable-owners')).data.total, 0);
    assert.equal((await call(a, '/grants/given')).data.length, 0);
    await call(b, '/blocks/' + a.id, 'DELETE');
    assert.equal((await call(b, '/owners/' + a.id + '/bills')).status, 403); // unblock never restores access
    assert.equal((await call(b, '/users/' + a.id)).data.friend, false);
    for (let i = 0; i < 21; i++) {
      const extra = await db.user.create({ data: { username: `owner-page-${Date.now()}-${i}`, password: 'test-only', socialPreference: { create: { enabledAt: new Date(), consentVersion: '2026-09-16' } } } });
      users.push(extra);
      await db.reviewGrant.create({ data: { ownerId: extra.id, reviewerId: b.id, scope: 'expense', activatedAt: new Date() } });
    }
    const ownerPage1 = (await call(b, '/reviewable-owners?page=1&pageSize=20')).data;
    const ownerPage2 = (await call(b, '/reviewable-owners?page=2&pageSize=20')).data;
    assert.equal(ownerPage1.total, 21); assert.equal(ownerPage1.items.length, 20); assert.equal(ownerPage2.items.length, 1);
    assert.equal(new Set([...ownerPage1.items, ...ownerPage2.items].map(item => item.owner.id)).size, 21);
    console.log('PASS social integration: explicit consent, default privacy, search projection, mutual following, private lists, grant direction/scope/history, version conflicts, exit, block races and revocation');
  } finally {
    for (const u of users) await db.user.deleteMany({ where: { id: u.id } });
    await app.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
