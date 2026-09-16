const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const database = new URL(process.env.DATABASE_URL || 'http://missing');
if (database.hostname !== '127.0.0.1' || database.port !== '15448' || database.pathname !== '/zhizhang_evidence_test') throw Error('Requires isolated evidence test DB');
const { PrismaClient } = require('@prisma/client');
const { BudgetHistoryService } = require('../dist/budgets/budget-history.service');
const { RetrospectiveEvidenceService } = require('../dist/ai/services/retrospective-evidence.service');
const db = new PrismaClient(), service = new RetrospectiveEvidenceService(db, new BudgetHistoryService(db));
const users = [];
(async () => {
  async function user(name, authored = false) {
    const result = await db.user.create({ data: { username: `${name}-${randomUUID()}`, password: 'test-only', socialPreference: { create: {
      enabledAt: new Date(), consentVersion: '2026-09-17', allowAiFeedback: true, allowAiAuthoredFeedback: authored,
    } } } }); users.push(result.id); return result;
  }
  const owner = await user('owner', true), friend = await user('friend', true), noConsent = await user('no-consent'), other = await user('other');
  const category = await db.category.create({ data: { name: '餐饮', type: 'expense', userId: owner.id } });
  const stamp = new Date('2020-02-10T00:00:00Z');
  await db.bill.createMany({ data: Array.from({ length: 501 }, (_, i) => ({ userId: owner.id, amount: '0.1001', type: 'expense',
    date: stamp, updatedAt: stamp, categoryId: i === 500 ? null : category.id, description: `完整账单${i}` })) });
  const bills = await db.bill.findMany({ where: { userId: owner.id }, orderBy: { id: 'asc' } });
  await db.billFinancialClassification.createMany({ data: bills.map(b => ({ billId: b.id, kind: 'ordinary', currency: 'CNY', billUpdatedAt: b.updatedAt, reviewedAt: stamp })) });
  await db.bill.create({ data: { userId: other.id, amount: 999999, type: 'income', date: stamp, description: '其他账号秘密' } });
  async function thread(reviewer) {
    return db.billReviewThread.create({ data: { ownerId: owner.id, reviewerId: reviewer.id, billId: bills[0].id, originalBillId: bills[0].id,
      vote: 'la', snapshot: {}, initialBillUpdatedAt: stamp, snapshotUpdatedAt: stamp } });
  }
  const t = await thread(friend), denied = await thread(noConsent);
  await db.reviewMessage.createMany({ data: [
    { threadId: t.id, authorId: friend.id, clientKey: randomUUID(), body: '可以减少外卖', mainSlot: 1 },
    { threadId: t.id, authorId: owner.id, clientKey: randomUUID(), body: '本人解释' },
    { threadId: t.id, authorId: friend.id, clientKey: randomUUID(), body: '违规文字', hidden: true },
    { threadId: t.id, authorId: friend.id, clientKey: randomUUID(), body: '已撤回', withdrawn: true },
    { threadId: denied.id, authorId: noConsent.id, clientKey: randomUUID(), body: '没有作者授权' },
    ...Array.from({ length: 501 }, (_, i) => ({ threadId: t.id, authorId: friend.id, clientKey: randomUUID(), body: `回复${i}` })),
  ] });
  let result = await service.collect(owner.id, 'day', '2020-02-10');
  assert.equal(result.payload.facts.bills.length, 501);
  assert.equal(result.payload.facts.grossExpense, '50.1501');
  assert.equal(result.payload.facts.categories.find(c => c.name === '餐饮').totals.grossExpense, '50.0500');
  assert.equal(result.payload.feedback.length, 503);
  assert.equal(result.payload.votes.length, 1);
  const modelInput = JSON.stringify(result.payload);
  for (const secret of [owner.id, friend.id, noConsent.id, '其他账号秘密', '违规文字', '已撤回', '没有作者授权']) assert.ok(!modelInput.includes(secret), secret);
  assert.equal(result.payload.budgets[0].coverage, 'unavailable');
  const unchanged = await service.collect(owner.id, 'day', '2020-02-10');
  assert.equal(result.inputDigest, unchanged.inputDigest);
  await db.socialPreference.update({ where: { userId: friend.id }, data: { allowAiAuthoredFeedback: false } });
  result = await service.collect(owner.id, 'day', '2020-02-10');
  assert.equal(result.payload.feedback.length, 1); // owner's independently consented reply
  assert.equal(result.payload.votes.length, 0);
  assert.notEqual(result.inputDigest, unchanged.inputDigest);
  await db.socialPreference.update({ where: { userId: owner.id }, data: { allowAiFeedback: false } });
  assert.equal((await service.collect(owner.id, 'day', '2020-02-10')).payload.feedback.length, 0);
  await db.billFinancialClassification.delete({ where: { billId: bills[500].id } });
  result = await service.collect(owner.id, 'month', '2020-02');
  assert.equal(result.payload.facts.counts.needsReview, 0);
  assert.equal(result.payload.facts.bills.length, 501);
  assert.equal(result.payload.facts.grossExpense, '50.1501');
  assert.equal(result.payload.facts.bills[500].classification, 'ordinary');
  await assert.rejects(service.collect(owner.id, 'day', '2099-01-01'), /已结束/);
  await assert.rejects(service.collect(owner.id, 'year', '2020'), /日或月/);
  // Control historical coverage on the fully migrated schema (with production triggers).
  await db.budgetHistoryLaunch.upsert({ where: { id: 1 },
    create: { id: 1, startedAt: new Date('2019-01-01') }, update: { startedAt: new Date('2019-01-01') } });
  await db.budgetRevision.create({ data: { budgetId: 1, userId: owner.id, recordedAt: new Date('2020-01-01'), action: 'baseline',
    snapshot: { name: '月预算', amount: '10.0000', period: 'monthly', is_active: true, category_id: category.id } } });
  result = await service.collect(owner.id, 'day', '2020-02-10');
  assert.equal(result.payload.budgets[0].comparisons[0].overBudget, true);
  assert.equal(result.payload.budgets[0].comparisons[0].grossExpense, '50.0500');
  assert.equal(result.payload.budgets[0].startDate, '2020-02-01');
  assert.equal(result.payload.budgets[1].comparisons.length, 0);
  await assert.rejects(service.collect(owner.id, 'day', '2020-02-10', new Date('2020-02-10T15:59:59Z')), /已结束/);
  assert.equal((await service.collect(owner.id, 'day', '2020-02-10', new Date('2020-02-10T16:00:00Z'))).payload.facts.bills.length, 501);
  await db.bill.delete({ where: { id: bills[0].id } });
  const afterDelete = await service.collect(owner.id, 'day', '2020-02-10');
  assert.equal(afterDelete.payload.facts.bills.length, 500);
  assert.equal(afterDelete.payload.feedback.length, 0);
  // Upgrade preserves received-feedback permission but never invents authorship permission.
  await db.socialPreference.update({ where: { userId: owner.id }, data: { allowAiFeedback: true } });
  await db.$executeRawUnsafe('ALTER TABLE social_preferences DROP COLUMN allow_ai_authored_feedback');
  await db.$executeRawUnsafe(require('node:fs').readFileSync('prisma/migrations/202609160012_ai_author_consent/migration.sql', 'utf8'));
  const migrated = await db.socialPreference.findUniqueOrThrow({ where: { userId: owner.id } });
  assert.equal(migrated.allowAiFeedback, true);
  assert.equal(migrated.allowAiAuthoredFeedback, false);
  console.log('Full 501-bill/503-message pagination, precise totals, consent revocation, hidden/withdrawn filtering, ownership, periods and historical budget evidence passed.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.budgetHistoryLaunch.deleteMany();
  await db.$disconnect();
});
