// Run only inside the dedicated restricted acceptance container. The outer
// container is the boundary; do not run this fixture on a developer host.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {DeepSeekHarness} from '@deepseek-ai/dsh-sdk-client';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
test('isolated full runtime executes native bash and closing runtime kills the running shell', {timeout:60000},async()=>{
 await access('/.dockerenv');assert.equal(process.getuid(),1000);
 const dir=await mkdtemp('/tmp/dh120-shell-'),patch=join(dir,'fixture.patch.yml');
 const plugin=fileURLToPath(new URL('../fixtures/native-model.mjs',import.meta.url));
 const overlay=fileURLToPath(new URL('../../profiles/enterprise-web.patch.yml',import.meta.url));
 await writeFile(patch,`- id: llm-deepseek\n  disabled: true\n- id: llm-pi-ai\n  disabled: true\n- insert:\n    - id: native-test-model\n      name: ${JSON.stringify(plugin)}\n`);
 const options={profile:'sdk',patches:[overlay,patch],dshHome:join(dir,'home'),cwd:dir,processCwd:dir,
  provider:'synthetic',model:'fixture',maxTokens:1024,requestTimeoutMs:30000,
  env:{PATH:process.env.PATH,HOME:dir,TMPDIR:dir,DSH_TELEMETRY_DISABLED:'1',NARB_DISABLE_NATIVE_CACHE:'1',DSH_PERMISSION_MODE:'danger-full-access',DH_TEST_LEDGER:join(dir,'budget.sqlite')}};
 let harness=new DeepSeekHarness(options);
 try{
  const result=await harness.run('NATIVE_SHELL');
  assert.ok(result.events.some(e=>e.type==='tool/result' && !e.data.message.isError && JSON.stringify(e).includes('native-shell-ok')));
  await harness.close();
  harness=new DeepSeekHarness({...options,env:{...options.env,DH_TEST_SHELL_COMMAND:'echo "$BASHPID" > running.pid; sleep 30'}});
  const running=harness.run('NATIVE_SHELL').then(()=>null,e=>e);
  let pid;
  for(let i=0;i<150;i++){
   try{pid=Number((await readFile(join(dir,'running.pid'),'utf8')).trim());break;}catch{await delay(100);}
  }
  assert.ok(Number.isInteger(pid)&&pid>1,'native bash did not start');
  await harness.close();await running;
  let alive=true;
  for(let i=0;i<30;i++){try{process.kill(pid,0);await delay(100);}catch(e){assert.equal(e.code,'ESRCH');alive=false;break;}}
  assert.equal(alive,false,'SDK close returned while native command remained alive');
 }finally{await harness.close();await rm(dir,{recursive:true,force:true});}
});
