import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { AgentTasks } from '../dist/runtime/agent-task.js';
import { listen, close, body, json } from './fixtures/agent.mjs';
import { usageFixture } from './fixtures/usage.mjs';

async function fixture(t, scenario, protocol = '1.5') {
  const receipts = [],
    openings = [];
  let calls = 0;
  const platform = createServer(async (req, res) => {
    if (usageFixture(req, res)) return;
    const input = await body(req);
    if (req.url.endsWith('/check')) return json(res, { allowed: true, executionClass: 'verification' });
    if (req.url.endsWith('/execution/open')) {
      openings.push(input);
      return json(res, { accepted: true, policy: 'READ_ONLY_PRIVATE_V1' });
    }
    if (req.url.endsWith('/execution/tool')) {
      receipts.push(input);
      return json(res, { accepted: true });
    }
    if (req.url.endsWith('/search')) return json(res, { items: [] });
    json(res, { code: 'unexpected' }, 404);
  });
  const url = await listen(platform);
  t.after(() => close(platform));
  const agent = new AgentTasks({
    platformBaseUrl: url,
    executionClass: 'verification',
    modelName: 'synthetic-control',
    createModel: () => ({
      usage: null,
      async *generate(request) {
        calls++;
        if (scenario === 'budget' && calls < 8) {
          yield {
            type: 'tool_call',
            id: `search-${calls}`,
            name: 'search_sources',
            arguments: JSON.stringify({ query: '收款' }),
          };
          yield { type: 'finish', reason: 'tool_calls' };
        } else if (calls === 1 && scenario !== 'legacy') {
          assert.ok(
            request.tools.some((t) => t.name === 'task_control'),
            JSON.stringify(request.tools.map((t) => t.name)),
          );
          const failed = scenario === 'failed-tool';
          yield {
            type: 'tool_call',
            id: 'call-1',
            name: failed ? 'search_sources' : 'task_control',
            arguments: JSON.stringify(
              failed ? { query: 'x'.repeat(201) } : { outcome: scenario, message: '请提供合成截止日期' },
            ),
          };
          yield { type: 'finish', reason: 'tool_calls' };
        } else {
          if (scenario === 'budget') assert.deepEqual(request.tools, []);
          yield { type: 'text', text: '合成说明：已取得部分信息，仍需确认缺少的数据。' };
          yield { type: 'finish', reason: 'stop' };
        }
      },
    }),
  });
  const result = await agent.run(
    {
      contractVersion: protocol,
      taskId: randomUUID(),
      attemptId: randomUUID(),
      prompt: '仅用于本机合成测试',
    },
    new AbortController().signal,
  );
  return { result, receipts, openings, calls };
}
test('actual Harness returns explicit waiting input and records tool start/result over HTTP', async (t) => {
  const { result, receipts, openings } = await fixture(t, 'WAITING_INPUT');
  assert.equal(result.contractVersion, '1.5');
  assert.equal(result.outcome, 'WAITING_INPUT');
  assert.equal(result.requiredInput, '请提供合成截止日期');
  assert.equal(result.tools[0].status, 'succeeded');
  assert.deepEqual(
    receipts.map((r) => r.status),
    ['STARTED', 'succeeded'],
  );
  assert.ok(openings[0].tools.includes('task_control'));
  assert.equal(result.modelCalls, 2);
});
test('missing capability is a persistent outcome, not automatic model retries', async (t) => {
  const { result, calls } = await fixture(t, 'WAITING_CAPABILITY');
  assert.equal(result.outcome, 'WAITING_CAPABILITY');
  assert.equal(calls, 2);
});
test('failed actual tool remains failed and yields partial delivery rather than completed business success', async (t) => {
  const warnings = [];
  t.mock.method(console, 'warn', (line) => warnings.push(JSON.parse(line)));
  const { result, receipts } = await fixture(t, 'failed-tool');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].event, 'TASK_TOOL_REJECTED');
  assert.equal(warnings[0].tool, 'search_sources');
  assert.equal(warnings[0].code, 'INVALID_QUERY');
  assert.equal(warnings[0].callId, 'call-1');
  assert.equal(warnings[0].executionStarted, true);
  assert.match(warnings[0].taskId, /^[0-9a-f-]{36}$/);
  assert.match(warnings[0].attemptId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(Object.keys(warnings[0]).sort(), [
    'attemptId',
    'callId',
    'code',
    'event',
    'executionStarted',
    'taskId',
    'tool',
  ]);
  assert.equal(result.outcome, 'PARTIAL');
  assert.equal(result.tools[0].status, 'failed');
  assert.equal(result.tools[0].rejection, undefined);
  assert.deepEqual(
    receipts.map((r) => r.status),
    ['STARTED', 'failed'],
  );
  assert.deepEqual(result.artifacts, []);
});
test('legacy 1.4 requests keep the existing response and never call new callbacks', async (t) => {
  const { result, receipts, openings } = await fixture(t, 'legacy', '1.4');
  assert.equal(result.contractVersion, '1.4');
  assert.equal(result.outcome, undefined);
  assert.equal(result.requiredInput, undefined);
  assert.deepEqual(receipts, []);
  assert.deepEqual(openings, []);
});
test('repeated searches retain a partial response within eight metered calls, never business success', async (t) => {
  const { result, receipts, calls } = await fixture(t, 'budget');
  assert.equal(calls, 8);
  assert.equal(result.outcome, 'PARTIAL');
  assert.match(result.requiredInput, /预算/);
  assert.match(result.text, /仍需确认缺少的数据/);
  assert.equal(receipts.filter((r) => r.status === 'succeeded').length, 6);
});
