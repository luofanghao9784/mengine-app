import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
const spec = JSON.parse(
  await readFile(new URL('../../contracts/public-api/attachments.openapi.json', import.meta.url), 'utf8'),
);
const ajv = new Ajv({ strict: false, formats: { uuid: true, 'date-time': true, binary: true } }),
  id = '00000000-0000-4000-8000-000000000001';
const check = (n) => ajv.compile({ ...spec.components.schemas[n], components: spec.components });
test('private upload binds an idempotent draft and accepts conversation workspace but cannot choose owner or sharing', () => {
  const validate = check('AttachmentUpload');
  assert.ok(validate({ requestId: id, draftRequestId: id }));
  assert.ok(validate({ requestId: id, draftRequestId: id, conversationId: id }));
  assert.ok(validate({ requestId: id, draftRequestId: id, workspaceId: id }));
  for (const body of [
    { requestId: id },
    { requestId: id, draftRequestId: id, ownerId: id },
    { requestId: id, draftRequestId: id, inLibrary: true },
    { requestId: id, draftRequestId: id, sharing: true },
  ])
    assert.equal(validate(body), false);
  for (const item of Object.values(spec.paths))
    if (item.post) assert.ok(item.post.parameters.some((p) => p.name === 'X-CSRF-TOKEN' && p.required));
});
test('promotion is explicit and cannot change version or audience', () => {
  const validate = check('AttachmentSave');
  assert.ok(validate({ requestId: id }));
  assert.equal(validate({ requestId: id, version: 2 }), false);
  assert.equal(validate({ requestId: id, share: true }), false);
});
