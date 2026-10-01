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
test('upload receipts distinguish the accepted immutable version from current material state', () => {
  const at='2026-10-01T00:00:00Z';
  const accepted={id,number:1,filename:'synthetic.txt',sizeBytes:3,sha256:'a'.repeat(64),createdBy:id,createdAt:at,origin:'UPLOAD'};
  const entry={id,tenantId:id,workspaceId:id,workspaceName:'合成空间',folderId:null,kind:'DOCUMENT',name:'synthetic.txt',version:1,sizeBytes:3,updatedAt:at,path:['合成空间','synthetic.txt'],canMaintain:true};
  const validate=check('UploadReceipt');
  assert.ok(validate({...entry,receiptStatus:'EXACT',acceptedVersion:accepted,currentVersion:2}),JSON.stringify(validate.errors));
  assert.equal(validate({...entry,receiptStatus:'EXACT',acceptedVersion:null,currentVersion:2}),false);
  assert.ok(validate({...entry,version:2,receiptStatus:'HISTORICAL_UNKNOWN',acceptedVersion:null,currentVersion:2}));
  assert.equal(validate({...entry,receiptStatus:'HISTORICAL_UNKNOWN',acceptedVersion:accepted,currentVersion:2}),false);
  assert.equal(validate({...entry,receiptStatus:'EXACT',acceptedVersion:accepted,currentVersion:2,objectId:id}),false);
});
