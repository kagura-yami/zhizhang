// Run against the pre-migration schema in a disposable PostgreSQL container.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const database = new URL(process.env.DATABASE_URL || 'http://missing');
if (database.hostname !== '127.0.0.1' || database.port !== '15447' || database.pathname !== '/zhizhang_budget_test') throw Error('Requires isolated budget test DB');
const { PrismaClient } = require('@prisma/client');
const { BudgetsService } = require('../dist/budgets/budgets.service');
const { BudgetHistoryService } = require('../dist/budgets/budget-history.service');
const prisma = new PrismaClient();
const service = new BudgetsService(prisma), history = new BudgetHistoryService(prisma);
(async () => {
  const owner = await prisma.user.create({ data: { username: 'budget-owner', password: 'test-only' } });
  const other = await prisma.user.create({ data: { username: 'budget-other', password: 'test-only' } });
  const baseline = await service.create(owner.id, { name: '既有预算', amount: 123.4567, period: 'monthly' });
  const migrated = spawnSync('docker', ['exec', '-i', 'zhizhang-budget-test', 'psql', '-U', 'test', '-d', 'zhizhang_budget_test', '-v', 'ON_ERROR_STOP=1'], {
    input: readFileSync('prisma/migrations/202609160011_budget_history/migration.sql'), encoding: 'utf8',
  });
  assert.equal(migrated.status, 0, migrated.stderr);
  const launch = await prisma.budgetHistoryLaunch.findUniqueOrThrow({ where: { id: 1 } });
  const seed = await prisma.budgetRevision.findFirstOrThrow({ where: { budgetId: baseline.id } });
  assert.equal(seed.action, 'baseline');
  assert.equal(seed.recordedAt.getTime(), launch.startedAt.getTime());
  assert.equal(String(seed.snapshot.amount), '123.4567');
  assert.equal((await history.evidence(owner.id, new Date('2020-01-01'), new Date('2020-02-01'))).status, 'unavailable');
  await service.update(baseline.id, owner.id, { amount: 200 });
  await service.update(baseline.id, owner.id, { amount: 200 });
  assert.equal(await prisma.budgetRevision.count({ where: { budgetId: baseline.id } }), 2);
  assert.deepEqual(await service.update(baseline.id, other.id, { amount: 300 }), { count: 0 });
  await assert.rejects(prisma.$transaction(async tx => {
    await tx.budget.update({ where: { id: baseline.id }, data: { amount: 999 } });
    throw Error('rollback');
  }), /rollback/);
  assert.equal(await prisma.budgetRevision.count({ where: { budgetId: baseline.id } }), 2);
  const foreign = await prisma.category.create({ data: { name: '他人分类', type: 'expense', userId: other.id } });
  await assert.rejects(service.create(owner.id, { name: '错误分类', amount: 1, period: 'monthly', categoryId: foreign.id }), /支出分类/);
  const category = await prisma.category.create({ data: { name: '本人分类', type: 'expense', userId: owner.id } });
  const scoped = await service.create(owner.id, { name: '分类预算', amount: 50, period: 'monthly', categoryId: category.id });
  await prisma.category.delete({ where: { id: category.id } });
  const orphan = await prisma.budget.findUniqueOrThrow({ where: { id: scoped.id } });
  assert.equal(orphan.categoryId, null);
  assert.equal(orphan.isActive, false);
  const orphanRevision = await prisma.budgetRevision.findFirstOrThrow({ where: { budgetId: scoped.id }, orderBy: { id: 'desc' } });
  assert.equal(orphanRevision.snapshot.is_active, false);
  await service.remove(scoped.id, owner.id);
  assert.equal(await prisma.budgetRevision.count({ where: { budgetId: scoped.id, action: 'delete' } }), 1);

  // Controlled timestamps test historical evidence, including later budget changes.
  await prisma.budgetHistoryLaunch.update({ where: { id: 1 }, data: { startedAt: new Date('2020-01-01') } });
  await prisma.budgetRevision.updateMany({ where: { budgetId: baseline.id, action: 'baseline' }, data: { recordedAt: new Date('2020-01-01') } });
  await prisma.budgetRevision.updateMany({ where: { budgetId: baseline.id, action: 'update' }, data: { recordedAt: new Date('2020-03-15') } });
  const feb = await history.evidence(owner.id, new Date('2020-02-01'), new Date('2020-03-01'));
  assert.equal(feb.budgets.length, 1);
  assert.equal(feb.budgets[0].status, 'stable');
  assert.equal(String(feb.budgets[0].snapshot.amount), '123.4567');
  const mar = await history.evidence(owner.id, new Date('2020-03-01'), new Date('2020-04-01'));
  assert.equal(mar.budgets[0].status, 'changed_in_period');
  assert.equal(mar.budgets[0].snapshot, null);
  assert.equal((await history.evidence(other.id, new Date('2020-02-01'), new Date('2020-03-01'))).budgets.length, 0);
  await assert.rejects(history.evidence(owner.id, new Date('2099-01-01'), new Date('2099-02-01')), /已结束/);
  await service.remove(baseline.id, owner.id);
  assert.equal((await history.evidence(owner.id, new Date('2020-02-01'), new Date('2020-03-01'))).budgets[0].status, 'stable');
  await prisma.user.delete({ where: { id: owner.id } });
  assert.equal(await prisma.budgetRevision.count({ where: { userId: owner.id } }), 0);
  // Cascade of a still-existing budget must also work.
  await service.create(other.id, { name: '级联删除', amount: 1, period: 'yearly' });
  await prisma.user.delete({ where: { id: other.id } });
  assert.equal(await prisma.budgetRevision.count(), 0);
  console.log('Budget migration, rollback, ownership, category deletion, historical evidence and account cascade passed.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
