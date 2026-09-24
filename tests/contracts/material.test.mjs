import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
const spec = JSON.parse(
  await readFile(new URL('../../contracts/public-api/material.openapi.json', import.meta.url), 'utf8'),
);
const ajv = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true } });
const check = (name) => ajv.compile({ ...spec.components.schemas[name], components: spec.components });
const id = '00000000-0000-4000-8000-000000000001';
test('material contract exposes version identity and hash but never an object storage key', () => {
  const version = {
    id,
    number: 1,
    filename: '合成.txt',
    sizeBytes: 3,
    sha256: 'a'.repeat(64),
    createdBy: id,
    createdAt: '2026-09-22T00:00:00Z',
  };
  const validate = check('Version');
  assert.ok(validate(version));
  assert.equal(validate({ ...version, objectId: id }), false);
  assert.equal(validate({ ...version, downloadUrl: 'https://untrusted.example/' }), false);
  assert.equal(validate({ ...version, number: 0 }), false);
});
test('all material writes require CSRF and downloads specify attachments with no public URL', () => {
  for (const [path, item] of Object.entries(spec.paths)) {
    if (item.post)
      assert.ok(item.post.parameters.some((p) => p.$ref === '#/components/parameters/CsrfHeader'));
    if (path.endsWith('/download')) {
      assert.ok(item.get.responses['200'].content['application/octet-stream']);
      assert.ok(item.get.responses['200'].headers['Content-Disposition']);
    }
  }
  const upload = check('UploadRequest');
  assert.ok(upload({ requestId: id }));
  assert.equal(upload({ folderId: id }), false);
  assert.equal(upload({ requestId: id, ownerId: id }), false);
});
