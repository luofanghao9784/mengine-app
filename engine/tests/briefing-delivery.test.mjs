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

test('dataset briefing closes retrieval after three lookups and delivers an honest bounded insight without scanning all rows', async (t) => {
  const datasetId = randomUUID(), snapshotId = randomUUID(), artifactId = randomUUID();
  const source = { datasetId, snapshotId, version: 1, name: '合成收款', description: '',
    columns: ['门店', '收款状态'], columnOffset: 0, nextColumnOffset: null, totalColumns: 2,
    rowCount: 100, coverageThrough: null, collectedAt: '2026-10-05T00:00:00Z', authority: false };
  const actions = [];
  const platform = createServer(async (req, res) => {
    if (usageFixture(req, res)) return;
    const input = await body(req);
    if (req.url.endsWith('/check')) return json(res, { allowed: true, executionClass: 'live',
      contextVersion: '1.0', datasetContextVersion: '1.0', datasetComparisonVersion: '1.0',
      briefingContentVersion: '1.0', briefingGeneration: true });
    if (req.url.endsWith('/context')) {
      actions.push(input.action);
      const result = input.action === 'bootstrap' ? {} : input.action === 'dataset_search'
        ? { items: [source], hasMore: false }
        : { source, rows: [['合成门店', '待确认']], offset: input.offset ?? 0, nextOffset: (input.offset ?? 0) + 1,
          hasMore: true, completeDataset: false, referenceOnly: true };
      return json(res, { contractVersion: '1.0', action: input.action, referenceOnly: true, result });
    }
    if (req.url.endsWith('/execution/open')) return json(res, { accepted: true, policy: 'READ_ONLY_PRIVATE_V1' });
    if (req.url.endsWith('/execution/tool')) return json(res, { accepted: true });
    if (req.url.endsWith('/deliver-briefing')) {
      assert.equal(input.businessType, 'INSIGHT');
      assert.equal(input.calculationArtifactId, undefined);
      assert.match(input.summary, /样本/);
      return json(res, { contractVersion: '1.0', status: 'PREPARED', artifactId,
        title: input.title, visibility: 'PRIVATE_AFTER_TASK_SUCCEEDS' });
    }
    json(res, {}, 404);
  });
  const url = await listen(platform); t.after(() => close(platform));
  let calls = 0;
  const agent = new AgentTasks({ platformBaseUrl: url, executionClass: 'live', modelName: 'synthetic-dataset-insight',
    createModel: () => ({ usage: null, async *generate(request) {
      calls++;
      const instructions = request.messages[0].content[0].text;
      assert.match(instructions, /compare_dataset computes ALL rows/);
      let name = 'task_context', args;
      if (calls === 1) args = { action: 'dataset_search' };
      else if (calls === 2) args = { action: 'dataset_read', referenceId: datasetId, versionId: snapshotId, columnLimit: 10 };
      else if (calls === 3) args = { action: 'dataset_read', referenceId: datasetId, versionId: snapshotId, columnLimit: 10, offset: 1 };
      else {
        assert.equal(calls, 4);
        assert.ok(!request.tools.some(tool => tool.name === 'task_context'));
        assert.match(instructions, /retrieval is now closed after three successful lookups/);
        assert.match(instructions, /Successful dataset_read calls so far: 2/);
        name = 'deliver_briefing';
        args = { businessType: 'INSIGHT', title: '收款确认状态值得进一步核对',
          summary: '已读取样本中存在待确认收款，仍需核对其业务依据。',
          analysis: ['本次仅观察到固定版本中的一条样本，不代表完整数据集的分布。',
            '建议结合业务回执核对确认状态，当前证据不足以推断经营原因。'] };
      }
      yield { type: 'tool_call', id: `dataset-insight-${calls}`, name, arguments: JSON.stringify(args) };
      yield { type: 'finish', reason: 'tool_calls' };
    } }) });
  const result = await agent.run({ contractVersion: '1.5', taskId: randomUUID(), attemptId: randomUUID(),
    prompt: 'Generate one useful briefing from selected synthetic sources.' }, new AbortController().signal);
  assert.equal(result.outcome, 'COMPLETE');
  assert.equal(calls, 4);
  assert.deepEqual(actions, ['bootstrap', 'dataset_search', 'dataset_read', 'dataset_read']);
  assert.deepEqual(result.tools.map(r => r.name), ['task_context', 'task_context', 'task_context', 'deliver_briefing']);
});
