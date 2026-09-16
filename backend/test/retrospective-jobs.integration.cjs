const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const database = new URL(process.env.DATABASE_URL || 'http://missing');
if (database.hostname !== '127.0.0.1' || database.port !== '15449' || database.pathname !== '/zhizhang_report_test') throw Error('Requires isolated report test DB with migration 013 installed');
process.env.JWT_SECRET = 'synthetic-report-test-secret'; process.env.RETROSPECTIVE_WORKER_DISABLED = '1';
const { NestFactory, APP_GUARD } = require('@nestjs/core');
const { Module, ValidationPipe } = require('@nestjs/common');
const { JwtService } = require('@nestjs/jwt');
const { AuthModule } = require('../dist/auth/auth.module');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard');
const { BudgetsModule } = require('../dist/budgets/budgets.module');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { RetrospectiveController } = require('../dist/ai/retrospective.controller');
const { AIConfigService } = require('../dist/ai/ai-config.service');
const { RetrospectiveEvidenceService } = require('../dist/ai/services/retrospective-evidence.service');
const { RetrospectiveGeneratorService } = require('../dist/ai/services/retrospective-generator.service');
const { RetrospectiveJobsService } = require('../dist/ai/services/retrospective-jobs.service');
const { ClaudeAdapter, OpenAIAdapter, DeepSeekAdapter, QwenAdapter } = require('../dist/ai/adapters');
class Root {}
Module({ imports: [AuthModule, BudgetsModule], controllers: [RetrospectiveController], providers: [
  AIConfigService, RetrospectiveEvidenceService, RetrospectiveGeneratorService, RetrospectiveJobsService,
  ClaudeAdapter, OpenAIAdapter, DeepSeekAdapter, QwenAdapter, { provide: APP_GUARD, useClass: JwtAuthGuard },
] })(Root);
let mode = 'ok', modelCalls = 0, release, entered;
const model = http.createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString()), input = JSON.parse(body.messages[1].content);
  modelCalls++; assert.equal(body.tools, undefined);
  if (mode === 'error') { res.writeHead(503); res.end('private-upstream-text'); return; }
  const finish = () => {
    const friend = input.feedback.find(m => m.role === 'reviewer');
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      friendViews: friend ? [{ ref: friend.ref, quote: friend.text }] : [],
      analysis: [{ text: '可以检查消费安排', citations: ['B1'] }], actions: [{ text: '提前安排工作餐', citations: ['B1'] }],
    }) }, finish_reason: 'stop' }] }));
  };
  if (mode === 'hold') { release = finish; entered(); } else finish();
});
(async () => {
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
  const app = await NestFactory.create(Root, { logger: ['error'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(), db = app.get(PrismaService), jobs = app.get(RetrospectiveJobsService), users = [];
  const jwt = new JwtService();
  async function request(path, user, method = 'GET', body, expected = 200) {
    const response = await fetch(`${base}/ai/retrospectives${path}`, { method, headers: { 'content-type': 'application/json', ...(user ? { authorization: `Bearer ${jwt.sign({ sub: user.id }, { secret: process.env.JWT_SECRET })}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result.data;
  }
  try {
    async function user(name) { const u = await db.user.create({ data: { username: `${name}-${randomUUID()}`, password: 'test', socialPreference: { create: { enabledAt: new Date(), consentVersion: '2026-09-16', allowAiFeedback: true, allowAiAuthoredFeedback: true } } } }); users.push(u.id); return u; }
    const owner = await user('report-owner'), friend = await user('report-friend');
    const config = await db.aIModelConfig.create({ data: { userId: owner.id, name: 'synthetic', provider: 'openai', model: 'synthetic', apiKey: 'test-only', apiBaseUrl: `http://127.0.0.1:${model.address().port}`, isDefault: true } });
    const bill = await db.bill.create({ data: { userId: owner.id, date: new Date('2020-02-10'), amount: '25.0000', type: 'expense' } });
    await db.billFinancialClassification.create({ data: { billId: bill.id, kind: 'ordinary', currency: 'CNY', billUpdatedAt: bill.updatedAt, reviewedAt: new Date() } });
    const thread = await db.billReviewThread.create({ data: { ownerId: owner.id, reviewerId: friend.id, billId: bill.id, originalBillId: bill.id, vote: 'la', snapshot: {}, initialBillUpdatedAt: bill.updatedAt, snapshotUpdatedAt: bill.updatedAt } });
    const message = await db.reviewMessage.create({ data: { threadId: thread.id, authorId: friend.id, clientKey: randomUUID(), mainSlot: 1, body: '可减少外卖' } });
    const dto = () => ({ clientKey: randomUUID(), kind: 'day', period: '2020-02-10' });
    await request('', null, 'GET', null, 401);
    await request('', friend, 'POST', { ...dto(), configId: config.id }, 400);
    const first = dto(), created = await Promise.all([request('', owner, 'POST', first, 201), request('', owner, 'POST', first, 201)]);
    assert.equal(created[0].id, created[1].id); const id = created[0].id;
    await request('', owner, 'POST', dto(), 409);
    await request(`/${id}`, friend, 'GET', null, 404);
    assert.equal((await request('', friend)).total, 0);
    assert.equal((await Promise.all([jobs.runOne(), jobs.runOne()])).filter(Boolean).length, 1);
    assert.equal(modelCalls, 1);
    let detail = await request(`/${id}`, owner);
    assert.equal(detail.status, 'succeeded'); assert.equal(detail.sourceChanged, false);
    assert.equal(detail.result.report.facts.grossExpense, '25.0000');
    assert.ok(!JSON.stringify(detail).includes('test-only'));
    assert.equal(detail.result.sources, undefined);
    assert.ok(!JSON.stringify(detail.result).includes(friend.id));
    assert.ok(detail.result.references.some(ref => ref.kind === 'message' && ref.id === message.id));
    await db.bill.update({ where: { id: bill.id }, data: { amount: 30 } });
    detail = await request(`/${id}`, owner);
    assert.equal(detail.sourceChanged, true); assert.equal(detail.result.report.facts.grossExpense, '25.0000');
    await db.reviewMessage.update({ where: { id: message.id }, data: { hidden: true } });
    assert.equal((await db.retrospectiveJob.findUnique({ where: { id } })).result, null);
    await db.reviewMessage.update({ where: { id: message.id }, data: { hidden: false } });
    detail = await request(`/${id}`, owner); assert.equal(detail.status, 'invalidated'); assert.equal(detail.result, null);

    mode = 'hold'; const waiting = new Promise(resolve => { entered = resolve; });
    const inFlight = await request('', owner, 'POST', dto(), 201), running = jobs.runOne();
    await waiting;
    assert.ok((await db.retrospectiveJob.findUnique({ where: { id: inFlight.id } })).sources.length);
    await db.socialPreference.update({ where: { userId: friend.id }, data: { allowAiAuthoredFeedback: false } });
    await db.socialPreference.update({ where: { userId: friend.id }, data: { allowAiAuthoredFeedback: true } });
    release(); await running;
    assert.equal((await request(`/${inFlight.id}`, owner)).status, 'invalidated');

    mode = 'error'; const retry = await request('', owner, 'POST', dto(), 201); await jobs.runOne();
    detail = await request(`/${retry.id}`, owner); assert.equal(detail.status, 'failed'); assert.equal(detail.result, null);
    await request(`/${retry.id}/retry`, owner, 'POST', {}, 201);
    mode = 'ok'; await jobs.runOne(); detail = await request(`/${retry.id}`, owner);
    assert.equal(detail.status, 'succeeded'); assert.equal(detail.attempts, 2);
    await db.reviewMessage.update({ where: { id: message.id }, data: { body: '新的建议', revision: { increment: 1 } } });
    detail = await request(`/${retry.id}`, owner);
    assert.equal(detail.sourceChanged, true); assert.equal(detail.result.report.friendViews[0].quote, '可减少外卖');
    await db.reviewMessage.update({ where: { id: message.id }, data: { withdrawn: true } });
    assert.equal((await request(`/${retry.id}`, owner)).status, 'invalidated');
    await db.reviewMessage.update({ where: { id: message.id }, data: { withdrawn: false } });

    mode = 'hold'; const deletingWait = new Promise(resolve => { entered = resolve; });
    const deleteDto = dto(), deleting = await request('', owner, 'POST', deleteDto, 201), deleteRun = jobs.runOne();
    await deletingWait; await request(`/${deleting.id}`, owner, 'DELETE'); await deleteRun;
    await request(`/${deleting.id}`, owner, 'GET', null, 404);
    assert.equal((await request('', owner, 'POST', deleteDto, 201)).status, 'deleted');
    assert.equal((await db.retrospectiveJob.findUnique({ where: { id: deleting.id } })).sources, null);

    mode = 'ok'; const expired = await request('', owner, 'POST', dto(), 201);
    await db.retrospectiveJob.update({ where: { id: expired.id }, data: { status: 'running', leaseToken: randomUUID(), leaseUntil: new Date(0), attempts: 1 } });
    await jobs.runOne(); assert.equal((await request(`/${expired.id}`, owner)).errorCode, 'interrupted');
    await request(`/${expired.id}/retry`, owner, 'POST', {}, 201); await jobs.runOne();
    assert.equal((await request(`/${expired.id}`, owner)).status, 'succeeded');
    await db.user.update({ where: { id: friend.id }, data: { isActive: false } });
    await db.user.update({ where: { id: friend.id }, data: { isActive: true } });
    assert.equal((await request(`/${expired.id}`, owner)).status, 'invalidated');
    await db.retrospectiveJob.createMany({ data: Array.from({ length: 21 }, () => ({ id: randomUUID(), userId: owner.id, clientKey: randomUUID(), configId: config.id, kind: 'day', period: '2020-02-10', status: 'failed', updatedAt: new Date() })) });
    const page1 = await request('?page=1&pageSize=20', owner), page2 = await request('?page=2&pageSize=20', owner);
    assert.equal(page1.items.length, 20); assert.ok(page2.items.length > 0);
    assert.ok(page1.items.every(x => !('result' in x) && !('sources' in x)));
    assert.equal(new Set([...page1.items, ...page2.items].map(x => x.id)).size, page1.total);
    await request('', owner, 'POST', dto(), 400);
    const automatic = await db.retrospectiveJob.create({ data: { userId: owner.id, clientKey: randomUUID(), configId: config.id, kind: 'day', period: '2020-02-10' } });
    delete process.env.RETROSPECTIVE_WORKER_DISABLED; jobs.onModuleInit();
    let automaticStatus;
    for (let i = 0; i < 12; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      automaticStatus = (await db.retrospectiveJob.findUnique({ where: { id: automatic.id } })).status;
      if (automaticStatus === 'succeeded') break;
    }
    assert.equal(automaticStatus, 'succeeded');
    console.log('Report HTTP/DB lifecycle passed: idempotency, concurrent claim, ownership, immutable history, permanent invalidation, in-flight revoke/delete, retry, lease recovery, pagination and limits.');
  } finally { await db.user.deleteMany({ where: { id: { in: users } } }); await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { model.closeAllConnections(); model.close(); });
