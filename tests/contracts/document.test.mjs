import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
const spec = JSON.parse(
  await readFile(new URL('../../contracts/public-api/document.openapi.json', import.meta.url), 'utf8'),
);
const ajv = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true } }),
  id = '00000000-0000-4000-8000-000000000001';
test('personal document writes never accept caller-supplied owner, destination or detached source', () => {
  const create = ajv.compile(spec.components.schemas.Create),
    valid = { requestId: id, conversationId: id, taskId: id };
  assert.ok(create(valid));
  for (const extra of [
    { ownerId: id },
    { workspaceId: id },
    { body: 'spoofed model result' },
    { ignoreSourcePermission: true },
  ])
    assert.equal(create({ ...valid, ...extra }), false);
  const save = ajv.compile(spec.components.schemas.Save),
    change = { requestId: id, expectedRevision: 1, title: '标题', body: '正文' };
  assert.ok(save(change));
  for (const extra of [
    { sourceWorkspaceId: id },
    { sourceTaskId: id },
    { expectedRevision: 0 },
    { requestId: undefined },
    { body: 'x'.repeat(32769) },
  ])
    assert.equal(save({ ...change, ...extra }), false);
  for (const route of Object.values(spec.paths))
    if (route.post) assert.ok(route.post.parameters.some((p) => p.name === 'X-CSRF-TOKEN' && p.required));
});
test('document export contract identifies immutable version and explicit unsupported glyph failure', () => {
  const route = spec.paths['/api/v1/tenants/{tenant}/documents/{id}/versions/{version}/exports/{format}'];
  assert.ok(route.parameters.some((p) => p.name === 'version' && p.required && p.schema.minimum === 1));
  assert.ok(route.get.responses['422']);
  assert.deepEqual(route.parameters.find((p) => p.name === 'format').schema.enum, ['docx', 'pdf']);
});

test('publication requires explicit independent-copy acknowledgement and guarded update identity', () => {
  const validate = ajv.compile(spec.components.schemas.Publish),
    body = { requestId: id, workspaceId: id, format: 'docx', acknowledgeIndependentCopy: true };
  assert.ok(validate(body));
  assert.ok(validate({ ...body, folderId: id }));
  assert.ok(validate({ ...body, materialId: id, expectedMaterialVersion: 1 }));
  for (const mutation of [
    { acknowledgeIndependentCopy: false },
    { acknowledgeIndependentCopy: undefined },
    { materialId: id },
    { expectedMaterialVersion: 1 },
    { materialId: id, expectedMaterialVersion: 1, folderId: id },
    { ownerId: id },
    { body: 'spoofed source' },
    { sourcePermissionsIgnored: true },
  ])
    assert.equal(validate({ ...body, ...mutation }), false);
});
