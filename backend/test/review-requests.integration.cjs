const assert = require('node:assert/strict');
const url = new URL(process.env.DATABASE_URL || 'http://missing');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/zhizhang_social_test') throw new Error('Use an isolated localhost zhizhang_social_test database');
process.env.JWT_SECRET = 'isolated-social-request-test-secret';
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
  const call = async (u, path, body, method = 'POST') => {
    const token = u ? jwt.sign({ sub: u.id }, { secret: process.env.JWT_SECRET }) : null;
    const response = await fetch(base + '/social' + path, { method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    return { status: response.status, data: response.ok ? data.data : data };
  };
  try {
    for (let i = 0; i < 13; i++) {
      const user = await db.user.create({ data: { username: `request-${Date.now()}-${i}`, password: 'test-only' } });
      users.push(user);
      assert.equal((await call(user, '/enable', { consentVersion: '2026-09-16' })).status, 201);
    }
    const [applicant, ...owners] = users;
    const request = owner => db.reviewRequest.findUnique({ where: { ownerId_applicantId: { ownerId: owner.id, applicantId: applicant.id } } });
    const pref = () => db.socialPreference.findUnique({ where: { userId: applicant.id } });
    const submit = (owner, body = {}) => call(applicant, '/requests/to/' + owner.id, body);
    const reject = async owner => call(owner, `/requests/from/${applicant.id}/reject`, { expectedVersion: (await request(owner)).version });
    assert.equal((await call(null, '/requests/to/' + owners[0].id, {})).status, 401);
    assert.equal((await submit(applicant)).status, 400);
    const parallel = await Promise.all(owners.slice(0, 11).map(owner => submit(owner)));
    assert.equal(parallel.filter(r => r.status === 201).length, 10);
    assert.equal(parallel.filter(r => r.status === 409).length, 1);
    const pendingOwners = owners.slice(0, 11).filter((_, i) => parallel[i].status === 201);
    const [o0, o1, o2, o3, o4, o5] = pendingOwners;
    const initial = await request(o0);
    assert.equal((await submit(o0)).data.version, initial.version);
    assert.equal(await db.socialInboxEvent.count({ where: { userId: o0.id, kind: 'review_request_pending' } }), 1);
    const withdrawn = await call(applicant, `/requests/to/${o0.id}/withdraw`, { expectedVersion: initial.version });
    assert.equal(withdrawn.data.status, 'withdrawn');
    assert.equal((await call(applicant, `/requests/to/${o0.id}/withdraw`, { expectedVersion: initial.version })).status, 201);
    assert.equal((await pref()).requestRejectStreak, 0);
    assert.equal((await submit(o0)).status, 409); // a delayed old POST cannot reopen a finished cycle
    const reopened = await submit(o0, { expectedVersion: withdrawn.data.version });
    assert.equal(reopened.data.status, 'pending');
    assert.equal((await call(applicant, `/requests/to/${o0.id}/withdraw`, { expectedVersion: initial.version })).status, 409);
    assert.equal((await call(owners[11], `/requests/from/${applicant.id}/reject`, { expectedVersion: reopened.data.version })).status, 404);
    await reject(o0);
    assert.equal((await pref()).requestRejectStreak, 1);
    const replay = await call(o0, `/requests/from/${applicant.id}/reject`, { expectedVersion: reopened.data.version });
    assert.equal(replay.status, 201); assert.equal((await pref()).requestRejectStreak, 1);
    const beforeWithdrawal = await request(o1);
    const w1 = await call(applicant, `/requests/to/${o1.id}/withdraw`, { expectedVersion: beforeWithdrawal.version });
    assert.equal((await pref()).requestRejectStreak, 1); // withdraw neither resets nor increments
    await submit(o1, { expectedVersion: w1.data.version });
    await reject(o1); assert.equal((await pref()).requestRejectStreak, 2);
    await reject(o2);
    const cooling = await pref();
    assert.equal(cooling.requestRejectStreak, 3);
    assert(cooling.requestCooldownUntil.getTime() > Date.now() + 23.9 * 3600000);
    assert.equal(await db.reviewRequest.count({ where: { applicantId: applicant.id, status: 'pending' } }), 0);
    assert.equal(await db.reviewRequest.count({ where: { applicantId: applicant.id, status: 'system_cancelled' } }), 7);
    assert.equal((await submit(owners[11])).status, 403);
    const cancelled = await request(o3);
    assert.equal((await call(o3, `/requests/from/${applicant.id}/approve`, { expectedVersion: cancelled.version - 1, scope: 'expense' })).status, 409);
    // Simulate elapsed time, not a production escape hatch; a new application starts a fresh cooldown cycle.
    await db.socialPreference.update({ where: { userId: applicant.id }, data: { requestCooldownUntil: new Date(Date.now() - 1000) } });
    const newCycle = await submit(o3, { expectedVersion: cancelled.version });
    assert.equal(newCycle.status, 201); assert.equal((await pref()).requestRejectStreak, 0);
    await db.socialPreference.update({ where: { userId: applicant.id }, data: { requestRejectStreak: 2 } });
    const approveDto = { expectedVersion: newCycle.data.version, scope: 'income', historyStart: '2026-09-01' };
    assert.equal((await call(o3, `/requests/from/${applicant.id}/approve`, approveDto)).data.status, 'approved');
    assert.equal((await call(o3, `/requests/from/${applicant.id}/approve`, approveDto)).status, 201);
    assert.equal((await pref()).requestRejectStreak, 0);
    const grant = await db.reviewGrant.findUnique({ where: { ownerId_reviewerId: { ownerId: o3.id, reviewerId: applicant.id } } });
    assert.equal(grant.scope, 'income'); assert.equal(grant.status, 'active');
    assert.equal(await db.socialFollow.count({ where: { followerId: applicant.id } }), 0);
    assert.equal((await submit(o3, { expectedVersion: (await request(o3)).version })).status, 409);
    // Direct grants resolve a pending application instead of leaving contradictory states.
    await submit(o4, { expectedVersion: (await request(o4)).version });
    assert.equal((await call(o4, '/grants/given/' + applicant.id, { scope: 'expense' }, 'PUT')).status, 200);
    assert.equal((await request(o4)).status, 'approved');
    // Blocking cancels pending requests and a stale approval cannot restore permissions.
    const rb = await submit(o5, { expectedVersion: (await request(o5)).version });
    await call(applicant, '/blocks/' + o5.id, undefined, 'PUT');
    assert.equal((await request(o5)).status, 'system_cancelled');
    assert.equal((await call(o5, `/requests/from/${applicant.id}/approve`, { expectedVersion: rb.data.version, scope: 'expense' })).status, 403);
    assert.equal(await db.socialInboxEvent.count({ where: { userId: applicant.id, kind: 'review_request_approved' } }), 2);
    assert.equal(await db.socialInboxEvent.count({ where: { userId: applicant.id, kind: 'review_request_rejected' } }), 3);
    const competingOwner = pendingOwners[6];
    const competing = await submit(competingOwner, { expectedVersion: (await request(competingOwner)).version });
    const terminalRace = await Promise.all([
      call(competingOwner, `/requests/from/${applicant.id}/approve`, { expectedVersion: competing.data.version, scope: 'expense' }),
      call(competingOwner, `/requests/from/${applicant.id}/reject`, { expectedVersion: competing.data.version }),
    ]);
    assert.deepEqual(terminalRace.map(result => result.status).sort(), [201, 409]);
    const final = await request(competingOwner);
    const finalGrant = await db.reviewGrant.findUnique({ where: { ownerId_reviewerId: { ownerId: competingOwner.id, reviewerId: applicant.id } } });
    assert.equal(finalGrant?.status === 'active', final.status === 'approved');
    console.log('PASS request integration: concurrent global limit, duplicate events, stale retries, withdraw, three rejections, cooldown cancellation/expiry, approval reset, direct grants and block isolation');
  } finally {
    for (const user of users) await db.user.deleteMany({ where: { id: user.id } });
    await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
