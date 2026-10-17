import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { meteredModel } from '../dist/runtime/metered-model.js';
import { DeepSeekModel } from '../dist/runtime/deepseek-model.js';
import { AgentTasks } from '../dist/runtime/agent-task.js';
import { listen, close, json, completion } from './fixtures/agent.mjs';
const collect = async (stream) => {
  for await (const _ of stream) {
  }
};
const request = (signal = new AbortController().signal) => ({
  messages: [{ role: 'user', content: [{ type: 'text', text: 'synthetic-only' }] }],
  tools: [],
  maxTokens: 2048,
  signal,
});
const callback = (events) => async (action, body, receipt) => {
  events.push({ action, body, receipt });
  return { accepted: true };
};
const adapter = (url) =>
  new DeepSeekModel({
    model: 'fixture',
    apiKey: 'synthetic',
    endpoint: url + '/chat/completions',
    localVerification: true,
    // Allow the synthetic HTTP fixture to respond under concurrent test load.
    timeoutMs: 1000,
  });

test('metering retains usage from malformed responses and distinguishes a later missing response', async (t) => {
  let malformed = true;
  const server = createServer((_req, res) => {
    const body = completion('synthetic');
    if (malformed) body.choices[0].finish_reason = 'invalid';
    else delete body.usage;
    json(res, body);
  });
  const url = await listen(server);
  t.after(() => close(server));
  const backend = adapter(url),
    events = [],
    model = meteredModel(backend, callback(events));
  await assert.rejects(collect(model.generate(request())));
  assert.deepEqual(events[1].body, { sequence: 1, outcome: 'FAILED', inputTokens: 10, outputTokens: 5 });
  malformed = false;
  await collect(model.generate(request()));
  assert.deepEqual(events[3].body, {
    sequence: 2,
    outcome: 'RETURNED',
    inputTokens: null,
    outputTokens: null,
  });
  assert.equal(backend.usage, null);
});

test('timeout usage remains unknown and a subsequent reported call still has its own usage', async (t) => {
  let stalled = true;
  const server = createServer((_req, res) => {
    if (stalled) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{');
    } else json(res, completion('ok'));
  });
  const url = await listen(server);
  t.after(() => close(server));
  const backend = adapter(url),
    events = [],
    model = meteredModel(backend, callback(events));
  await assert.rejects(collect(model.generate(request())));
  assert.equal(events[1].body.inputTokens, null);
  stalled = false;
  await collect(model.generate(request()));
  assert.equal(events[3].body.inputTokens, 10);
  assert.equal(backend.usage, null); // A later known response cannot fill an earlier missing receipt.
});

test('refused reservation prevents model dispatch, and uncertain completion is never retried', async () => {
  let calls = 0;
  const backend = {
    async *generate() {
      calls++;
      yield { type: 'finish', reason: 'stop' };
    },
  };
  const denied = meteredModel(backend, async () => {
    throw Error('denied');
  });
  await assert.rejects(collect(denied.generate(request())));
  assert.equal(calls, 0);
  let receipts = 0;
  const uncertain = meteredModel(backend, async (action) => {
    if (action.endsWith('/finish')) {
      receipts++;
      throw Error('lost receipt');
    }
    return { accepted: true };
  });
  await assert.rejects(collect(uncertain.generate(request())));
  assert.equal(calls, 1);
  assert.equal(receipts, 1);
});

test('cancellation sends only metadata receipt with independent signal semantics and no stale tokens', async () => {
  const events = [],
    controller = new AbortController();
  controller.abort();
  let calls = 0;
  const backend = {
    lastUsage: { inputTokens: 100, outputTokens: 20 },
    async *generate() {
      calls++;
    },
  };
  await assert.rejects(collect(meteredModel(backend, callback(events)).generate(request(controller.signal))));
  assert.equal(calls, 0);
  assert.equal(events[1].receipt, true);
  assert.deepEqual(events[1].body, {
    sequence: 1,
    outcome: 'CANCELLED',
    inputTokens: null,
    outputTokens: null,
  });
});

test('model call and output limits are enforced before dispatch', async () => {
  const events = [];
  let calls = 0;
  const backend = {
    async *generate() {
      calls++;
      yield { type: 'finish', reason: 'stop' };
    },
  };
  const model = meteredModel(backend, callback(events));
  await assert.rejects(collect(model.generate({ ...request(), maxTokens: 2049 })), { code: 'TASK_LIMIT' });
  for (let n = 0; n < 8; n++) await collect(model.generate(request()));
  await assert.rejects(collect(model.generate(request())), { code: 'TASK_LIMIT' });
  assert.equal(calls, 8);
  assert.equal(events.length, 16);
});

test('new engine refuses a platform without the metering handshake before any model call', async (t) => {
  const server = createServer((_req, res) => json(res, { allowed: true, executionClass: 'verification' }));
  const url = await listen(server);
  t.after(() => close(server));
  let calls = 0;
  const agent = new AgentTasks({
    platformBaseUrl: url,
    executionClass: 'verification',
    modelName: 'fixture',
    createModel() {
      calls++;
      return { async *generate() {} };
    },
  });
  await assert.rejects(
    agent.run(
      { contractVersion: '1.4', taskId: randomUUID(), attemptId: randomUUID(), prompt: 'synthetic' },
      new AbortController().signal,
    ),
    { code: 'TASK_RUNTIME_INCOMPATIBLE' },
  );
  assert.equal(calls, 0);
});

test('Harness may close the stream at finish without turning a returned response into failure', async () => {
  const events = [];
  const backend = {
    async *generate() {
      yield { type: 'text', text: 'ok' };
      yield { type: 'finish', reason: 'stop' };
    },
  };
  for await (const part of meteredModel(backend, callback(events)).generate(request())) {
    if (part.type === 'finish') break;
  }
  assert.equal(events[1].body.outcome, 'RETURNED');
});

test('model failure diagnostics exclude arbitrary provider errors and request data', async (t) => {
  const warnings = [];
  t.mock.method(console, 'warn', (value) => warnings.push(JSON.parse(value)));
  const events = [];
  const backend = {
    async *generate() {
      throw new Error('synthetic secret must never reach diagnostic logs');
    },
  };
  await assert.rejects(collect(meteredModel(backend, callback(events)).generate(request())));
  assert.deepEqual(warnings, [{ event: 'TASK_MODEL_REQUEST_FAILED', sequence: 1, code: 'MODEL_ERROR' }]);
  assert.equal(events[1].body.outcome, 'FAILED');
});
