import test from 'node:test';
import assert from 'node:assert/strict';
import {loadBaseline,evaluate} from '../scripts/evaluation/briefing-quality-baseline.mjs';
const suite=await loadBaseline();
function observation(c){return {caseId:c.id,execution:'SYNTHETIC_REPLAY',traceRef:'test-only',decision:c.expected.decision,cardCount:['EMIT','MERGE'].includes(c.expected.decision)?1:0,reads:c.expected.maxReads?2:0,gapReason:'需要确认口径',businessType:c.expected.businessType,calculationVerified:true,sources:[...suite.roles[c.role].sources],assertions:[],claims:c.expected.requiredFactIds.map(id=>{const f=suite.facts.find(f=>f.id===id);return {factId:id,value:f.value,unit:f.unit,period:f.period};})};}
test('missing observations stay unrun, including all twelve model cases',()=>{const r=evaluate(suite);assert.equal(r.cases.filter(c=>c.status==='NOT_RUN').length,12);assert.equal(r.semanticQuality,'NOT_ASSESSED');});
test('scorer accepts structured expected behavior, not as model-quality proof',()=>{const r=evaluate(suite,suite.cases.map(observation));assert.ok(r.cases.every(c=>c.status==='PASS'&&c.semanticReview==='PENDING'));});
test('scorer catches changed money, unauthorized source, missing evidence and excess reads',()=>{
 for(const mutate of [o=>o.claims[0].value='999',o=>o.sources.push('private-other'),o=>o.claims=[],o=>o.cardCount=3,o=>o.assertions.push('银行到账')]){const o=observation(suite.cases[0]);mutate(o);assert.equal(evaluate(suite,[o]).cases[0].status,'FAIL');}
 const o=observation(suite.cases[2]);o.reads=3;assert.equal(evaluate(suite,[o]).cases[2].status,'FAIL');
 assert.throws(()=>evaluate(suite,[o,o]));assert.throws(()=>evaluate(suite,[{...o,execution:'LIVE_ASSUMED'}]));
});
