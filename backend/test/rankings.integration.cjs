// Synthetic fixtures only; never accepts a production URL.
const assert = require('node:assert/strict');
const database = new URL(process.env.DATABASE_URL || 'http://missing');
if (!['127.0.0.1', 'localhost'].includes(database.hostname) || database.pathname !== '/zhizhang_ranking_test') throw new Error('Requires localhost zhizhang_ranking_test');
process.env.JWT_SECRET = 'isolated-ranking-test-secret';
process.env.RANKING_WORKER_DISABLED = '1';
const { NestFactory, APP_GUARD } = require('@nestjs/core');
const { Module, ValidationPipe } = require('@nestjs/common');
const { JwtService } = require('@nestjs/jwt');
const { RankingsModule } = require('../dist/rankings/rankings.module');
const { LedgerModule } = require('../dist/ledger/ledger.module');
const { BillsModule } = require('../dist/bills/bills.module');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { JwtAuthGuard } = require('../dist/auth/jwt-auth.guard');
const { prepareRanking, refreshRanking, changeRankingParticipation } = require('../dist/rankings/ranking-projection');
const { rankingKeys } = require('../dist/rankings/ranking-period');
const { lockSocialUsers } = require('../dist/social/social-access.service');
class Root {}
Module({ imports: [RankingsModule, LedgerModule, BillsModule], providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }] })(Root);

(async () => {
  const app = await NestFactory.create(Root, { logger: ['error'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(), prisma = app.get(PrismaService), users = [];
  const now = new Date(), keys = rankingKeys(now), today = keys.day;
  const yesterday = new Date(new Date(today).getTime() - 86400000).toISOString().slice(0, 10);
  const priorYear = String(Number(keys.year) - 1);
  const oldTime = new Date(`${priorYear}-12-30T04:00:00Z`);
  const jwt = new JwtService();
  async function request(path, user, method = 'GET', body, expected = 200) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${jwt.sign({ sub: user.id }, { secret: process.env.JWT_SECRET })}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    return result.data;
  }
  async function user(name) {
    const u = await prisma.user.create({ data: { username: `rank-${name}-${Date.now()}`, nickname: name, password: 'test-only' } });
    users.push(u); return u;
  }
  async function bill(u, amount, type = 'income', date = today, kind = 'ordinary') {
    const b = await prisma.bill.create({ data: { userId: u.id, amount, type, date: new Date(date) } });
    if (kind) await prisma.billFinancialClassification.create({ data: { billId: b.id, kind, currency: 'CNY', billUpdatedAt: b.updatedAt, reviewedAt: now } });
    return b;
  }
  async function enable(u, scope = 'global') {
    return request('/social/enable', u, 'POST', { consentVersion: '2026-09-17', rankingScope: scope }, 201);
  }
  async function prefs(u, data) { return request('/social/preferences', u, 'PATCH', data); }
  async function follow(a, b) { return request(`/social/following/${b.id}`, a, 'PUT'); }
  const url = (kind = 'year', period = keys.year, scope = 'global', page = 1, size = 20) => `/rankings?kind=${kind}&period=${period}&scope=${scope}&page=${page}&pageSize=${size}`;
  try {
    await prisma.rankingLaunch.upsert({ where: { id: 1 }, create: { id: 1, launchedAt: now }, update: { launchedAt: now } });
    // Initially only current periods exist; raw migration launch time must not backfill old history.
    const alpha = await user('alpha'), bravo = await user('bravo'), charlie = await user('charlie');
    const zero = await user('zero'), negative = await user('negative'), pending = await user('pending'), transfer = await user('transfer'), friendsOnly = await user('friends'), disabled = await user('disabled');
    for (const u of [alpha, bravo]) {
      await bill(u, '40', 'income', `${keys.year}-01-01`);
      await bill(u, '60', 'income', `${keys.year}-01-02`);
    }
    await bill(charlie, '100');
    await bill(zero, '0.1000'); await bill(zero, '0.1000', 'expense');
    await bill(negative, '10', 'expense');
    await bill(pending, '9999', 'income', today, null);
    await bill(transfer, '9999', 'income', today, 'internal_transfer');
    await bill(friendsOnly, '1000');
    for (const u of [alpha, bravo, charlie, zero, negative, pending, transfer]) await enable(u);
    await enable(friendsOnly, 'friends');
    await prisma.rankingLaunch.deleteMany();
    await Promise.all([request('/rankings/periods?kind=year', alpha), request(url(), bravo)]);
    await request(url(), null, 'GET', null, 401);
    await request(url(), disabled, 'GET', null, 403);
    await request(url('day', '2026-02-30'), alpha, 'GET', null, 400);
    await request(url('day', yesterday), alpha, 'GET', null, 400);
    assert.deepEqual((await request('/rankings/periods?kind=year', alpha)).items, [{ period: keys.year, closed: false }]);
    let result = await request(url(), charlie);
    assert.equal(result.total, 6);
    assert.deepEqual(result.items.map(i => i.rank), [1, 2, 2, 4, 5, 6]);
    assert.equal(result.mine.amount, '100.0000');
    assert.equal(result.items.find(i => i.user.id === alpha.id).amount, null);
    assert.equal(result.items.find(i => i.user.id === zero.id).rank, 5);
    result = await request(url('year', keys.year, 'global', 1, 2), charlie);
    assert.equal(result.items.length, 2); assert.equal(result.myPage, 2); assert.equal(result.mine.rank, 4);
    assert.equal((await request(url(), pending)).mineStatus, 'ranked');
    assert.equal((await request(url(), pending)).myPendingCount, 0);
    assert.equal((await request(url(), transfer)).mineStatus, 'no_valid_entries');
    assert.equal((await request(url(), friendsOnly)).mineStatus, 'friends_only');
    await prefs(alpha, { showRankingAmount: true });
    assert.equal((await request(url(), charlie)).items.find(i => i.user.id === alpha.id).amount, '100.0000');
    await follow(alpha, bravo); // one-way is not friendship
    assert.equal((await request(url('year', keys.year, 'friends'), alpha)).total, 1);
    await follow(bravo, alpha); await follow(alpha, friendsOnly); await follow(friendsOnly, alpha);
    result = await request(url('year', keys.year, 'friends'), alpha);
    assert.equal(result.total, 3); assert.equal(result.items[0].user.id, friendsOnly.id);
    await request(`/social/blocks/${bravo.id}`, alpha, 'PUT');
    assert.equal((await request(url(), alpha)).total, 5);
    assert.equal((await request(url('year', keys.year, 'friends'), alpha)).total, 2);
    await request(`/social/blocks/${bravo.id}`, alpha, 'DELETE');
    assert.equal((await request(url('year', keys.year, 'friends'), alpha)).total, 2, 'unblock must not recreate friendship');

    // Time-travel fixtures model a stopped worker. The actual HTTP ledger mutation must seal first.
    await prisma.rankingLaunch.update({ where: { id: 1 }, data: { launchedAt: oldTime } });
    const frozen = await user('frozen');
    const historical = await bill(frozen, '123.4567', 'income', yesterday);
    const oldBill = await bill(frozen, '321', 'income', `${priorYear}-12-30`);
    await prisma.socialPreference.create({ data: { userId: frozen.id, enabledAt: oldTime, consentVersion: '2026-09-17', rankingScope: 'global' } });
    await prisma.$transaction(async tx => {
      await lockSocialUsers(tx, [frozen.id]);
      await changeRankingParticipation(tx, frozen.id, 'global', oldTime);
    });
    await request(`/bills/${historical.id}`, frozen, 'PATCH', { amount: 999 });
    let day = await request(url('day', yesterday), frozen);
    assert.equal(day.mine.amount, '123.4567', 'mutation must freeze pre-change amount even without a worker');
    assert.equal((await request(url(), frozen)).mineStatus, 'ranked', 'bill edits automatically update current-period ranking');
    const edited = await prisma.bill.findUnique({ where: { id: historical.id } });
    await request(`/ledger/bills/${historical.id}/classification`, frozen, 'PUT', { expectedUpdatedAt: edited.updatedAt.toISOString(), kind: 'ordinary', currency: 'CNY' });
    assert.equal((await request(url(), frozen)).mine.amount, '999.0000');
    assert.equal((await request(url('day', yesterday), frozen)).mine.amount, '123.4567');
    assert.equal((await request(url('year', priorYear), frozen)).mine.amount, '321.0000');
    assert.equal((await request(url('month', `${priorYear}-12`), frozen)).mine.amount, '321.0000');
    await request(`/bills/${oldBill.id}`, frozen, 'DELETE');
    assert.equal((await request(url('year', priorYear), frozen)).mine.amount, '321.0000', 'deletion must not rewrite closed years');
    await prefs(frozen, { showRankingAmount: true });
    assert.equal((await request(url('day', yesterday), alpha)).items.find(i => i.user.id === frozen.id).amount, '123.4567');
    await prefs(frozen, { showRankingAmount: false });
    assert.equal((await request(url('day', yesterday), alpha)).items.find(i => i.user.id === frozen.id).amount, null);
    await follow(alpha, frozen); await follow(frozen, alpha);
    assert.ok((await request(url('day', yesterday, 'friends'), alpha)).items.some(i => i.user.id === frozen.id));
    await request(`/social/following/${frozen.id}`, alpha, 'DELETE');
    assert.ok(!(await request(url('day', yesterday, 'friends'), alpha)).items.some(i => i.user.id === frozen.id));
    await prefs(frozen, { rankingScope: 'none' });
    assert.equal((await request(url('day', yesterday), frozen)).mine, null);
    await prefs(frozen, { rankingScope: 'global' });
    assert.equal((await request(url('day', yesterday), frozen)).mine, null, 're-entry must not restore closed participation');
    assert.equal((await request(url(), frozen)).mine.amount, '999.0000');

    // All application writers refresh the open-period projection; empty and pending states never leak a stale rank.
    const created = await prisma.createBill({ userId: frozen.id, amount: 10, type: 'income', date: new Date(today) });
    assert.equal((await request(url(), frozen)).mineStatus, 'ranked');
    await prisma.deleteBill(created.id, frozen.id);
    assert.equal((await request(url(), frozen)).mine.amount, '999.0000');
    await prisma.updateBill(historical.id, { amount: 900 }, frozen.id);
    assert.equal((await request(url(), frozen)).mineStatus, 'ranked');
    await request(`/bills/${historical.id}`, frozen, 'DELETE');
    assert.equal((await request(url(), frozen)).mineStatus, 'no_valid_entries');

    // Projections read every page, keep decimal precision, and rollback with their parent transaction.
    const many = await user('many');
    await prisma.bill.createMany({ data: Array.from({ length: 503 }, () => ({ userId: many.id, amount: '0.0001', type: 'income', date: new Date(today) })) });
    const small = await prisma.bill.findMany({ where: { userId: many.id } });
    await prisma.billFinancialClassification.createMany({ data: small.map(b => ({ billId: b.id, kind: 'ordinary', currency: 'CNY', billUpdatedAt: b.updatedAt, reviewedAt: now })) });
    await enable(many);
    assert.equal((await request(url(), many)).mine.amount, '0.0503');
    await assert.rejects(prisma.$transaction(async tx => {
      await lockSocialUsers(tx, [many.id]); const captured = new Date();
      await prepareRanking(tx, many.id, captured);
      await tx.bill.deleteMany({ where: { userId: many.id } });
      await refreshRanking(tx, many.id, captured);
      throw new Error('injected transaction failure');
    }), /injected/);
    assert.equal((await request(url(), many)).mine.amount, '0.0503');
    await Promise.all([
      prefs(many, { rankingScope: 'none' }),
      prisma.createBill({ userId: many.id, amount: 1, type: 'income', date: new Date(today) }),
    ]);
    assert.equal(await prisma.rankingState.count({ where: { userId: many.id } }), 0);
    assert.equal(await prisma.rankingResult.count({ where: { userId: many.id } }), 0);
    assert.equal((await request(url(), many)).mineStatus, 'not_participating');
    await prefs(many, { rankingScope: 'global' });
    assert.equal((await request(url(), many)).mineStatus, 'ranked');

    const late = await user('late-confirmation');
    const lateBill = await bill(late, '80', 'income', yesterday, null);
    const yesterdayTime = new Date(`${yesterday}T04:00:00Z`);
    await prisma.socialPreference.create({ data: { userId: late.id, enabledAt: yesterdayTime, consentVersion: '2026-09-17', rankingScope: 'global' } });
    await prisma.$transaction(async tx => {
      await lockSocialUsers(tx, [late.id]);
      await changeRankingParticipation(tx, late.id, 'global', yesterdayTime);
    });
    await request(`/ledger/bills/${lateBill.id}/classification`, late, 'PUT', { expectedUpdatedAt: lateBill.updatedAt.toISOString(), kind: 'ordinary', currency: 'CNY' });
    assert.equal((await request(url('day', yesterday), late)).mineStatus, 'ranked', 'unclassified bills already participated before the period closed');
    assert.equal((await request(url(), late)).mine.amount, '80.0000');

    const cash = await user('cash');
    await bill(cash, '20', 'expense'); await bill(cash, '5', 'income', today, 'refund');
    await bill(cash, '9999', 'income', today, 'adjustment'); await bill(cash, '9999', 'income', today, 'ignored');
    await enable(cash);
    assert.equal((await request(url(), cash)).mine.amount, '-15.0000');
    await request('/bills', cash, 'POST', { amount: 1, type: 'income', date: today }, 201);
    assert.equal((await request(url(), cash)).mineStatus, 'ranked', 'HTTP bill creation refreshes the projection');
    // The optional community never gates normal ledger totals or needs per-bill confirmation.
    const ledgerUrl = `/ledger/summary?startDate=${today}&endDate=${today}`;
    const beforeDisable = await request(ledgerUrl, cash);
    const savedBillCount = await prisma.bill.count({where:{userId:cash.id}});
    await request('/social/enable', cash, 'DELETE');
    assert.equal((await request('/social/me',cash)).enabled,false);
    assert.equal(await prisma.rankingResult.count({where:{userId:cash.id}}),0);
    assert.deepEqual(await request(ledgerUrl,cash),beforeDisable);
    assert.equal(await prisma.bill.count({where:{userId:cash.id}}),savedBillCount);
    await request(url(),cash,'GET',null,403);
    const reenabling = await request('/social/enable',cash,'POST',{consentVersion:'2026-09-17'},201);
    assert.equal(reenabling.rankingScope,'global');
    assert.equal((await request(url(),cash)).mine.amount,'-14.0000');
    assert.deepEqual(await request(ledgerUrl,cash),beforeDisable);
    console.log('Rankings integration passed: privacy, ties, zero/negative, pagination, UTC+8 history, pre-write sealing, re-entry, all writers, 503 bills, rollback.');
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: users.map(u => u.id) } } });
    await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
