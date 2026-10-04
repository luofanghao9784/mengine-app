import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { generateTitle, ConversationTitleTasks } from '../dist/runtime/conversation-title.js';
import { createEngineServer } from '../dist/server.js';
import { AgentTasks } from '../dist/runtime/agent-task.js';

const signal = () => new AbortController().signal;
function model(parts, inspect = () => {}) {
  return {
    lastUsage: null,
    async *generate(request) {
      inspect(request);
      this.lastUsage = { inputTokens: 40, outputTokens: 12 };
      for (const part of parts) yield part;
    },
  };
}
const good = [
  { type: 'text', text: '9POP五店' },
  { type: 'text', text: '收款分析' },
  { type: 'finish', reason: 'stop' },
];
test('pinned Harness helper frames the prompt, keeps chunks contiguous and uses an independent no-tool call', async () => {
  let calls = 0;
  const backend = model(good, (r) => {
    calls++;
    assert.equal(r.maxTokens, 128);
    assert.deepEqual(r.tools, []);
    assert.match(r.messages[0].content[0].text, /business-work conversation/);
    assert.match(JSON.stringify(r.messages), /五店两期/);
  });
  assert.equal(
    await generateTitle('请分析五店两期收款', randomUUID(), backend, signal()),
    '9POP五店收款分析',
  );
  assert.equal(calls, 1);
});
test('invalid title, incomplete finish, tools and cancelled output never replace fallback', async () => {
  for (const parts of [
    [],
    [
      { type: 'text', text: '会话标题' },
      { type: 'finish', reason: 'stop' },
    ],
    [
      { type: 'text', text: '很长'.repeat(30) },
      { type: 'finish', reason: 'stop' },
    ],
    [
      { type: 'text', text: '分析' },
      { type: 'finish', reason: 'length' },
    ],
    [{ type: 'tool_call', id: 'x', name: 'write', arguments: '{}' }],
  ]) {
    await assert.rejects(() => generateTitle('分析收款', randomUUID(), model(parts), signal()));
  }
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(() => generateTitle('分析收款', randomUUID(), model(good), abort.signal));
});
test('auxiliary request is at most once and preserves usage even for invalid titles', async () => {
  const tasks = new ConversationTitleTasks({
    modelName: 'synthetic',
    createModel: () =>
      model([
        { type: 'text', text: '会话标题' },
        { type: 'finish', reason: 'stop' },
      ]),
  });
  const input = {
    contractVersion: '1.0',
    conversationId: randomUUID(),
    requestId: randomUUID(),
    prompt: '合成收款分析',
  };
  const result = await tasks.run(input, signal());
  assert.equal(result.title, null);
  assert.equal(result.inputTokens, 40);
  await assert.rejects(() => tasks.run(input, signal()), { code: 'ATTEMPT_ALREADY_SEEN' });
  await assert.rejects(
    () => tasks.run({ ...input, requestId: randomUUID(), prompt: 'x'.repeat(2001) }, signal()),
    { code: 'INVALID_AGENT_REQUEST' },
  );
});
test('internal title route requires authentication and returns a bounded generated title', async () => {
  const server = createEngineServer({
    token: 't'.repeat(40),
    agent: new AgentTasks({
      platformBaseUrl: 'http://127.0.0.1:19001',
      executionClass: 'verification',
      modelName: 'synthetic',
      createModel: () => model(good),
    }),
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/internal/v1/conversation-title`;
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 401);
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${'t'.repeat(40)}` },
      body: JSON.stringify({
        contractVersion: '1.0',
        conversationId: randomUUID(),
        requestId: randomUUID(),
        prompt: '合成五店两期收款',
      }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).title, '9POP五店收款分析');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
