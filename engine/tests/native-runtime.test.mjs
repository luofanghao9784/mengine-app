import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DeepSeekHarness} from '@deepseek-ai/dsh-sdk-client';
import {LongTaskBudget} from '../dist/native/budget.js';
const root=fileURLToPath(new URL('../',import.meta.url));
test('official full SDK: ten native reads, restart, child agent and shared root budget', {timeout:90000}, async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dh120-native-'));
 const home=join(dir,'home'), ledgerPath=join(dir,'budget.sqlite'), file=join(dir,'synthetic.txt');
 await writeFile(file,'Synthetic-only file; no customer data.');
 const patch=join(dir,'fixture.patch.yml');
 await writeFile(patch,`- id: llm-deepseek\n  disabled: true\n- id: llm-pi-ai\n  disabled: true\n- insert:\n    - id: native-test-model\n      name: ${JSON.stringify(resolve(root,'tests/fixtures/native-model.mjs'))}\n`);
 const options={profile:'sdk',patches:[resolve(root,'profiles/enterprise-web.patch.yml'),patch],dshHome:home,
   processCwd:dir,cwd:dir,provider:'synthetic',model:'fixture',maxTokens:1024,initializeTimeoutMs:30000,
   env:{PATH:process.env.PATH,HOME:dir,TMPDIR:dir,DSH_TELEMETRY_DISABLED:'1',NARB_DISABLE_NATIVE_CACHE:'1',DH_TEST_LEDGER:ledgerPath,DH_TEST_FILE:file},
   requestTimeoutMs:30000};
 let harness=new DeepSeekHarness(options);
 try {
   const first=await harness.run('NATIVE_READ');
   assert.match(first.finalResponse,/synthetic-ok/);
   const results=first.events.filter(e=>e.type==='tool/result');
   assert.equal(results.length,10,JSON.stringify(first));
   assert.ok(results.every(e=>!e.data.message.isError),JSON.stringify(results));
   await harness.close();
   const before=new LongTaskBudget(ledgerPath);const spent=before.snapshot({tenant:'synthetic',user:'synthetic',task:'persistent-root'}).task;before.close();
   assert.ok(spent>=11*130);
   harness=new DeepSeekHarness(options);
   const restored=await harness.resumeSession(first.sessionId);
   const second=await restored.run('CONTINUE_HISTORY');
   assert.equal(second.sessionId,first.sessionId);
   assert.match(second.finalResponse,/history=true tools=10/);
   const notices=[];
   const third=await restored.run('NATIVE_CHILD',{onNotification:n=>notices.push(n)});
   await harness.client.request('session/wait',{sessionId:first.sessionId});
   assert.ok(third.events.some(e=>e.type==='tool/result' && !e.data.message.isError));
   assert.ok(notices.some(n=>n.method==='subagent.started'),JSON.stringify(notices.map(n=>n.method)));
   await harness.close();
   const after=new LongTaskBudget(ledgerPath);assert.ok(after.snapshot({tenant:'synthetic',user:'synthetic',task:'persistent-root'}).task>=spent+4*130);after.close();
 } finally {await harness.close();await rm(dir,{recursive:true,force:true});}
});
