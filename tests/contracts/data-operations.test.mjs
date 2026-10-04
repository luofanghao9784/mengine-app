import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
const spec = JSON.parse(
  await readFile(new URL('../../contracts/public-api/data-operations.openapi.json', import.meta.url), 'utf8'),
);
const ajv = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true } });
const check = ajv.compile({ ...spec.components.schemas.Item, components: spec.components });
test('data operations only expose independent platform reads with bounded paging', () => {
  assert.deepEqual(spec.security, [{ platformSessionCookie: [] }]);
  assert.equal(Object.keys(spec.paths).length, 2);
  for (const [path, route] of Object.entries(spec.paths)) {
    assert.ok(path.startsWith('/api/platform-admin/v1/'));
    assert.deepEqual(Object.keys(route), ['get']);
    assert.equal(route.get.parameters.find((p) => p.name === 'offset').schema.maximum, 20000);
    assert.equal(route.get.responses['200'].headers['Cache-Control'].schema.const, 'private, no-store');
  }
});
test('operational item schema excludes names, credentials and raw diagnostic payloads', () => {
  const row = {
    monitorKey: 'a'.repeat(32),
    runId: null,
    stage: 'NOT_STARTED',
    configuration: 'UNCONFIGURED',
    category: 'NOT_STARTED',
    diagnostic: 'CONNECTION_UNCONFIGURED',
    createdAt: '2026-10-04T10:00:00Z',
    finishedAt: null,
    lastSuccessAt: null,
  };
  assert.ok(check(row));
  for (const field of [
    'filename',
    'materialId',
    'workspaceId',
    'content',
    'routeLabel',
    'secret',
    'warnings',
  ])
    assert.equal(check({ ...row, [field]: 'private' }), false);
  assert.equal(check({ ...row, diagnostic: 'raw secret error' }), false);
});
