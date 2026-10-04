import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
const spec = JSON.parse(
  readFileSync(new URL('../../contracts/public-api/experience.openapi.json', import.meta.url), 'utf8'),
);
const ajv = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true } });
const check = (n) => ajv.compile({ ...spec.components.schemas[n], components: spec.components });
const id = '00000000-0000-4000-8000-000000000001';
const content = {
  kind: 'METHOD',
  title: '人工方法',
  summary: '摘要',
  body: '核对步骤',
  tags: ['核对'],
  applicable: '有当前资料',
  excluded: '不替代事实',
  dependencies: '',
  basis: '未评测',
  accessMode: 'INDEPENDENT_COPY',
};
test('manual experience schemas distinguish exact method from self-reported usage', () => {
  assert.ok(check('ExperienceContent')(content));
  assert.equal(check('ExperienceContent')({ ...content, hiddenReasoning: 'private' }), false);
  assert.equal(check('ExperienceContent')({ ...content, tags: ['核对', '核对'] }), false);
  assert.ok(
    check('ExperienceUseRequest')({
      requestId: id,
      use: {
        versionId: id,
        taskId: null,
        contextKey: 'case-a',
        decision: 'NOT_APPLICABLE',
        adopted: false,
        conditions: '缺资料',
        adjustments: '',
      },
    }),
  );
  assert.equal(
    check('ExperienceVersion')({
      id,
      number: 1,
      schemaVersion: 1,
      content,
      evidence: [],
      origin: 'AI_VERIFIED',
      evaluation: 'NOT_EVALUATED',
      createdBy: id,
      createdAt: '2026-10-01T00:00:00Z',
    }),
    false,
  );
});
test('all routes scoped and mutations require CSRF and stable request ID', () => {
  for (const [path, verbs] of Object.entries(spec.paths)) {
    assert.match(path, /tenants\/\{tenant\}\/workspaces\/\{workspace\}\/experiences/);
    for (const [method, op] of Object.entries(verbs)) {
      if (method === 'post') {
        assert.ok(op.parameters.some((p) => p.$ref === '#/components/parameters/CsrfHeader'));
        const name = op.requestBody.content['application/json'].schema.$ref.split('/').at(-1);
        assert.ok(spec.components.schemas[name].required.includes('requestId'));
      }
      assert.ok(
        Object.values(op.responses).some(
          (r) => r.headers?.['Cache-Control']?.schema.const === 'private, no-store',
        ),
      );
    }
  }
});
test('publishing independent content is an explicit, revision-bound action', () => {
  assert.ok(
    check('ExperiencePublish')({
      requestId: id,
      expectedRevision: 1,
      versionId: id,
      independentCopyConfirmed: true,
    }),
  );
  assert.equal(check('ExperiencePublish')({ requestId: id, expectedRevision: 1, versionId: id }), false);
  assert.equal(
    check('ExperiencePublish')({
      requestId: id,
      expectedRevision: 0,
      versionId: id,
      independentCopyConfirmed: true,
    }),
    false,
  );
});

test('automatic checking is a distinct origin pair, never interchangeable with manual provenance', () => {
  const version = {
    id,
    number: 1,
    schemaVersion: 1,
    content,
    evidence: [],
    origin: 'AUTOMATIC',
    evaluation: 'AUTOMATIC_CHECKED',
    createdBy: id,
    createdAt: '2026-10-01T00:00:00Z',
  };
  const validate = check('ExperienceVersion');
  assert.ok(validate(version));
  assert.equal(validate({ ...version, origin: 'MANUAL' }), false);
  assert.equal(validate({ ...version, evaluation: 'NOT_EVALUATED' }), false);
});

test('restoration requires the original publication and expected revision', () => {
  assert.ok(check('ExperienceRestore')({ requestId: id, expectedRevision: 3, versionId: id }));
  assert.equal(check('ExperienceRestore')({ requestId: id, expectedRevision: 3 }), false);
  assert.equal(check('ExperienceRestore')({ requestId: id, expectedRevision: 0, versionId: id }), false);
  assert.equal(
    check('ExperienceRestore')({ requestId: id, expectedRevision: 3, versionId: id, content }),
    false,
  );
});
