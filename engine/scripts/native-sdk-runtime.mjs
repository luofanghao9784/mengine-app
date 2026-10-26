import {HarnessClient} from '@deepseek-ai/dsh-sdk-client';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

export async function serveSdk({patch,root,port=18191,host='0.0.0.0',home='/work/home',cwd='/work',bridge,capability,controlCapability,model,synthetic=false,plugin='/app/scripts/native-sdk-plugin.mjs'}){
 const client=new HarnessClient({profile:'sdk',patches:[patch],dshHome:home,processCwd:cwd,initializeTimeoutMs:30000,requestTimeoutMs:30000});
 const subscription=client.subscribe();let queue=Promise.resolve(),failed=false;
 const send=n=>{
  queue=queue.then(async()=>{
   const body=JSON.stringify(n);
   for(let n=0;n<5;n++){
    try{const r=await fetch(bridge+'notification',{method:'POST',headers:{authorization:`Bearer ${controlCapability}`,'content-type':'application/json'},body,signal:AbortSignal.timeout(5000)});if(r.ok)return;}catch{}
    await new Promise(r=>setTimeout(r,200));
   }
   throw Error('EVENT_PERSISTENCE_UNAVAILABLE');
  }).catch(()=>{failed=true;void client.close();});
 };
 const members=new Set([root]);
 void (async()=>{try{for await(const n of subscription){
  const p=n.params;
  if(n.method==='subagent.started'&&members.has(p.parentSessionId))members.add(p.childSessionId);
  if(!members.has(p.sessionId||p.parentSessionId))continue;
  send({...n,key:n.method==='session.event'?`${p.sessionId}:${p.event.seq}`:randomUUID()});
 }}catch{failed=true;}})();
 await client.initialize({cwd,provider:synthetic?'synthetic':'deepseek-official',model:synthetic?'fixture':model.model,maxTokens:model?.maxOutputTokens||1024});
 // A persisted marker distinguishes a fresh root from a corrupt/missing history.
 const marker=home+'/enterprise-root';let exists=false;try{exists=(await readFile(marker,'utf8'))===root;}catch{}
 if(exists)await client.resumeSession(root);else{await client.getWorkingDirectory(root);await writeFile(marker,root);}
 const server=createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  try{
   if(req.method!=='POST'||req.headers.authorization!==`Bearer ${controlCapability}`){res.writeHead(403).end();return;}
   let raw='';for await(const b of req){raw+=b;if(raw.length>300000)throw Error('TOO_LARGE');}const p=JSON.parse(raw||'{}');
   if(failed)throw Error('RUNTIME_UNAVAILABLE');
   let result;
   if(req.url==='/command/messages'){
    const refs=p.materials||[];
    const text=p.text+(refs.length?'\n\n用户引用的企业资料（须经 enterprise_read/search 按当前权限读取）：\n'+refs.map(r=>JSON.stringify({materialId:r.materialId,versionId:r.versionId})).join('\n'):'');
    result={accepted:true,messageId:await client.prompt(root,[{type:'text',text}])};
   }else{
    const operation={'/command/turn-stop':'stop','/command/approval':'approval','/command/answer':'answer','/command/plan-review':'plan-review'}[req.url];
    if(!operation){res.writeHead(404).end();return;}
    result=await client.request('enterprise/'+operation,{...p,sessionId:root});
   }
   await queue;if(failed)throw Error('EVENT_PERSISTENCE_UNAVAILABLE');res.end(JSON.stringify(result));
  }catch(error){console.error('SDK operation rejected');res.writeHead(409).end(JSON.stringify({code:'NATIVE_OPERATION_REJECTED'}));}
 });
 await new Promise(r=>server.listen(port,host,r));console.log('sdk-ready');
 return async()=>{server.closeAllConnections();server.close();await client.close();await queue;};
}
