import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { runHarness } from '../dist/runtime/harness.js';
import { createTaskTools } from '../dist/runtime/task-tools.js';
import { RuntimeError } from '../dist/runtime/ports.js';

// Scripted transport fixture only. It never ships in the engine HTTP entrypoint.
const reply = (text) => [
  { type: 'text', text },
  { type: 'finish', reason: 'stop' },
];
const call = (name, args, id = 'call-1') => [
  { type: 'tool_call', id, name, arguments: JSON.stringify(args) },
  { type: 'finish', reason: 'tool_calls' },
];
const fixture = (steps) => {
  let index = 0;
  return {
    async *generate(request) {
      const step = steps[index++];
      assert.ok(step, 'no unexpected model calls');
      yield* typeof step === 'function' ? await step(request) : step;
    },
  };
};
const noSandbox = {
  async run() {
    throw new Error('must not execute');
  },
};
const files = (text) => [{ handle: 'current.txt', bytes: Buffer.from(text) }];
const tools = (text) => createTaskTools({ files: files(text), allowJavaScript: false, sandbox: noSandbox });

test('tool diagnostics cover invalid arguments and execution failures without private payloads', async () => {
  for (const scenario of ['schema', 'runtime', 'unexpected']) {
    const diagnostics = [];
    const result = await runHarness({
      prompt: 'synthetic',
      onToolFailure: (failure) => diagnostics.push(failure),
      tools: [
        {
          name: 'search_sources',
          description: 'synthetic',
          parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
          async execute() {
            if (scenario === 'runtime') throw new RuntimeError('INVALID_QUERY');
            throw new Error('private-key and raw document contents');
          },
        },
      ],
      model: fixture([
        call('search_sources', scenario === 'schema' ? {} : { query: 'private source text' }),
        reply('Unable to retrieve supporting data.'),
      ]),
    });
    assert.equal(result.tools[0].status, 'failed');
    assert.deepEqual(diagnostics, [
      {
        tool: 'search_sources',
        callId: 'call-1',
        executionStarted: scenario !== 'schema',
        code:
          scenario === 'schema'
            ? 'INVALID_TOOL_ARGUMENTS'
            : scenario === 'runtime'
              ? 'INVALID_QUERY'
              : 'TOOL_FAILED',
      },
    ]);
    assert.doesNotMatch(JSON.stringify(diagnostics), /private/);
  }
});

test('no model is configured by default; aborted requests do not call an adapter', async () => {
  await assert.rejects(runHarness({ prompt: 'test', tools: [] }), { code: 'MODEL_NOT_CONFIGURED' });
  const result = await runHarness({
    prompt: 'test',
    tools: [],
    model: fixture([]),
    signal: AbortSignal.abort(),
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.modelCalls, 0);
});

test('actual Harness loop executes only granted input and feeds the real tool result to the next model call', async () => {
  let received = false;
  const result = await runHarness({
    prompt: 'read my file',
    tools: tools('synthetic-content'),
    model: fixture([
      (request) => {
        assert.deepEqual(
          request.tools.map((t) => t.name),
          ['read_input'],
        );
        return call('read_input', { handle: 'current.txt' });
      },
      (request) => {
        const tool = request.messages.flatMap((m) => m.content).find((c) => c.type === 'tool_result');
        assert.equal(tool.isError, false);
        assert.match(tool.content, /synthetic-content/);
        received = true;
        return reply('scripted transport fixture; no model inference');
      },
    ]),
  });
  assert.equal(received, true);
  assert.equal(result.status, 'completed');
  assert.equal(result.modelCalls, 2);
  assert.equal(result.tools[0].callId, 'call-1');
  assert.equal(result.tools[0].name, 'read_input');
  assert.equal(result.tools[0].status, 'succeeded');
  assert.equal(result.tools[0].output.text, 'synthetic-content');
});

test('unknown tool, ungranted file and malformed arguments cannot execute protected work', async () => {
  assert.deepEqual(createTaskTools({ files: [], allowJavaScript: 'true', sandbox: noSandbox }), []);
  for (const request of [
    call('run_javascript', { script: 'attack' }),
    call('read_input', { handle: '../other.txt' }),
    call('read_input', { handle: 'current.txt', path: '/etc/passwd' }),
  ]) {
    const result = await runHarness({
      prompt: 'test',
      tools: tools('allowed'),
      model: fixture([
        request,
        (input) => {
          const tool = input.messages.flatMap((m) => m.content).find((c) => c.type === 'tool_result');
          assert.equal(tool.isError, true);
          assert.doesNotMatch(tool.content, /"text":"allowed"/);
          return reply('Cannot complete with these permissions.');
        },
      ]),
    });
    assert.equal(result.tools[0].status, 'failed');
    assert.equal(result.status, 'completed');
  }
});

test('task contexts and snapshots do not share file bytes or tools', async () => {
  const input = files('tenant-A'),
    grant = createTaskTools({ files: input, allowJavaScript: false, sandbox: noSandbox });
  input[0].bytes.fill(88);
  const execute = (toolset, expected) =>
    runHarness({
      prompt: 'test',
      tools: toolset,
      model: fixture([
        call('read_input', { handle: 'current.txt' }),
        (request) => {
          const tool = request.messages.flatMap((m) => m.content).find((c) => c.type === 'tool_result');
          assert.match(tool.content, new RegExp(expected));
          return reply(expected);
        },
      ]),
    });
  const results = await Promise.all([execute(grant, 'tenant-A'), execute(tools('tenant-B'), 'tenant-B')]);
  assert.deepEqual(
    results.map((r) => r.text),
    ['tenant-A', 'tenant-B'],
  );
});

test('model call, tool call, output and time budgets stop the turn', async () => {
  const endless = {
    async *generate() {
      yield* call('read_input', { handle: 'current.txt' }, crypto.randomUUID());
    },
  };
  const modelLimit = await runHarness({
    prompt: 'test',
    model: endless,
    tools: tools('ok'),
    limits: { modelCalls: 2, toolCalls: 10 },
  });
  assert.equal(modelLimit.code, 'MODEL_CALL_LIMIT');
  assert.equal(modelLimit.modelCalls, 2);
  const toolLimit = await runHarness({
    prompt: 'test',
    model: endless,
    tools: tools('ok'),
    limits: { toolCalls: 1 },
  });
  assert.equal(toolLimit.code, 'TOOL_CALL_LIMIT');
  assert.equal(toolLimit.tools.filter((t) => t.status === 'succeeded').length, 1);
  const outputLimit = await runHarness({
    prompt: 'test',
    tools: [],
    model: fixture([reply('x'.repeat(70000))]),
  });
  assert.equal(outputLimit.code, 'MODEL_OUTPUT_LIMIT');
  const timed = await runHarness({
    prompt: 'test',
    tools: [],
    limits: { timeoutMs: 50 },
    model: {
      async *generate({ signal }) {
        await delay(10000, null, { signal });
        yield* reply('late');
      },
    },
  });
  assert.equal(timed.code, 'TIME_LIMIT');
  for (const result of [modelLimit, toolLimit, outputLimit, timed]) {
    assert.equal(result.status, 'limit');
    assert.equal(result.text, '');
  }
});

test('reserved final response uses the existing budget and cannot execute another tool', async () => {
  for (const ignoresFinal of [false, true]) {
    let executions = 0;
    const result = await runHarness({
      prompt: 'Find supported facts, preserving gaps.',
      reserveFinalResponse: true,
      limits: { modelCalls: 2, toolCalls: 4 },
      tools: [
        {
          name: 'search_sources',
          description: 'synthetic',
          parameters: { type: 'object' },
          async execute() {
            executions++;
            return { items: [] };
          },
        },
      ],
      model: fixture([
        call('search_sources', {}),
        (request) => {
          assert.deepEqual(request.tools, []);
          assert.match(request.messages[0].content[0].text, /reserved final response/);
          return ignoresFinal
            ? call('search_sources', {}, 'blocked')
            : reply('No supporting evidence yet; data remains missing.');
        },
      ]),
    });
    assert.equal(executions, 1);
    assert.equal(result.modelCalls, 2);
    assert.equal(result.finalResponseReserved, true);
    assert.equal(result.status, ignoresFinal ? 'limit' : 'completed');
    if (ignoresFinal) assert.equal(result.text, '');
  }
});

test('ordinary final response preserves projected evidence and recovers once inside eight calls', async () => {
  let executions = 0, consumedRejectedFinish = false;
  const steps = Array.from({ length: 6 }, (_, i) => call('search_sources', {}, `search-${i}`));
  const inspectFinal = (request) => {
    assert.deepEqual(request.tools, []);
    assert.ok(request.messages.flatMap(m => m.content).every(b => b.type === 'text'));
    const text = JSON.stringify(request.messages);
    assert.match(text, /Which store is most profitable/);
    assert.match(text, /receipt-citation-42/);
    assert.match(text, /Receipts only; costs missing/);
    assert.doesNotMatch(text, /PRIVATE_UNPROJECTED/);
    assert.doesNotMatch(text, /Let me search again/);
  };
  steps.push(request => {
    inspectFinal(request);
    return (async function* () {
      yield { type: 'text', text: 'Let me search again' };
      yield call('search_sources', {}, 'forbidden-final')[0];
      consumedRejectedFinish = true;
      yield { type: 'finish', reason: 'tool_calls' };
    })();
  });
  steps.push(request => {
    assert.equal(consumedRejectedFinish, true);
    inspectFinal(request);
    return reply('Receipts are supported [receipt-citation-42], but costs are missing: profit cannot be ranked.');
  });
  const result = await runHarness({
    prompt: 'Which store is most profitable?', reserveFinalResponse: true,
    limits: { modelCalls: 8, toolCalls: 8, timeoutMs: 55000 },
    tools: [{ name: 'search_sources', description: 'synthetic', parameters: { type: 'object' },
      async execute() { executions++; return { evidence: 'Receipts only; costs missing', citation: 'receipt-citation-42', private: 'PRIVATE_UNPROJECTED' }; },
      modelOutput(value) { return { evidence: value.evidence, citation: value.citation }; },
    }], model: fixture(steps),
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.modelCalls, 8);
  assert.equal(executions, 6);
  assert.equal(result.finalResponseReserved, true);
  assert.match(result.text, /profit cannot be ranked/);
  assert.doesNotMatch(result.text, /Let me/);
});

test('ordinary final correction cannot loop or execute a forbidden tool', async () => {
  let executions = 0;
  const result = await runHarness({
    prompt: 'Report evidence.', reserveFinalResponse: true,
    limits: { modelCalls: 3, toolCalls: 4 },
    tools: [{ name: 'search_sources', description: 'synthetic', parameters: { type: 'object' },
      async execute() { executions++; return { evidence: 'No costs' }; } }],
    model: fixture([call('search_sources', {}), call('search_sources', {}, 'blocked-1'), call('search_sources', {}, 'blocked-2')]),
  });
  assert.equal(result.status, 'limit');
  assert.equal(result.code, 'MODEL_CALL_LIMIT');
  assert.equal(result.modelCalls, 3);
  assert.equal(executions, 1);
  assert.equal(result.text, '');
});

test('final correction obeys cancellation and never publishes a rejected prefix', async () => {
  const controller = new AbortController();
  let calls = 0, executions = 0;
  const result = await runHarness({
    prompt: 'Answer with existing evidence.', reserveFinalResponse: true, signal: controller.signal,
    limits: { modelCalls: 3, toolCalls: 4 },
    tools: [{ name: 'search_sources', description: 'synthetic', parameters: { type: 'object' },
      async execute() { executions++; return { evidence: 'Costs unavailable' }; } }],
    model: { async *generate(request) {
      calls++;
      if (calls === 1) yield* call('search_sources', {});
      else if (calls === 2) { yield { type: 'text', text: 'Let me retrieve more' }; yield* call('search_sources', {}, 'forbidden'); }
      else { assert.deepEqual(request.tools, []); controller.abort(); request.signal.throwIfAborted(); }
    } },
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.code, 'CANCELLED');
  assert.equal(result.modelCalls, 3);
  assert.equal(executions, 1);
  assert.equal(result.text, '');
});

test('slow evidence retrieval reserves wall time for a final reply even with calls remaining', async () => {
  let calls = 0;
  const result = await runHarness({
    prompt: 'Analyze the evidence and report gaps.',
    reserveFinalResponse: true,
    limits: { timeoutMs: 2000, modelCalls: 8, toolCalls: 8 },
    tools: [
      {
        name: 'search_sources',
        description: 'synthetic',
        parameters: { type: 'object' },
        async execute() {
          await delay(600);
          return { evidence: 'Receipts: 42 yuan; matched partial period.' };
        },
      },
    ],
    model: {
      async *generate(request) {
        calls++;
        if (calls === 1) {
          yield* call('search_sources', {});
        } else {
          assert.deepEqual(request.tools, []);
          assert.match(request.messages[0].content[0].text, /reserved final response/);
          assert.ok(
            request.messages
              .flatMap((m) => m.content)
              .some((b) => b.type === 'text' && b.text.includes('42 yuan')),
          );
          await delay(100);
          yield* reply('42 yuan for the matched partial period; chart generation remains unavailable.');
        }
      },
    },
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.finalResponseReserved, true);
  assert.equal(calls, 2);
  assert.equal(result.tools.length, 1);
  assert.match(result.text, /42 yuan/);
});

test('cancellation drains a running tool, returns no late text and does not retry', async () => {
  const controller = new AbortController();
  let started,
    stopped = false;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const task = runHarness({
    prompt: 'test',
    signal: controller.signal,
    model: fixture([call('slow', {})]),
    tools: [
      {
        name: 'slow',
        description: 'test',
        parameters: { type: 'object', additionalProperties: false },
        async execute(_args, signal) {
          started();
          try {
            await delay(10000, null, { signal });
            return 'late';
          } finally {
            stopped = true;
          }
        },
      },
    ],
  });
  await ready;
  controller.abort();
  const result = await task;
  assert.equal(result.status, 'cancelled');
  assert.equal(result.modelCalls, 1);
  assert.equal(stopped, true);
  assert.equal(result.text, '');
  assert.ok(result.tools.every((tool) => tool.output === undefined));
});

test('raw tool errors are sanitized and incomplete model streams cannot succeed', async () => {
  const result = await runHarness({
    prompt: 'test',
    tools: [
      {
        name: 'fail',
        description: 'test',
        parameters: { type: 'object' },
        async execute() {
          throw new Error('/host/private/secret synthetic-api-key');
        },
      },
    ],
    model: fixture([
      call('fail', {}),
      (request) => {
        const transcript = JSON.stringify(request);
        assert.doesNotMatch(transcript, /synthetic-api-key|\/host\/private/);
        assert.match(transcript, /TOOL_FAILED/);
        return reply('failed');
      },
    ]),
  });
  assert.equal(result.tools[0].status, 'failed');
  assert.equal(result.status, 'completed');
  const broken = await runHarness({
    prompt: 'test',
    tools: [],
    model: fixture([[{ type: 'text', text: 'partial' }]]),
  });
  assert.equal(broken.status, 'failed');
  assert.equal(broken.text, '');
});

test('multiple tool calls keep their own success/failure receipt', async () => {
  const batch = [
    ...call('read_input', { handle: 'current.txt' }, 'first').slice(0, 1),
    ...call('read_input', { handle: 'missing.txt' }, 'second'),
  ];
  const result = await runHarness({
    prompt: 'test',
    tools: tools('one'),
    model: fixture([
      batch,
      (request) => {
        const results = request.messages.flatMap((m) => m.content).filter((b) => b.type === 'tool_result');
        assert.deepEqual(
          results.map((b) => [b.id, b.isError]),
          [
            ['first', false],
            ['second', true],
          ],
        );
        return reply('one input unavailable');
      },
    ]),
  });
  assert.equal(result.status, 'completed');
  assert.deepEqual(
    result.tools.map((t) => t.status),
    ['succeeded', 'failed'],
  );
});

test('invalid model completion and duplicate call IDs fail closed without executing twice', async () => {
  const invalid = await runHarness({
    prompt: 'test',
    tools: [],
    model: fixture([[{ type: 'finish', reason: 'invented-success' }]]),
  });
  assert.equal(invalid.status, 'failed');
  let count = 0;
  const tool = {
    name: 'count',
    description: 'test',
    parameters: { type: 'object' },
    async execute() {
      count++;
      return count;
    },
  };
  const result = await runHarness({
    prompt: 'test',
    tools: [tool],
    model: fixture([call('count', {}, 'duplicate'), call('count', {}, 'duplicate')]),
  });
  assert.equal(count, 1);
  assert.equal(result.status, 'failed');
  assert.equal(result.text, '');
});

test('fine-grained streaming uses the same content budget as a single chunk', async () => {
  const text = '证'.repeat(3000);
  const result = await runHarness({
    prompt: 'test streaming payload',
    tools: [],
    model: {
      async *generate() {
        for (const ch of text) yield { type: 'text', text: ch };
        yield { type: 'finish', reason: 'stop' };
      },
    },
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.text, text);
});

test('structured delivery keeps tools after 15 seconds while preserving a short final confirmation', async (t) => {
  const now = performance.now.bind(performance);
  let elapsed = 0;
  t.mock.method(performance, 'now', () => now() + elapsed);
  let calls = 0;
  const r = await runHarness({
    prompt: 'deliver a structured card',
    reserveFinalResponse: true,
    finalResponseReserveMs: 10000,
    limits: { timeoutMs: 55000, modelCalls: 8, toolCalls: 8 },
    tools: tools('evidence'),
    model: {
      async *generate(req) {
        calls++;
        if (calls === 1) {
          elapsed = 20000;
          yield* call('read_input', { handle: 'current.txt' });
        } else if (calls === 2) {
          assert.ok(req.tools.length > 0);
          elapsed = 46000;
          yield* call('read_input', { handle: 'current.txt' }, 'second');
        } else {
          assert.equal(req.tools.length, 0);
          yield* reply('A short truthful final response.');
        }
      },
    },
  });
  assert.equal(r.status, 'completed');
  assert.equal(calls, 3);
  assert.equal(r.finalResponseReserved, true);
});

test('context validation gives a safe correction and the model can retry without widening access', async () => {
  const { contextTool } = await import('../dist/runtime/task-context.js');
  let invoked = 0;
  const warnings = [], previous = console.warn;
  console.warn = (line) => warnings.push(JSON.parse(line));
  try {
    const result = await runHarness({
      prompt: 'Read authorized profiles.',
      tools: [contextTool(async (_action, input) => {
        invoked++;
        assert.deepEqual(input, { action: 'profiles', scope: 'WORKSPACE' });
        return { contractVersion: '1.0', action: 'profiles', referenceOnly: true,
          result: { items: [], hasMore: false } };
      }, async () => {})],
      model: fixture([
        call('task_context', { action: 'profiles', query: 'private account text' }),
        (request) => {
          const evidence = JSON.stringify(request.messages);
          assert.match(evidence, /profiles requires scope TENANT, WORKSPACE or PERSONAL/);
          return call('task_context', { action: 'profiles', scope: 'WORKSPACE' }, 'corrected');
        },
        reply('No authorized profiles found.'),
      ]),
    });
    assert.equal(invoked, 1);
    assert.deepEqual(result.tools.map(t => t.status), ['failed', 'succeeded']);
    assert.deepEqual(warnings, [{ event: 'CONTEXT_REQUEST_REJECTED', action: 'profiles', field: 'scope' }]);
    assert.ok(!JSON.stringify(warnings).includes('private account text'));
  } finally { console.warn = previous; }
});
