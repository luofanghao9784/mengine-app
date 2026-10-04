import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
const spec = JSON.parse(
  await readFile(new URL('../../contracts/public-api/storage-status.openapi.json', import.meta.url), 'utf8'),
);
const ajv = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true } });
const check = ajv.compile({ ...spec.components.schemas.Event, components: spec.components });
test('storage exposes only an independent no-store platform read', () => {
  assert.deepEqual(spec.security, [{ platformSessionCookie: [] }]);
  assert.deepEqual(Object.keys(spec.paths), ['/api/platform-admin/v1/storage-status']);
  const route = Object.values(spec.paths)[0];
  assert.deepEqual(Object.keys(route), ['get']);
  assert.equal(route.get.responses['200'].headers['Cache-Control'].schema.const, 'private, no-store');
});
test('backup event contract excludes raw content and separates operations', () => {
  const event = {
    id: '00000000-0000-4000-8000-000000000001',
    command: 'RESTORE',
    state: 'SUCCEEDED',
    startedAt: '2026-10-04T10:00:00Z',
    finishedAt: '2026-10-04T10:01:00Z',
    snapshot: null,
  };
  assert.ok(check(event));
  for (const field of ['path', 'error', 'credentials', 'content', 'tenantName'])
    assert.equal(check({ ...event, [field]: 'private' }), false);
  assert.equal(check({ ...event, command: 'DOWNLOAD' }), false);
  assert.equal(check({ ...event, state: 'RECOVERABLE' }), false);
});
