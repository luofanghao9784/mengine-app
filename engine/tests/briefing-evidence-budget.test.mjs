import test from 'node:test';
import assert from 'node:assert/strict';
import { BriefingEvidenceBudget } from '../dist/runtime/briefing-evidence-budget.js';
test('supplement is explicit, bounded and cannot grant calculation or mutation',()=>{
 const b=new BriefingEvidenceBudget();assert.equal(b.canRequest(false,true),false);assert.equal(b.canRequest(true,false),false);
 assert.throws(()=>b.request({reason:''}));assert.equal(b.canRequest(true,true),true);
 assert.equal(b.request({reason:'缺少当前期间解释规则'}).authority,false);
 for(const action of ['briefing_plan','reconciliation_execute','experience_use','history'])assert.throws(()=>b.consume('task_context',{action}));
 assert.throws(()=>b.consume('compare_dataset',{}));
 b.consume('task_context',{action:'profile_read'});b.consume('search_sources',{query:'确认规则'});
 assert.equal(b.open,false);assert.equal(b.canRequest(true,true),false);assert.throws(()=>b.request({reason:'再读'}));assert.throws(()=>b.consume('search_sources',{}));
});

import { briefingDeliveryTool } from '../dist/runtime/briefing-delivery.js';
test('old platform never receives unsupported text calculation and new platform preserves type',async()=>{
 let calls=0;const options={authorize:async()=>{},invoke:async body=>{calls++;assert.equal(body.businessType,'SUGGESTION');return {contractVersion:'1.0',status:'NO_NEW_CONTENT',reason:'DUPLICATE_CONTENT'};}};
 const card={businessType:'SUGGESTION',calculationArtifactId:'00000000-0000-4000-8000-000000000001',title:'核对收款凭证',summary:'核对当前期间',analysis:[]};
 await assert.rejects(briefingDeliveryTool({...options,textCalculationAvailable:false}).execute(card,new AbortController().signal),e=>e.code==='BRIEFING_TEXT_CALCULATION_UNAVAILABLE');assert.equal(calls,0);
 await briefingDeliveryTool({...options,textCalculationAvailable:true}).execute(card,new AbortController().signal);assert.equal(calls,1);
});
