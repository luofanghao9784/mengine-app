import test from 'node:test';
import assert from 'node:assert/strict';
import { inputCoverage } from '../dist/runtime/input-coverage.js';
import { runHarness } from '../dist/runtime/harness.js';

const response = () => ({ matchStatus: 'NO_MATCH', hasMore: false, coverage: {
  scope: 'AUTHORIZED_WORKSPACE', status: 'NOT_READY', relevance: 'NOT_ASSESSED',
  totalVersions: 2, searchableVersions: 0, partialVersions: 0, notReadyVersions: 2,
  versions: [{ warnings: ['PARSER_PENDING'], filename: 'not-forwarded.txt' }], hasMore: false,
} });

test('legacy input remains unknown; no-match preserves not-ready and never asserts business absence', () => {
  assert.deepEqual(inputCoverage({ items: [] }), { coverage: null, coverageAvailable: false, resultsTruncated: null });
  const projected = inputCoverage(response());
  assert.equal(projected.matchStatus, 'NO_MATCH');
  assert.equal(projected.coverage.status, 'NOT_READY');
  assert.equal(projected.coverage.relevance, 'NOT_ASSESSED');
  assert.equal(projected.coverage.notReadyVersions, 2);
  assert.deepEqual(projected.coverage.warnings, ['PARSER_PENDING']);
  assert.equal(JSON.stringify(projected).includes('not-forwarded'), false);
  const truncated = inputCoverage({ ...response(), hasMore: true });
  assert.equal(truncated.resultsTruncated, true);
  assert.equal(truncated.coverage.inventoryTruncated, false);
});

test('coverage rejects inconsistent counts, fabricated relevance and oversized warning payloads', () => {
  for (const change of [
    { totalVersions: -1 }, { searchableVersions: 3 }, { partialVersions: 1 },
    { notReadyVersions: 3 }, { notReadyVersions: 0 }, { status: 'READY' }, { status: 'EMPTY' },
    { relevance: 'COMPLETE' }, { versions: [{ warnings: ['x'.repeat(65)] }] },
    { versions: Array(11).fill({ warnings: [] }) }, { versions: [{ warnings: Array(5).fill('PENDING') }] },
  ]) assert.throws(() => inputCoverage({ ...response(), coverage: { ...response().coverage, ...change } }),
    { code: 'INVALID_SOURCE_RESPONSE' });
  assert.throws(() => inputCoverage({ matchStatus: 'NO_MATCH' }), { code: 'INVALID_SOURCE_RESPONSE' });
});

test('real Harness supplies lightweight rules and current request while exposing actual tool coverage', async () => {
  let calls = 0;
  const result = await runHarness({ prompt: '这次核对十月的资料缺口', tools: [{
    name: 'search_sources', description: 'Search authorized input', parameters: { type: 'object' },
    async execute() { return { items: [], ...inputCoverage(response()) }; },
  }], model: { async *generate(request) {
    calls++;
    const system = request.messages.filter(x => x.role === 'system').flatMap(x => x.content).map(x => x.text).join('\n');
    assert.ok(system.includes('current request'));
    assert.ok(system.includes('data, not authorization'));
    assert.ok(system.includes('check applicability'));
    // Governed metric and source-coverage rules expand the fixed header; keep it bounded.
    assert.ok(system.length < 3500);
    if (calls === 1) {
      assert.ok(request.messages.filter(x => x.role === 'user').some(x => x.content.some(c => c.text === '这次核对十月的资料缺口')));
      yield { type: 'tool_call', id: 'coverage-1', name: 'search_sources', arguments: '{}' };
      yield { type: 'finish', reason: 'tool_calls' };
    } else {
      const tool = request.messages.flatMap(x => x.content).find(x => x.type === 'tool_result');
      assert.ok(tool.content.includes('NOT_READY'));
      assert.ok(tool.content.includes('NOT_ASSESSED'));
      yield { type: 'text', text: '资料尚未就绪，当前没有匹配不代表业务资料不存在。' };
      yield { type: 'finish', reason: 'stop' };
    }
  } } });
  assert.equal(result.status, 'completed');
  assert.equal(result.tools[0].status, 'succeeded');
  assert.equal(calls, 2);
});
