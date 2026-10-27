import {HarnessClient} from '@deepseek-ai/dsh-sdk-client';import {attachmentBlocks} from '../../scripts/native-attachments.mjs';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url)),dir=await mkdtemp(join(tmpdir(),'dh-attachments-'));const [platform,id,token,...ids]=process.argv.slice(2),patch=join(dir,'patch.yml');
await writeFile(patch,`- id: llm-deepseek\n  disabled: true\n- id: llm-pi-ai\n  disabled: true\n- insert:\n    - id: fixture\n      name: ${JSON.stringify(resolve(root,'tests/fixtures/native-model.mjs'))}\n`);
const client=new HarnessClient({profile:'sdk',patches:[resolve(root,'profiles/enterprise-web.patch.yml'),patch],dshHome:join(dir,'home'),processCwd:dir,initializeTimeoutMs:30000,env:{PATH:process.env.PATH,HOME:dir,NARB_DISABLE_NATIVE_CACHE:"1",DH_TEST_LEDGER:join(dir,"ledger.sqlite")}});
const subscription=client.subscribe(),events=[];const collected=(async()=>{try{for await(const notice of subscription){events.push(notice);if(notice.method==='session.event'&&notice.params.event.type==='user/message')return;}}catch{}})();
try{
 const blocks=await attachmentBlocks({ids,bridge:`${platform}/internal/v1/native-conversations/${id}/`,capability:token,cwd:dir});
 const text=JSON.parse(blocks.at(-1).text.split('：')[1]);assert.equal(await readFile(text.path,'utf8'),'PRIVATE_FILE');assert.ok(text.path.startsWith(dir));
 await client.initialize({cwd:dir,provider:'synthetic',model:'fixture',maxTokens:1024});await client.getWorkingDirectory(id);
 assert.ok(await client.prompt(id,[{type:'text',text:'Inspect private image'},...blocks]));
 await collected;assert.ok(JSON.stringify(events).includes('image'));assert.ok(JSON.stringify(events).includes('attachment'));
}finally{await client.close();await rm(dir,{recursive:true,force:true});}
