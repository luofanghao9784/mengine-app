import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
const ajv = new Ajv({ strict: false, formats: { uuid: true, 'date-time': true } }),
  id = '00000000-0000-4000-8000-000000000001';
const schema = JSON.parse(
  await readFile(new URL('../../contracts/engine-api/artifact-transfer.schema.json', import.meta.url)),
);
test('transfer contract bounds chunks and forbids caller authority', () => {
  const check = ajv.compile(schema.$defs.prepare);
  const p = {
    clientKey: id,
    filename: 'report.pptx',
    mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    bytes: 600000,
    sha256: 'a'.repeat(64),
  };
  assert.ok(check(p));
  for (const patch of [{ tenantId: id }, { bytes: 20971521 }, { filename: '../report.pptx' }])
    assert.equal(check({ ...p, ...patch }), false);
  const chunk = ajv.compile(schema.$defs.chunk);
  assert.ok(chunk({ offset: 0, contentBase64: 'AA==' }));
  assert.equal(chunk({ offset: -1, contentBase64: 'AA==' }), false);
  assert.equal(chunk({ offset: 0, contentBase64: 'A'.repeat(349529) }), false);
});
test('artifact refs require v1.5 and cannot mix inline content', async () => {
  const source = JSON.parse(
    await readFile(new URL('../../contracts/engine-api/agent-results.schema.json', import.meta.url)),
  );
  const check = ajv.compile(source.$defs.result);
  const artifact = { name: 'report.pptx', sha256: 'a'.repeat(64), uploadId: id };
  const result = {
    contractVersion: '1.5',
    engineVersion: 'test',
    taskId: id,
    attemptId: id,
    mode: 'AGENT',
    executionClass: 'verification',
    modelName: 'test',
    text: 'test',
    sourceIds: [],
    originalIds: [],
    tools: [],
    artifacts: [artifact],
    webSources: [],
    skills: [],
    modelCalls: 1,
    usage: null,
    outcome: 'COMPLETE',
    requiredInput: null,
  };
  assert.ok(check(result), JSON.stringify(check.errors));
  assert.equal(check({ ...result, artifacts: [{ ...artifact, contentBase64: 'AA==' }] }), false);
  const { outcome, requiredInput, ...old } = result;
  assert.equal(check({ ...old, contractVersion: '1.4' }), false);
  assert.ok(
    check({
      ...old,
      contractVersion: '1.4',
      artifacts: [{ name: artifact.name, sha256: artifact.sha256, contentBase64: 'AA==' }],
    }),
  );
});
