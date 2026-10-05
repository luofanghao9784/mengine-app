import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { BailianModel } from '../dist/runtime/bailian-model.js';
import { configuredModel } from '../dist/runtime/model-config.js';
import { runHarness } from '../dist/runtime/harness.js';
import { close, listen, json, completion, call, body } from './fixtures/agent.mjs';
const config = {
  model: 'qwen3.7-plus-2026-05-26',
  apiKey: 'synthetic-private-key',
  workspaceId: 'synthetic-dreamcore',
};
const request = (signal = new AbortController().signal) => ({
  messages: [{ role: 'user', content: [{ type: 'text', text: 'synthetic' }] }],
  tools: [],
  maxTokens: 30,
  signal,
});
const collect = async (items) => {
  const result = [];
  for await (const item of items) result.push(item);
  return result;
};
const local = (url, timeoutMs = 150) =>
  new BailianModel({
    ...config,
    localVerification: true,
    endpoint: url + '/compatible-mode/v1/chat/completions',
    timeoutMs,
  });

test('a verified delivery phase selects its exact function on the provider wire', async (t) => {
  let calls = 0;
  const server = createServer(async (req, res) => {
    calls++;
    const input = await body(req);
    assert.deepEqual(input.tool_choice, { type: 'function', function: { name: 'deliver_briefing' } });
    assert.deepEqual(input.tools.map((tool) => tool.function.name), ['deliver_briefing']);
    json(res, completion(null, [call('delivery', 'deliver_briefing', {})]));
  });
  const url = await listen(server);t.after(() => close(server));
  const backend = local(url, 2000);
  const input = { ...request(), tools: [{ name: 'deliver_briefing', description: 'synthetic', parameters: { type: 'object' } }], requiredTool: 'deliver_briefing' };
  assert.equal((await collect(backend.generate(input)))[0].name, 'deliver_briefing');
  await assert.rejects(collect(backend.generate({ ...input, requiredTool: 'unavailable_tool' })), { code: 'INVALID_MODEL_INPUT' });
  assert.equal(calls, 1, 'invalid tool selection never dispatches a provider request');
});

test('selected-function routing labels are normalized only for the exact required tool', async (t) => {
  t.mock.method(console, 'warn', () => {});
  let wrong = false, empty = false;
  const server = createServer(async (req, res) => {
    await body(req);
    if (empty) return json(res, completion('No actual tool was called.'));
    const value = completion(null, [{ type: 'function', function: {
      ...(wrong ? { name: 'another_tool' } : {}), arguments: '{"title":"synthetic"}',
    } }]);
    value.choices[0].finish_reason = 'stop';json(res, value);
  });
  const url = await listen(server);t.after(() => close(server));
  const backend = local(url, 2000);
  const input = { ...request(), tools: [{ name: 'deliver_briefing', description: 'synthetic', parameters: { type: 'object' } }], requiredTool: 'deliver_briefing' };
  const parts = await collect(backend.generate(input));
  assert.match(parts[0].id, /^[0-9a-f-]{36}$/);
  assert.equal(parts[0].name, 'deliver_briefing');
  assert.equal(parts[0].arguments, '{"title":"synthetic"}');
  assert.equal(parts.at(-1).reason, 'tool_calls');
  wrong = true;
  await assert.rejects(collect(backend.generate(input)), { code: 'INVALID_MODEL_RESPONSE' });
  wrong = false;
  await assert.rejects(collect(backend.generate({ ...input, requiredTool: undefined })), { code: 'INVALID_MODEL_RESPONSE' });
  empty = true;
  await assert.rejects(collect(backend.generate(input)), { code: 'INVALID_MODEL_RESPONSE' });
});

test('Bailian configuration stays scoped to a Beijing workspace and reviewed model snapshots', () => {
  assert.ok(new BailianModel(config));
  for (const patch of [
    { workspaceId: '' },
    { workspaceId: 'x.evil.test' },
    { workspaceId: 'user@evil' },
    { workspaceId: 'x/path' },
    { workspaceId: '-bad' },
    { workspaceId: 'x'.repeat(64) },
    { model: 'qwen-plus' },
    { model: 'unreviewed' },
    { apiKey: 'secret\nheader' },
    { apiKey: '' },
    { endpoint: 'https://evil.test' },
    { endpoint: 'http://127.0.0.1:1/compatible-mode/v1/chat/completions' },
    { timeoutMs: Infinity },
    {
      localVerification: true,
      endpoint: 'https://x.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
    },
    { localVerification: true, endpoint: 'http://127.0.0.1:1/chat/completions' },
  ])
    assert.throws(() => new BailianModel({ ...config, ...patch }), { code: 'INVALID_MODEL_CONFIG' });
});

test('Bailian wire → real Harness → tool result → final text preserves call IDs and usage', async (t) => {
  const requests = [];
  const server = createServer(async (req, res) => {
    assert.equal(req.url, '/compatible-mode/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer synthetic-private-key');
    const input = await body(req);
    requests.push(input);
    assert.equal(input.model, config.model);
    assert.equal(input.enable_thinking, false);
    assert.equal(input.thinking, undefined);
    assert.equal(input.stream, true);
    assert.ok(input.tools.some((x) => x.function.name === 'lookup'));
    const results = input.messages.filter((m) => m.role === 'tool');
    if (!results.length)
      return json(res, completion(null, [call('lookup-1', 'lookup', { term: '合成进度' })]));
    assert.equal(results[0].tool_call_id, 'lookup-1');
    assert.match(results[0].content, /已完成/);
    const assistant = input.messages.find((m) => m.role === 'assistant');
    assert.equal(assistant.tool_calls[0].id, 'lookup-1');
    assert.equal(assistant.content, null);
    json(res, completion('合成报告：已完成。'));
  });
  const url = await listen(server);
  t.after(() => close(server));
  const model = local(url, 2000);
  const result = await runHarness({
    prompt: '只查询合成资料',
    model,
    tools: [
      {
        name: 'lookup',
        description: '查找资料',
        parameters: {
          type: 'object',
          properties: { term: { type: 'string' } },
          required: ['term'],
          additionalProperties: false,
        },
        execute: async (args) => {
          assert.equal(args.term, '合成进度');
          return { status: '已完成' };
        },
      },
    ],
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.text, '合成报告：已完成。');
  assert.equal(requests.length, 2);
  assert.equal(result.tools[0].status, 'succeeded');
  assert.deepEqual(model.usage, { inputTokens: 20, outputTokens: 10 });
});

test('reserved final round explicitly disables tools on the wire within the eight-call budget', async (t) => {
  for (const ignoresConstraint of [false, true]) {
    let calls = 0,
      executions = 0;
    const server = createServer(async (req, res) => {
      const input = await body(req);
      calls++;
      if (calls < 7) {
        assert.ok(input.tools.some((tool) => tool.function.name === 'search_sources'));
        assert.equal(input.tool_choice, undefined);
        return json(res, completion(null, [call(`search-${calls}`, 'search_sources', {})]));
      }
      assert.ok(calls === 7 || (ignoresConstraint && calls === 8), 'at most one correction within original budget');
      assert.equal(input.tool_choice, 'none');
      assert.equal(input.tools, undefined);
      assert.equal(input.messages.filter((message) => message.role === 'tool').length, 0);
      assert.equal(input.messages.filter((message) => message.content?.includes('Reference data from a successful tool')).length, 6);
      json(
        res,
        ignoresConstraint
          ? completion(null, [call('forbidden-final', 'search_sources', {})])
          : completion('根据已查到的合成资料给出阶段说明，仍缺少企业简介。'),
      );
    });
    const url = await listen(server);
    t.after(() => close(server));
    const result = await runHarness({
      prompt: '介绍合成企业',
      model: local(url, 2000),
      reserveFinalResponse: true,
      limits: { modelCalls: 8, toolCalls: 8, timeoutMs: 55000 },
      tools: [
        {
          name: 'search_sources',
          description: '合成检索',
          parameters: { type: 'object' },
          async execute() {
            executions++;
            return { items: [] };
          },
        },
      ],
    });
    assert.equal(calls, ignoresConstraint ? 8 : 7);
    assert.equal(executions, 6);
    assert.equal(result.finalResponseReserved, true);
    assert.equal(result.status, ignoresConstraint ? 'limit' : 'completed');
    assert.equal(result.text, ignoresConstraint ? '' : '根据已查到的合成资料给出阶段说明，仍缺少企业简介。');
  }
});

test('missing usage remains unknown and truncated completion is not a successful Harness task', async (t) => {
  let count = 0;
  const server = createServer((req, res) => {
    const value = completion('synthetic');
    count++;
    if (count === 1) delete value.usage;
    if (count === 3) value.choices[0].finish_reason = 'length';
    json(res, value);
  });
  const url = await listen(server);
  t.after(() => close(server));
  const model = local(url);
  await collect(model.generate(request()));
  await collect(model.generate(request()));
  assert.equal(model.usage, null);
  assert.notEqual((await runHarness({ prompt: 'test', model, tools: [] })).status, 'completed');
});

test('Bailian rejects malformed calls, thinking responses, redirects, oversized and stalled bodies without retries or secret reflection', async (t) => {
  let scenario,
    calls = 0;
  const server = createServer((req, res) => {
    calls++;
    if (scenario === 'redirect') {
      res.writeHead(302, { location: 'http://127.0.0.1:1/' });
      return res.end();
    }
    if (scenario === 'limited') return json(res, { error: { message: config.apiKey } }, 429);
    res.writeHead(200, { 'content-type': 'application/json' });
    if (scenario === 'stalled') return res.write('{');
    if (scenario === 'large') return res.end(JSON.stringify({ text: 'x'.repeat(140000) }));
    const value = completion('synthetic');
    if (scenario === 'reasoning') value.choices[0].message.reasoning_content = 'not requested';
    if (scenario === 'badCall')
      value.choices[0].message.tool_calls = [
        { type: 'function', id: '1', function: { name: 'x', arguments: {} } },
      ];
    res.end(JSON.stringify(value));
  });
  const url = await listen(server);
  t.after(() => close(server));
  for (scenario of ['redirect', 'limited', 'stalled', 'large', 'reasoning', 'badCall']) {
    const before = calls;
    await assert.rejects(
      collect(local(url).generate(request())),
      (e) => e.code && !e.message.includes(config.apiKey),
    );
    assert.equal(calls, before + 1);
  }
});

test('Bailian cancellation aborts the in-flight response body', async (t) => {
  let disconnected = false,
    started;
  const ready = new Promise((resolve) => (started = resolve));
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{');
    res.on('close', () => (disconnected = true));
    started();
  });
  const url = await listen(server);
  t.after(() => close(server));
  const controller = new AbortController();
  const running = collect(local(url, 1000).generate(request(controller.signal)));
  await ready;
  controller.abort();
  await assert.rejects(running, { code: 'CANCELLED' });
  await delay(30);
  assert.equal(disconnected, true);
});

test('configuration preflight is offline, defaults off and never falls back to another provider', () => {
  assert.equal(configuredModel({}), undefined);
  assert.throws(() => configuredModel({ AGENT_MODEL_PROVIDER: 'unknown' }), {
    code: 'INVALID_MODEL_PROVIDER',
  });
  const env = {
    AGENT_MODEL_PROVIDER: 'bailian',
    AGENT_MODEL_NAME: config.model,
    AGENT_MODEL_API_KEY: config.apiKey,
    AGENT_BAILIAN_WORKSPACE_ID: config.workspaceId,
  };
  assert.equal(configuredModel(env).provider, 'bailian');
  assert.throws(() => configuredModel({ ...env, AGENT_BAILIAN_WORKSPACE_ID: '' }), {
    code: 'INVALID_MODEL_CONFIG',
  });
  const run = (patch) =>
    spawnSync(process.execPath, ['scripts/check-model-config.mjs'], {
      cwd: new URL('../', import.meta.url),
      env: { ...env, ...patch },
      encoding: 'utf8',
    });
  const ok = run({});
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).liveVerified, false);
  assert.equal(JSON.parse(ok.stdout).modelRequests, 0);
  assert.ok(!ok.stdout.includes(config.apiKey));
  const invalid = run({ AGENT_BAILIAN_WORKSPACE_ID: config.apiKey + '@evil' });
  assert.equal(invalid.status, 2);
  assert.ok(!(invalid.stdout + invalid.stderr).includes(config.apiKey));
  assert.equal(run({ AGENT_MODEL_PROVIDER: 'off' }).status, 1);
});

test('a closed retrieval phase selects only advertised calculation, delivery or blocker tools', async (t) => {
  const diagnostics = [];
  t.mock.method(console, 'warn', value => diagnostics.push(value));
  let responseMode = 'delivery', calls = 0;
  const server = createServer(async (req, res) => {
    calls++;
    const input = await body(req);
    assert.equal(input.tool_choice, 'required');
    assert.deepEqual(input.tools.map(tool => tool.function.name), ['compare_dataset', 'deliver_briefing', 'task_control']);
    if (responseMode === 'empty') return json(res, completion('No tool was called.'));
    const name = responseMode === 'obsolete' ? 'task_context' : responseMode === 'blocker' ? 'task_control' : 'deliver_briefing';
    const value = completion(null, [call('phase-call', name, {})]);
    if (responseMode === 'stop') value.choices[0].finish_reason = 'stop';
    if (responseMode === 'length') value.choices[0].finish_reason = 'length';
    if (responseMode === 'missing-name') delete value.choices[0].message.tool_calls[0].function.name;
    json(res, value);
  });
  const url = await listen(server); t.after(() => close(server));
  const backend = local(url, 2000), input = { ...request(), requireToolCall: true,
    tools: ['compare_dataset', 'deliver_briefing', 'task_control'].map(name => ({ name, description: 'synthetic', parameters: { type: 'object' } })) };
  for (const mode of ['delivery', 'blocker', 'stop']) {
    responseMode = mode;
    const output = await collect(backend.generate(input));
    assert.equal(output[0].name, mode === 'blocker' ? 'task_control' : 'deliver_briefing');
    assert.equal(output.at(-1).reason, 'tool_calls');
  }
  for (const mode of ['empty', 'obsolete', 'length', 'missing-name']) {
    responseMode = mode;
    await assert.rejects(collect(backend.generate(input)), { code: 'INVALID_MODEL_RESPONSE' });
  }
  await assert.rejects(collect(backend.generate({ ...input, tools: [] })), { code: 'INVALID_MODEL_INPUT' });
  assert.equal(calls, 7, 'an empty phase cannot dispatch a model request');
  assert.ok(diagnostics.some(value => JSON.parse(value).calls.some(call => call.advertisedName === false)));
  assert.ok(diagnostics.every(value => !/task_context|deliver_briefing|phase-call/.test(value)), 'diagnostics expose only fixed shape metadata');
});
