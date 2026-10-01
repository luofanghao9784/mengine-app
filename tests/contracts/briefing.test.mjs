import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
const spec = JSON.parse(
  await readFile(new URL('../../contracts/public-api/briefing.openapi.json', import.meta.url), 'utf8'),
);
const ajv = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true, date: true } });
const id = '00000000-0000-4000-8000-000000000001';
test('manual focus placement requires current layout revision and exact card identities', () => {
  const route = spec.paths['/api/v1/tenants/{tenant}/briefing/layout'].post;
  assert.ok(route.parameters.some((p) => p.name === 'X-CSRF-TOKEN' && p.required));
  const check = ajv.compile(spec.components.schemas.LayoutMove);
  const valid = { requestId: id, expectedRevision: 3, conversationId: id, anchorId: id, direction: 'BEFORE' };
  assert.ok(check(valid));
  for (const invalid of [
    { ...valid, ownerId: id },
    { ...valid, expectedRevision: undefined },
    { ...valid, direction: 'PUBLISH' },
  ])
    assert.equal(check(invalid), false);
});
test('briefing preferences require CSRF, idempotency, revision and no caller-supplied owner', () => {
  const route = spec.paths['/api/v1/tenants/{tenant}/briefing/{conversation}'].post;
  assert.ok(route.parameters.some((p) => p.name === 'X-CSRF-TOKEN' && p.required));
  const check = ajv.compile(spec.components.schemas.Update);
  const valid = { requestId: id, expectedRevision: 0, pinned: true, hidden: false, size: 'WIDE' };
  assert.ok(check(valid));
  for (const bad of [
    { ...valid, ownerId: id },
    { ...valid, requestId: undefined },
    { ...valid, expectedRevision: undefined },
    { ...valid, expectedRevision: -1 },
    { ...valid, size: 'UNLIMITED' },
  ])
    assert.equal(check(bad), false);
});
test('briefing result bounds apply to Unicode excerpts and truthful execution class', () => {
  const check = ajv.compile({ ...spec.components.schemas.Card, components: spec.components });
  const valid = {
    conversationId: id,
    taskId: id,
    taskRevision: 1,
    attempt: 1,
    presentationVersion: 'briefing-basic-v1',
    workspaceId: id,
    workspaceName: 'test',
    title: 'test',
    excerpt: '😀'.repeat(600),
    truncated: true,
    completedAt: '2026-09-23T00:00:00Z',
    executionClass: 'verification',
    engineVersion: '0.8.0',
    artifactCount: 1,
    citationCount: 0,
    originalCount: 0,
    preference: { revision: 0, pinned: false, hidden: false, size: 'STANDARD' },
  };
  assert.ok(check(valid));
  assert.equal(check({ ...valid, excerpt: '😀'.repeat(601) }), false);
  assert.equal(check({ ...valid, executionClass: 'pretend-live' }), false);
  assert.equal(check({ ...valid, artifactCount: 9 }), false);
});

test('generation is owner-derived, idempotent, bounded and separate from reading', () => {
  const check = ajv.compile(spec.components.schemas.Generate);
  assert.ok(check({ requestId: id, businessType: 'INFO' }));
  for (const bad of [
    { requestId: id, ownerId: id },
    { businessType: 'DATA' },
    { requestId: id, businessType: 'UNKNOWN' },
  ])
    assert.equal(check(bad), false);
  const validate = ajv.compile(spec.components.schemas.GenerationBatch);
  const b = {
    id,
    workspaceId: id,
    trigger: 'INITIALIZATION',
    businessType: null,
    status: 'WAITING_DATA',
    reason: 'NO_MATERIALS',
    taskId: null,
    cardIds: [],
    createdAt: '2026-10-01T00:00:00Z',
    finishedAt: null,
  };
  assert.ok(validate(b));
  assert.equal(validate({ ...b, status: 'pretend-success' }), false);
  for (const [path, r] of Object.entries(spec.paths))
    if (path.includes('/generation') && r.post)
      assert.ok(r.post.parameters.some((p) => p.name === 'X-CSRF-TOKEN' && p.required));
});
