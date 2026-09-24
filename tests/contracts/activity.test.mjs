import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
const spec = JSON.parse(
  await readFile(new URL('../../contracts/public-api/activity.openapi.json', import.meta.url), 'utf8'),
);
const ajv = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true } });
const id = '00000000-0000-4000-8000-000000000001';
test('activity contract excludes private lineage and credentials', () => {
  const check = ajv.compile(spec.components.schemas.Item);
  const item = {
    id,
    workspaceId: id,
    workspaceName: 'space',
    folderId: null,
    materialId: id,
    version: 1,
    filename: 'shared.txt',
    actorName: 'member',
    kind: 'DOCUMENT_PUBLISHED',
    occurredAt: '2026-09-24T00:00:00Z',
  };
  assert.ok(check(item));
  for (const field of [
    'conversationId',
    'documentId',
    'sourceWorkspaceId',
    'email',
    'prompt',
    'reply',
    'objectId',
  ])
    assert.equal(check({ ...item, [field]: id }), false);
  assert.equal(check({ ...item, version: 0 }), false);
  assert.equal(check({ ...item, kind: 'TASK_RUNNING' }), false);
});
test('activity is bounded, session-protected and has no content-write operation', () => {
  const route = spec.paths['/api/v1/tenants/{tenant}/activity'];
  assert.deepEqual(Object.keys(route), ['get']);
  assert.ok(spec.security[0].sessionCookie);
  assert.equal(route.get.parameters.find((x) => x.name === 'limit').schema.maximum, 50);
  const check = ajv.compile({ ...spec.components.schemas.Page, components: spec.components });
  assert.ok(check({ tenantId: id, workspaceId: null, items: [], nextCursor: null }));
  assert.equal(
    check({ tenantId: id, workspaceId: null, items: [], nextCursor: null, totalCount: 42 }),
    false,
  );
});
