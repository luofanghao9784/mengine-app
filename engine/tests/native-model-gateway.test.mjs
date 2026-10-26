import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeModelGateway } from '../dist/native/model-gateway.js';
import { LongTaskBudget } from '../dist/native/budget.js';
const scope = { tenant:'a', user:'u', task:'root' };
const price = {version:'test-only',input:1_000_000,output:1_000_000,cacheRead:100_000,cacheWrite:1_000_000,reasoningIncluded:true};
const route = {protocol:'messages',model:'test-model',endpoint:'https://provider.invalid/v1/messages',apiKey:'provider-secret',price,maxInputTokens:100,maxOutputTokens:100};
const wire = [
 {type:'message_start',message:{usage:{input_tokens:10,output_tokens:0}}},
 {type:'content_block_delta',delta:{type:'thinking_delta',thinking:'原样思考'}},
 {type:'content_block_delta',delta:{type:'input_json_delta',partial_json:'{"image":"native"}'}},
 {type:'message_delta',usage:{output_tokens:20}}, {type:'message_stop'},
].map(e=>`data: ${JSON.stringify(e)}\n\n`).join('');
function request(body={},headers={},path='/v1/messages') {
 return new Request(`http://gateway.invalid${path}`,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer task-capability',...headers},
 body:JSON.stringify({model:'test-model',stream:true,max_tokens:100,messages:[{role:'user',content:[{type:'image',source:{type:'base64',media_type:'image/png',data:'synthetic'}}]}],...body})});
}
function fixture(t,dispatch,overrides={}) {
 const ledger=new LongTaskBudget(':memory:');t.after(()=>ledger.close());
 const controller=new AbortController(); const grant={scope,route,signal:controller.signal};
 const gateway=new NativeModelGateway({ledger,resolve:async token=>token==='task-capability'?grant:null,dispatch,...overrides});
 return {gateway,ledger,controller,grant};
}
test('gateway preserves native body and wire bytes; credentials and scope stay external',async t=>{
 let received;
 const {gateway,ledger}=fixture(t,async(url,init)=>{
  received={url:String(url),...init};
  assert.equal(ledger.snapshot(scope).task,200); // reserved before dispatch
  return new Response(wire,{headers:{'content-type':'text/event-stream','set-cookie':'leak=secret'}});
 });
 const input=request({metadata:{tenant:'spoof',task:'new-budget'}},{cookie:'platform-secret','x-forwarded-host':'attacker','anthropic-beta':'mid-conversation-tool-changes-2026-07-01'});
 const original=await input.clone().text();const response=await gateway.handle(input);
 assert.equal(await response.text(),wire);assert.equal(received.body.toString(),original);
 assert.equal(received.headers.get('x-api-key'),'provider-secret');assert.equal(received.headers.get('authorization'),null);
 assert.equal(received.headers.get('cookie'),null);assert.equal(received.redirect,'error');
 assert.equal(received.headers.get('anthropic-beta'),'mid-conversation-tool-changes-2026-07-01');
 assert.equal(response.headers.get('set-cookie'),null);assert.equal(ledger.snapshot(scope).task,30);
 assert.equal(ledger.snapshot({...scope,tenant:'spoof',task:'new-budget'}).task,0);
});
test('invalid scope, revoked permission, routes and model bounds never dispatch',async t=>{
 let calls=0;const {gateway,ledger,controller}=fixture(t,async()=>{calls++;throw Error('unexpected');});
 for(const input of [request({}, {authorization:'Bearer other'}),request({model:'other'}),request({max_tokens:101}),request({stream:false}),request({max_completion_tokens:1}),request({messages:[{content:[{type:'file',file_id:'other-root'}]}]}),request({}, {},'/v1/files'),request({}, {},'/v1/messages?target=other')]) {
  assert.ok((await gateway.handle(input)).status>=400);
 }
 controller.abort();assert.equal((await gateway.handle(request())).status,403);
 assert.equal(calls,0);assert.equal(ledger.snapshot(scope).task,0);
});
test('permission rechecked after request upload before spending',async t=>{
 let resolutions=0,calls=0;const controller=new AbortController();
 const {gateway,ledger}=fixture(t,async()=>{calls++;}, {resolve:async()=>++resolutions===1?{scope,route,signal:controller.signal}:null});
 assert.equal((await gateway.handle(request())).status,403);assert.equal(calls,0);assert.equal(ledger.snapshot(scope).task,0);
});
test('failed or incomplete upstream retains conservative reservation',async t=>{
 for(const response of [()=>new Response('secret provider diagnostic',{status:400}),()=>new Response(wire.slice(0,100),{headers:{'content-type':'text/event-stream'}})]){
  const {gateway,ledger}=fixture(t,async()=>response());
  const result=await gateway.handle(request());const text=await result.text();
  assert.ok(!text.includes('secret provider diagnostic'));assert.equal(ledger.snapshot(scope).task,200);
 }
});
test('root cancellation aborts provider and settles UNKNOWN even without consumer pull',async t=>{
 let upstreamSignal,cancelled=false;
 const {gateway,ledger,controller}=fixture(t,async(url,init)=>{
  upstreamSignal=init.signal;
  return new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}});
 });
 const response=await gateway.handle(request());controller.abort();
 await assert.rejects(response.text());
 assert.equal(upstreamSignal.aborted,true);assert.equal(cancelled,true);assert.equal(ledger.snapshot(scope).task,200);
});
test('all requests share hard cap even if caller spoofs descendant identity',async t=>{
 let calls=0;const controller=new AbortController();
 const {gateway}=fixture(t,async()=>{calls++;return new Response('data: {}\n\n',{headers:{'content-type':'text/event-stream'}});},
 {resolve:async()=>({scope,route:{...route,maxInputTokens:4_000_000},signal:controller.signal})});
 await (await gateway.handle(request())).text();
 const second=await gateway.handle(request({metadata:{task:'child'}}));
 assert.equal(second.status,429);assert.equal(calls,1);
});
