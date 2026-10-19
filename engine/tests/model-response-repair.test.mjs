import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHarness } from '../dist/runtime/harness.js';
import { collectModelResponse, ModelResponseError } from '../dist/runtime/model-response.js';
import { RuntimeError } from '../dist/runtime/ports.js';
import { meteredModel } from '../dist/runtime/metered-model.js';
import { ChatCompletionsModel } from '../dist/runtime/chat-completions-model.js';
const stop = [
  { type: 'text', text: '已按记录完成。' },
  { type: 'finish', reason: 'stop' },
];
const call = (name, id = 'a', args = '{}') => ({ type: 'tool_call', name, id, arguments: args });
const response = (...calls) => [...calls, { type: 'finish', reason: 'tool_calls' }];
function scripted(steps, requests = []) {
  let n = 0;
  return {
    async *generate(r) {
      requests.push(r);
      const s = steps[n++];
      assert.ok(s, 'unexpected model dispatch');
      if (s instanceof Error) throw s;
      yield* s;
    },
  };
}
function tool(executed) {
  return {
    name: 'read_record',
    description: 'synthetic',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      executed.push('read');
      return { ok: true };
    },
  };
}
test('rejected batch is atomic, corrected once, each dispatch metered, rejected preview marked interrupted', async () => {
  const executed = [],
    diagnostics = [],
    requests = [],
    usage = [],
    outputs = [],
    states = [];
  const backend = scripted(
    [
      [
        { type: 'text', text: 'PRIVATE_REJECTED_PREFIX' },
        ...response(call('read_record', 'a'), call('PRIVATE_UNAVAILABLE_TOOL', 'b')),
      ],
      response(call('read_record', 'a')),
      stop,
    ],
    requests,
  );
  const model = meteredModel(backend, async (action, body) => {
    usage.push({ action, body });
    return { accepted: true };
  });
  const result = await runHarness({
    prompt: 'synthetic',
    tools: [tool(executed)],
    model,
    limits: { modelCalls: 5 },
    onModelFailure: (v) => diagnostics.push(v),
    realtime: {
      async control() {
        return { stop: false, inputs: [] };
      },
      async output(step, text, state) {
        outputs.push(text);
        states.push({ step, state });
      },
    },
  });
  assert.equal(result.status, 'completed');
  assert.deepEqual(executed, ['read']);
  assert.equal(result.modelCalls, 3);
  assert.deepEqual(diagnostics, [{ diagnostic: 'UNADVERTISED_TOOL', modelCall: 1, correction: true }]);
  assert.equal(usage.filter((x) => x.action === 'model-usage/start').length, 3);
  assert.equal(usage.filter((x) => x.action === 'model-usage/finish').length, 3);
  assert.ok(states.some((v) => v.step === 1 && v.state === 'INTERRUPTED'));
  assert.ok(states.some((v) => v.step === 3 && v.state === 'COMPLETE'));
  assert.doesNotMatch(result.text, /PRIVATE/);
  assert.doesNotMatch(JSON.stringify(diagnostics), /PRIVATE/);
  assert.ok(
    requests[1].messages.some((m) =>
      m.content.some((b) => b.type === 'text' && b.text.includes('Response correction')),
    ),
  );
});
test('second invalid proposal fails without tool execution or unlimited correction', async () => {
  const executed = [],
    diagnostics = [];
  const result = await runHarness({
    prompt: 'synthetic',
    tools: [tool(executed)],
    model: scripted([response(call('bad')), response(call('bad'))]),
    onModelFailure: (v) => diagnostics.push(v),
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.diagnostic, 'UNADVERTISED_TOOL');
  assert.equal(result.modelCalls, 2);
  assert.deepEqual(executed, []);
  assert.equal(diagnostics[1].correction, false);
});
test('later phase correction preserves previous receipt and does not replay work', async () => {
  const executed = [],
    requests = [];
  const result = await runHarness({
    prompt: 'synthetic',
    tools: [tool(executed)],
    model: scripted([response(call('read_record', 'first')), response(call('bad', 'b')), stop], requests),
  });
  assert.equal(result.status, 'completed');
  assert.deepEqual(executed, ['read']);
  assert.equal(result.tools.length, 1);
  assert.ok(
    requests[2].messages.some((m) => m.content.some((b) => b.type === 'tool_result' && b.id === 'first')),
  );
});
test('network, cancellation and exhausted budget never get an automatic correction', async () => {
  for (const error of [new RuntimeError('MODEL_TIMEOUT'), new RuntimeError('MODEL_NETWORK_ERROR')]) {
    const r = await runHarness({ prompt: 'synthetic', tools: [], model: scripted([error]) });
    assert.equal(r.modelCalls, 1);
    assert.equal(r.diagnostic, error.code);
  }
  const r = await runHarness({
    prompt: 'synthetic',
    tools: [],
    model: scripted([response(call('bad'))]),
    limits: { modelCalls: 1 },
  });
  assert.equal(r.modelCalls, 1);
  assert.equal(r.status, 'failed');
  const aborted = await runHarness({
    prompt: 'synthetic',
    tools: [],
    model: scripted([]),
    signal: AbortSignal.abort(),
  });
  assert.equal(aborted.modelCalls, 0);
});
test('ambiguous malformed arguments, duplicate identities and missing finish fail before execution', async () => {
  const cases = [
    [response(call('read_record', 'a', '{bad')), 'TOOL_ARGUMENTS_JSON'],
    [response(call('read_record', 'a'), call('read_record', 'a')), 'DUPLICATE_TOOL_ID'],
    [[call('read_record')], 'MODEL_INCOMPLETE'],
  ];
  for (const [parts, diagnostic] of cases) {
    await assert.rejects(
      collectModelResponse(
        (async function* () {
          yield* parts;
        })(),
        [tool([])],
        new Set(),
        new AbortController().signal,
      ),
      (e) => (e.diagnostic ?? e.code) === diagnostic,
    );
  }
});
test('wire compatibility only fills routing metadata; wrong named function is never relabelled', async (t) => {
  const original = globalThis.fetch;
  t.after(() => (globalThis.fetch = original));
  let body;
  globalThis.fetch = async () =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  const model = new ChatCompletionsModel({
    endpoint: new URL('http://127.0.0.1/synthetic'),
    model: 'synthetic',
    apiKey: 'synthetic',
    timeoutMs: 1000,
    modeParameters: {},
  });
  const request = {
    messages: [],
    tools: [tool([])],
    requiredTool: 'read_record',
    signal: new AbortController().signal,
    maxTokens: 10,
  };
  body = {
    choices: [
      {
        finish_reason: 'stop',
        message: { role: 'assistant', tool_calls: [{ function: { name: 'read_record', arguments: '{}' } }] },
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  };
  const parts = [];
  for await (const p of model.generate(request)) parts.push(p);
  assert.equal(parts[0].name, 'read_record');
  assert.ok(parts[0].id);
  assert.equal(parts[1].reason, 'tool_calls');
  body.choices[0].message.tool_calls[0].function.name = 'unavailable_private_name';
  await assert.rejects(
    async () => {
      for await (const p of model.generate(request)) {
      }
    },
    (e) => e instanceof ModelResponseError && e.diagnostic === 'UNADVERTISED_TOOL',
  );
});

test('independent later phase may correct once while total model and tool budgets remain enforced', async () => {
  const executed = [],
    diagnostics = [];
  const result = await runHarness({
    prompt: 'synthetic',
    tools: [tool(executed)],
    limits: { modelCalls: 5 },
    onModelFailure: (d) => diagnostics.push(d),
    model: scripted([
      response(call('wrong', 'a')),
      response(call('read_record', 'a')),
      response(call('wrong', 'b')),
      response(call('read_record', 'b')),
      stop,
    ]),
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.modelCalls, 5);
  assert.deepEqual(executed, ['read', 'read']);
  assert.equal(diagnostics.length, 2);
  assert.ok(diagnostics.every((d) => d.correction));
});
test('batched source reads fit existing sixteen-tool ceiling and cannot bypass a smaller task budget', async () => {
  const executed = [];
  const batch = response(...Array.from({ length: 10 }, (_, i) => call('read_record', 'read-' + i)));
  const accepted = await runHarness({
    prompt: 'synthetic',
    tools: [tool(executed)],
    model: scripted([batch, stop]),
    limits: { toolCalls: 16 },
  });
  assert.equal(accepted.status, 'completed');
  assert.equal(executed.length, 10);
  const limited = [];
  const result = await runHarness({
    prompt: 'synthetic',
    tools: [tool(limited)],
    model: scripted([batch]),
    limits: { toolCalls: 2 },
  });
  assert.equal(result.code, 'TOOL_CALL_LIMIT');
  assert.equal(limited.length, 2);
});

test('invalid incomplete wire stream cannot trigger a corrective model replay', async () => {
  const diagnostics = [];
  const result = await runHarness({
    prompt: 'synthetic',
    tools: [],
    model: scripted([new ModelResponseError('TOOL_INDEX', false)]),
    onModelFailure: (d) => diagnostics.push(d),
  });
  assert.equal(result.modelCalls, 1);
  assert.equal(result.status, 'failed');
  assert.equal(diagnostics[0].correction, false);
});

test('real wire correction preserves both returned usage receipts and executes only corrected call', async (t) => {
  const original = globalThis.fetch;
  t.after(() => (globalThis.fetch = original));
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    const calls = Array.from({ length: requests === 1 ? 2 : 1 }, (_, n) => ({
      id: `wire-${requests}-${n}`,
      type: 'function',
      function: { name: 'read_record', arguments: '{}' },
    }));
    return new Response(
      JSON.stringify({
        choices: [
          { finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: calls } },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 3 },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  };
  const backend = new ChatCompletionsModel({
    endpoint: new URL('http://127.0.0.1/synthetic'),
    model: 'synthetic',
    apiKey: 'synthetic',
    timeoutMs: 1000,
    modeParameters: {},
  });
  const events = [],
    executed = [],
    metered = meteredModel(backend, async (action, body) => {
      events.push({ action, body });
      return { accepted: true };
    });
  const result = await runHarness({
    prompt: 'synthetic',
    tools: [tool(executed)],
    model: { generate: (r) => metered.generate({ ...r, requiredTool: 'read_record' }) },
    finishOnDeliverable: true,
    hasCompletedDeliverable: (r) => r.some((t) => t.status === 'succeeded'),
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.modelCalls, 2);
  assert.deepEqual(executed, ['read']);
  assert.deepEqual(
    events.filter((e) => e.action === 'model-usage/finish').map((e) => e.body.outcome),
    ['RETURNED', 'RETURNED'],
  );
  assert.deepEqual(backend.usage, { inputTokens: 20, outputTokens: 6 });
});
