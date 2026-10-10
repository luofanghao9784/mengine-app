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

test('cumulative summary uses separate date filtering and verifies grouped receipts', async () => {
 const args={datasetId:request.datasetId,snapshotId:request.snapshotId,operation:'SUMMARY',groupColumns:['门店','状态'],valueColumn:'金额',dateColumn:'确认时间',dateFrom:'2026-08-01',missingDates:'EXCLUDE'};
 const response=result();response.calculation={recipeVersion:'dataset-summary-1',status:'COMPUTED',request:{...args},inputSha256:sha,matchedRows:5,ignoredRows:1,missingDateRows:1,rows:[{group:['甲','已确认'],value:'1.20',records:5}],total:'1.20'};
 const tool=datasetComparisonTool({authorize:async()=>{},invoke:async(body)=>{assert.deepEqual(body,args);return response;}});
 assertObjectJsonSchema(tool.parameters);
 assert.deepEqual(await tool.execute(args,new AbortController().signal),response);
 for(const change of [{dateTo:'2026-07-01'},{dateColumn:undefined},{groupColumns:[]},{groupColumns:['门店','门店']},{baseline:'2026-07'}])await assert.rejects(tool.execute({...args,...change},new AbortController().signal),{code:'INVALID_TOOL_ARGUMENTS'});
 response.calculation.missingDateRows=2;
 await assert.rejects(tool.execute(args,new AbortController().signal),{code:'DATASET_RESULT_INVALID'});
});

test('DATA briefing calculator cannot mistake a summary receipt for a two-period chart', async()=>{
 const tool=datasetComparisonTool({allowSummary:false,authorize:async()=>{},invoke:async()=>{throw Error('must not invoke');}});
 assert.deepEqual(tool.parameters.properties.operation.enum,['COMPARE']);
 await assert.rejects(tool.execute({operation:'SUMMARY'},new AbortController().signal),{code:'INVALID_TOOL_ARGUMENTS'});
});

test('mixed summary/comparison arguments return actionable hints without echoing business values',async()=>{
 const tool=datasetComparisonTool({allowSummary:true,authorize:async()=>{},invoke:async()=>{throw Error('must not invoke');}});
 await assert.rejects(tool.execute({...request,operation:'SUMMARY',groupColumns:['private-header']},new AbortController().signal),e=>e.code==='INVALID_TOOL_ARGUMENTS'&&e.hint.includes('OMIT')&&!e.hint.includes('private-header'));
});

test('null optional placeholders normalize without changing business choices or IDs', async () => {
 const {normalizeDatasetArguments}=await import('../dist/runtime/dataset-comparison.js');
 const args={datasetId:id,snapshotId:id,operation:'SUMMARY',groupColumns:['status'],aggregation:'COUNT',groupColumn:null,periodColumn:null,baseline:null,current:null,dateColumn:null,dateFrom:null,dateTo:null};
 const normalized=normalizeDatasetArguments(args);
 assert.deepEqual(normalized,{datasetId:id,snapshotId:id,operation:'SUMMARY',groupColumns:['status'],aggregation:'COUNT'});
 assert.equal(args.groupColumn,null);
 const invalid={...args,baseline:'actual-period'};
 await assert.rejects(datasetComparisonTool({authorize:async()=>{},invoke:async()=>{throw Error('must not invoke');}}).execute(normalizeDatasetArguments(invalid),new AbortController().signal),{code:'INVALID_TOOL_ARGUMENTS'});
 assert.equal(normalizeDatasetArguments({datasetId:null}).datasetId,null);
});
