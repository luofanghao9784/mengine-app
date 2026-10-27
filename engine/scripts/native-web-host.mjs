// Dedicated local Web host. Full official Web traffic is proxied only after a
// live enterprise check. No changes to the existing conversation layout.
import {createServer,request as httpRequest} from 'node:http';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {upgrade} from './native-web-upgrade.mjs';
const context=process.env.DREAMCORE_NATIVE_DOCKER_CONTEXT||'colima-dh120';
const image=process.env.DREAMCORE_NATIVE_IMAGE;
const platform=process.env.DREAMCORE_NATIVE_PLATFORM_URL;
const publicURL=new URL(process.env.DREAMCORE_NATIVE_PUBLIC_URL||'http://127.0.0.1:18189');
const controlToken=process.env.DREAMCORE_NATIVE_CONTROL_TOKEN;
const appOrigin=process.env.DREAMCORE_NATIVE_APP_ORIGIN;
const synthetic=process.env.DREAMCORE_NATIVE_SYNTHETIC==='true';
const route=process.env.DREAMCORE_NATIVE_ROUTE_FILE?JSON.parse(await readFile(process.env.DREAMCORE_NATIVE_ROUTE_FILE,'utf8')):null;
if(!/^sha256:[a-f0-9]{64}$/.test(image||'')||!platform||!appOrigin||!synthetic&&!route)throw Error('native host requires immutable image, platform, app origin and model route (or explicit synthetic acceptance)');
if(route && route.protocol!=='messages')throw Error('Native Web currently requires a verified Messages route');
const sockets=new Set();
const instances=new Map();const pending=new Map();
const docker=(args,input)=>new Promise((resolve,reject)=>{
 const child=spawn('docker',['--context',context,...args],{stdio:['pipe','pipe','pipe']});let out='',err='';
 child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('exit',code=>code===0?resolve((out+(args[0]==='logs'?err:'')).trim()):reject(Error(`docker ${args[0]} failed: ${err.slice(0,500)}`)));child.stdin.end(input);
});
async function check(id,token){
 const r=await fetch(`${platform}/internal/v1/native-conversations/${id}/runtime-config`,{method:'POST',headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(5000),redirect:'error'});
 if(!r.ok)throw Error('enterprise access denied');const result=await r.json();if(result.scope?.id!==id||!result.plugins?.enabled)throw Error('scope mismatch');return result;
}
const limits=['--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','256','--memory','1g','--cpus','2','--tmpfs','/tmp:rw,nosuid,nodev,size=256m,uid=1000,gid=1000','--user','1000:1000'];
async function stop(i){
 if(i.stopping)return i.stopping;
 clearInterval(i.timer);
 i.stopping=(async()=>{
  await docker(['rm','-f',i.runtime,i.bridge]).catch(()=>{});
  await docker(['network','rm',i.network]).catch(()=>{});
  if(instances.get(i.id)===i)instances.delete(i.id);
 })();
 return i.stopping;
}
async function start(id,token,mode='web'){
 const policy=await check(id,token);
 if(instances.has(id)){
  const i=instances.get(id);
  if(i.mode!==mode)throw Error('runtime mode conflict');
  if(!i.stopping){try{const current=await check(id,i.token);if(current.plugins.revision!==i.policyVersion)throw Error('policy changed');return i;}catch{/* expired grant: replace only after cleanup */}}
  await stop(i);
 }
 const short=id.replaceAll('-','');const i={id,token,mode,policyVersion:policy.plugins.revision,cookie:randomBytes(32).toString('base64url'),network:`dh120-net-${short}`,runtime:`dh120-web-${short}`,bridge:`dh120-bridge-${short}`};
 const volume=`dh120-data-${short}`,ledger=process.env.DREAMCORE_NATIVE_LEDGER_VOLUME||'dh120-native-budget';
 try{
  // Named volumes contain only runtime data / host-side accounting respectively.
  for(const v of [volume,ledger]){
   await docker(['volume','create',v]);
   await docker(['run','--rm','--network','none','--read-only','--cap-drop','ALL','--cap-add','CHOWN','--user','0:0','--mount',`type=volume,src=${v},dst=/data`,image,'-e',"require('fs').chownSync('/data',1000,1000)"]);
  }
  await docker(['network','create','--internal',i.network]);
  const capability=randomBytes(32).toString('base64url'),controlCapability=randomBytes(32).toString('base64url');
  await docker(['create','--name',i.bridge,...limits,'--network','bridge','--publish','127.0.0.1::18190','--mount',`type=volume,src=${ledger},dst=/ledger`,'-i',image,'scripts/native-web-bridge.mjs']);
  await docker(['network','connect','--alias','enterprise-bridge',i.network,i.bridge]);
  const bridge=spawn('docker',['--context',context,'start','-ai',i.bridge],{stdio:['pipe','ignore','ignore']});
  bridge.stdin.end(JSON.stringify({platform:process.env.DREAMCORE_NATIVE_PLATFORM_CONTAINER_URL||platform,id,token,capability,controlCapability,controlToken,route,mode,synthetic,policyVersion:policy.plugins.revision,publicAuthority:publicURL.host}));
  await docker(['create','-i','--name',i.runtime,...limits,'--network',i.network,'--network-alias','native-runtime','--mount',`type=volume,src=${volume},dst=/work`,
   '-e',`DREAMCORE_NATIVE_MODE=${mode}`,'-e',`DREAMCORE_NATIVE_ROOT=${id}`,'-e','HOME=/work/home','-e','DSH_HOME=/work/home','-e','NARB_DISABLE_NATIVE_CACHE=1','-e',`DREAMCORE_NATIVE_BRIDGE=http://enterprise-bridge:18190/`,'-e',`DREAMCORE_NATIVE_CAPABILITY=${capability}`,
   '-e',`DREAMCORE_NATIVE_PUBLIC_URL=${publicURL.origin}/s/${id}/`,'-e',`DREAMCORE_NATIVE_SYNTHETIC=${synthetic}`,
   '-e','DH_TEST_LEDGER=/work/synthetic-budget.sqlite','-e',`DREAMCORE_NATIVE_MODEL=${route?JSON.stringify({model:route.model,maxInputTokens:route.maxInputTokens,maxOutputTokens:route.maxOutputTokens}):''}`,image,'scripts/native-web-runtime.mjs']);
  const runtime=spawn('docker',['--context',context,'start','-ai',i.runtime],{stdio:['pipe','ignore','ignore']});
  runtime.stdin.end(JSON.stringify({controlCapability,plugins:policy.plugins.enabled}));
  let port;for(let n=0;n<20;n++){port=await docker(['port',i.bridge,'18190/tcp']).catch(()=>null);if(port)break;await new Promise(r=>setTimeout(r,100));}if(!port)throw Error('native port missing');i.upstream=`http://${port}/runtime`;i.capability=controlCapability;
  let owner;
  for(let n=0;n<60;n++){
   const logs=await docker(['logs',i.runtime]);owner=mode==='sdk'?(logs.includes('sdk-ready')?'sdk':null):logs.match(/token=([A-Za-z0-9_-]+)/)?.[1];if(owner)break;
   await new Promise(r=>setTimeout(r,250));
  }
  if(!owner)throw Error('native web not ready');
  if(mode==='web'){
  const exchange=await fetch(`${i.upstream}/?token=${owner}`,{redirect:'manual',headers:{'x-dreamcore-bridge':controlCapability},signal:AbortSignal.timeout(5000)});
  i.ownerCookie=exchange.headers.get('set-cookie')?.split(';')[0];if(!i.ownerCookie)throw Error('native owner exchange failed');
  }
  i.timer=setInterval(()=>check(id,token).then(current=>{if(current.plugins.revision!==i.policyVersion)return stop(i);}).catch(()=>stop(i)),2000);instances.set(id,i);return i;
 }catch(error){console.error('Native runtime start failed; inspect the dedicated container locally.');await stop(i);throw error;}
}
const server=createServer(async(req,res)=>{
 let stage='request';
 res.setHeader('cache-control','no-store');res.setHeader('referrer-policy','no-referrer');
 try{
  const url=new URL(req.url,publicURL);
  const reclaim=url.pathname.match(/^\/sdk\/([0-9a-f-]{36})\/reclaim$/);
  if(reclaim&&req.method==='POST'){
   if(!controlToken||controlToken.length<32||req.headers['x-dreamcore-control']!==controlToken){res.writeHead(403).end();return;}
   const starting=pending.get(reclaim[1]);if(starting)await starting.catch(()=>{});
   const short=reclaim[1].replaceAll('-','');
   const instance=instances.get(reclaim[1])||{id:reclaim[1],runtime:`dh120-web-${short}`,bridge:`dh120-bridge-${short}`,network:`dh120-net-${short}`};await stop(instance);
   for(const name of [instance.runtime,instance.bridge])if(await docker(['ps','-aq','--filter',`name=^/${name}$`]))throw Error('reclaim incomplete');
   res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({accepted:true}));return;
  }
  const sdk=url.pathname.match(/^\/sdk\/([0-9a-f-]{36})\/(messages|turn-stop|answer|approval|plan-review)$/);
  if(sdk&&req.method==='POST'){
   if(!controlToken||controlToken.length<32||req.headers['x-dreamcore-control']!==controlToken){res.writeHead(403).end();return;}
   const token=req.headers.authorization?.replace(/^Bearer /,'');if(!token)throw Error('denied');
   stage='sdk-authorize';await check(sdk[1],token);
   let raw='';for await(const b of req){raw+=b;if(raw.length>300000)throw Error('too large');}
   stage='sdk-start';let work=pending.get(sdk[1]);if(!work){work=start(sdk[1],token,'sdk');pending.set(sdk[1],work);work.finally(()=>pending.delete(sdk[1])).catch(()=>{});}
   const i=await work;await check(sdk[1],token);if(i.mode!=='sdk'||i.stopping)throw Error('runtime mode conflict');
   stage='sdk-command';const result=await fetch(i.upstream.replace(/\/runtime$/,'')+'/control/'+sdk[2],{method:'POST',headers:{'x-dreamcore-bridge':i.capability,'content-type':'application/json'},body:raw,signal:AbortSignal.timeout(35000)});
   res.writeHead(result.status,{'content-type':'application/json'}).end(await result.text());return;
  }
  if(url.pathname==='/launch'&&req.method==='POST'){
   if(req.headers.origin!==appOrigin){res.writeHead(403).end();return;}
   let text='';for await(const b of req){text+=b;if(text.length>2048)throw Error('invalid launch');}
   const form=new URLSearchParams(text),id=form.get('id'),token=form.get('token');
   if(!/^[0-9a-f-]{36}$/.test(id||'')||!token)throw Error('invalid launch');
   await check(id,token); // Every launch is authorized, including concurrent opens.
   let work=pending.get(id);if(!work){work=start(id,token);pending.set(id,work);work.finally(()=>pending.delete(id)).catch(()=>{});}
   const i=await work;await check(id,token);if(i.stopping||i.mode!=='web')throw Error('runtime stopping or mode conflict');
   res.writeHead(303,{'set-cookie':`dh_native=${i.cookie}; HttpOnly; SameSite=Strict; Path=/s/${id}/; Max-Age=1800${publicURL.protocol==='https:'?'; Secure':''}`,location:`/s/${id}/`}).end();return;
  }
  const match=url.pathname.match(/^\/s\/([0-9a-f-]{36})(\/.*)$/);const i=match&&instances.get(match[1]);
  if(!i||!req.headers.cookie?.split(';').some(v=>v.trim()===`dh_native=${i.cookie}`)){res.writeHead(403).end();return;}
  await check(i.id,i.token);
  if(req.method!=='GET'&&req.method!=='HEAD'&&req.headers.origin!==publicURL.origin){res.writeHead(403).end();return;}
  if(match[2]==='/connect'||url.searchParams.has('token')){res.writeHead(403).end();return;}
  const upstream=new URL(i.upstream);const headers={...req.headers,host:upstream.host,cookie:i.ownerCookie,'x-dreamcore-bridge':i.capability};delete headers.authorization;
  const proxy=httpRequest(`${i.upstream}${match[2]}${url.search}`,{method:req.method,headers},response=>{
   const h={...response.headers};delete h['set-cookie'];res.writeHead(response.statusCode,h);response.pipe(res);
  });proxy.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(proxy);res.on('close',()=>proxy.destroy());
 }catch{console.error(`Native request failed at ${stage}`);if(!res.headersSent)res.writeHead(403);res.end('原生会话不可用或授权已失效');}
});
server.on('upgrade',async(req,socket,head)=>{
 try{
  const url=new URL(req.url,publicURL),match=url.pathname.match(/^\/s\/([0-9a-f-]{36})(\/api(?:\/.*)?)$/),i=match&&instances.get(match[1]);
  if(!i||req.headers.origin!==publicURL.origin||!req.headers.cookie?.split(';').some(v=>v.trim()===`dh_native=${i.cookie}`)||url.searchParams.has('token'))throw Error('denied');
  await check(i.id,i.token);
  const headers={...req.headers,host:new URL(i.upstream).host,cookie:i.ownerCookie,'x-dreamcore-bridge':i.capability};delete headers.authorization;
  upgrade(req,socket,head,i.upstream+match[2]+url.search,headers,sockets);
 }catch{socket.destroy();}
});
server.listen(Number(publicURL.port||18189),'127.0.0.1',()=>console.log('Native enterprise Web host ready (loopback only)'));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{server.close();for(const socket of sockets)socket.destroy();await Promise.all([...instances.values()].map(stop));process.exit();});
