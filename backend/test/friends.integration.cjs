const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = new URL(process.env.DATABASE_URL || 'http://missing');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/zhizhang_friends_test') throw new Error('Use isolated localhost zhizhang_friends_test');
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
      users.push(u); await call(u, '/social/enable', 'POST', { consentVersion: '2026-09-17' });
    }
    const [a,b,c] = users;
    const request = (from,to) => call(from, `/social/users/${to.id}/friend-request`, 'POST');
    const accept = (by,id) => call(by, `/social/friend-requests/${id}/accept`, 'POST');
    const profile = async (from,to) => (await call(from, `/social/users/${to.id}`)).data;
    const unfollow = (from,to) => call(from, `/social/following/${to.id}`, 'DELETE');
    assert.equal((await request(null,b)).status,401);
    assert.equal((await request(a,a)).status,400);
    const requests = await Promise.all([request(a,b),request(a,b)]);
    assert.equal(requests[0].status,201);
    const id = requests[0].data.requestId;
    assert.equal(id,requests[1].data.requestId);
    assert.equal((await profile(a,b)).following,true);
    assert.equal((await profile(a,b)).friend,false);
    assert.equal((await profile(a,b)).friendRequestSent,true);
    assert.equal((await profile(b,a)).incomingFriendRequestId,id);
    const received = (await call(b,inbox)).data.items;
    assert.equal(received.filter(e=>e.kind==='friend_request_created').length,1);
    assert.equal(received[0].target.pending,true);
    assert.equal(received[0].preview,null);
    assert.equal((await accept(c,id)).status,404);
    assert.equal((await accept(b,2147483648)).status,404);
    const accepted=await Promise.all([accept(b,id),accept(b,id)]);
    assert(accepted.every(r=>r.status===201));
    assert.equal((await profile(a,b)).friend,true);
    assert.equal(await db.reviewGrant.count(),0);
    assert.equal((await call(a, `/social/owners/${b.id}/bills`)).status,403);
    assert.equal((await call(a,inbox)).data.items.filter(e=>e.kind==='friend_request_accepted').length,1);
    assert.equal((await call(b,inbox)).data.items[0].target.pending,false);
    await unfollow(b,a);
    await accept(b,id); // Replaying a processed request cannot recreate a later-removed friendship.
    assert.equal((await profile(a,b)).friend,false);
    const renewed=(await request(a,b)).data.requestId;
    assert.notEqual(renewed,id);
    await unfollow(a,b);
    assert.equal((await accept(b,renewed)).status,409);
    const fresh=(await request(a,b)).data.requestId;
    assert.notEqual(fresh,renewed);
    assert.equal((await accept(b,renewed)).status,409);
    await call(b, `/social/blocks/${a.id}`, 'PUT');
    assert.equal((await accept(b,fresh)).status,403);
    assert.equal((await request(a,b)).status,403);
    assert.equal((await call(b,inbox)).data.items.length,0);
    await call(b, `/social/blocks/${a.id}`, 'DELETE');
    const beforeDisable=(await request(a,b)).data.requestId;
    await call(a, '/social/enable', 'DELETE');
    assert.equal((await accept(b,beforeDisable)).status,403);
    console.log('PASS: friend request HTTP flow, concurrent dedupe, accept, inbox, privacy, replay, stale generation, block and disable');
  } finally {
    await db.user.deleteMany({where:{id:{in:users.map(u=>u.id)}}});
    await app.close();
  }
})().catch(e=>{console.error(e);process.exitCode=1});

