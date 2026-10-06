import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
const spec = JSON.parse(
  await readFile(
    new URL('../../contracts/public-api/engine-telemetry.openapi.json', import.meta.url),
    'utf8',
  ),
);
const validate = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true } }).compile({
  ...spec.components.schemas.Snapshot,
  components: spec.components,
});
test('telemetry has independent authenticated read-only endpoints and no content vocabulary', () => {
  const paths = Object.entries(spec.paths);
  assert.equal(paths.length, 3);
  for (const [path, route] of paths) {
    assert.deepEqual(Object.keys(route), ['get']);
    assert.deepEqual(route.get.security, [
      { [path.includes('platform-admin') ? 'platformSessionCookie' : 'sessionCookie']: [] },
    ]);
    assert.equal(route.get.responses['200'].headers['Cache-Control'].schema.const, 'private, no-store');
  }
  const channels = spec.components.schemas.Channel.properties.code.enum.map((code) => ({
    code,
    running: 0,
    queued: 0,
    waiting: 0,
    failed: 0,
    unknown: 0,
    completedRecent: 0,
    lastCompletedAt: null,
  }));
  const value = {
    tenantId: null,
    checkedAt: '2026-10-04T10:00:00Z',
    recentSeconds: 300,
    evolution: 'NOT_CONNECTED',
    channels,
  };
  assert.ok(validate(value));
  for (const field of ['prompt', 'filename', 'taskId', 'accountId', 'rawError'])
    assert.equal(validate({ ...value, [field]: 'private' }), false);
  assert.equal(validate({ ...value, channels: [{ ...channels[0], running: -1 }] }), false);
});
test('tenant distribution is platform-only, counts only and bounded', () => {
  const route = spec.paths['/api/platform-admin/v1/engine-telemetry/tenants'];
  assert.deepEqual(route.get.security, [{ platformSessionCookie: [] }]);
  assert.equal(
    Object.keys(spec.paths).some((p) => p.startsWith('/api/tenant-admin') && p.endsWith('/tenants')),
    false,
  );
  const check = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true } }).compile({
    ...spec.components.schemas.TenantDistribution,
    components: spec.components,
  });
  const row = { tenantId: '00000000-0000-4000-8000-000000000001', tenantName: '合成企业', running: 2 };
  const value = { checkedAt: '2026-10-06T10:00:00Z', tenants: [row], otherTenants: 0, otherRunning: 0 };
  assert.ok(check(value));
  assert.ok(check({ ...value, tenants: [] }));
  for (const field of ['channels', 'code', 'taskId', 'prompt', 'accountId'])
    assert.equal(check({ ...value, tenants: [{ ...row, [field]: 'private' }] }), false);
  assert.equal(check({ ...value, tenants: [{ ...row, running: 0 }] }), false);
  assert.equal(check({ ...value, tenants: Array(11).fill(row) }), false);
});
