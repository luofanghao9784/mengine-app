import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
const spec = JSON.parse(
    readFileSync(new URL('../../contracts/public-api/retention.openapi.json', import.meta.url), 'utf8'),
  ),
  ajv = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true } }),
  check = (name) => ajv.compile({ ...spec.components.schemas[name], components: spec.components }),
  id = '00000000-0000-4000-8000-000000000001';
test('preparation creation cannot select all private data or implicit target identity', () => {
  const create = {
    requestId: id,
    kind: 'TENANT_EXIT',
    targetAccountId: null,
    label: '合成退出准备',
    workspaceIds: [id],
  };
  assert.ok(check('CreateCase')(create));
  assert.equal(check('CreateCase')({ ...create, includeAllPrivate: true }), false);
  assert.equal(check('CreateCase')({ ...create, kind: 'MEMBER_OFFBOARD' }), false);
  assert.equal(check('CreateCase')({ ...create, workspaceIds: Array(51).fill(id) }), false);
  assert.equal(check('CreateCase')({ ...create, targetAccountId: id }), false);
});
test('preparation commands have no execution or destructive clearance action', () => {
  const command = { requestId: id, expectedRevision: 1, action: 'ASSESS' };
  assert.ok(check('CaseCommand')(command));
  assert.equal(check('CaseCommand')({ ...command, action: 'EXECUTE' }), false);
  assert.equal(check('CaseCommand')({ ...command, action: 'PURGE_TENANT' }), false);
  assert.equal(check('CaseCommand')({ ...command, action: 'CHECK' }), false);
  assert.equal(check('CaseCommand')({ ...command, checklist: [] }), false);
});
test('assessment cannot attest full migration, effective exit, or missing critical blocker', () => {
  const value = {
    assessedAt: '2026-10-01T00:00:00Z',
    scopeCoverage: 'SELECTED_AUTHORIZED_SHARED_SCOPES',
    completeMigration: false,
    executionEnabled: false,
    blockers: ['EXECUTION_NOT_CONNECTED'],
    scopes: [],
    restrictedScopeCount: 0,
    exclusions: ['私人内容不属于迁出范围'],
    policyRevisions: { TRASH: 0 },
  };
  assert.ok(check('RetentionAssessment')(value));
  for (const change of [
    { completeMigration: true },
    { executionEnabled: true },
    { scopeCoverage: 'ALL_TENANT' },
    { blockers: [] },
  ])
    assert.equal(check('RetentionAssessment')({ ...value, ...change }), false);
});
test('all operations are tenant-scoped, authenticated, no-store, stable-key mutations', () => {
  assert.equal(spec.components.securitySchemes.sessionCookie.name, 'DREAMCORE_SESSION');
  for (const [path, verbs] of Object.entries(spec.paths))
    for (const [verb, op] of Object.entries(verbs)) {
      assert.ok(path.startsWith('/api/v1/tenants/{tenant}/retention'));
      assert.deepEqual(op.security, [{ sessionCookie: [] }]);
      const ok = op.responses['200'] ?? op.responses['201'];
      assert.ok(ok.headers['Cache-Control']);
      if (verb === 'post') {
        assert.ok(op.parameters.some((p) => p.$ref === '#/components/parameters/CsrfHeader'));
        const name = op.requestBody.content['application/json'].schema.$ref.split('/').at(-1);
        assert.ok(spec.components.schemas[name].required.includes('requestId'));
        assert.ok(op.responses['409']);
      }
    }
});
