import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { runHarness } from '../dist/runtime/harness.js';
import { createTaskTools } from '../dist/runtime/task-tools.js';

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
      tools: [{ name: 'search_sources', description: 'synthetic', parameters: { type: 'object' },
        async execute() { executions++; return { items: [] }; } }],
      model: fixture([
        call('search_sources', {}),
        (request) => {
          assert.deepEqual(request.tools, []);
          assert.match(request.messages[0].content[0].text, /reserved final response/);
          return ignoresFinal ? call('search_sources', {}, 'blocked') : reply('No supporting evidence yet; data remains missing.');
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

test('slow evidence retrieval reserves wall time for a final reply even with calls remaining', async () => {
  let calls = 0;
  const result = await runHarness({
    prompt: 'Analyze the evidence and report gaps.',
    reserveFinalResponse: true,
    limits: { timeoutMs: 2000, modelCalls: 8, toolCalls: 8 },
    tools: [{ name: 'search_sources', description: 'synthetic', parameters: { type: 'object' },
      async execute() { await delay(600); return { evidence: 'Receipts: 42 yuan; matched partial period.' }; } }],
    model: {
      async *generate(request) {
        calls++;
        if (calls === 1) {
          yield* call('search_sources', {});
        } else {
          assert.deepEqual(request.tools, []);
          assert.match(request.messages[0].content[0].text, /reserved final response/);
          assert.ok(request.messages.flatMap(m => m.content).some(b => b.type === 'tool_result' && b.content.includes('42 yuan')));
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
