import test from 'node:test';
import assert from 'node:assert/strict';
import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools';
import { datasetComparisonTool } from '../dist/runtime/dataset-comparison.js';
const id = '00000000-0000-4000-8000-000000000001',
  sha = 'a'.repeat(64);
const request = {
  datasetId: id,
  snapshotId: id,
  groupColumn: '门店',
  periodColumn: '期间',
  valueColumn: '收款（元）',
  baseline: '前期',
  current: '本期',
};
const row = {
  group: '合成店',
  baseline: '0.30',
  current: '0.60',
  difference: '0.30',
  changePercent: '100.00',
  baselineRank: 1,
  currentRank: 1,
  issue: null,
};
const result = () => ({
  contractVersion: '1.0',
  status: 'COMPUTED',
  datasetSource: {
    datasetId: id,
    snapshotId: id,
    version: 1,
    name: '合成销售数据',
    sha256: sha,
    rowCount: 6,
    collectedAt: '2026-10-04T00:00:00Z',
    coverageThrough: null,
  },
  calculation: {
    recipeVersion: 'dataset-compare-1',
    status: 'COMPUTED',
    request: { ...request },
    inputSha256: sha,
    matchedRows: 5,
    ignoredRows: 1,
    rows: [row],
    totals: { ...row, group: null, baselineRank: null, currentRank: null },
  },
  artifact: { id, filename: 'dataset-comparison-' + sha.slice(0, 20) + '.json', sha256: sha, bytes: 1000 },
});
test('native tool preserves decimal strings, exact snapshot and missing coverage with authorization before and after', async () => {
  let checks = 0;
  const tool = datasetComparisonTool({
    authorize: async () => {
      checks++;
    },
    invoke: async (body) => {
      assert.deepEqual(body, request);
      return result();
    },
  });
  assertObjectJsonSchema(tool.parameters);
  const receipt = await tool.execute(request, new AbortController().signal);
  assert.deepEqual(receipt, result());
  assert.equal(checks, 2);
});
test('invalid identities and incomplete or substituted calculator receipts fail closed', async () => {
  const signal = new AbortController().signal;
  for (const change of [
    (r) => (r.datasetSource.snapshotId = 'other'),
    (r) => (r.calculation.request.current = 'wrong'),
    (r) => (r.calculation.rows[0] = { ...row, current: 'NaN' }),
    (r) => (r.calculation.matchedRows = 2),
    (r) => delete r.datasetSource.coverageThrough,
  ]) {
    const response = structuredClone(result());
    change(response);
    const tool = datasetComparisonTool({ authorize: async () => {}, invoke: async () => response });
    await assert.rejects(tool.execute(request, signal), { code: 'DATASET_RESULT_INVALID' });
  }
  let sent = false;
  const tool = datasetComparisonTool({
    authorize: async () => {},
    invoke: async () => {
      sent = true;
      return result();
    },
  });
  await assert.rejects(tool.execute({ ...request, snapshotId: 'latest' }, signal), {
    code: 'INVALID_TOOL_ARGUMENTS',
  });
  assert.equal(sent, false);
});
test('authorization loss after a calculation prevents returning the result to the model', async () => {
  let calls = 0;
  const tool = datasetComparisonTool({
    authorize: async () => {
      if (++calls === 2) throw Error('revoked');
    },
    invoke: async () => result(),
  });
  await assert.rejects(tool.execute(request, new AbortController().signal), /revoked/);
});

test('COUNT accepts omitted value column and verifies echoed aggregation',async()=>{
 const args={...request,aggregation:'COUNT'};delete args.valueColumn;
 const r=result();r.calculation.request={...args};
 const tool=datasetComparisonTool({authorize:async()=>{},invoke:async(body)=>{assert.deepEqual(body,args);return r;}});
 assertObjectJsonSchema(tool.parameters);
 assert.deepEqual(await tool.execute(args,new AbortController().signal),r);
 await assert.rejects(tool.execute({...args,aggregation:'AVERAGE'},new AbortController().signal),{code:'INVALID_TOOL_ARGUMENTS'});
});
