// Explicit production smoke test. Only creates/deletes uniquely named synthetic users.
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
if (process.env.RUN_NOTIFICATION_SMOKE !== '1') throw Error('Requires RUN_NOTIFICATION_SMOKE=1');
if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) throw Error('Requires existing admin environment');
const base = 'http://127.0.0.1:3006';
const run = randomUUID(), names = [`qa-notify-${run.slice(0, 18)}-a`, `qa-notify-${run.slice(0, 18)}-b`];
const password = randomBytes(24).toString('base64url');
let admin, checks = 0;
async function request(route, token, method = 'GET', body, expected = 200) {
  const r = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  assert.equal(r.status, expected, `Unexpected HTTP status for ${method} ${route.split('?')[0]}`);
  const json = await r.json(); checks++; return json.data;
}
const sample = (i) => ({ sampleId: `${run}-${i}`, packageName: 'com.eg.android.AlipayGphone', appVersion: 'smoke-only', ruleVersion: 'synthetic-v1',
  postedAt: '2020-02-10T01:00:00Z', capturedAt: '2020-02-10T01:00:01Z', status: i % 2 ? 'queued' : 'ignored',
  reason: 'synthetic smoke fixture', raw: { title: '支付宝卡包（合成测试）', text: '你有淘宝闪购无门槛5元红包今晚失效', unicode: '中文🙂', lines: ['第一行', '第二行'] },
  ...(i % 2 ? { parsed: { amount: 0.01, type: 'income', synthetic: true } } : {}),
});
(async () => {
  admin = (await request('/admin-api/auth/login', null, 'POST', { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD }, 201)).token;
  try {
    const users = [];
    for (const username of names) {
      const user = await request('/admin-api/users', admin, 'POST', { username, password, nickname: '通知留档临时验收' }, 201);
      users.push({ ...user, token: (await request('/auth/login', null, 'POST', { username, password })).token });
    }
    const [a, b] = users;
    await request('/notification-samples/batch', null, 'POST', { samples: [sample(0)] }, 401);
    await request('/admin-api/notification-samples/export', a.token, 'GET', undefined, 401);
    await request('/notification-samples/batch', a.token, 'POST', { samples: [] }, 400);
    for (let i = 0; i < 1001; i += 25) {
      const batch = Array.from({ length: Math.min(25, 1001 - i) }, (_, j) => sample(i + j));
      const accepted = await request('/notification-samples/batch', a.token, 'POST', { samples: batch }, 201);
      assert.deepEqual(accepted.acceptedIds, batch.map(s => s.sampleId));
    }
    await Promise.all(Array.from({ length: 3 }, () => request('/notification-samples/batch', a.token, 'POST', { samples: [sample(0)] }, 201)));
    await request('/notification-samples/batch', b.token, 'POST', { samples: [sample(0)] }, 201);
    const aQuery = `userId=${a.id}&packageName=com.eg.android.AlipayGphone&ruleVersion=synthetic-v1`;
    const list = await request(`/admin-api/notification-samples?${aQuery}&pageSize=100`, admin);
    assert.equal(list.total, 1001); assert.equal(list.items.length, 100);
    const ignored = await request(`/admin-api/notification-samples?${aQuery}&status=ignored`, admin);
    assert.equal(ignored.total, 501);
    const first = await request(`/admin-api/notification-samples/export?${aQuery}`, admin);
    assert.equal(first.items.length, 1000); assert.ok(first.nextAfterId);
    const second = await request(`/admin-api/notification-samples/export?${aQuery}&afterId=${first.nextAfterId}`, admin);
    assert.equal(second.items.length, 1); assert.equal(second.nextAfterId, null);
    const all = [...first.items, ...second.items];
    assert.equal(new Set(all.map(x => x.sampleId)).size, 1001);
    for (const row of all) {
      assert.equal(row.userId, a.id);
      const index = Number(row.sampleId.slice(run.length + 1));
      assert.deepEqual(row.raw, sample(index).raw);
      assert.deepEqual(row.parsed, sample(index).parsed ?? null);
      assert.equal(new Date(row.postedAt).toISOString(), sample(index).postedAt.replace('Z', '.000Z'));
    }
    const other = await request(`/admin-api/notification-samples/export?userId=${b.id}`, admin);
    assert.equal(other.items.length, 1); assert.equal(other.items[0].userId, b.id);
    console.log(JSON.stringify({ phase: 'passed', checks, samples: 1002, exportPages: 2, concurrentRetries: 3, isolatedAccounts: 2 }));
  } finally {
    // Exact random username match also handles a lost create response. Never broad-delete.
    for (const username of names) {
      const found = await request(`/admin-api/users?search=${encodeURIComponent(username)}`, admin);
      for (const user of found.items.filter(u => u.username === username)) {
        await request(`/admin-api/users/${user.id}`, admin, 'DELETE');
        const remaining = await request(`/admin-api/notification-samples?userId=${user.id}`, admin);
        assert.equal(remaining.total, 0);
      }
      const after = await request(`/admin-api/users?search=${encodeURIComponent(username)}`, admin);
      assert.equal(after.items.filter(u => u.username === username).length, 0);
    }
    console.log(JSON.stringify({ phase: 'cleaned', syntheticUsers: 2 }));
  }
})().catch(error => {
  // Do not print tokens, admin credentials or response bodies from a live service.
  console.error(JSON.stringify({ phase: 'failed', type: error?.constructor?.name, message: error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Smoke request failed', fixtureNames: names }));
  process.exitCode = 1;
});
