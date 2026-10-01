import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
const spec = JSON.parse(
  await readFile(new URL('../../contracts/public-api/recommendation.openapi.json', import.meta.url), 'utf8'),
);
const schema = (name) =>
  new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true } }).compile({
    ...spec.components.schemas[name],
    components: spec.components,
  });
test('recommendation API declares bounded ranking, explicit evidence and real cookie', () => {
  assert.equal(spec.components.securitySchemes.sessionCookie.name, 'DREAMCORE_SESSION');
  assert.equal(
    spec.paths['/api/v1/tenants/{tenant}/recommendations'].get.parameters.find((p) => p.name === 'limit')
      .schema.maximum,
    30,
  );
  const validate = schema('Opened'),
    target = { kind: 'TASK', id: '00000000-0000-4000-8000-000000000001', versionKey: 'synthetic' };
  assert.ok(
    validate({
      target,
      openedAt: '2026-10-01T00:00:00Z',
      evidence: 'USER_OPEN_ACTION',
      businessOutcome: 'NOT_ASSESSED',
    }),
  );
  assert.equal(
    validate({
      target,
      openedAt: '2026-10-01T00:00:00Z',
      evidence: 'BUSINESS_COMPLETED',
      businessOutcome: 'NOT_ASSESSED',
    }),
    false,
  );
});
test('presentation feedback schema admits versioned recommendation but keeps task rating distinct', () => {
  const validate = schema('FeedbackTarget'),
    target = {
      kind: 'BRIEFING',
      taskId: '00000000-0000-4000-8000-000000000001',
      taskRevision: 2,
      attempt: 1,
      presentationVersion: 'recommendation-v1',
      presentationRevision: 3,
    };
  assert.ok(validate(target), JSON.stringify(validate.errors));
  assert.equal(validate({ ...target, kind: 'TASK' }), false);
});
