import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

export async function loadBaseline() {
 const suite=JSON.parse(await readFile(new URL('../../tests/fixtures/briefing-quality/baseline.json',import.meta.url),'utf8'));
 assert.equal(suite.dataKind,'SYNTHETIC');assert.equal(suite.cases.length,12);
 const facts=new Map(suite.facts.map(f=>[f.id,f]));assert.equal(facts.size,suite.facts.length);
 assert.equal(new Set(suite.cases.map(c=>c.id)).size,12);
 for(const c of suite.cases){
  const role=suite.roles[c.role];assert.ok(role?.goal);
  assert.ok(['EMIT','MERGE','SUPPLEMENT','NO_OUTPUT'].includes(c.expected.decision));
  for(const id of c.expected.requiredFactIds)assert.ok(facts.has(id)&&role.sources.includes(facts.get(id).source));
 }
 for(const role of Object.keys(suite.roles))assert.deepEqual(suite.cases.filter(c=>c.role===role).map(c=>c.expected.decision).sort(),['EMIT','MERGE','NO_OUTPUT','SUPPLEMENT'].sort());
 return suite;
}

/** Scores structured observations only, never guesses prose truth or model quality. */
export function evaluate(suite, observations=[]) {
 const ids=new Set(suite.cases.map(c=>c.id));const seen=new Set();
 for(const o of observations){assert.ok(ids.has(o.caseId)&&!seen.has(o.caseId),'Unknown/duplicate observation');seen.add(o.caseId);}
 const cases=suite.cases.map(c=>{
  const o=observations.find(o=>o.caseId===c.id);
  if(!o)return {id:c.id,status:'NOT_RUN',semanticReview:'PENDING'};
  assert.ok(['SYNTHETIC_REPLAY','REAL_MODEL'].includes(o.execution));assert.ok(typeof o.traceRef==='string'&&o.traceRef.trim());
  assert.ok(Array.isArray(o.claims)&&Array.isArray(o.sources)&&Array.isArray(o.assertions));
  assert.ok(Number.isInteger(o.cardCount)&&o.cardCount>=0&&Number.isInteger(o.reads)&&o.reads>=0);
  const failures=[];const expected=c.expected;const role=suite.roles[c.role];
  if(o.decision!==expected.decision)failures.push('DECISION');
  if(expected.maxCards!==undefined&&o.cardCount>expected.maxCards || ['EMIT','MERGE'].includes(expected.decision)&&o.cardCount!==1)failures.push('CARD_COUNT');
  if(o.sources.some(s=>!role.sources.includes(s)))failures.push('SOURCE_SCOPE');
  for(const claim of o.claims){const fact=suite.facts.find(f=>f.id===claim.factId);if(!fact||!role.sources.includes(fact.source)||!o.sources.includes(fact.source)||['value','unit','period'].some(k=>claim[k]!==fact[k]))failures.push('FACT_OR_SCOPE');}
  for(const id of expected.requiredFactIds)if(!o.claims.some(f=>f.factId===id))failures.push('MISSING_EVIDENCE');
  if(expected.forbiddenAssertions.some(a=>o.assertions.includes(a)))failures.push('FORBIDDEN_ASSERTION');
  if(expected.maxReads!==undefined&&(o.reads>expected.maxReads||o.reads<1||!o.gapReason))failures.push('SUPPLEMENT');
  if(expected.businessType&&o.businessType!==expected.businessType)failures.push('TYPE');
  if(expected.requiresCalculation&&o.calculationVerified!==true)failures.push('CALCULATION');
  return {id:c.id,status:failures.length?'FAIL':'PASS',failures:[...new Set(failures)],execution:o.execution,traceRef:o.traceRef,semanticReview:'PENDING'};
 });
 return {version:suite.version,fixtureIntegrity:'PASS',cases,semanticQuality:'NOT_ASSESSED',note:'PASS only checks supplied structured observations. Trace authenticity and prose relevance require review; no model is called.'};
}
async function main(){
 const args=process.argv.slice(2);assert.ok(args.length<=1,'Optional argument: local observations JSON');
 const suite=await loadBaseline();const observations=args[0]?JSON.parse(await readFile(args[0],'utf8')):[];
 const report=evaluate(suite,observations);await mkdir('.local/briefing-quality',{recursive:true});
 await writeFile('.local/briefing-quality/baseline-report.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({fixtureIntegrity:report.fixtureIntegrity,cases:report.cases.length,passed:report.cases.filter(c=>c.status==='PASS').length,failed:report.cases.filter(c=>c.status==='FAIL').length,notRun:report.cases.filter(c=>c.status==='NOT_RUN').length,semanticQuality:report.semanticQuality}));
 if(report.cases.some(c=>c.status==='FAIL'))process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
