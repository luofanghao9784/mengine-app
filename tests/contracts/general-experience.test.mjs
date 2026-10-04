import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
const spec = JSON.parse(
  readFileSync(
    new URL('../../contracts/public-api/general-experience.openapi.json', import.meta.url),
    'utf8',
  ),
);
const ajv = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true } });
const id = '00000000-0000-4000-8000-000000000001';
test('cleaned method contract refuses source identities, raw evidence and invented effect claims', () => {
  const check = ajv.compile({ ...spec.components.schemas.Detail, components: spec.components });
  const method = {
    title: '核对',
    summary: '依据实际回执',
    steps: ['核对状态'],
    applicable: ['有回执'],
    excluded: ['缺少记录'],
    tags: ['执行'],
    basis: 'OBSERVED_EXECUTION',
  };
  const row = {
    id,
    versionId: id,
    number: 1,
    status: 'AVAILABLE',
    method,
    updatedAt: '2026-10-04T00:00:00Z',
  };
  assert.ok(check(row));
  for (const key of ['tenantId', 'sourceId', 'runId', 'actorId', 'evidence']) {
    assert.equal(check({ ...row, [key]: id }), false);
    assert.equal(check({ ...row, method: { ...method, [key]: id } }), false);
  }
  assert.equal(check({ ...row, method: { ...method, basis: 'PROVEN_SUCCESS' } }), false);
});
test('realm contracts are separate read-only routes and detail requires exact version', () => {
  for (const [path, operations] of Object.entries(spec.paths)) {
    assert.deepEqual(Object.keys(operations), ['get']);
    const platform = path.includes('platform-admin');
    assert.deepEqual(operations.get.security, [{ [platform ? 'platformCookie' : 'customerCookie']: [] }]);
    assert.equal(operations.get.responses['200'].headers['Cache-Control'].schema.const, 'private, no-store');
    if (path.endsWith('{entry}'))
      assert.ok(operations.get.parameters.some((p) => p.name === 'version' && p.required));
  }
  assert.equal(spec.components.securitySchemes.platformCookie.name, 'DREAMCORE_PLATFORM');
  assert.equal(spec.components.securitySchemes.customerCookie.name, 'DREAMCORE_SESSION');
  assert.equal(Object.keys(spec.paths).filter((p) => p.endsWith('/processing')).length, 1);
});
