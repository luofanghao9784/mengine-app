import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
const spec = JSON.parse(
    readFileSync(new URL('../../contracts/public-api/export.openapi.json', import.meta.url), 'utf8'),
  ),
  ajv = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true } }),
  check = (n) => ajv.compile({ ...spec.components.schemas[n], components: spec.components }),
  id = '00000000-0000-4000-8000-000000000001';
test('batch requests are explicit, bounded, fixed versions and finite retention', () => {
  const value = {
    requestId: id,
    workspaceId: id,
    scope: 'PRIVATE',
    retentionDays: 7,
    items: [{ objectId: id, version: 1, format: 'docx' }],
  };
  assert.ok(check('ExportCreate')(value));
  for (const change of [
    { items: [] },
    { items: Array(51).fill(value.items[0]) },
    { retentionDays: 30 },
    { scope: 'ALL_TENANTS' },
    { items: [{ objectId: id, version: 0, format: 'docx' }] },
  ])
    assert.equal(check('ExportCreate')({ ...value, ...change }), false);
  assert.equal(check('ExportCreate')({ ...value, includeAllPrivate: true }), false);
});
test('unreadable item projection cannot contain old title or file metadata', () => {
  const item = {
    ordinal: 1,
    selection: { objectId: id, version: 1, format: 'docx' },
    versionId: null,
    title: null,
    state: 'INCLUDED',
    archivePath: null,
    sizeBytes: null,
    sha256: null,
    errorCode: 'EXPORT_ITEM_UNAVAILABLE',
    visible: false,
  };
  assert.ok(check('ExportItem')(item));
  assert.equal(check('ExportItem')({ ...item, title: '原私人标题' }), false);
});
test('export operations require session, mutation CSRF/idempotency, current downloads have bounded binary headers', () => {
  for (const [path, verbs] of Object.entries(spec.paths))
    for (const [method, op] of Object.entries(verbs)) {
      assert.ok(path.startsWith('/api/v1/tenants/{tenant}/export-batches'));
      assert.deepEqual(op.security, [{ sessionCookie: [] }]);
      if (method === 'post') {
        assert.ok(op.parameters.some((p) => p.$ref === '#/components/parameters/CsrfHeader'));
        const name = op.requestBody.content['application/json'].schema.$ref.split('/').at(-1);
        assert.ok(spec.components.schemas[name].required.includes('requestId'));
      }
    }
  const r = spec.paths['/api/v1/tenants/{tenant}/export-batches/{id}/archive'].get.responses;
  assert.ok(r['200'].content['application/zip']);
  assert.equal(r['200'].headers['Content-Length'].schema.maximum, 41943040);
  assert.ok(r['410']);
});
