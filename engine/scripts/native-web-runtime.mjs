import {networkInterfaces} from 'node:os';
import {writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const address=Object.values(networkInterfaces()).flat().find(a=>a.family==='IPv4'&&!a.internal)?.address;
if(!address)throw Error('isolated interface required');
await mkdir('/work/home',{recursive:true});
let patch='- insert:\n    - id: dreamcore-enterprise\n      name: /app/dist/native/enterprise-plugin.js\n';
if(process.env.DREAMCORE_NATIVE_SYNTHETIC==='true')patch+='    - id: native-test-model\n      name: /app/tests/fixtures/native-model.mjs\n- id: llm-deepseek\n  disabled: true\n- id: llm-pi-ai\n  disabled: true\n';
if(process.env.DREAMCORE_NATIVE_MODEL){
 const model=JSON.parse(process.env.DREAMCORE_NATIVE_MODEL);
 patch+='- id: agent-default-model\n  config: '+JSON.stringify({provider:'deepseek-official',model:model.model})+'\n';
 patch+='- id: llm-deepseek\n  config: '+JSON.stringify({baseURL:'http://enterprise-bridge:18190',apiKeyEnv:'DREAMCORE_NATIVE_CAPABILITY',maxTokens:model.maxOutputTokens,defaultContextWindow:model.maxInputTokens,models:[{id:model.model,name:model.model,contextWindow:model.maxInputTokens,maxTokens:model.maxOutputTokens,inputModalities:['text','image']}]})+'\n';
}
if(process.env.DREAMCORE_NATIVE_SYNTHETIC==='true')patch+='- id: agent-default-model\n  config: {provider: synthetic, model: fixture}\n';
if(process.env.DREAMCORE_NATIVE_MODE==='sdk')patch+='- id: sdk-jsonrpc-server\n  disabled: true\n- insert:\n    - id: enterprise-sdk-server\n      name: /app/scripts/native-sdk-plugin.mjs\n';
await writeFile('/tmp/enterprise.patch.yml',patch);
if(process.env.DREAMCORE_NATIVE_MODE==='sdk'){
 let raw='';for await(const chunk of process.stdin)raw+=chunk;const {controlCapability}=JSON.parse(raw);raw='';

 const {serveSdk}=await import('./native-sdk-runtime.mjs');
 const combined='/tmp/enterprise-sdk.patch.yml';
 const {readFile}=await import('node:fs/promises');
 await writeFile(combined,(await readFile('/app/profiles/enterprise-web.patch.yml','utf8'))+'\n'+patch);
 const close=await serveSdk({controlCapability,patch:combined,root:process.env.DREAMCORE_NATIVE_ROOT,host:address,bridge:process.env.DREAMCORE_NATIVE_BRIDGE,capability:process.env.DREAMCORE_NATIVE_CAPABILITY,model:process.env.DREAMCORE_NATIVE_MODEL?JSON.parse(process.env.DREAMCORE_NATIVE_MODEL):null,synthetic:process.env.DREAMCORE_NATIVE_SYNTHETIC==='true'});
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await close();process.exit();});
 setTimeout(async()=>{await close();process.exit();},30*60*1000).unref();
}else{

const child=spawn('/app/node_modules/.bin/dsh',['--profile','web','--patch','/app/profiles/enterprise-web.patch.yml','--patch','/tmp/enterprise.patch.yml','--host',address,'--port','18191','--public-url',process.env.DREAMCORE_NATIVE_PUBLIC_URL,'--no-open'],{cwd:'/work',stdio:'inherit'});
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>child.kill(sig));
const deadline=setTimeout(()=>{child.kill('SIGTERM');setTimeout(()=>process.exit(1),5000).unref();},30*60*1000);
child.on('exit',code=>{clearTimeout(deadline);process.exit(code??1);});

}
