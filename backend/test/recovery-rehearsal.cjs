// Called only by the disposable-container regression runner; never accepts a production URL.
const assert = require('node:assert/strict');
module.exports = async function rehearse({ run, sql, container, baselineSql, schemaPath, migrationSql }) {
  if (!/^zhizhang-regression-[0-9a-f-]+$/.test(container)) throw new Error('Disposable regression container required');
  const original = 'zhizhang_recovery_test', restored = 'zhizhang_recovery_restored_test';
  await sql('postgres', `CREATE DATABASE ${original}; CREATE DATABASE ${restored};`);
  await sql(original, baselineSql);
  await sql(original, `
    INSERT INTO users (id, username, password, updated_at)
      VALUES ('11111111-1111-4111-8111-111111111111', 'synthetic-recovery', 'test-only', now());
    INSERT INTO bills (user_id, amount, type, date, notes, updated_at) VALUES
      ('11111111-1111-4111-8111-111111111111', 118.1234, 'expense', '2026-09-15', '合成备份样本', now()),
      ('11111111-1111-4111-8111-111111111111', 50.0123, 'income', '2026-09-16', 'synthetic refund', now());
    UPDATE bills SET related_bill_id = 1 WHERE id = 2;
    INSERT INTO budgets (user_id, name, amount, period, updated_at)
      VALUES ('11111111-1111-4111-8111-111111111111', 'synthetic budget', 300.1234, 'monthly', now());
  `);
  const snapshot = db => run('docker', ['exec', container, 'psql', '-U', 'test', '-d', db, '-At', '-v', 'ON_ERROR_STOP=1', '-c',
    `SELECT json_build_object(
      'users', (SELECT json_agg(t ORDER BY id) FROM users t),
      'bills', (SELECT json_agg(t ORDER BY id) FROM bills t),
      'budgets', (SELECT json_agg(t ORDER BY id) FROM budgets t))::text;`], { capture: true });
  const before = JSON.parse(await snapshot(original));
  // Capture stdout without logging the dump. In this runner every row is synthetic.
  const backup = await run('docker', ['exec', container, 'pg_dump', '-U', 'test', '-d', original, '--no-owner', '--no-privileges'], { capture: true });
  assert(backup.includes('PostgreSQL database dump'), 'A usable dump must be produced before upgrades');
  for (const migration of migrationSql) await sql(original, migration);
  assert.deepEqual(JSON.parse(await snapshot(original)), before, 'Upgrade must preserve original financial rows');
  // Deliberate post-upgrade writes cannot contaminate the restored backup.
  await sql(original, "UPDATE bills SET amount = 999 WHERE id = 1;");
  await sql(restored, backup);
  const restoredUrl = `postgresql://test:test-only@127.0.0.1:15451/${restored}?schema=public`;
  await run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-url', restoredUrl,
    '--to-schema-datamodel', schemaPath, '--exit-code'], { env: { DATABASE_URL: restoredUrl } });
  assert.deepEqual(JSON.parse(await snapshot(restored)), before, 'Restore must reproduce pre-upgrade data exactly');
  // Verify restored sequences and FKs, not only row counts.
  await sql(restored, `
    INSERT INTO bills (user_id, amount, type, date, updated_at)
      VALUES ('11111111-1111-4111-8111-111111111111', 0.0001, 'expense', '2026-09-17', now());
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM bills WHERE id = 3 AND amount = 0.0001) THEN
        RAISE EXCEPTION 'Restored sequence or Decimal amount is incorrect';
      END IF;
      BEGIN
        INSERT INTO bills (user_id, amount, type, date, updated_at)
          VALUES ('22222222-2222-4222-8222-222222222222', 1, 'expense', '2026-09-17', now());
        RAISE EXCEPTION 'Restored user foreign key is missing';
      EXCEPTION WHEN foreign_key_violation THEN NULL;
      END;
    END $$;
  `);
  console.log('PASS recovery rehearsal: pre-upgrade dump, preserved Decimal/refund/budget rows, old-schema restore, sequence and foreign-key enforcement.');
};
