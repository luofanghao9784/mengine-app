import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { sourceQueries } from '../dist/runtime/source-query.js';
import { AgentTasks } from '../dist/runtime/agent-task.js';
import { listen, close, body, json } from './fixtures/agent.mjs';
import { usageFixture } from './fixtures/usage.mjs';
const context = (patch = {}) => ({
  contractVersion: '1.0',
  action: 'bootstrap',
  referenceOnly: true,
  result: {
    organization: { name: '合成品牌', source: 'CURRENT_TENANT', authority: false },
    sourceScope: 'AUTHORIZED_LIBRARY',
    selectedMaterials: [],
    ...patch,
  },
});

test('company fallback is bounded and never overrides selected documents or unrelated questions', () => {
  assert.deepEqual(sourceQueries('你好，介绍当前企业', '企业介绍', context()), ['企业介绍', '合成品牌']);
  assert.deepEqual(sourceQueries('介绍当前企业', '', context()), ['合成品牌']);
  assert.deepEqual(sourceQueries('介绍当前企业', '合成品牌', context()), ['合成品牌']);
  assert.deepEqual(sourceQueries('介绍另一家公司', '企业介绍', context()), ['企业介绍']);
  assert.deepEqual(sourceQueries('介绍当前企业', '企业介绍', context({ sourceScope: 'SELECTED' })), [
    '企业介绍',
  ]);
  assert.deepEqual(
    sourceQueries('介绍当前企业', '', context({ selectedMaterials: [{ filename: 'selected.txt' }] })),
    [''],
  );
  assert.throws(() => sourceQueries('分析当前工作', '', context()), { code: 'SEARCH_QUERY_REQUIRED' });
  assert.deepEqual(sourceQueries('介绍当前企业', '企业介绍'), ['企业介绍']);
});

for (const failed of [false, true])
  test(`actual Harness company search ${failed ? 'preserves lookup failure' : 'falls back to tenant name after no match'}`, async (t) => {
    const queries = [],
      id = randomUUID();
    let calls = 0;
    const coverage = {
      scope: 'AUTHORIZED_LIBRARY',
      status: 'READY',
      relevance: 'NOT_ASSESSED',
      totalVersions: 1,
      searchableVersions: 1,
      partialVersions: 0,
      notReadyVersions: 0,
      versions: [],
      hasMore: false,
    };
    const platform = createServer(async (req, res) => {
      if (usageFixture(req, res)) return;
      const input = await body(req);
      if (req.url.endsWith('/check'))
        return json(res, { allowed: true, executionClass: 'verification', contextVersion: '1.0' });
      if (req.url.endsWith('/context')) return json(res, context());
      if (req.url.endsWith('/execution/open'))
        return json(res, { accepted: true, policy: 'READ_ONLY_PRIVATE_V1' });
      if (req.url.endsWith('/execution/tool')) return json(res, { accepted: true });
      if (req.url.endsWith('/search')) {
        queries.push(input.query);
        if (failed) return json(res, { code: 'INVALID_REQUEST' }, 400);
        const matched = input.query === '合成品牌';
        return json(res, {
          items: matched
            ? [{ id, filename: '合成合同.txt', version: 1, locator: 'L1', content: '合成品牌提供培训服务。' }]
            : [],
          matchStatus: matched ? 'MATCHED' : 'NO_MATCH',
          coverage,
          hasMore: false,
        });
      }
      return json(res, {}, 404);
    });
    const url = await listen(platform);
    t.after(() => close(platform));
    const agent = new AgentTasks({
      platformBaseUrl: url,
      executionClass: 'verification',
      modelName: 'synthetic-company',
      createModel: () => ({
        usage: null,
        async *generate(request) {
          calls++;
          if (calls === 1) {
            assert.ok(request.messages.some((m) => m.content.some((c) => c.text?.includes('合成品牌'))));
            yield {
              type: 'tool_call',
              id: 'company-lookup',
              name: 'search_sources',
              arguments: JSON.stringify({ query: '企业介绍' }),
            };
            yield { type: 'finish', reason: 'tool_calls' };
          } else {
            const output = request.messages.flatMap((m) => m.content).find((c) => c.type === 'tool_result');
            assert.equal(output.isError, failed);
            assert.ok(output.content.includes(failed ? 'REMOTE_BAD_REQUEST' : '合成品牌提供培训服务'));
            if (!failed) assert.ok(output.content.includes('effectiveQuery'));
            yield {
              type: 'text',
              text: failed ? '本次检索失败，不能判断资料是否存在。' : '根据合成合同，合成品牌提供培训服务。',
            };
            yield { type: 'finish', reason: 'stop' };
          }
        },
      }),
    });
    const result = await agent.run(
      { contractVersion: '1.5', taskId: randomUUID(), attemptId: randomUUID(), prompt: '你好，介绍当前企业' },
      new AbortController().signal,
    );
    assert.deepEqual(queries, failed ? ['企业介绍'] : ['企业介绍', '合成品牌']);
    assert.equal(calls, 2);
    assert.equal(result.outcome, failed ? 'PARTIAL' : 'COMPLETE');
    assert.deepEqual(result.sourceIds, failed ? [] : [id]);
  });

test('empty unrestricted search returns bounded correction without copying the prompt', () => {
 assert.throws(()=>sourceQueries('private wording','',context()),e=>e.code==='SEARCH_QUERY_REQUIRED'&&e.hint.includes('keyword')&&!e.hint.includes('private wording'));
});
