import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
const spec = JSON.parse(
  readFileSync(new URL('../../contracts/public-api/feedback.openapi.json', import.meta.url), 'utf8'),
);
const ajv = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true } });
const check = (n) => ajv.compile({ ...spec.components.schemas[n], components: spec.components });
const id = '00000000-0000-4000-8000-000000000001';
test('target ties a channel to its exact task/attempt/presentation versions', () => {
  const t = {
    kind: 'TASK',
    taskId: id,
    taskRevision: 3,
    attempt: 1,
    presentationVersion: 'task-v1',
    presentationRevision: 0,
  };
  assert.ok(check('FeedbackTarget')(t));
  assert.equal(check('FeedbackTarget')({ ...t, presentationRevision: 1 }), false);
  assert.equal(check('FeedbackTarget')({ ...t, kind: 'BRIEFING' }), false);
  assert.ok(
    check('FeedbackTarget')({
      ...t,
      kind: 'BRIEFING',
      presentationVersion: 'briefing-basic-v1',
      presentationRevision: 2,
    }),
  );
});
test('follow-up requires one explicit action and candidate is source-bound manual content', () => {
  const a = {
    kind: 'CORRECTION',
    confirmed: true,
    preference: null,
    correction: '核对本次数字',
    candidate: null,
  };
  assert.ok(check('FeedbackFollowUp')(a));
  assert.equal(check('FeedbackFollowUp')({ ...a, confirmed: false }), false);
  assert.equal(
    check('FeedbackFollowUp')({
      ...a,
      preference: { scenario: 'GENERAL', style: 'CONCISE', expectedProfileRevision: 0 },
    }),
    false,
  );
  const candidate = {
    kind: 'CORRECTION',
    title: '人工方法',
    summary: '摘要',
    body: '步骤',
    tags: [],
    applicable: '有资料',
    excluded: '',
    dependencies: '',
    basis: '未评测',
    accessMode: 'SOURCE_BOUND',
  };
  assert.ok(
    check('FeedbackFollowUp')({
      kind: 'EXPERIENCE_CANDIDATE',
      confirmed: true,
      preference: null,
      correction: null,
      candidate,
    }),
  );
  assert.equal(
    check('FeedbackFollowUp')({
      kind: 'EXPERIENCE_CANDIDATE',
      confirmed: true,
      preference: null,
      correction: null,
      candidate: { ...candidate, accessMode: 'INDEPENDENT_COPY' },
    }),
    false,
  );
});
test('every mutation has CSRF, request ID and revision for an existing object; private reads no-store', () => {
  for (const [path, methods] of Object.entries(spec.paths))
    for (const [method, op] of Object.entries(methods)) {
      assert.ok(path.startsWith('/api/v1/tenants/{tenant}/feedback'));
      assert.ok(
        Object.values(op.responses).some(
          (r) => r.headers?.['Cache-Control']?.schema.const === 'private, no-store',
        ),
      );
      if (method === 'post') {
        assert.ok(op.parameters.some((p) => p.$ref === '#/components/parameters/CsrfHeader'));
        const name = op.requestBody.content['application/json'].schema.$ref.split('/').at(-1),
          schema = spec.components.schemas[name];
        assert.ok(schema.required.includes('requestId'));
        if (path.includes('{id}')) assert.ok(schema.required.includes('expectedRevision'));
      }
    }
});
test('candidate receipt cannot claim auto-publication or evaluated success', () => {
  const a = {
    id,
    feedbackId: id,
    feedbackRevision: 1,
    kind: 'EXPERIENCE_CANDIDATE',
    status: 'CANDIDATE_CREATED',
    targetId: id,
    targetVersion: id,
    targetRevision: 1,
    conversationId: null,
    acceptedState: 'CANDIDATE',
    executionClass: 'verification',
    createdAt: '2026-10-01T00:00:00Z',
  };
  assert.ok(check('FeedbackAction')(a));
  assert.equal(check('FeedbackAction')({ ...a, acceptedState: 'PUBLISHED' }), false);
  assert.equal(check('FeedbackAction')({ ...a, status: 'APPLIED' }), false);
  assert.ok(
    check('Error')({
      contractVersion: '1.0',
      code: 'FEEDBACK_STATE_CHANGED',
      message: '请求未完成',
      retryable: false,
    }),
  );
});
test('independent publication feedback is its own exact version target, never an author task alias', () => {
  const value = {
    kind: 'PUBLICATION',
    taskRevision: 0,
    attempt: 0,
    publicationId: id,
    materialVersionId: id,
    materialVersion: 1,
    presentationVersion: 'recommendation-v1',
    presentationRevision: 4,
  };
  assert.ok(check('FeedbackTarget')(value));
  for (const invalid of [
    { ...value, taskId: id },
    { ...value, attempt: 1 },
    { ...value, publicationId: null },
    { ...value, materialVersion: 0 },
  ])
    assert.equal(check('FeedbackTarget')(invalid), false);
});
