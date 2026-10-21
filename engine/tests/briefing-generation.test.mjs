import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { AgentTasks } from '../dist/runtime/agent-task.js';
import { runHarness } from '../dist/runtime/harness.js';
import { hasPreparedBriefing, hasTerminalBriefing } from '../dist/runtime/briefing-delivery.js';
import { listen, close, body, json } from './fixtures/agent.mjs';
import { usageFixture } from './fixtures/usage.mjs';

async function generationFixture(t, { generation = true, missing = false, revoke = false, ignore = false, data = false, calculationLoop = false, ignoreCalculation = false, malformedDelivery = false, noUsefulContent = false, supplement = false, revokeSupplement = false } = {}) {
  const queries = [], receipts = [], deliveries = [];
  const sourceId = randomUUID(), artifactId = randomUUID(), calculationId = randomUUID();
  let calls = 0, calculations = 0, attemptedDelivery = false, supplementalCalls = 0;
  const platform = createServer(async (req, res) => {
    if (usageFixture(req, res)) return;
    const input = await body(req);
    if (req.url.endsWith('/check'))
      return json(res, {
        allowed: !(revoke && queries.length === 3) && !(revokeSupplement && supplementalCalls > 2), executionClass: 'live',
        ...(supplement ? {briefingEvidenceSupplementVersion:'1.0'} : {}),
        contextVersion: '1.0', briefingContentVersion: '1.0', briefingGeneration: generation,
        ...(data ? { tableComparisonVersion: '1.0' } : {}),
      });
    if (req.url.endsWith('/context'))
      return json(res, {
        contractVersion: '1.0', action: input.action, referenceOnly: true,
        result: input.action==='profiles'?{items:[],hasMore:false}:{ sourceScope: 'SELECTED', selectedMaterials: [{ filename: 'selected.txt', version: 1 }] },
      });
    if (req.url.endsWith('/execution/open'))
      return json(res, { accepted: true, policy: 'READ_ONLY_PRIVATE_V1' });
    if (req.url.endsWith('/execution/tool')) {
      receipts.push(input);
      return json(res, { accepted: true });
    }
    if (req.url.endsWith('/search')) {
      queries.push(input.query);
      return json(res, {
        items: missing ? [] : [{ id: sourceId, filename: data ? 'selected.xlsx' : 'selected.txt', version: 1,
          locator: 'L1', content: '合成项目已经提交方案，客户确认仍未完成。' }],
      });
    }
    if (req.url.endsWith('/compare-table')) {
      assert.equal(input.sourceId, sourceId);
      calculations++;
      return json(res, { contractVersion: '1.0', status: 'COMPUTED', source: { id: sourceId },
        calculation: { recipeVersion: 'table-compare-1', rows: [{ current: '120', baseline: '100' }] },
        artifact: { id: calculationId, filename: 'table-comparison-12345678901234567890.json' } });
    }
    if (req.url.endsWith('/deliver-briefing')) {
      if (data) {
        assert.equal(calculations, 1);
        assert.equal(input.calculationArtifactId, calculationId);
      }
      deliveries.push(input);
      if (noUsefulContent) return json(res, { contractVersion: '1.0', status: 'NO_NEW_CONTENT', reason: 'NO_USEFUL_CONTENT' });
      return json(res, { contractVersion: '1.0', status: 'PREPARED', artifactId,
        title: input.title, visibility: 'PRIVATE_AFTER_TASK_SUCCEEDS' });
    }
    return json(res, {}, 404);
  });
  const url = await listen(platform);
  t.after(() => close(platform));
  const agent = new AgentTasks({
    platformBaseUrl: url, executionClass: 'live', modelName: 'synthetic-briefing-search-loop',
    createModel: () => ({ usage: null, async *generate(request) {
      calls++;
      const searchAvailable = request.tools.some((tool) => tool.name === 'search_sources');
      if (supplement && calculations > 0 && supplementalCalls < 3) {
        assert.ok(!request.tools.some(tool => tool.name === 'compare_table'));
        const name=supplementalCalls===0?'request_briefing_evidence':'task_context';
        assert.ok(request.tools.some(tool=>tool.name===name));
        yield {type:'tool_call',id:`supplement-${calls}`,name,arguments:JSON.stringify(supplementalCalls===0?{reason:'缺少业务确认与银行到账的解释边界'}:{action:'profiles',scope:'TENANT'})};
        supplementalCalls++;
        yield {type:'finish',reason:'tool_calls'};
      } else if ((searchAvailable && (generation || calls < 5)) || (ignore && calls === 4)) {
        yield { type: 'tool_call', id: `search-${calls}`, name: 'search_sources',
          arguments: JSON.stringify({ query: `客户 ${calls}` }) };
        yield { type: 'finish', reason: 'tool_calls' };
      } else if (!generation || missing || (ignore && !data) || (ignoreCalculation && calls > 5)) {
        yield { type: 'text', text: '未形成完整的新主题，本次没有生成画报。' };
        yield { type: 'finish', reason: 'stop' };
      } else if (data && (calculations === 0 || (ignoreCalculation && calls === 5) || (calculationLoop && request.tools.some((tool) => tool.name === 'compare_table')))) {
        if (!ignoreCalculation || calls !== 5) assert.ok(request.tools.some((tool) => tool.name === 'compare_table'));
        yield { type: 'tool_call', id: `calculation-${calls}`, name: 'compare_table',
          arguments: JSON.stringify({ sourceId: 'table-1', sheet: '经营', range: 'A1:C3',
            groupColumn: 'B', periodColumn: 'A', valueColumn: 'C', baseline: '前期', current: '本期' }) };
        yield { type: 'finish', reason: 'tool_calls' };
      } else {
        assert.ok(request.tools.some((tool) => tool.name === 'deliver_briefing'));
        assert.match(JSON.stringify(request.messages), /客户确认仍未完成/);
        if (data) assert.ok(JSON.stringify(request.messages).includes(calculationId));
        if (data) {
          assert.deepEqual(request.tools.map((tool) => tool.name), ['deliver_briefing']);
          assert.equal(request.requiredTool, 'deliver_briefing');
        }
        const rejectArguments = malformedDelivery && !attemptedDelivery;
        attemptedDelivery = true;
        yield { type: 'tool_call', id: `delivery-${calls}`, name: 'deliver_briefing',
          arguments: JSON.stringify({ businessType: data ? 'DATA' : 'INSIGHT', title: '合成项目待客户确认',
            ...(data ? { calculationArtifactId: calculationId } : {}),
            summary: '方案已经提交，客户确认仍需要继续跟进。',
            analysis: rejectArguments ? '错误的参数类型' : ['资料仅能证明方案已经提交，尚未证明客户确认。', '建议先核实客户确认时间，避免把提交当成完成。'] }) };
        yield { type: 'finish', reason: 'tool_calls' };
      }
    } }),
  });
  const run = () => agent.run({ contractVersion: '1.5', taskId: randomUUID(), attemptId: randomUUID(),
    prompt: '系统智能画报生成：读取所选资料，生成一个有依据的新主题。' }, new AbortController().signal);
  return { run, queries, receipts, deliveries, calls: () => calls, calculations: () => calculations };
}

test('system generation ends a repeated-search loop and delivers within the existing eight-call budget', async (t) => {
  const f = await generationFixture(t);
  const result = await f.run();
  assert.equal(f.calls(), 4);
  assert.deepEqual(f.queries, ['', '客户 2', '客户 3']);
  assert.equal(f.deliveries.length, 1);
  assert.equal(f.deliveries[0].businessType, 'INSIGHT');
  assert.equal(result.outcome, 'COMPLETE');
  assert.equal(result.tools.at(-1).name, 'deliver_briefing');
  assert.equal(result.tools.at(-1).status, 'succeeded');
  assert.equal(result.text, '画报已生成，可在智能画报查看。');
  assert.deepEqual(f.receipts.filter((r) => r.status === 'succeeded').map((r) => r.name),
    ['search_sources', 'search_sources', 'search_sources', 'deliver_briefing']);
});

test('closing retrieval keeps the granted calculation available before DATA delivery', async (t) => {
  const f = await generationFixture(t, { data: true });
  const result = await f.run();
  assert.equal(f.calls(), 5);
  assert.equal(f.queries.length, 3);
  assert.equal(f.deliveries[0].businessType, 'DATA');
  assert.equal(result.outcome, 'COMPLETE');
  assert.deepEqual(f.receipts.filter((r) => r.status === 'succeeded').map((r) => r.name),
    ['search_sources', 'search_sources', 'search_sources', 'compare_table', 'deliver_briefing']);
});

test('one verified calculation closes further calculation rounds and requires delivery', async (t) => {
  const f = await generationFixture(t, { data: true, calculationLoop: true });
  const result = await f.run();
  assert.equal(f.calls(), 5);
  assert.equal(f.deliveries.length, 1);
  assert.equal(result.outcome, 'COMPLETE');
  assert.equal(result.tools.filter((tool) => tool.name === 'compare_table').length, 1);
});

test('native delivery recovers rejected arguments with matching failed and successful platform receipts', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const f = await generationFixture(t, { data: true, malformedDelivery: true });
  const result = await f.run();
  assert.equal(f.calls(), 6);
  assert.equal(f.deliveries.length, 1);
  assert.equal(result.outcome, 'COMPLETE');
  assert.equal(result.text, '画报已生成，可在智能画报查看。');
  assert.deepEqual(result.tools.slice(-2).map((r) => `${r.name}/${r.status}`),
    ['deliver_briefing/failed', 'deliver_briefing/succeeded']);
  assert.deepEqual(f.receipts.filter((r) => r.status !== 'STARTED').map((r) => `${r.name}/${r.status}`),
    result.tools.map((r) => `${r.name}/${r.status}`));
});

test('no useful content ends native generation without claiming a newly published card', async (t) => {
  const f = await generationFixture(t, { noUsefulContent: true });
  const result = await f.run();
  assert.equal(f.calls(), 4);
  assert.equal(result.outcome, 'COMPLETE');
  assert.equal(result.text, '本次没有新增画报：所选资料暂无独立的新主题。');
});

test('terminal receipt cannot conceal failed retrieval, invalid proof, or ordinary delivery failure', () => {
  const prepared = { name: 'deliver_briefing', status: 'succeeded', output: {
    contractVersion: '1.0', status: 'PREPARED', artifactId: randomUUID(), visibility: 'PRIVATE_AFTER_TASK_SUCCEEDS' } };
  assert.equal(hasTerminalBriefing([{ name: 'deliver_briefing', status: 'failed' }, prepared]), true);
  assert.equal(hasTerminalBriefing([{ name: 'search_sources', status: 'failed' }, prepared]), false);
  assert.equal(hasTerminalBriefing([{ name: 'deliver_briefing', status: 'failed' },
    { ...prepared, output: { status: 'PREPARED' } }]), false);
  assert.equal(hasPreparedBriefing([{ name: 'deliver_briefing', status: 'failed' }, prepared]), false);
});

test('a stale fourth search reports closure and still permits grounded DATA delivery', async (t) => {
  const f = await generationFixture(t, { data: true, ignore: true });
  const result = await f.run();
  assert.equal(f.queries.length, 3);
  assert.equal(f.calls(), 6);
  assert.equal(f.deliveries.length, 1);
  assert.equal(result.outcome, 'COMPLETE');
  assert.ok(result.tools.every((tool) => tool.status === 'succeeded'));
});

test('a model ignoring the required delivery cannot dispatch another platform calculation', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const f = await generationFixture(t, { data: true, ignoreCalculation: true });
  const result = await f.run();
  assert.equal(f.calculations(), 1);
  assert.equal(result.outcome, 'PARTIAL');
  assert.ok(result.tools.some((tool) => tool.name === 'compare_table' && tool.status === 'failed'));
});

test('only the server generation flag bounds searches; ordinary conversations retain their retrieval budget', async (t) => {
  const f = await generationFixture(t, { generation: false });
  const result = await f.run();
  assert.equal(f.calls(), 5);
  assert.deepEqual(f.queries, ['客户 1', '客户 2', '客户 3', '客户 4']);
  assert.equal(f.deliveries.length, 0);
  assert.equal(result.outcome, 'COMPLETE');
});

test('bounded retrieval without evidence never invents a card', async (t) => {
  const f = await generationFixture(t, { missing: true });
  const result = await f.run();
  assert.equal(f.queries.length, 3);
  assert.equal(f.deliveries.length, 0);
  assert.equal(hasPreparedBriefing(result.tools), false);
  assert.match(result.text, /没有生成画报/);
});

test('a model ignoring the removed search tool gets closure without a fourth platform lookup', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const f = await generationFixture(t, { ignore: true });
  const result = await f.run();
  assert.equal(f.queries.length, 3);
  assert.equal(f.deliveries.length, 0);
  assert.equal(result.outcome, 'COMPLETE');
  assert.equal(result.tools.at(-1).status, 'succeeded');
});

test('authority is rechecked before delivery after bounded retrieval', async (t) => {
  const f = await generationFixture(t, { revoke: true });
  await assert.rejects(f.run(), { code: 'TASK_ACCESS_DENIED' });
  assert.equal(f.deliveries.length, 0);
});

for (const mode of ['prepared', 'duplicate', 'missing', 'forbidden'])
  test(`the final system call reserves actual delivery: ${mode}`, async () => {
    let calls = 0, deliveries = 0;
    const result = await runHarness({
      prompt: 'synthetic last-call delivery', reserveFinalResponse: true,
      finishOnDeliverable: true, hasCompletedDeliverable: hasPreparedBriefing,
      limits: { modelCalls: 8, toolCalls: 8, timeoutMs: 55000 },
      tools: [
        { name: 'search_sources', description: 'synthetic retrieval', parameters: { type: 'object' },
          execute: async () => ({ items: [] }) },
        { name: 'deliver_briefing', description: 'synthetic delivery', parameters: { type: 'object' },
          execute: async () => {
            deliveries++;
            return mode === 'duplicate'
              ? { contractVersion: '1.0', status: 'NO_NEW_CONTENT', reason: 'DUPLICATE_CONTENT' }
              : { contractVersion: '1.0', status: 'PREPARED', artifactId: randomUUID(),
                  visibility: 'PRIVATE_AFTER_TASK_SUCCEEDS' };
          } },
      ],
      model: { async *generate(request) {
        calls++;
        if (calls < 8 || mode === 'forbidden') {
          yield { type: 'tool_call', id: `lookup-${calls}`, name: 'search_sources', arguments: '{}' };
          yield { type: 'finish', reason: 'tool_calls' };
        } else if (mode === 'missing') {
          assert.deepEqual(request.tools.map((t) => t.name), ['deliver_briefing']);
          yield { type: 'text', text: '缺少可靠证据，没有生成画报。' };
          yield { type: 'finish', reason: 'stop' };
        } else {
          assert.deepEqual(request.tools.map((t) => t.name), ['deliver_briefing']);
          yield { type: 'tool_call', id: 'delivery', name: 'deliver_briefing', arguments: '{}' };
          yield { type: 'finish', reason: 'tool_calls' };
        }
      } },
    });
    assert.equal(calls, 8);
    assert.equal(deliveries, ['prepared', 'duplicate'].includes(mode) ? 1 : 0);
    assert.equal(hasPreparedBriefing(result.tools), ['prepared', 'duplicate'].includes(mode));
    assert.equal(result.status, mode === 'forbidden' ? 'limit' : 'completed');
    assert.equal(result.finalResponseReserved, true);
  });

test('negotiated supplement reopens exactly two reads after calculation and then delivers within eight calls', async t => {
  const f=await generationFixture(t,{data:true,supplement:true});
  const result=await f.run();
  assert.equal(result.outcome,'COMPLETE');assert.equal(f.calls(),8);assert.equal(f.calculations(),1);
  assert.deepEqual(f.receipts.filter(r=>r.status==='succeeded').map(r=>r.name),['search_sources','search_sources','search_sources','compare_table','request_briefing_evidence','task_context','task_context','deliver_briefing']);
});

test('source revocation during supplemental reads prevents delivery', async t => {
 const f=await generationFixture(t,{data:true,supplement:true,revokeSupplement:true});
 await assert.rejects(f.run(), e=>e.code==='TASK_ACCESS_DENIED');assert.equal(f.deliveries.length,0);assert.equal(f.calculations(),1);
});
