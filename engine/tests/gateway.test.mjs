import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { DeepSeekModel } from '../dist/runtime/deepseek-model.js';
import { AgentTasks } from '../dist/runtime/agent-task.js';
import { createEngineServer } from '../dist/server.js';
import { close, listen, json, completion, body, fixtureEngine } from './fixtures/agent.mjs';
const request = (signal) => ({
  messages: [{ role: 'user', content: [{ type: 'text', text: 'synthetic' }] }],
  tools: [],
  maxTokens: 10,
  signal: signal || new AbortController().signal,
});
const collect = async (iterable) => {
  const out = [];
  for await (const part of iterable) out.push(part);
  return out;
};
const model = (url) =>
  new DeepSeekModel({
    model: 'fixture',
    apiKey: 'synthetic-secret',
    endpoint: url + '/chat/completions',
    localVerification: true,
    timeoutMs: 150,
  });
test('model wire validates configuration and handles actual HTTP replies and absent usage', async (t) => {
  for (const endpoint of [
    'http://api.deepseek.com/chat/completions',
    'https://evil.example/chat/completions',
    'https://api.deepseek.com/chat/completions?leak=x',
  ])
    assert.throws(() => new DeepSeekModel({ model: 'x', apiKey: 'secret', endpoint }));
  let count = 0;
  const server = createServer(async (req, res) => {
    const input = await body(req);
    assert.equal(input.thinking.type, 'disabled');
    assert.equal(req.headers.authorization, 'Bearer synthetic-secret');
    count++;
    const value = completion('hello');
    if (count === 2) delete value.usage;
    json(res, value);
  });
  const url = await listen(server);
  t.after(() => close(server));
  const adapter = model(url);
  assert.deepEqual(await collect(adapter.generate(request())), [
    { type: 'text', text: 'hello' },
    { type: 'finish', reason: 'stop' },
  ]);
  assert.deepEqual(adapter.usage, { inputTokens: 10, outputTokens: 5 });
  await collect(adapter.generate(request()));
  assert.equal(adapter.usage, null);
});
test('model rejects malformed, oversized, redirected and stalled responses without reflecting secrets', async (t) => {
  let scenario = 'malformed';
  const server = createServer((req, res) => {
    if (scenario === 'redirect') {
      res.writeHead(302, { location: 'http://127.0.0.1:1/' });
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    if (scenario === 'stalled') return res.write('{');
    if (scenario === 'large') return res.end(JSON.stringify({ text: 'x'.repeat(140000) }));
    res.end(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'secret' }, finish_reason: 'untrusted' }],
      }),
    );
  });
  const url = await listen(server);
  t.after(() => close(server));
  for (scenario of ['malformed', 'large', 'redirect', 'stalled'])
    await assert.rejects(
      collect(model(url).generate(request())),
      (e) => e.code && !e.message.includes('synthetic-secret'),
    );
});
test('model cancellation aborts a response body, not just the headers', async (t) => {
  let aborted = false;
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{');
    res.on('close', () => (aborted = true));
  });
  const url = await listen(server);
  t.after(() => close(server));
  const controller = new AbortController();
  const running = collect(model(url).generate(request(controller.signal)));
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(running, { code: 'CANCELLED' });
  await delay(40);
  assert.equal(aborted, true);
});
test('default HTTP engine never manufactures an Agent response; internal token is required', async (t) => {
  const token = 'synthetic-'.repeat(5),
    server = createEngineServer({ token });
  const url = await listen(server);
  t.after(() => close(server));
  for (const [headers, status] of [
    [{}, 401],
    [{ Authorization: `Bearer ${token}` }, 503],
  ]) {
    const r = await fetch(url + '/internal/v1/agent-results', { method: 'POST', headers, body: '{}' });
    assert.equal(r.status, status);
  }
});
test(
  'real HTTP adapter → Harness → sandbox → artifact, authorized callbacks and replay fence',
  { skip: process.platform !== 'darwin' },
  async (t) => {
    const taskId = randomUUID(),
      attemptId = randomUUID(),
      sourceId = randomUUID();
    let checks = 0;
    const platform = createServer(async (req, res) => {
      assert.equal(req.headers.authorization, `Bearer ${attemptId}`);
      assert.ok(req.url.startsWith(`/internal/v1/agent-access/${taskId}/`));
      await body(req);
      checks++;
      json(
        res,
        req.url.endsWith('/check')
          ? { allowed: true, executionClass: 'verification' }
          : {
              items: [
                {
                  id: sourceId,
                  filename: 'amount.md',
                  version: 1,
                  locator: 'L1',
                  content: 'amount=1001\namount=999',
                },
              ],
            },
      );
    });
    const platformUrl = await listen(platform);
    t.after(() => close(platform));
    const fixture = await fixtureEngine(platformUrl, 'synthetic-'.repeat(5));
    t.after(() => fixture.stop());
    const input = { contractVersion: '1.4', taskId, attemptId, prompt: 'sum amount' };
    const send = () =>
      fetch(fixture.url + '/internal/v1/agent-results', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + 'synthetic-'.repeat(5) },
        body: JSON.stringify(input),
      });
    const result = await (await send()).json();
    assert.ok(result.text, JSON.stringify({ result, requests: fixture.stats.requests }));
    assert.equal(result.text, '联调验证：实际工具计算合计 2000 分；未调用真实模型。');
    assert.equal(result.modelCalls, 3);
    assert.deepEqual(result.usage, { inputTokens: 30, outputTokens: 15 });
    assert.deepEqual(result.sourceIds, [sourceId]);
    assert.equal(JSON.parse(Buffer.from(result.artifacts[0].contentBase64, 'base64')).totalCents, '2000');
    assert.ok(checks >= 5);
    assert.ok(!JSON.stringify(fixture.stats.requests).includes(attemptId));
    assert.equal((await send()).status, 409);
  },
);
test(
  'revoked permission aborts an in-flight model response and never publishes a result',
  { timeout: 10000 },
  async (t) => {
    let allowed = true;
    const platform = createServer((req, res) =>
      json(res, { allowed, executionClass: 'verification' }, allowed ? 200 : 403),
    );
    const url = await listen(platform);
    t.after(() => close(platform));
    const fixture = await fixtureEngine(url, 'synthetic-'.repeat(5));
    t.after(() => fixture.stop());
    const result = fetch(fixture.url + '/internal/v1/agent-results', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + 'synthetic-'.repeat(5) },
      body: JSON.stringify({
        contractVersion: '1.4',
        taskId: randomUUID(),
        attemptId: randomUUID(),
        prompt: '等待取消',
      }),
    });
    while (!fixture.stats.calls) await delay(20, undefined, { signal: t.signal });
    allowed = false;
    const response = await result;
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'TASK_ACCESS_DENIED');
    await delay(50);
    assert.equal(fixture.stats.aborted, 1);
    assert.equal(fixture.stats.calls, 1);
  },
);
test('live Agent rejects local code execution capability at configuration time', () =>
  assert.throws(
    () =>
      new AgentTasks({
        platformBaseUrl: 'http://127.0.0.1:1',
        executionClass: 'live',
        modelName: 'x',
        createModel() {},
        sandbox: {},
      }),
    { code: 'LIVE_CODE_NOT_AVAILABLE' },
  ));
