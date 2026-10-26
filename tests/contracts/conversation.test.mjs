import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
const spec = JSON.parse(
  await readFile(new URL('../../contracts/public-api/conversation.openapi.json', import.meta.url), 'utf8'),
);
const engine = JSON.parse(
  await readFile(new URL('../../contracts/engine-api/source-results.schema.json', import.meta.url), 'utf8'),
);
const ajv = new Ajv2020({ strict: false, formats: { uuid: true, 'date-time': true } }),
  id = '00000000-0000-4000-8000-000000000001';
test('conversation events include persisted live updates without accepting unknown kinds', () => {
  const check = ajv.compile(spec.components.schemas.Event);
  const event = { seq: 2, taskId: id, kind: 'LIVE', revision: 1 };
  assert.ok(check(event));
  assert.ok(check({ ...event, kind: 'SUCCEEDED', revision: 2 }));
  assert.equal(check({ ...event, kind: 'UNKNOWN' }), false);
});
test('conversation writes require CSRF, caller idempotency key and explicit local mode', () => {
  for (const path of Object.values(spec.paths))
    if (path.post)
      assert.ok(
        path.post.parameters.some((p) => p.in === 'header' && p.name === 'X-CSRF-TOKEN' && p.required),
      );
  const send = ajv.compile(spec.components.schemas.Send),
    action = ajv.compile(spec.components.schemas.Action);
  assert.ok(send({ requestId: id, workspaceId: id, prompt: 'hello', mode: 'SOURCE_LOOKUP' }));
  assert.equal(send({ requestId: id, prompt: 'hello', mode: 'AI_CHAT' }), false);
  assert.equal(send({ prompt: 'hello', mode: 'SOURCE_LOOKUP' }), false);
  assert.ok(action({ requestId: id, expectedRevision: 0, action: 'CANCEL' }));
  assert.equal(action({ requestId: id, action: 'RETRY' }), false);
});
test('local engine receives bounded source handles without host paths or model-generated text', () => {
  const request = ajv.compile(engine.$defs.request),
    result = ajv.compile(engine.$defs.result);
  const body = { contractVersion: '1.0', taskId: id, attemptId: id, sourceIds: [id] };
  assert.ok(request(body));
  assert.equal(request({ ...body, sourceIds: [id, id] }), false);
  assert.equal(request({ ...body, path: '/tmp/private' }), false);
  const done = { ...body, engineVersion: '0.2.0', mode: 'SOURCE_LOOKUP', summaryCode: 'SOURCES_FOUND' };
  assert.ok(result(done));
  assert.equal(result({ ...done, text: 'fabricated reply' }), false);
});
test('capability schema requires matching opt-in local mode and exact implemented capability', async () => {
  const schema = JSON.parse(
    await readFile(new URL('../../contracts/engine-api/capabilities.schema.json', import.meta.url), 'utf8'),
  );
  const check = ajv.compile(schema);
  const base = {
    contractVersion: '1.0',
    engineVersion: '0.2.0',
    runtimeMode: 'local-retrieval',
    capabilities: ['source-lookup'],
  };
  assert.ok(check(base));
  assert.equal(check({ ...base, capabilities: [] }), false);
  assert.equal(check({ ...base, runtimeMode: 'contract-only' }), false);
  assert.equal(check({ ...base, capabilities: ['agent-chat'] }), false);
});
test('Agent protocol carries attempt-scoped authority, bounded receipts and separate verification mode', async () => {
  const schema = JSON.parse(
    await readFile(new URL('../../contracts/engine-api/agent-results.schema.json', import.meta.url), 'utf8'),
  );
  const request = ajv.compile(schema.$defs.request),
    result = ajv.compile(schema.$defs.result);
  const input = { contractVersion: '1.4', taskId: id, attemptId: id, prompt: '整理工作' };
  assert.ok(request(input));
  assert.equal(request({ ...input, contractVersion: '1.0' }), false);
  assert.equal(request({ ...input, contractVersion: '1.1' }), false);
  assert.equal(request({ ...input, contractVersion: '1.2' }), false);
  assert.equal(request({ ...input, contractVersion: '1.3' }), false);
  for (const extra of [{ tenantId: id }, { apiKey: 'secret' }, { callbackUrl: 'http://evil' }])
    assert.equal(request({ ...input, ...extra }), false);
  const valid = {
    contractVersion: '1.4',
    engineVersion: '0.3.0',
    taskId: id,
    attemptId: id,
    mode: 'AGENT',
    executionClass: 'verification',
    modelName: 'fixture',
    text: 'fixture',
    sourceIds: [],
    originalIds: [],
    tools: [],
    artifacts: [],
    webSources: [],
    skills: [],
    modelCalls: 1,
    usage: null,
  };
  assert.ok(result(valid));
  assert.ok(result({ ...valid, tools: [{ callId: 'trial', name: 'candidate_tool', status: 'succeeded' }] }));
  assert.equal(result({ ...valid, executionClass: 'mock-live' }), false);
  assert.equal(result({ ...valid, modelCalls: 9 }), false);
  assert.equal(
    result({ ...valid, artifacts: [{ name: '../private', sha256: '0'.repeat(64), contentBase64: '' }] }),
    false,
  );
  const send = ajv.compile(spec.components.schemas.Send);
  assert.ok(send({ requestId: id, workspaceId: id, prompt: 'x'.repeat(201), mode: 'AGENT' }));
  assert.equal(
    send({ requestId: id, workspaceId: id, prompt: 'x'.repeat(201), mode: 'SOURCE_LOOKUP' }),
    false,
  );
});
test('public query is optional, bounded and unavailable to local lookup mode', () => {
  const send = ajv.compile(spec.components.schemas.Send);
  const input = {
    requestId: id,
    workspaceId: id,
    prompt: 'research',
    mode: 'AGENT',
    publicQuery: 'public topic',
  };
  assert.ok(send(input));
  assert.equal(send({ ...input, mode: 'SOURCE_LOOKUP' }), false);
  assert.equal(send({ ...input, publicQuery: 'x'.repeat(2049) }), false);
});

test('original contracts pin exact versions and reject arbitrary file paths or unbounded manifests', async () => {
  const schema = JSON.parse(
    await readFile(
      new URL('../../contracts/engine-api/original-access.schema.json', import.meta.url),
      'utf8',
    ),
  );
  const read = ajv.compile(schema.$defs.readRequest),
    content = ajv.compile(schema.$defs.readResult),
    list = ajv.compile(schema.$defs.listResult),
    send = ajv.compile(spec.components.schemas.Send);
  assert.ok(read({ versionId: id }));
  assert.equal(read({ versionId: id, path: '/private' }), false);
  assert.ok(content({ versionId: id, sha256: 'a'.repeat(64), contentBase64: 'AA==' }));
  assert.equal(content({ versionId: id, sha256: 'a'.repeat(64), contentBase64: 'a'.repeat(349529) }), false);
  const original = {
    materialId: id,
    versionId: id,
    filename: 'file.csv',
    version: 1,
    bytes: 10,
    sha256: 'a'.repeat(64),
    read: false,
  };
  assert.ok(list({ items: [original] }));
  assert.equal(list({ items: [{ ...original, bytes: 262145 }] }), false);
  const body = {
    requestId: id,
    workspaceId: id,
    prompt: 'whole file',
    mode: 'AGENT',
    originals: [{ materialId: id, versionId: id }],
  };
  assert.ok(send(body));
  assert.equal(send({ ...body, mode: 'SOURCE_LOOKUP' }), false);
  assert.equal(send({ ...body, originals: [{ materialId: id, versionId: id, objectId: id }] }), false);
});

test('control protocol supports explicit wait/partial without manual success or legacy ambiguity', async () => {
  const schema = JSON.parse(
    await readFile(new URL('../../contracts/engine-api/agent-results.schema.json', import.meta.url), 'utf8'),
  );
  const request = ajv.compile(schema.$defs.request),
    result = ajv.compile(schema.$defs.result),
    action = ajv.compile(spec.components.schemas.Action);
  assert.ok(request({ contractVersion: '1.5', taskId: id, attemptId: id, prompt: 'x'.repeat(3000) }));
  assert.equal(
    request({ contractVersion: '1.4', taskId: id, attemptId: id, prompt: 'x'.repeat(3000) }),
    false,
  );
  const current = {
    contractVersion: '1.5',
    engineVersion: '0.11.0',
    taskId: id,
    attemptId: id,
    mode: 'AGENT',
    executionClass: 'verification',
    modelName: 'synthetic',
    text: '需要信息',
    sourceIds: [],
    originalIds: [],
    tools: [{ callId: 'control', name: 'task_control', status: 'succeeded' }],
    artifacts: [],
    webSources: [],
    skills: [],
    modelCalls: 2,
    usage: null,
    outcome: 'WAITING_INPUT',
    requiredInput: '请补充日期',
  };
  assert.ok(result(current));
  assert.equal(result({ ...current, requiredInput: null }), false);
  assert.equal(result({ ...current, contractVersion: '1.4' }), false);
  assert.ok(
    result({
      ...current,
      outcome: 'PARTIAL',
      tools: [{ callId: 'search', name: 'search_sources', status: 'failed' }],
    }),
  );
  assert.equal(
    result({
      ...current,
      outcome: 'COMPLETE',
      tools: [{ callId: 'search', name: 'search_sources', status: 'failed' }],
    }),
    false,
  );
  assert.ok(action({ requestId: id, expectedRevision: 2, action: 'RESUME', input: '周五' }));
  assert.equal(action({ requestId: id, expectedRevision: 2, action: 'SUCCEED' }), false);
  assert.equal(
    action({ requestId: id, expectedRevision: 2, action: 'RECONCILE', input: '我确认成功' }),
    false,
  );
});

test('execution evidence registers a bounded read-only allowlist without identity or manual success', async () => {
  const schema = JSON.parse(
    await readFile(
      new URL('../../contracts/engine-api/task-execution-control.schema.json', import.meta.url),
      'utf8',
    ),
  );
  const open = ajv.compile(schema.$defs.open),
    receipt = ajv.compile(schema.$defs.receipt);
  assert.ok(open({ contractVersion: '1.5', tools: ['search_sources', 'task_control'] }));
  assert.equal(open({ contractVersion: '1.5', tools: ['send_payment'] }), false);
  assert.equal(open({ contractVersion: '1.5', tools: ['search_sources'], tenantId: id }), false);
  assert.ok(receipt({ sequence: 1, name: 'search_sources', status: 'STARTED' }));
  assert.equal(receipt({ sequence: 9, name: 'search_sources', status: 'succeeded' }), false);
  assert.equal(receipt({ sequence: 1, name: 'task_control', status: 'BUSINESS_DONE' }), false);
  const rejected = {sequence:1,name:'task_context',status:'failed',rejection:'CONTEXT_ARGUMENTS'};
  assert.ok(receipt(rejected));
  for (const patch of [{name:'search_sources'}, {status:'succeeded'}, {status:'STARTED'}, {rejection:'REMOTE_TIMEOUT'}, {rejection:null}])
    assert.equal(receipt({...rejected,...patch}), false);
});
