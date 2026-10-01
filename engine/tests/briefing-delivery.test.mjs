import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { briefingDeliveryTool, hasPreparedBriefing } from '../dist/runtime/briefing-delivery.js';
import { AgentTasks } from '../dist/runtime/agent-task.js';
import { runHarness } from '../dist/runtime/harness.js';
import { listen, close, body, json } from './fixtures/agent.mjs';
import { usageFixture } from './fixtures/usage.mjs';
test('a model claim or malformed envelope is not a real prepared briefing', async () => {
  const tool = briefingDeliveryTool({
    authorize: async () => {},
    invoke: async () => ({ status: 'SUCCESS', text: '已经生成图表' }),
  });
  await assert.rejects(tool.execute({}, new AbortController().signal), { code: 'BRIEFING_RECEIPT_INVALID' });
});
test('native generation concludes on the verified receipt without another model call', async (t) => {
  const realNow = performance.now.bind(performance);
  let elapsed = 0;
  t.mock.method(performance, 'now', () => realNow() + elapsed);
  let calls = 0,
    delivered = 0;
  const receipts = [],
    artifactId = randomUUID(),
    calc = randomUUID();
  const platform = createServer(async (req, res) => {
    if (usageFixture(req, res)) return;
    const input = await body(req);
    if (req.url.endsWith('/check'))
      return json(res, {
        allowed: true,
        executionClass: 'live',
        briefingContentVersion: '1.0',
        briefingGeneration: true,
      });
    if (req.url.endsWith('/execution/open')) {
      assert.ok(input.tools.includes('deliver_briefing'));
      return json(res, { accepted: true, policy: 'READ_ONLY_PRIVATE_V1' });
    }
    if (req.url.endsWith('/execution/tool')) {
      receipts.push(input);
      return json(res, { accepted: true });
    }
    if (req.url.endsWith('/deliver-briefing')) {
      delivered++;
      elapsed = 1000;
      assert.equal(input.calculationArtifactId, calc);
      return json(res, {
        contractVersion: '1.0',
        status: 'PREPARED',
        artifactId,
        title: input.title,
        visibility: 'PRIVATE_AFTER_TASK_SUCCEEDS',
      });
    }
    json(res, {}, 404);
  });
  const url = await listen(platform);
  t.after(() => close(platform));
  const agent = new AgentTasks({
    platformBaseUrl: url,
    executionClass: 'live',
    modelName: 'synthetic-briefing',
    createModel: () => ({
      usage: null,
      async *generate(r) {
        calls++;
        if (calls === 1) {
          yield {
            type: 'tool_call',
            id: 'brief',
            name: 'deliver_briefing',
            arguments: JSON.stringify({
              calculationArtifactId: calc,
              title: '合成经营分析画报',
              summary: '本次分析仅用于验证画报生成链路。',
              analysis: ['金额由实际计算回执提供给画报工具。', '画报默认只对本次会话的本人可见。'],
            }),
          };
          yield { type: 'finish', reason: 'tool_calls' };
        } else {
          assert.ok(JSON.stringify(r.messages).includes('PREPARED'));
          assert.equal(r.tools.length, 0);
          assert.match(r.messages[0].content[0].text, /verified a terminal delivery receipt/);
          yield { type: 'text', text: '画报已生成，可在智能画报查看。' };
          yield { type: 'finish', reason: 'stop' };
        }
      },
    }),
  });
  const r = await agent.run(
    { contractVersion: '1.5', taskId: randomUUID(), attemptId: randomUUID(), prompt: '生成合成画报' },
    new AbortController().signal,
  );
  assert.equal(r.outcome, 'COMPLETE');
  assert.equal(delivered, 1);
  assert.deepEqual(
    receipts.map((x) => x.status),
    ['STARTED', 'succeeded'],
  );
  assert.equal(calls, 1);
  assert.equal(r.text, '画报已生成，可在智能画报查看。');
});

test('a claim, failed tool, or unfinished post-delivery tool cannot release a partial result', () => {
  const valid = {
    name: 'deliver_briefing',
    status: 'succeeded',
    output: {
      contractVersion: '1.0',
      status: 'PREPARED',
      artifactId: randomUUID(),
      visibility: 'PRIVATE_AFTER_TASK_SUCCEEDS',
    },
  };
  assert.equal(hasPreparedBriefing([valid]), true);
  for (const tools of [
    [],
    [{ ...valid, output: { text: '已经生成' } }],
    [{ ...valid, status: 'failed' }],
    [{ name: 'search_sources', status: 'failed' }, valid],
    [valid, { name: 'search_sources', status: 'succeeded' }],
  ])
    assert.equal(hasPreparedBriefing(tools), false);
});

test('verified duplicate receipt completes without pretending to save a new card', async () => {
  const receipt = { contractVersion: '1.0', status: 'NO_NEW_CONTENT', reason: 'DUPLICATE_CONTENT' };
  const tool = briefingDeliveryTool({ authorize: async () => {}, invoke: async () => receipt });
  assert.deepEqual(await tool.execute({}, new AbortController().signal), receipt);
  assert.equal(
    hasPreparedBriefing([{ name: 'deliver_briefing', status: 'succeeded', output: receipt }]),
    true,
  );
  assert.equal(
    hasPreparedBriefing([
      { name: 'deliver_briefing', status: 'succeeded', output: { ...receipt, reason: 'model says so' } },
    ]),
    false,
  );
});

test('receipt-based completion respects duplicates, cancellation, failed tools and conversation mode', async () => {
  for (const mode of ['duplicate', 'cancel', 'failed-tool', 'conversation']) {
    let calls = 0;
    const controller = new AbortController();
    const result = await runHarness({
      prompt: 'synthetic terminal receipt check',
      signal: controller.signal,
      finishOnDeliverable: mode !== 'conversation',
      hasCompletedDeliverable: hasPreparedBriefing,
      tools: [
        {
          name: 'deliver_briefing',
          description: 'synthetic',
          parameters: { type: 'object', properties: {} },
          execute: async () => {
            if (mode === 'cancel') controller.abort();
            if (mode === 'failed-tool') throw Error('synthetic failure');
            return { contractVersion: '1.0', status: 'NO_NEW_CONTENT', reason: 'DUPLICATE_CONTENT' };
          },
        },
      ],
      model: {
        async *generate() {
          calls++;
          if (calls === 1) {
            yield { type: 'tool_call', id: 'delivery', name: 'deliver_briefing', arguments: '{}' };
            yield { type: 'finish', reason: 'tool_calls' };
          } else {
            yield { type: 'text', text: 'No new content.' };
            yield { type: 'finish', reason: 'stop' };
          }
        },
      },
    });
    assert.equal(calls, ['duplicate', 'cancel'].includes(mode) ? 1 : 2, mode);
    assert.equal(result.status, mode === 'cancel' ? 'cancelled' : 'completed', mode);
    assert.equal(hasPreparedBriefing(result.tools), ['duplicate', 'conversation'].includes(mode), mode);
  }
});
