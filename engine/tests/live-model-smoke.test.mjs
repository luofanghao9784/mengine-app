import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/live-model-smoke.mjs', import.meta.url));
const key = 'synthetic-smoke-secret';
const workspace = 'synthetic-smoke';
const model = 'qwen3.7-plus-2026-05-26';
const privateText = 'synthetic-response-body-must-not-be-logged';
// This transport replacement exists only inside test-owned child processes. Every other origin fails closed.
const wrapper = `
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => {
    const target = new URL(url);
    if (target.href !== 'https://synthetic-smoke.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions')
      throw new Error('Test blocked an unexpected origin');
    return originalFetch(new URL(target.pathname, process.env.SMOKE_TEST_ORIGIN), options);
  };
  process.argv = [process.execPath, process.env.SMOKE_TEST_SCRIPT, ...JSON.parse(process.env.SMOKE_TEST_ARGS)];
  await import((await import('node:url')).pathToFileURL(process.env.SMOKE_TEST_SCRIPT));
`;
const completion = (text, calls = [], reason = calls.length ? 'tool_calls' : 'stop') => ({
  choices: [{ finish_reason: reason, message: { role: 'assistant', content: text, ...(calls.length ? { tool_calls: calls } : {}) } }],
  usage: { prompt_tokens: 12, completion_tokens: 4 },
});
const call = (name = 'smoke_marker', args = '{}', id = 'synthetic-call-1') => ({
  id, type: 'function', function: { name, arguments: args },
});
const json = (res, body, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
async function fixture(t, handle) {
  const requests = [], errors = [];
  const server = createServer(async (req, res) => {
    try {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const input = JSON.parse(raw);
      requests.push({ input, headers: req.headers, url: req.url });
      await handle(input, res, requests.length);
    } catch (error) {
      errors.push(error);
      json(res, {}, 500);
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    const stopped = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await stopped;
    assert.deepEqual(errors, []);
  });
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
}
function start(origin, args = [], patch = {}) {
  const child = spawn(process.execPath, ['--input-type=module', '--eval', wrapper], {
    env: {
      PATH: process.env.PATH,
      AGENT_MODEL_PROVIDER: 'bailian', AGENT_MODEL_NAME: model,
      AGENT_MODEL_API_KEY: key, AGENT_BAILIAN_WORKSPACE_ID: workspace,
      SMOKE_TEST_ORIGIN: origin, SMOKE_TEST_SCRIPT: script, SMOKE_TEST_ARGS: JSON.stringify(args),
      ...patch,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', (data) => stdout += data);
  child.stderr.on('data', (data) => stderr += data);
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr, report: JSON.parse(stdout) }));
  });
  return { child, done };
}
function safe(result) {
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.trim().split('\n').length, 1);
  assert.deepEqual(Object.keys(result.report).sort(), ['status', 'provider', 'model', 'durationMs', 'usage', 'requestCount', 'liveVerified'].sort());
  for (const value of [key, workspace, privateText, script]) assert.ok(!result.stdout.includes(value));
  assert.ok(Number.isInteger(result.report.durationMs) && result.report.durationMs >= 0);
}

test('text smoke sends one bounded synthetic request through the real adapter and prints metadata only', async (t) => {
  const f = await fixture(t, (_input, res) => json(res, completion(privateText)));
  const result = await start(f.url).done;
  safe(result);
  assert.equal(result.code, 0);
  assert.equal(result.report.status, 'succeeded');
  assert.equal(result.report.liveVerified, true);
  assert.equal(result.report.provider, 'bailian');
  assert.equal(result.report.model, model);
  assert.equal(result.report.requestCount, 1);
  assert.deepEqual(result.report.usage, { inputTokens: 12, outputTokens: 4 });
  assert.equal(f.requests.length, 1);
  const request = f.requests[0];
  assert.equal(request.headers.authorization, `Bearer ${key}`);
  assert.equal(request.url, '/compatible-mode/v1/chat/completions');
  assert.equal(request.input.max_tokens, 64);
  assert.equal(request.input.stream, true);
  assert.equal(request.input.enable_thinking, false);
  assert.equal(request.input.tools, undefined);
  assert.equal(request.input.messages.length, 1);
  assert.match(request.input.messages[0].content, /synthetic connectivity check/);
});

test('tools smoke makes at most two calls and verifies exact call ID and unpredictable local marker replay', async (t) => {
  let marker;
  const f = await fixture(t, (input, res, number) => {
    assert.equal(input.max_tokens, 64);
    if (number === 1) {
      assert.equal(input.tools.length, 1);
      assert.equal(input.tools[0].function.name, 'smoke_marker');
      assert.deepEqual(input.tools[0].function.parameters, { type: 'object', properties: {}, additionalProperties: false });
      return json(res, completion(privateText, [call()]));
    }
    assert.equal(number, 2);
    assert.equal(input.tools, undefined);
    assert.equal(input.messages[1].role, 'assistant');
    assert.equal(input.messages[1].tool_calls[0].id, 'synthetic-call-1');
    assert.equal(input.messages[2].role, 'tool');
    assert.equal(input.messages[2].tool_call_id, 'synthetic-call-1');
    marker = JSON.parse(input.messages[2].content).marker;
    assert.match(marker, /^smoke-[a-f0-9-]{36}$/);
    assert.ok(!input.messages[0].content.includes(marker));
    json(res, completion(marker));
  });
  const result = await start(f.url, ['--tools']).done;
  safe(result);
  assert.equal(result.code, 0);
  assert.equal(result.report.requestCount, 2);
  assert.equal(f.requests.length, 2);
  assert.ok(!result.stdout.includes(marker));
  assert.deepEqual(result.report.usage, { inputTokens: 24, outputTokens: 8 });
});

test('off, invalid configuration and arbitrary CLI arguments do not dispatch or echo their input', async (t) => {
  const f = await fixture(t, (_input, res) => json(res, completion('unused')));
  for (const [patch, args, status, code] of [
    [{ AGENT_MODEL_PROVIDER: 'off' }, [], 'off', 1],
    [{ AGENT_MODEL_PROVIDER: key }, [], 'invalid_configuration', 2],
    [{ AGENT_BAILIAN_WORKSPACE_ID: `${key}@invalid` }, [], 'invalid_configuration', 2],
    [{ AGENT_MODEL_API_KEY: '' }, [], 'invalid_configuration', 2],
    [{ AGENT_MODEL_PROVIDER: 'deepseek', AGENT_MODEL_NAME: key }, [], 'invalid_configuration', 2],
    [{}, [`--endpoint=${key}`], 'invalid_arguments', 2],
    [{}, ['--tools', privateText], 'invalid_arguments', 2],
  ]) {
    const result = await start(f.url, args, patch).done;
    safe(result);
    assert.equal(result.code, code);
    assert.equal(result.report.status, status);
    assert.equal(result.report.requestCount, 0);
    assert.equal(result.report.liveVerified, false);
  }
  assert.equal(f.requests.length, 0);
});

test('provider failures are classified without body reflection, automatic retries or fallback', async (t) => {
  let responseStatus = 401;
  const f = await fixture(t, (_input, res) => json(res, { error: { message: `${key} ${privateText}` } }, responseStatus));
  for (responseStatus of [401, 403, 404, 429, 500]) {
    const before = f.requests.length;
    const result = await start(f.url).done;
    safe(result);
    assert.equal(result.code, 3);
    assert.equal(result.report.status, responseStatus < 429 ? 'remote_access_denied' : 'remote_unavailable');
    assert.equal(result.report.requestCount, 1);
    assert.equal(result.report.liveVerified, false);
    assert.equal(result.report.usage, null);
    assert.equal(f.requests.length, before + 1);
  }
});

test('truncation and malformed model responses never count as successful smoke checks', async (t) => {
  let response;
  const f = await fixture(t, (_input, res) => json(res, response));
  for (const [value, status] of [
    [completion(privateText, [], 'length'), 'output_limit'],
    [completion(''), 'invalid_response'],
    [{ error: { message: key } }, 'invalid_response'],
    [completion(null, [call()]), 'invalid_response'],
  ]) {
    response = value;
    const before = f.requests.length;
    const result = await start(f.url).done;
    safe(result);
    assert.equal(result.report.status, status);
    assert.equal(result.report.liveVerified, false);
    assert.equal(f.requests.length, before + 1);
  }
});

test('unexpected tool, arguments, duplicate calls or no tool stop before a second request', async (t) => {
  let response;
  const f = await fixture(t, (_input, res) => json(res, response));
  for (const value of [
    completion(null, [call('run_shell')]),
    completion(null, [call('smoke_marker', '{"secret":"unused"}')]),
    completion(null, [call('smoke_marker', '[]')]),
    completion(null, [call('smoke_marker', 'not-json')]),
    completion(null, [call(), call('smoke_marker', '{}', 'synthetic-call-2')]),
    completion(privateText),
  ]) {
    response = value;
    const before = f.requests.length;
    const result = await start(f.url, ['--tools']).done;
    safe(result);
    assert.equal(result.report.status, 'tool_verification_failed');
    assert.equal(result.report.requestCount, 1);
    assert.equal(result.report.liveVerified, false);
    assert.equal(f.requests.length, before + 1);
  }
});

test('incorrect marker or repeated tool call after replay fails at exactly two requests', async (t) => {
  let final;
  const f = await fixture(t, (_input, res, count) => json(res, count % 2 === 1 ? completion(null, [call()]) : final));
  for (const value of [completion(privateText), completion(null, [call()])]) {
    final = value;
    const before = f.requests.length;
    const result = await start(f.url, ['--tools']).done;
    safe(result);
    assert.equal(result.report.status, 'tool_verification_failed');
    assert.equal(result.report.requestCount, 2);
    assert.equal(result.report.liveVerified, false);
    assert.equal(f.requests.length, before + 2);
  }
});

test('missing usage stays unknown even when a later tool replay reports usage', async (t) => {
  const f = await fixture(t, (input, res, number) => {
    const value = number === 1 ? completion(null, [call()]) : completion(JSON.parse(input.messages[2].content).marker);
    if (number === 1) delete value.usage;
    json(res, value);
  });
  const result = await start(f.url, ['--tools']).done;
  safe(result);
  assert.equal(result.code, 0);
  assert.equal(result.report.usage, null);
  assert.equal(result.report.requestCount, 2);
});

test('SIGINT cancels the real in-flight HTTP body and emits one safe terminal receipt without retry', async (t) => {
  let ready, disconnected;
  const started = new Promise((resolve) => ready = resolve);
  const closed = new Promise((resolve) => disconnected = resolve);
  const f = await fixture(t, (_input, res) => {
    res.on('close', disconnected);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{');
    ready();
  });
  const running = start(f.url);
  await started;
  running.child.kill('SIGINT');
  const result = await running.done;
  await closed;
  safe(result);
  assert.equal(result.code, 130);
  assert.equal(result.report.status, 'cancelled');
  assert.equal(result.report.requestCount, 1);
  assert.equal(result.report.liveVerified, false);
  assert.equal(result.report.usage, null);
  assert.equal(f.requests.length, 1);
});
