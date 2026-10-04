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
test('realm contracts keep customer usage writes separate and require exact versions', () => {
  for (const [path, operations] of Object.entries(spec.paths)) {
    assert.deepEqual(
      Object.keys(operations),
      path.endsWith('/usage') ||
        path.endsWith('/availability') ||
        path.endsWith('/suggestions') ||
        path === '/api/platform-admin/v1/experience-library/{entry}/adjustments'
        ? ['get', 'post']
        : ['get'],
    );
    if (operations.post) {
      assert.deepEqual(operations.post.security, [
        { [path.includes('platform-admin') ? 'platformCookie' : 'customerCookie']: [] },
      ]);
      assert.ok(operations.post.parameters.some((p) => p.in === 'header' && p.required));
    }
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

test('usage control request and receipt carry exact version, revision and idempotency identity only', () => {
  const check = ajv.compile(spec.components.schemas.UsageChange);
  const request = { requestId: id, versionId: id, expectedRevision: 0, enabled: false };
  assert.ok(check(request));
  for (const key of ['actorId', 'tenantId', 'method', 'sourceId'])
    assert.equal(check({ ...request, [key]: id }), false);
  assert.equal(check({ ...request, expectedRevision: -1 }), false);
  assert.equal(check({ ...request, enabled: 'false' }), false);
  const state = ajv.compile(spec.components.schemas.Usage);
  assert.ok(state({ entryId: id, versionId: id, revision: 0, enabled: true, usable: true, canManage: false }));
  assert.equal(
    state({ entryId: id, versionId: id, revision: 0, enabled: true, usable: true, canManage: false, reason: 'private' }),
    false,
  );
});

test('platform availability requires an exact version, current revision and bounded reason without source fields', () => {
  const check = ajv.compile(spec.components.schemas.AvailabilityChange);
  const body = {
    requestId: id,
    versionId: id,
    expectedRevision: 1,
    status: 'STOPPED',
    reason: '合成适用范围',
  };
  assert.ok(check(body));
  for (const key of ['tenantId', 'actorId', 'method', 'sourceId'])
    assert.equal(check({ ...body, [key]: id }), false);
  for (const invalid of [
    { expectedRevision: 0 },
    { reason: '' },
    { reason: 'x'.repeat(501) },
    { status: 'WITHDRAWN' },
  ])
    assert.equal(check({ ...body, ...invalid }), false);
  const receipt = ajv.compile(spec.components.schemas.AvailabilityReceipt);
  assert.ok(receipt({ requestId: id, entryId: id, versionId: id, revision: 2, status: 'STOPPED' }));
  assert.equal(
    receipt({ requestId: id, entryId: id, versionId: id, revision: 2, status: 'STOPPED', method: 'private' }),
    false,
  );
});

test('enterprise suggestion metadata excludes private bodies and original contribution identifiers', () => {
  const validate = ajv.compile({ ...spec.components.schemas.Suggestions, components: spec.components });
  const item = {
    id,
    versionId: id,
    workspaceId: id,
    intent: 'FEEDBACK',
    state: 'WAITING',
    resultEntryId: null,
    resultVersionId: null,
    createdAt: '2026-10-04T00:00:00Z',
  };
  const page = { enabled: false, canSubmit: true, scopes: [{ id, name: '获权空间' }], items: [item] };
  assert.ok(validate(page));
  for (const key of ['content', 'actorId', 'sourceId', 'review', 'candidate'])
    assert.equal(validate({ ...page, items: [{ ...item, [key]: 'private' }] }), false);
  assert.equal(validate({ ...page, items: [{ ...item, resultEntryId: id }] }), false);
  const change = ajv.compile(spec.components.schemas.SuggestionChange);
  const body = { requestId: id, versionId: id, workspaceId: id, intent: 'ADAPTATION', content: '核对口径' };
  assert.ok(change(body));
  for (const bad of [
    { ...body, intent: 'APPROVE' },
    { ...body, content: '' },
    { ...body, content: 'x'.repeat(12001) },
    { ...body, sourceId: id },
  ])
    assert.equal(change(bad), false);
  assert.ok(!Object.keys(spec.paths).some((p) => p.includes('platform-admin') && p.endsWith('/suggestions')));
});

test('platform adjustments expose own metadata only, have no customer endpoint or approval action', () => {
  const check = ajv.compile({ ...spec.components.schemas.Adjustments, components: spec.components });
  const item = {
    id,
    versionId: id,
    state: 'ADMITTED',
    resultVersionId: id,
    createdAt: '2026-10-04T00:00:00Z',
  };
  const page = { enabled: false, canSubmit: true, revision: 1, currentVersionId: id, items: [item] };
  assert.ok(check(page), JSON.stringify(check.errors));
  for (const key of ['content', 'actorId', 'tenantId', 'sourceId', 'runId', 'receipt', 'evidence'])
    assert.equal(check({ ...page, items: [{ ...item, [key]: 'private' }] }), false);
  assert.equal(check({ ...page, items: [{ ...item, state: 'RUNNING' }] }), false);
  assert.equal(
    check({ ...page, items: [{ ...item, state: 'AWAITING_APPROVAL', resultVersionId: null }] }),
    false,
  );
  const route = spec.paths['/api/platform-admin/v1/experience-library/{entry}/adjustments'];
  assert.deepEqual(route.post.security, [{ platformCookie: [] }]);
  assert.ok(route.post.parameters.some((p) => p.name === 'X-CSRF-TOKEN'));
  assert.equal(
    Object.keys(spec.paths).some((p) => p.startsWith('/api/v1/') && p.endsWith('/adjustments')),
    false,
  );
});

test('history is fixed-version read-only across both realms and excludes unpublished inputs', () => {
  const check = ajv.compile({ ...spec.components.schemas.Historical, components: spec.components });
  const history = {
    entryId: id,
    currentVersionId: id,
    versionId: id,
    number: 1,
    method: {
      title: '核对',
      summary: '核对回执',
      steps: ['核对'],
      applicable: ['有依据'],
      excluded: ['无依据'],
      tags: ['核对'],
      basis: 'OBSERVED_EXECUTION',
    },
    createdAt: '2026-10-04T00:00:00Z',
  };
  assert.ok(check(history), JSON.stringify(check.errors));
  for (const field of ['sourceId', 'tenantId', 'actorId', 'suggestion', 'receipt'])
    assert.equal(check({ ...history, [field]: id }), false);
  for (const [path, operation] of Object.entries(spec.paths).filter(([path]) =>
    /\/(history|versions)$/.test(path),
  )) {
    assert.deepEqual(Object.keys(operation), ['get']);
    assert.ok(operation.get.parameters.some((p) => p.name === 'current' && p.required));
    if (path.endsWith('/history'))
      assert.ok(operation.get.parameters.some((p) => p.name === 'version' && p.required));
  }
});

test('usage aggregates contain bounded counts and an explicitly unknown application outcome only', () => {
  const check = ajv.compile(spec.components.schemas.Activity);
  const value = {
    entryId: id,
    currentVersionId: id,
    versionId: id,
    scope: 'PLATFORM_AGGREGATE',
    referencedAttempts: 5,
    fullyReadAttempts: 3,
    assessedAttempts: 3,
    adoptedAttempts: 2,
    applicationOutcome: 'UNKNOWN',
    checkedAt: '2026-10-04T00:00:00Z',
  };
  assert.ok(check(value));
  for (const extra of [
    { taskId: id },
    { tenantId: id },
    { conditions: 'private' },
    { items: [] },
    { applicationOutcome: 'SUCCESS' },
    { adoptedAttempts: -1 },
  ])
    assert.equal(check({ ...value, ...extra }), false);
});
