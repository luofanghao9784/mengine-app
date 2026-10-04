import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
const spec = JSON.parse(
  readFileSync(
    new URL('../../contracts/public-api/experience-management.openapi.json', import.meta.url),
    'utf8',
  ),
);
const ajv = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true } });
const check = ajv.compile({ ...spec.components.schemas.Processing, components: spec.components });
const id = '00000000-0000-4000-8000-000000000001';
const row = {
  id,
  sourceKind: 'FEEDBACK',
  state: 'NOT_ADMITTED',
  reason: 'INSUFFICIENT_EVIDENCE',
  updatedAt: '2026-10-04T00:00:00Z',
  entryId: null,
  versionId: null,
  workspaceId: id,
};
test('processing projection refuses raw source bodies, provider errors and half-authorized links', () => {
  assert.ok(check(row));
  for (const field of [
    'prompt',
    'reply',
    'title',
    'assessment',
    'candidate',
    'evidence',
    'sourceId',
    'ownerId',
  ])
    assert.equal(check({ ...row, [field]: 'private' }), false);
  assert.equal(check({ ...row, reason: 'private-provider-error' }), false);
  assert.equal(check({ ...row, entryId: id }), false);
  assert.ok(check({ ...row, entryId: id, versionId: id }));
});
test('observation endpoints have customer scope, no write or review actions, and no-store responses', () => {
  assert.equal(spec.components.securitySchemes.sessionCookie.name, 'DREAMCORE_SESSION');
  for (const [path, operations] of Object.entries(spec.paths)) {
    assert.match(path, /tenants\/\{tenant\}/);
    assert.deepEqual(Object.keys(operations), ['get']);
    assert.equal(operations.get.responses['200'].headers['Cache-Control'].schema.const, 'private, no-store');
  }
});
