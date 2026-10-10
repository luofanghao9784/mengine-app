import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
const spec = JSON.parse(
    readFileSync(new URL('../../contracts/public-api/departure.openapi.json', import.meta.url), 'utf8'),
  ),
  ajv = new Ajv({ strict: false, formats: { uuid: true, 'date-time': true } }),
  check = (name) => ajv.compile({ ...spec.components.schemas[name], components: spec.components }),
  id = '00000000-0000-4000-8000-000000000001';
test('effective departure requires explicit cleanup and explicit scope', () => {
  const body = {
    requestId: id,
    expectedTenantRevision: 0,
    reason: '确认退出',
    exportGrants: [],
    acceptScheduledCleanup: true,
  };
  assert.ok(check('ExitInput')(body));
  assert.equal(check('ExitInput')({ ...body, acceptScheduledCleanup: false }), false);
  assert.equal(check('ExitInput')({ ...body, includeAllPrivate: true }), false);
  assert.equal(
    check('ExitInput')({ ...body, exportGrants: Array(201).fill({ accountId: id, workspaceId: id }) }),
    false,
  );
});
test('offboard never receives new private owner and restoration is bounded operation', () => {
  const body = {
    requestId: id,
    targetAccountId: id,
    expectedMemberRevision: 0,
    reason: '确认离职',
    acceptScheduledCleanup: true,
  };
  assert.ok(check('OffboardInput')(body));
  assert.equal(check('OffboardInput')({ ...body, transferPrivateTo: id }), false);
  assert.equal(
    check('DepartureCommand')({ requestId: id, expectedRevision: 1, action: 'ACTIVATE_TENANT' }),
    false,
  );
});
test('exit inventory recognizes exact data snapshots without accepting an external database dump', () => {
  const item = { ordinal: 1, kind: 'DATASET_SNAPSHOT', objectId: id, versionId: id,
    version: 2, state: 'PENDING', filename: null, sha256: null, errorCode: null };
  assert.ok(check('Item')(item));
  assert.equal(check('Item')({ ...item, kind: 'DATABASE_DUMP' }), false);
  assert.equal(check('Item')({ ...item, version: 0 }), false);
});
test('all endpoints are scoped, no-store, CSRF-bound and support precise conflict', () => {
  assert.equal(spec.components.securitySchemes.sessionCookie.name, 'DREAMCORE_SESSION');
  assert.equal(spec.components.securitySchemes.platformSessionCookie.name, 'DREAMCORE_SESSION');
  for (const [path, verbs] of Object.entries(spec.paths))
    for (const [method, op] of Object.entries(verbs)) {
      const platform = path.startsWith('/api/platform-admin/');
      assert.ok(platform ? /^\/api\/platform-admin\/v1\/tenants\/\{tenant\}\//.test(path) : /^\/api\/v1\/tenants\/\{tenant\}\//.test(path));
      assert.deepEqual(op.security, platform ? [{ platformSessionCookie: [] }] : [{ sessionCookie: [] }]);
      assert.ok((op.responses['200'] ?? op.responses['201']).headers['Cache-Control']);
      if (method === 'post') {
        assert.ok(op.parameters.some((x) => x.$ref === '#/components/parameters/CsrfHeader'));
        const name = op.requestBody.content['application/json'].schema.$ref.split('/').at(-1);
        assert.ok(spec.components.schemas[name].required.includes('requestId'));
        assert.ok(op.responses['409']);
      }
    }
});
