import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { BailianModel } from '../dist/runtime/bailian-model.js';
import { runHarness } from '../dist/runtime/harness.js';
import { body, listen, close } from './fixtures/agent.mjs';
const frame = (delta = {}, finish_reason = null) => ({ choices: [{ index: 0, delta, finish_reason }] });
const send = (res, data) => res.write(`data: ${JSON.stringify(data)}\r\n\r\n`);
const model = (url) =>
  new BailianModel({
    model: 'qwen3.7-plus-2026-05-26',
    apiKey: 'synthetic',
    workspaceId: 'synthetic',
    localVerification: true,
    endpoint: url + '/compatible-mode/v1/chat/completions',
    timeoutMs: 2000,
  });
const request = (signal) => ({
  messages: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
  tools: [],
  maxTokens: 2048,
  signal,
});
test('real SSE text arrives before completion, split UTF-8 is preserved, usage follows finish', async (t) => {
  let release;
  const gate = new Promise((r) => (release = r));
  const server = createServer(async (req, res) => {
    const input = await body(req);
    assert.equal(input.stream, true);
    assert.equal(input.stream_options.include_usage, true);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const bytes = Buffer.from(
      `data: ${JSON.stringify(frame({ role: 'assistant', content: '你好🙂' }))}\r\n\r\n`,
    );
    const at = bytes.indexOf(Buffer.from('你')) + 1;
    res.write(bytes.subarray(0, at));
    await delay(10);
    res.write(bytes.subarray(at));
    await gate;
    send(res, frame({ content: '，继续' }));
    send(res, frame({}, 'stop'));
    send(res, { choices: [], usage: { prompt_tokens: 12, completion_tokens: 7 } });
    res.end('data: [DONE]\n\n');
  });
  const url = await listen(server);
  t.after(() => close(server));
  const adapter = model(url),
    iterator = adapter.generate(request(new AbortController().signal))[Symbol.asyncIterator]();
  assert.deepEqual((await iterator.next()).value, { type: 'text', text: '你好🙂' });
  release();
  const rest = [];
  for await (const part of { [Symbol.asyncIterator]: () => iterator }) rest.push(part);
  assert.deepEqual(rest, [
    { type: 'text', text: '，继续' },
    { type: 'finish', reason: 'stop' },
  ]);
  assert.deepEqual(adapter.usage, { inputTokens: 12, outputTokens: 7 });
});
test('fragmented tool JSON executes only after complete frame and DONE', async (t) => {
  let complete = false,
    executions = 0,
    calls = 0;
  const server = createServer(async (req, res) => {
    await body(req);
    calls++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (calls === 1) {
      send(
        res,
        frame({
          tool_calls: [
            { index: 0, id: 'lookup-1', type: 'function', function: { name: 'lookup', arguments: '{"q":' } },
          ],
        }),
      );
      await delay(20);
      assert.equal(executions, 0);
      send(res, frame({ tool_calls: [{ index: 0, function: { arguments: '"合成"}' } }] }));
      send(res, frame({}, 'tool_calls'));
      complete = true;
    } else {
      send(res, frame({ content: '合成结论' }));
      send(res, frame({}, 'stop'));
    }
    res.end('data: [DONE]\n\n');
  });
  const url = await listen(server);
  t.after(() => close(server));
  const result = await runHarness({
    prompt: 'test',
    model: model(url),
    tools: [
      {
        name: 'lookup',
        description: 'synthetic',
        parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
        execute: async (args) => {
          assert.ok(complete);
          assert.equal(args.q, '合成');
          executions++;
          return { ok: true };
        },
      },
    ],
  });
  assert.equal(executions, 1);
  assert.equal(result.text, '合成结论');
  assert.equal(result.status, 'completed');
});
test('interrupted streams and explicit cancellation never deliver a final answer or retry', async (t) => {
  for (const cancel of [false, true]) {
    let calls = 0;
    const server = createServer((req, res) => {
      calls++;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      send(res, frame({ content: '部分' }));
      if (!cancel) res.end();
    });
    const url = await listen(server);
    t.after(() => close(server));
    const controller = new AbortController();
    const it = model(url).generate(request(controller.signal))[Symbol.asyncIterator]();
    assert.equal((await it.next()).value.text, '部分');
    if (cancel) controller.abort();
    await assert.rejects(it.next(), { code: cancel ? 'CANCELLED' : 'MODEL_INCOMPLETE' });
    assert.equal(calls, 1);
  }
});

test('agent publishes visible snapshots before model completion without per-token database calls', async (t) => {
  const { AgentTasks } = await import('../dist/runtime/agent-task.js');
  const { usageFixture } = await import('./fixtures/usage.mjs');
  const { randomUUID } = await import('node:crypto');
  let release, first;
  const gate = new Promise((r) => (release = r)),
    visible = new Promise((r) => (first = r));
  const snapshots = [];
  const server = createServer();
  server.on('request', async (req, res) => {
    if (usageFixture(req, res)) return;
    const input = await body(req);
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/check'))
      return res.end(
        JSON.stringify({ allowed: true, executionClass: 'verification', answerStreamVersion: '1.0' }),
      );
    if (req.url.endsWith('/answer')) {
      snapshots.push(input);
      res.end('{"accepted":true}');
      first();
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  const url = await listen(server);
  t.after(() => close(server));
  const agent = new AgentTasks({
    platformBaseUrl: url,
    executionClass: 'verification',
    modelName: 'synthetic-stream',
    createModel: () => ({
      usage: null,
      async *generate() {
        yield { type: 'text', text: '第一段' };
        await gate;
        for (let i = 0; i < 10; i++) yield { type: 'text', text: '字' };
        yield { type: 'finish', reason: 'stop' };
      },
    }),
  });
  let complete = false;
  const pending = agent
    .run(
      { contractVersion: '1.4', taskId: randomUUID(), attemptId: randomUUID(), prompt: '合成流式' },
      new AbortController().signal,
    )
    .then((value) => {
      complete = true;
      return value;
    });
  await visible;
  assert.equal(complete, false);
  assert.equal(snapshots[0].text, '第一段');
  release();
  const result = await pending;
  assert.equal(result.text, '第一段' + '字'.repeat(10));
  assert.equal(snapshots.at(-1).state, 'COMPLETE');
  assert.equal(snapshots.at(-1).text, result.text);
  assert.ok(snapshots.length < 11);
  assert.equal(new Set(snapshots.map((s) => s.step)).size, 1);
});

test('completed SSE responses drain a short tail and reuse the connection for the next model round', async (t) => {
  const sockets = new Set();
  const server = createServer(async (req, res) => {
    sockets.add(req.socket);
    await body(req);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    send(res, frame({ content: '合成完成' }));
    send(res, frame({}, 'stop'));
    res.write('data: [DONE]\n\n');
    await delay(30);
    res.end();
  });
  const url = await listen(server); t.after(() => close(server));
  const adapter = model(url);
  for (let i = 0; i < 2; i++) {
    const output = [];
    for await (const part of adapter.generate(request(new AbortController().signal))) output.push(part);
    assert.equal(output.at(-1).reason, 'stop');
    await delay(10);
  }
  assert.equal(sockets.size, 1, 'finished HTTP body should keep the existing connection reusable');
});

test('SSE tail cleanup is bounded and cancellation during cleanup cannot produce a final answer', async (t) => {
  const server = createServer(async (req, res) => {
    await body(req);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    send(res, frame({ content: '合成' })); send(res, frame({}, 'stop'));
    res.write('data: [DONE]\n\n'); // Intentionally never closes: must not wait for the model timeout.
  });
  const url = await listen(server); t.after(() => close(server));
  const adapter = model(url), start = performance.now(), output = [];
  for await (const part of adapter.generate(request(new AbortController().signal))) output.push(part);
  assert.equal(output.at(-1).reason, 'stop');
  assert.ok(performance.now() - start < 1000);
  const controller = new AbortController(), cancelled = [];
  const timer = setTimeout(() => controller.abort(), 50);
  try {
    await assert.rejects(async () => {
      for await (const part of adapter.generate(request(controller.signal))) cancelled.push(part);
    }, { code: 'CANCELLED' });
    assert.ok(!cancelled.some(p => p.type === 'finish'));
  } finally { clearTimeout(timer); }
});
