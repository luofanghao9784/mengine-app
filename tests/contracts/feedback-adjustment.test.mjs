import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
const spec = JSON.parse(
  readFileSync(
    new URL('../../contracts/public-api/feedback-adjustment.openapi.json', import.meta.url),
    'utf8',
  ),
);
const ajv = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true } });
const check = (n) => ajv.compile({ ...spec.components.schemas[n], components: spec.components });
const id = '00000000-0000-4000-8000-000000000001',
  target = {
    kind: 'BRIEFING',
    taskId: id,
    taskRevision: 3,
    attempt: 1,
    presentationVersion: 'briefing-basic-v1',
    presentationRevision: 0,
  };
test('sending requires both optimistic versions and explicit nonempty user text', () => {
  const body = {
    requestId: id,
    target,
    expectedThreadRevision: 0,
    expectedFeedbackRevision: 0,
    message: '仅调整本次表达',
    rating: 'USEFUL',
  };
  assert.ok(check('SendAdjustment')(body));
  assert.equal(check('SendAdjustment')({ ...body, expectedThreadRevision: -1 }), false);
  assert.equal(check('SendAdjustment')({ ...body, message: '' }), false);
  assert.equal(check('SendAdjustment')({ ...body, autoPublish: true }), false);
});
test('read is a separate endpoint and captures server reading with current source contract', () => {
  assert.ok(spec.paths['/api/v1/tenants/{tenant}/feedback-adjustments'].get);
  assert.ok(
    check('AdjustmentReading')({
      workspaceId: id,
      cardId: id,
      cardKind: 'BRIEFING',
      target,
      title: '实际卡片',
      excerpt: '原节选',
      truncated: false,
      presentation: '{}',
      sourceVersions: [],
      contentSha256: 'a'.repeat(64),
    }),
  );
});
