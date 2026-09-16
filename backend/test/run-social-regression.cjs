// Synthetic local databases only. Requires Docker, Git history and installed backend dependencies.
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { mkdtemp, writeFile, readFile, readdir, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve, dirname, basename } = require('node:path');
const cwd = resolve(__dirname, '..');
const container = 'zhizhang-regression-' + randomUUID();
const baseline = 'cd1acb8'; // Last schema before budget history migration 011.
const env = { ...process.env, DATABASE_URL: 'postgresql://test:test-only@127.0.0.1:15451/zhizhang_social_test?schema=public' };
const prisma = ['node_modules/prisma/build/index.js'];
function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env: { ...env, ...options.env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; if (!options.capture) process.stdout.write(chunk); });
    child.stderr.on('data', chunk => process.stderr.write(chunk));
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolveRun(output) : reject(new Error(`${command} failed with exit ${code}`)));
    child.stdin.on('error', () => {});
    child.stdin.end(options.input);
  });
}
const sql = (db, input) => run('docker', ['exec', '-i', container, 'psql', '-U', 'test', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q'], { input, capture: true });
const suites = [
  ['ledger', 'ledger'], ['social', 'social'], ['review-requests', 'social'],
  ['private-reviews', 'reviews'], ['review-write-limits', 'reviews'],
  ['moderation', 'moderation'], ['inbox', 'inbox'], ['new-bill-notices', 'notices'],
  ['rankings', 'ranking'], ['retrospective-jobs', 'report'],
];
(async () => {
  let created = false, temp;
  try {
    temp = await mkdtemp(join(tmpdir(), 'zhizhang-regression-'));
    const oldSchema = await run('git', ['show', `${baseline}:backend/prisma/schema.prisma`], { capture: true });
    const schemaPath = join(temp, 'baseline.prisma');
    await writeFile(schemaPath, oldSchema);
    await run(process.execPath, [...prisma, 'generate']);
    await run(process.execPath, ['node_modules/@nestjs/cli/bin/nest.js', 'build']);
    await run('docker', ['run', '--rm', '--name', container, '--label', 'zhizhang.synthetic-regression=true',
      '-e', 'POSTGRES_USER=test', '-e', 'POSTGRES_PASSWORD=test-only', '-e', 'POSTGRES_DB=postgres',
      '-p', '127.0.0.1:15451:5432', '-p', '127.0.0.1:15449:5432', '-d', 'postgres:16-alpine']);
    created = true;
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try { await run('docker', ['exec', container, 'pg_isready', '-U', 'test', '-d', 'postgres'], { capture: true }); ready = true; break; }
      catch { await new Promise(r => setTimeout(r, 500)); }
    }
    if (!ready) throw new Error('Disposable PostgreSQL did not become ready');
    const baselineSql = await run(process.execPath, [...prisma, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', schemaPath, '--script'], { capture: true });
    const migrations = (await readdir(join(cwd, 'prisma/migrations'))).filter(name => /^20260916\d{4}_/.test(name) && name >= '202609160011_').sort();
    if (!migrations.length) throw new Error('Required upgrade migrations are missing');
    for (const [suite, suffix] of suites) {
      const db = `zhizhang_${suffix}_test`;
      // Database names are constants above; all operations target our newly created container.
      await sql('postgres', `DROP DATABASE IF EXISTS ${db}; CREATE DATABASE ${db};`);
      await sql(db, baselineSql);
      for (const migration of migrations) await sql(db, await readFile(join(cwd, 'prisma/migrations', migration, 'migration.sql'), 'utf8'));
      const port = suffix === 'report' ? 15449 : 15451;
      const DATABASE_URL = `postgresql://test:test-only@127.0.0.1:${port}/${db}?schema=public`;
      console.log(`\nVerifying ${suite} against upgraded schema (${migrations.length} migrations)`);
      await run(process.execPath, [...prisma, 'migrate', 'diff', '--from-url', DATABASE_URL, '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'], { env: { DATABASE_URL } });
      await run(process.execPath, [`test/${suite}.integration.cjs`], { env: { DATABASE_URL } });
    }
    await run(process.execPath, ['test/retrospective-generator.integration.cjs']);
    console.log(`PASS: ${suites.length} upgraded-database suites and four-provider HTTP adapter suite. No production services used.`);
  } finally {
    try {
      if (created) await run('docker', ['stop', container]);
    } finally {
      if (temp) {
        const target = resolve(temp);
        if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('zhizhang-regression-'))
          throw new Error('Refusing to remove an unexpected temporary directory');
        await rm(target, { recursive: true });
      }
    }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
