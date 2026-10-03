import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { ChatCompletionsModel } from '../dist/runtime/chat-completions-model.js';
import { runHarness } from '../dist/runtime/harness.js';
const req = {
  messages: [{ role: 'user', content: [{ type: 'text', text: 'synthetic' }] }],
  tools: [],
  maxTokens: 100,
  signal: new AbortController().signal,
};
const frame = (delta, finish = null) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\r\n\r\n`;
async function server(t, handler) {
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return new ChatCompletionsModel({
    endpoint: new URL(`http://127.0.0.1:${server.address().port}/`),
    model: 'synthetic',
    apiKey: 'synthetic',
    timeoutMs: 3000,
    modeParameters: {},
  });
}
test('real SSE exposes text before completion, handles UTF-8 byte boundaries and usage', async (t) => {
  let release;
  const gate = new Promise((r) => (release = r));
  const model = await server(t, async (req, res) => {
    let body = '';
    for await (const b of req) body += b;
    assert.equal(JSON.parse(body).stream, true);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const bytes = Buffer.from(frame({ role: 'assistant', content: '中文' }));
    for (const b of bytes) res.write(Buffer.from([b]));
    await gate;
    res.write(frame({ content: '答案' }, 'stop'));
    res.end(`data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3}}\n\ndata: [DONE]\n\n`);
  });
  const iterator = model.generate(req)[Symbol.asyncIterator]();
  assert.deepEqual((await iterator.next()).value, { type: 'text', text: '中文' });
  release();
  const rest = [];
  for await (const p of { [Symbol.asyncIterator]: () => iterator }) rest.push(p);
  assert.deepEqual(rest, [
    { type: 'text', text: '答案' },
    { type: 'finish', reason: 'stop' },
  ]);
  assert.deepEqual(model.lastUsage, { inputTokens: 12, outputTokens: 3 });
});
test('tool fragments are assembled by index only after complete valid stream', async (t) => {
  const model = await server(t, (_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(
      frame({
        tool_calls: [{ index: 0, id: 'a', type: 'function', function: { name: 'read', arguments: '{"n":' } }],
      }),
    );
    res.write(frame({ tool_calls: [{ index: 0, function: { arguments: '1}' } }] }, 'tool_calls'));
    res.end('data: [DONE]\n\n');
  });
  const parts = [];
  for await (const p of model.generate(req)) parts.push(p);
  assert.deepEqual(parts, [
    { type: 'tool_call', id: 'a', name: 'read', arguments: '{"n":1}' },
    { type: 'finish', reason: 'tool_calls' },
  ]);
  assert.equal(model.lastUsage, null);
});
test('truncated SSE never completes or yields an executable tool', async (t) => {
  const model = await server(t, (_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(
      frame(
        { tool_calls: [{ index: 0, id: 'a', function: { name: 'read', arguments: '{}' } }] },
        'tool_calls',
      ),
    );
  });
  const parts = [];
  await assert.rejects(
    async () => {
      for await (const p of model.generate(req)) parts.push(p);
    },
    { code: 'MODEL_INCOMPLETE' },
  );
  assert.equal(parts.length, 0);
});
test('cancel aborts a response body that is still streaming', async (t) => {
  const model = await server(t, (_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(frame({ content: 'partial' }));
  });
  const abort = new AbortController();
  const iter = model.generate({ ...req, signal: abort.signal })[Symbol.asyncIterator]();
  assert.equal((await iter.next()).value.text, 'partial');
  abort.abort();
  await assert.rejects(iter.next(), { code: 'CANCELLED' });
});
test('Harness projects real increments, adopts steering at the next model request, and joins text', async () => {
  let calls = 0;
  const inputs = [],
    applied = [],
    outputs = [];
  const id = '00000000-0000-4000-8000-000000000001';
  const result = await runHarness({
    prompt: 'original',
    limits: { timeoutMs: 4000, modelCalls: 4 },
    tools: [
      {
        name: 'read',
        description: 'synthetic read',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ ok: true }),
      },
    ],
    realtime: {
      control: async () => ({ stop: false, inputs }),
      applied: async (id) => {
        applied.push(id);
      },
      output: async (step, text, state) => {
        outputs.push({ step, text, state });
      },
    },
    model: {
      async *generate(request) {
        calls++;
        if (calls === 1) {
          inputs.push({ id, text: 'use the new scope' });
          await delay(650);
          yield { type: 'tool_call', id: 'c1', name: 'read', arguments: '{}' };
          yield { type: 'finish', reason: 'tool_calls' };
        } else {
          assert.ok(
            request.messages.some((m) =>
              m.content.some((b) => b.type === 'text' && b.text.includes('use the new scope')),
            ),
          );
          assert.deepEqual(applied, [id]);
          yield { type: 'text', text: '第' };
          await delay(300);
          yield { type: 'text', text: '二段' };
          assert.ok(outputs.some((o) => o.text === '第'));
          yield { type: 'finish', reason: 'stop' };
        }
      },
    },
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.text, '第二段');
  assert.equal(outputs.at(-1).text, '第二段');
  assert.equal(outputs.at(-1).state, 'COMPLETE');
});
test('stop cancels the Harness before any later tool executes', async () => {
  let stop = false,
    executed = false;
  setTimeout(() => (stop = true), 100);
  const result = await runHarness({
    prompt: 'synthetic',
    limits: { timeoutMs: 3000 },
    tools: [
      {
        name: 'write',
        description: 'not allowed to reach',
        parameters: { type: 'object', properties: {} },
        execute: async () => {
          executed = true;
          return {};
        },
      },
    ],
    realtime: {
      control: async () => ({ stop, inputs: [] }),
      applied: async () => {},
      output: async () => {},
    },
    model: {
      async *generate({ signal }) {
        await delay(1500, undefined, { signal });
        yield { type: 'tool_call', id: 'c', name: 'write', arguments: '{}' };
        yield { type: 'finish', reason: 'tool_calls' };
      },
    },
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(executed, false);
});
test('blocking question concludes real Harness without another model round', async () => {
  let waiting = false,
    calls = 0;
  const result = await runHarness({
    prompt: 'synthetic',
    shouldConcludeTurn: () => waiting,
    tools: [
      {
        name: 'ask',
        description: 'question',
        parameters: { type: 'object', properties: {} },
        execute: async () => {
          waiting = true;
          return { waiting: true };
        },
      },
    ],
    model: {
      async *generate() {
        calls++;
        yield { type: 'tool_call', id: 'ask1', name: 'ask', arguments: '{}' };
        yield { type: 'finish', reason: 'tool_calls' };
      },
    },
  });
  assert.equal(result.status, 'completed');
  assert.equal(calls, 1);
  assert.equal(result.tools[0].status, 'succeeded');
});
