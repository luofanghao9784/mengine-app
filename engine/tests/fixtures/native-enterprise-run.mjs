import {DeepSeekHarness} from '@deepseek-ai/dsh-sdk-client';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {randomUUID} from 'node:crypto';import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url));const dir=await mkdtemp(join(tmpdir(),'dh120-enterprise-'));
const [platform,id,token,material,version]=process.argv.slice(2);
const patch=join(dir,'enterprise.patch.yml');
await writeFile(patch,`- id: llm-deepseek\n  disabled: true\n- id: llm-pi-ai\n  disabled: true\n- insert:\n    - id: enterprise-tools\n      name: ${JSON.stringify(resolve(root,'dist/native/enterprise-plugin.js'))}\n    - id: enterprise-test\n      name: ${JSON.stringify(resolve(root,'tests/fixtures/native-enterprise-model.mjs'))}\n`);
const harness=new DeepSeekHarness({profile:'sdk',patches:[resolve(root,'profiles/enterprise-web.patch.yml'),patch],dshHome:join(dir,'home'),cwd:dir,processCwd:dir,provider:'enterprise-test',model:'fixture',maxTokens:1024,initializeTimeoutMs:30000,requestTimeoutMs:30000,
 env:{PATH:process.env.PATH,HOME:dir,TMPDIR:dir,NARB_DISABLE_NATIVE_CACHE:'1',DREAMCORE_NATIVE_BRIDGE:`${platform}/internal/v1/native-conversations/${id}/`,DREAMCORE_NATIVE_CAPABILITY:token,TEST_MATERIAL:material,TEST_VERSION:version,TEST_FILE:join(dir,'source.txt'),TEST_SAVE_ID:randomUUID()}});
try{const result=await harness.run('请处理企业合成资料并保存私人成果，不发布。');const tools=result.events.filter(e=>e.type==='tool/result');assert.equal(tools.length,5);assert.ok(tools.every(e=>!e.data.message.isError),JSON.stringify(tools));console.log('Native enterprise tools: 5 real platform callbacks passed');}finally{await harness.close();await rm(dir,{recursive:true,force:true});}
