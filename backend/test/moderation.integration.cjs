const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = new URL(process.env.DATABASE_URL || 'http://missing');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/zhizhang_moderation_test') throw new Error('Use isolated localhost zhizhang_moderation_test');
process.env.JWT_SECRET = 'moderation-test-user-secret';
process.env.ADMIN_JWT_SECRET = 'moderation-test-admin-secret';
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory, APP_GUARD } = require('@nestjs/core');
const { JwtService } = require('@nestjs/jwt');
const { ModerationModule } = require('../dist/moderation/moderation.module');
const { BillsModule } = require('../dist/bills/bills.module');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard');
class Root {}
Module({ imports: [ModerationModule, BillsModule], providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }] })(Root);
(async () => {
  const app = await NestFactory.create(Root, { logger: ['error'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(), db = app.get(PrismaService), users = [], reports = [], jwt = new JwtService();
  const call = async (u, path, method = 'GET', body) => {
    const token = u === 'admin' ? jwt.sign({ scope: 'admin', username: 'test-admin' }, { secret: process.env.ADMIN_JWT_SECRET }) : u ? jwt.sign({ sub: u.id }, { secret: process.env.JWT_SECRET }) : '';
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await r.json(); return { status: r.status, data: r.ok ? data.data : data };
  };
  const message = body => ({ clientKey: randomUUID(), body });
  const reportBody = { expectedRevision: 1, reason: '包含人身攻击', acceptDisclosure: true, disclosureVersion: '2026-09-16' };
  try {
    for (let i = 0; i < 3; i++) {
      const u = await db.user.create({ data: { username: 'moderation-' + randomUUID(), password: 'test-only', nickname: '测试' + i } });
      users.push(u); assert.equal((await call(u, '/social/enable', 'POST', { consentVersion: '2026-09-17' })).status, 201);
    }
    const [a, b, c] = users;
    const bill = await db.bill.create({ data: { userId: a.id, amount: '16', type: 'expense', date: new Date('2026-09-16'), notes: '不应披露的账单备注' } });
    const threads = [], mains = [];
    for (const u of [b, c]) {
      await call(a, '/social/grants/given/' + u.id, 'PUT', { scope: 'expense', historyStart: '2020-01-01' });
      const t = (await call(u, `/reviews/bills/${bill.id}/vote`, 'PUT', { vote: 'hang' })).data.threadId;
      threads.push(t); mains.push((await call(u, `/reviews/threads/${t}/main`, 'POST', message(u === b ? '举报目标原文' : '其他评价者秘密'))).data);
    }
    const [t, ct] = threads, [m, cm] = mains;
    const reportPath = `/review-reports/threads/${t}/messages/${m.id}`;
    assert.equal((await call(null, reportPath)).status, 401);
    assert.equal((await call(c, reportPath)).status, 404);
    assert.equal((await call(b, reportPath)).status, 400);
    const preview = (await call(a, reportPath)).data;
    assert.equal(preview.message.body, '举报目标原文');
    assert.equal(preview.disclosureVersion, '2026-09-16');
    assert(!JSON.stringify(preview).includes('其他评价者秘密'));
    assert.equal((await call(null, reportPath, 'POST', reportBody)).status, 401);
    assert.equal((await call(c, reportPath, 'POST', reportBody)).status, 404);
    assert.equal((await call(b, reportPath, 'POST', reportBody)).status, 400);
    assert.equal((await call(a, reportPath, 'POST', { ...reportBody, acceptDisclosure: false })).status, 400);
    assert.equal((await call(a, reportPath, 'POST', { expectedRevision: 1, reason: '缺少同意' })).status, 400);
    assert.equal((await call(a, reportPath, 'POST', { ...reportBody, disclosureVersion: 'old' })).status, 400);
    assert.equal((await call(a, reportPath, 'POST', { ...reportBody, expectedRevision: 2 })).status, 409);
    await call(a, `/reviews/threads/${t}/replies`, 'POST', message('同一线程上下文'));
    const id = (await call(a, reportPath, 'POST', reportBody)).data.id; reports.push(id);
    assert.equal((await call(a, reportPath, 'POST', reportBody)).data.id, id);
    assert.equal((await db.reviewMessage.findUnique({ where: { id: m.id } })).hidden, false);
    assert.equal((await call(a, '/admin-api/moderation')).status, 401);
    assert.equal((await call(null, `/admin-api/moderation/${id}/evidence`)).status, 401);
    await call(b, `/reviews/threads/${t}/messages/${m.id}`, 'PATCH', { action: 'edit', expectedRevision: 1, body: '举报之后编辑的内容' });
    const evidence = (await call('admin', `/admin-api/moderation/${id}/evidence?pageSize=1`)).data;
    assert.equal(evidence.total, 2); assert.equal(evidence.pages, 2);
    assert.equal(evidence.items[0].body, '举报目标原文');
    assert.equal(evidence.items[0].versions[0].body, '举报目标原文');
    assert(!JSON.stringify(evidence).includes('其他评价者秘密')); assert(!JSON.stringify(evidence).includes('不应披露'));
    assert.equal((await call('admin', `/admin-api/moderation/${id}/evidence?page=2&pageSize=1`)).data.items[0].body, '同一线程上下文');
    assert.equal(await db.reviewModerationAudit.count({ where: { reportId: id, action: 'view_evidence' } }), 2);
    const decision = { status: 'upheld', reason: '审核确认违规，隐藏该文字' };
    assert.equal((await call('admin', `/admin-api/moderation/${id}/decision`, 'POST', decision)).status, 201);
    assert.equal((await call('admin', `/admin-api/moderation/${id}/decision`, 'POST', decision)).status, 201);
    assert.equal((await call('admin', `/admin-api/moderation/${id}/decision`, 'POST', { status: 'dismissed', reason: '另一判断' })).status, 409);
    assert.equal(await db.reviewModerationAudit.count({ where: { reportId: id, action: 'upheld' } }), 1);
    assert.equal(await db.socialInboxEvent.count({ where: { dedupeKey: { startsWith: `review-report:${id}:` } } }), 2);
    assert.equal((await call(a, `/reviews/threads/${t}`)).data.messages[0].body, null);
    assert.equal((await call(a, reportPath)).status, 400);
    assert.equal((await call(a, `/reviews/threads/${t}/messages/${m.id}/versions`)).status, 403);
    assert.equal((await call(b, `/reviews/threads/${t}/messages/${m.id}`, 'PATCH', { action: 'restore', expectedRevision: 2 })).status, 403);
    assert.equal((await call(a, `/reviews/threads/${t}/replies`, 'POST', message('隐藏主评后可继续回复'))).status, 201);
    assert.equal((await call(a, `/reviews/bills/${bill.id}/summary`)).data.hang, 2);
    assert(!JSON.stringify((await call(a, '/review-reports')).data).includes('举报目标原文'));
    assert.equal((await call(b, '/review-reports')).data.length, 0);
    const id2 = (await call(a, `/review-reports/threads/${ct}/messages/${cm.id}`, 'POST', reportBody)).data.id; reports.push(id2);
    const races = await Promise.all(['dismissed', 'upheld'].map(status => call('admin', `/admin-api/moderation/${id2}/decision`, 'POST', { status, reason: status })));
    assert.deepEqual(races.map(r => r.status).sort(), [201, 409]);
    const ownerReply = (await call(a, `/reviews/threads/${t}/replies`, 'POST', message('可正常保留的回复'))).data;
    const id3 = (await call(b, `/review-reports/threads/${t}/messages/${ownerReply.id}`, 'POST', reportBody)).data.id; reports.push(id3);
    assert.equal((await call('admin', `/admin-api/moderation/${id3}/decision`, 'POST', { status: 'dismissed', reason: '不构成违规' })).status, 201);
    assert.equal((await db.reviewMessage.findUnique({ where: { id: ownerReply.id } })).hidden, false);
    const dismissedEvents = await db.socialInboxEvent.findMany({ where: { dedupeKey: { startsWith: `review-report:${id3}:` } } });
    assert.equal(dismissedEvents.length, 1); assert.equal(dismissedEvents[0].userId, b.id);
    // Rate limits apply across threads, include decided reports, and remain race-safe.
    const extraBill = await db.bill.create({ data: { userId: a.id, amount: 1, type: 'expense', date: new Date('2026-09-16') } });
    const extraThread = (await call(c, `/reviews/bills/${extraBill.id}/vote`, 'PUT', { vote: 'hang' })).data.threadId;
    await call(c, `/reviews/threads/${extraThread}/main`, 'POST', message('另一笔账单'));
    const targets = [];
    for (const tid of [ct, extraThread]) {
      const row = (await call(a, `/reviews/threads/${tid}/replies`, 'POST', message('限额测试内容'))).data;
      targets.push(`/review-reports/threads/${tid}/messages/${row.id}`);
    }
    const seedReports = async count => {
      for (let i = 0; i < count; i++) {
        const row = await db.reviewReport.create({ data: { reporterId: c.id, originalMessageId: -Math.floor(Math.random() * 2000000000),
          reportedRevision: 1, ownerId: a.id, reviewerId: c.id, authorId: a.id, reason: '合成限额记录',
          disclosureVersion: '2026-09-16', status: 'dismissed', createdAt: new Date(Date.now() - 7200000) } });
        reports.push(row.id);
      }
    };
    await seedReports(4);
    await db.reviewReport.updateMany({ where: { reporterId: c.id }, data: { createdAt: new Date() } });
    const hourRace = await Promise.all(targets.map(path => call(c, path, 'POST', reportBody)));
    assert.deepEqual(hourRace.map(r => r.status).sort(), [201, 429]);
    const hourWinner = hourRace.findIndex(r => r.status === 201);
    reports.push(hourRace[hourWinner].data.id);
    assert.equal((await call(c, targets[hourWinner], 'POST', reportBody)).data.id, hourRace[hourWinner].data.id);
    assert.equal(await db.reviewReport.count({ where: { reporterId: c.id } }), 5);
    await db.reviewReport.updateMany({ where: { reporterId: c.id }, data: { createdAt: new Date(Date.now() - 7200000) } });
    await seedReports(14);
    const more = (await call(a, `/reviews/threads/${extraThread}/replies`, 'POST', message('日限额测试'))).data;
    const dayTargets = [targets[1 - hourWinner], `/review-reports/threads/${extraThread}/messages/${more.id}`];
    const dayRace = await Promise.all(dayTargets.map(path => call(c, path, 'POST', reportBody)));
    assert.deepEqual(dayRace.map(r => r.status).sort(), [201, 429]);
    const dayWinner = dayRace.findIndex(r => r.status === 201);
    reports.push(dayRace[dayWinner].data.id);
    assert.equal((await call(c, dayTargets[dayWinner], 'POST', reportBody)).data.id, dayRace[dayWinner].data.id);
    assert.equal(await db.reviewReport.count({ where: { reporterId: c.id } }), 20);
    assert.equal(await db.reviewReportEvidence.count({ where: { report: { reporterId: c.id, originalMessageId: more.id } } }), dayWinner === 1 ? 3 : 0);
    await db.reviewReport.updateMany({ where: { reporterId: c.id }, data: { createdAt: new Date(Date.now() - 90000000) } });
    const afterWindow = await call(c, dayTargets[1 - dayWinner], 'POST', reportBody);
    assert.equal(afterWindow.status, 201); reports.push(afterWindow.data.id);
    await call(a, `/bills/${bill.id}`, 'DELETE');
    await db.user.delete({ where: { id: a.id } });
    const retained = (await call('admin', `/admin-api/moderation/${id}/evidence`)).data;
    assert.equal(retained.report.reporterId, null); assert.equal(retained.report.messageId, null);
    assert.equal(retained.items[0].body, '举报目标原文');
    console.log('PASS moderation: disclosure, isolation, immutable evidence, admin guard, audit, pagination, hiding/history, concurrent decisions, idempotent events, deletion survival, cross-thread hourly/daily limit races, replay and window expiry');
  } finally {
    await db.reviewReport.deleteMany({ where: { id: { in: reports } } });
    for (const u of users) await db.user.deleteMany({ where: { id: u.id } });
    await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
