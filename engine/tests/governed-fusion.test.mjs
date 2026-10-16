import test from 'node:test';
import assert from 'node:assert/strict';
import {publishedMetricPlans} from '../dist/runtime/published-metric-plans.js';
import {governedMetricBundle} from '../dist/runtime/governed-metric-bundle.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const pick=n=>({metricId:id(n),metricVersion:1,datasetId:id(n+10),snapshotId:id(n+20)});
const response=()=>({action:'dataset_search',result:{items:[],fusionPlan:{version:'governed-graph-v1',primaryMetricId:id(1),sources:[1,2,3].map(n=>({datasetId:id(n+10),snapshotId:id(n+20)})),metrics:[1,2].map(n=>({metricId:id(n),version:1,executionRequest:{...pick(n),operation:'SUMMARY',aggregation:'SUM',groupColumns:[],valueColumn:'amount'}}))}}});
test('fixed fusion routes any selected metric to one complete backend plan, without independent companion calls',async()=>{
 const plans=publishedMetricPlans();plans.record(response());assert.equal(plans.hasFusion(),true);const calls=[];
 const tool={name:'compare_dataset',parameters:{properties:{}},description:'',async execute(p){calls.push(p);return {artifact:{id:id(9)},fusion:{version:'governed-graph-v1',results:[{label:'订单额'},{label:'收款额'}]}}}};
 const wrapped=governedMetricBundle(tool,true,plans.resolve,plans.companions,plans.preferred,plans.hasFusion);
 const r=await wrapped.execute({...pick(2),supportingMetrics:[pick(1)]},new AbortController().signal);
 assert.deepEqual(calls,[pick(1)]);assert.equal(r.fusion.results.length,2);assert.equal(r.supportingCalculations,undefined);
});
test('fusion context rejects swapped snapshot and unknown primary',()=>{
 for(const tamper of [r=>r.result.fusionPlan.metrics[0].executionRequest.snapshotId=id(99),r=>r.result.fusionPlan.primaryMetricId=id(99)]){const r=response();tamper(r);assert.throws(()=>publishedMetricPlans().record(r),{code:'INVALID_CONTEXT_RESPONSE'});}
});
