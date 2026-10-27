import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {HarnessClient} from '@deepseek-ai/dsh-sdk-client';
import {NativeStreamStore,publicNotification} from '../scripts/native-stream-store.mjs';
const root=resolve(import.meta.dirname,'..');
test('outbox restart, duplicate delivery and internal header redaction',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dh-outbox-'));try{
 let store=new NativeStreamStore(join(dir,'events.sqlite'),'root');
 const event=publicNotification({method:'session.event',params:{sessionId:'root',event:{type:'request/header',seq:0,time:'now',data:{secret:'never'}}}});
 assert.deepEqual(event.data,{redacted:true});store.append('root:0',event);store.append('root:0',event);assert.throws(()=>store.append('root:0',{...event,time:'different'}),/EVENT_RECEIPT_CONFLICT/);assert.throws(()=>publicNotification({method:'session.event',params:{event:{type:'status',seq:1,data:{usedYuan:0}}}}));store.close();
 store=new NativeStreamStore(join(dir,'events.sqlite'),'root');assert.equal(store.pending().length,1);store.delivered('root:0');assert.equal(store.pending().length,0);store.close();
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('real SDK extension: prompt, status, stop and same-root restart', {timeout:90000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dh-sdk-controls-'));const patch=join(dir,'patch.yml');
 await writeFile(patch,`- id: sdk-jsonrpc-server\n  disabled: true\n- id: llm-deepseek\n  disabled: true\n- id: llm-pi-ai\n  disabled: true\n- insert:\n    - id: enterprise-sdk\n      name: ${JSON.stringify(join(root,'scripts/native-sdk-plugin.mjs'))}\n    - id: fixture\n      name: ${JSON.stringify(join(root,'tests/fixtures/native-model.mjs'))}\n`);
 const options={profile:'sdk',patches:[join(root,'profiles/enterprise-web.patch.yml'),patch],dshHome:join(dir,'home'),processCwd:dir,initializeTimeoutMs:30000,requestTimeoutMs:10000,env:{PATH:process.env.PATH,HOME:dir,NARB_DISABLE_NATIVE_CACHE:'1',DH_TEST_LEDGER:join(dir,'ledger.sqlite')}};
 let client=new HarnessClient(options);const notices=[];const subscription=client.subscribe();
 const consume=(async()=>{try{for await(const n of subscription)notices.push(n);}catch{}})();
 try{
 await client.initialize({cwd:dir,provider:'synthetic',model:'fixture'});
 const message=await client.prompt('test-root',[{type:'text',text:'hello'}]);assert.ok(message);
 await client.request('session/wait',{sessionId:'test-root'});
 assert.ok(notices.some(n=>n.method==='session.event'&&n.params.event.type==='assistant/message'));
 assert.ok(notices.some(n=>n.method==='session.status'&&n.params.status==='idle'));
 assert.deepEqual(await client.request('enterprise/stop',{sessionId:'test-root'}),{accepted:true});
 await assert.rejects(client.request('enterprise/approval',{sessionId:'test-root',approvalId:'fake',decision:'ALLOW_ONCE'}));
 await assert.rejects(client.request('enterprise/answer',{sessionId:'test-root',callId:'fake',answers:[]}));
 await client.close();await consume;
 client=new HarnessClient(options);await client.initialize({cwd:dir,provider:'synthetic',model:'fixture'});await client.resumeSession('test-root');
 await client.prompt('test-root',[{type:'text',text:'continue'}]);await client.request('session/wait',{sessionId:'test-root'});
 }finally{await client.close();await rm(dir,{recursive:true,force:true});}
});
test('real SDK pending approval/question, timeout and late answer', {timeout:90000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dh-sdk-pending-'));const patch=join(dir,'patch.yml');
 await writeFile(patch,`- id: sdk-jsonrpc-server\n  disabled: true\n- id: llm-deepseek\n  disabled: true\n- id: llm-pi-ai\n  disabled: true\n- insert:\n    - id: enterprise-sdk\n      name: ${JSON.stringify(join(root,'scripts/native-sdk-plugin.mjs'))}\n    - id: fixture\n      name: ${JSON.stringify(join(root,'tests/fixtures/native-interaction-model.mjs'))}\n`);
 const client=new HarnessClient({profile:'sdk',patches:[join(root,'profiles/enterprise-web.patch.yml'),patch],dshHome:join(dir,'home'),processCwd:dir,initializeTimeoutMs:30000,requestTimeoutMs:10000,env:{PATH:process.env.PATH,HOME:dir,NARB_DISABLE_NATIVE_CACHE:'1'}});
 const notices=[];const sub=client.subscribe();void(async()=>{try{for await(const n of sub)notices.push(n);}catch{}})();
 const until=async predicate=>{const end=Date.now()+10000;while(Date.now()<end){const found=notices.find(predicate);if(found)return found;await new Promise(r=>setTimeout(r,20));}throw Error('notification missing: '+JSON.stringify(notices));};
 try{
 await client.initialize({cwd:dir,provider:'interaction-test',model:'fixture'});
 await client.prompt('root',[{type:'text',text:'APPROVAL'}]);
 const approval=await until(n=>n.params.event?.type==='approval/asked');
 await client.request('enterprise/approval',{sessionId:'root',approvalId:approval.params.event.data.id,decision:'ALLOW_ONCE'});
 await client.request('session/wait',{sessionId:'root'});
 assert.ok(notices.some(n=>n.params.event?.type==='approval/decided'&&n.params.event.data.outcome==='allowed-once'));
 await assert.rejects(client.request('enterprise/approval',{sessionId:'root',approvalId:approval.params.event.data.id,decision:'REJECT'}));
 notices.length=0;await client.prompt('root',[{type:'text',text:'QUESTION'}]);
 const question=await until(n=>n.params.type==='question/asked');
 await assert.rejects(client.request('enterprise/answer',{sessionId:'root',callId:question.params.data.callId,answers:[{id:'invalid',selected:[]}]}));
 await client.request('enterprise/answer',{sessionId:'root',callId:question.params.data.callId,answers:[{id:'choice',selected:['Yes']}]});
 await client.request('session/wait',{sessionId:'root'});
 notices.length=0;await client.prompt('root',[{type:'text',text:'QUESTION TIMEOUT'}]);
 const timed=await until(n=>n.params.type==='question/asked');await client.request('session/wait',{sessionId:'root'});
 assert.ok(notices.some(n=>n.params.type==='question/closed'&&n.params.data.outcome==='ASK_TIMED_OUT'));
 await client.request('enterprise/answer',{sessionId:'root',callId:timed.params.data.callId,answers:[{id:'choice',selected:[]}]});
 await client.request('session/wait',{sessionId:'root'});
 for(const decision of ['APPROVE','REVISE']){
  notices.length=0;await client.prompt('root',[{type:'text',text:'PLAN '+decision}]);
  const plan=await until(n=>n.params.type==='question/asked');
  await client.request('enterprise/plan-review',{sessionId:'root',callId:plan.params.data.callId,decision,comment:'Change synthetic plan'});
  await client.request('session/wait',{sessionId:'root'});
  const result=notices.find(n=>n.params.event?.type==='tool/result');assert.notEqual(result.params.event.data.message.isError,true);
 }
 notices.length=0;await client.prompt('root',[{type:'text',text:'APPROVAL reject'}]);
 const rejected=await until(n=>n.params.event?.type==='approval/asked');
 await client.request('enterprise/approval',{sessionId:'root',approvalId:rejected.params.event.data.id,decision:'REJECT'});
 await client.request('session/wait',{sessionId:'root'});
 assert.ok(notices.some(n=>n.params.event?.type==='approval/decided'&&n.params.event.data.outcome==='rejected'));
 notices.length=0;await client.prompt('root',[{type:'text',text:'QUESTION stop'}]);await until(n=>n.params.type==='question/asked');
 await client.request('enterprise/stop',{sessionId:'root'});await client.request('session/wait',{sessionId:'root'});
 assert.ok(notices.some(n=>n.method==='session.status'&&n.params.status==='idle'));
 }finally{await client.close();await rm(dir,{recursive:true,force:true});}
});

test('disconnected outbox coalesces disposable status without dropping conversation events',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dh-status-'));const store=new NativeStreamStore(join(dir,'events.sqlite'),'root');
 try{store.append('event',{type:'turn/start',data:{}});for(let i=0;i<30;i++)store.append('status-'+i,{type:'status',time:i,data:{running:true}});
 assert.equal(store.pending().length,2);assert.ok(store.pending().some(x=>x.key==='event'));assert.ok(store.pending().some(x=>x.key==='status-29'));}finally{store.close();await rm(dir,{recursive:true,force:true});}
});
