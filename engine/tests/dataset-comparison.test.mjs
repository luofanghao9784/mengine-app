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
 for(const change of [{dateTo:'2026-07-01'},{dateColumn:undefined},{groupColumns:['门店','门店']},{baseline:'2026-07'}])await assert.rejects(tool.execute({...args,...change},new AbortController().signal),{code:'INVALID_TOOL_ARGUMENTS'});
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

test('composition is capability-gated and checks exact total and rounded platform shares',async()=>{
 const args={datasetId:id,snapshotId:id,operation:'COMPOSITION',groupColumns:['门店'],valueColumn:'金额'};
 const response=result();response.calculation={recipeVersion:'dataset-composition-1',status:'COMPUTED',request:{...args},inputSha256:sha,matchedRows:5,ignoredRows:1,missingDateRows:0,rows:[{group:['甲'],value:'9007199254740993',records:3,sharePercent:'75.000000'},{group:['乙'],value:'3002399751580331',records:2,sharePercent:'25.000000'}],total:'12009599006321324'};
 let verified=0;const tool=datasetComparisonTool({allowComposition:true,onVerified:()=>verified++,authorize:async()=>{},invoke:async()=>response});assertObjectJsonSchema(tool.parameters);
 assert.deepEqual(await tool.execute(args,new AbortController().signal),response);
 await assert.rejects(datasetComparisonTool({authorize:async()=>{},invoke:async()=>response}).execute(args,new AbortController().signal),{code:'INVALID_TOOL_ARGUMENTS'});
 response.calculation.rows[0].sharePercent='74.999999';await assert.rejects(tool.execute(args,new AbortController().signal),{code:'DATASET_RESULT_INVALID'});
 response.calculation.rows[0].sharePercent='75.000000';response.calculation.total='12009599006321325';await assert.rejects(tool.execute(args,new AbortController().signal),{code:'DATASET_RESULT_INVALID'});assert.equal(verified,1);
});

test('whole-table summary is capability-gated and verifies the empty grouping receipt',async()=>{
 const args={datasetId:request.datasetId,snapshotId:request.snapshotId,operation:'SUMMARY',aggregation:'SUM',groupColumns:[],valueColumn:'金额'};
 const response=result();response.calculation={recipeVersion:'dataset-summary-1',status:'COMPUTED',request:{...args},inputSha256:sha,matchedRows:6,ignoredRows:0,missingDateRows:0,rows:[{group:[],value:'1.20',records:6}],total:'1.20'};
 const tool=datasetComparisonTool({authorize:async()=>{},invoke:async(body)=>{assert.deepEqual(body,args);return response;}});
 assert.deepEqual(await tool.execute(args,new AbortController().signal),response);
 await assert.rejects(datasetComparisonTool({authorize:async()=>{},invoke:async()=>response,allowSummary:false}).execute(args,new AbortController().signal));
 response.calculation.rows[0].group=['invented'];await assert.rejects(tool.execute(args,new AbortController().signal),{code:'DATASET_RESULT_INVALID'});
});

test('published metric identity is preserved and substituted or incomplete versions fail closed', async()=>{
 const args={...request,metricId:id,metricVersion:3};
 const response=result();response.calculation.request={...args};
 let calls=0;
 const tool=datasetComparisonTool({authorize:async()=>{},invoke:async(body)=>{calls++;assert.deepEqual(body,args);return response;}});
 assertObjectJsonSchema(tool.parameters);
 await tool.execute(args,new AbortController().signal);
 response.calculation.request.metricVersion=2;
 await assert.rejects(tool.execute(args,new AbortController().signal),{code:'DATASET_RESULT_INVALID'});
 for(const changed of [{metricVersion:undefined},{metricVersion:0},{metricVersion:1.2},{metricId:undefined}])
  await assert.rejects(tool.execute({...args,...changed},new AbortController().signal),{code:'INVALID_TOOL_ARGUMENTS'});
 assert.equal(calls,2);
});

test('missing governed plans return a bounded actionable hint without fabricating a receipt',async()=>{
 const {RuntimeError}=await import('../dist/runtime/ports.js');let calls=0;
 const tool=datasetComparisonTool({authorize:async()=>{},invoke:async()=>{calls++;throw new RuntimeError('METRIC_DEFINITION_REQUIRED');}});
 await assert.rejects(tool.execute(request,new AbortController().signal),e=>e.code==='METRIC_DEFINITION_REQUIRED'&&e.hint.includes('不要重复'));
 assert.equal(calls,1);
});
