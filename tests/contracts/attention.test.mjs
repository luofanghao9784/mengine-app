import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
const spec = JSON.parse(
  await readFile(new URL('../../contracts/public-api/attention.openapi.json', import.meta.url), 'utf8'),
);
test('attention has no synthetic completion endpoint and uses bounded current projection', () => {
  const route = spec.paths['/api/v1/tenants/{tenant}/attention'];
  assert.deepEqual(Object.keys(route), ['get']);
  assert.equal(route.get.parameters.find((p) => p.name === 'limit').schema.maximum, 50);
  const validate = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true } }).compile({
    ...spec.components.schemas.Page,
    components: spec.components,
  });
  const valid = {
    tenantId: '00000000-0000-4000-8000-000000000001',
    scope: 'MINE',
    items: [],
    total: 0,
    hasMore: false,
    checkedAt: '2026-10-01T00:00:00Z',
  };
  assert.ok(validate(valid));
  assert.equal(validate({ ...valid, total: -1 }), false);
  assert.equal(validate({ ...valid, completed: true }), false);
});
