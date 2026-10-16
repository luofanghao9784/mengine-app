import test from 'node:test';
import assert from 'node:assert/strict';
import { governedMetricBundle } from '../dist/runtime/governed-metric-bundle.js';
import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools';
const pick=n=>({metricId:`m${n}`,metricVersion:1,datasetId:`d${n}`,snapshotId:`s${n}`});
function fixture(fail=0){const calls=[];const tool={name:'compare_dataset',description:'fixed',parameters:{type:'object',properties:{metricId:{type:'string'},metricVersion:{type:'integer'},datasetId:{type:'string'},snapshotId:{type:'string'}},required:Object.keys(pick(1)),additionalProperties:false},async execute(p){calls.push(p);if(calls.length===fail)throw Error('ACCESS_REVOKED');return {artifact:{id:p.metricId},datasetSource:{datasetId:p.datasetId},calculation:{total:'0.30'}};}};return {tool,calls,wrapped:governedMetricBundle(tool,true,p=>{assert.ok(p.metricVersion===1&&/^m[123]$/.test(p.metricId));})};}
const signal=()=>new AbortController().signal;
test('published multi-dataset calculations keep separate receipts and decimal strings',async()=>{const f=fixture();assertObjectJsonSchema(f.wrapped.parameters);const r=await f.wrapped.execute({...pick(1),supportingMetrics:[pick(2),pick(3)]},signal());assert.equal(f.calls.length,3);assert.equal(r.artifact.id,'m1');assert.equal(r.supportingCalculations[1].datasetSource.datasetId,'d3');assert.equal(r.supportingCalculations[0].calculation.total,'0.30');});
test('single-metric compatibility and ordinary conversation preserved',async()=>{const f=fixture();assert.equal(governedMetricBundle(f.tool,false,()=>{}),f.tool);const r=await f.wrapped.execute(pick(1),signal());assert.deepEqual(r.supportingCalculations,[]);});
test('all plans resolved before any dispatch',async()=>{const f=fixture();await assert.rejects(f.wrapped.execute({...pick(1),supportingMetrics:[{...pick(2),metricVersion:2}]},signal()));assert.equal(f.calls.length,0);});
test('duplicate metrics, excess bundle, injected calculation scope fail before dispatch',async()=>{for(const p of [{...pick(1),supportingMetrics:[pick(1)]},{...pick(1),supportingMetrics:[pick(2),pick(3),pick(1)]},{...pick(1),supportingMetrics:[{...pick(2),aggregation:'SUM'}]}]){const f=fixture();await assert.rejects(f.wrapped.execute(p,signal()));assert.equal(f.calls.length,0);}});
test('revocation or failure in any calculation blocks partial disclosure',async()=>{const f=fixture(2);await assert.rejects(f.wrapped.execute({...pick(1),supportingMetrics:[pick(2),pick(3)]},signal()),/ACCESS_REVOKED/);assert.equal(f.calls.length,2);});
test('aborted task cannot dispatch calculation',async()=>{const f=fixture();const c=new AbortController();c.abort();await assert.rejects(f.wrapped.execute(pick(1),c.signal));assert.equal(f.calls.length,0);});
test('automatic primary recommendation uses its returned receipt and retains companion; explicit choice is preserved',async()=>{
 const f=fixture();const wrapped=governedMetricBundle(f.tool,true,()=>{},()=>[pick(1)],()=>pick(2));
 const r=await wrapped.execute(pick(1),signal());assert.equal(r.artifact.id,'m2');assert.equal(r.supportingCalculations[0].artifact.id,'m1');
 f.calls.length=0;const explicit=await wrapped.execute({...pick(1),supportingMetrics:[pick(3)]},signal());assert.equal(explicit.artifact.id,'m1');assert.equal(explicit.supportingCalculations[0].artifact.id,'m3');
});
