// Runs outside the tool container. Configuration arrives on stdin, not a volume
// shared with the agent. Only explicit platform operations are forwarded.
import {createServer,request as httpRequest} from 'node:http';
import {upgrade} from './native-web-upgrade.mjs';
import {Readable} from 'node:stream';
import {NativeModelGateway} from '../dist/native/model-gateway.js';
import {NativeStreamStore,publicNotification} from './native-stream-store.mjs';
import {randomUUID} from 'node:crypto';
import {LongTaskBudget} from '../dist/native/budget.js';
let raw='';for await(const chunk of process.stdin)raw+=chunk;
const config=JSON.parse(raw);raw='';
const ledger=new LongTaskBudget('/ledger/budget.sqlite');
const outbox=new NativeStreamStore('/ledger/native-events.sqlite',config.id);
let runtimeRunning=false,turnStarted=null,turnElapsed=0,flushing=false;
const lifetime=new AbortController();const sockets=new Set();lifetime.signal.addEventListener('abort',()=>{for(const s of sockets)s.destroy();});
const platform=async(action,body,signal)=>fetch(`${config.platform}/internal/v1/native-conversations/${config.id}/${action}`,{
 method:'POST',headers:{authorization:`Bearer ${config.token}`,'content-type':'application/json',...(action==='events-write'?{'x-dreamcore-control':config.controlToken}:{})},body:JSON.stringify(body),redirect:'error',signal,
});
const authorize=async()=>{const r=await platform('check',{},AbortSignal.timeout(5000));if(!r.ok)throw Error('access denied');return r.json();};
async function flush(){
 if(flushing)return;flushing=true;
 try{for(const row of outbox.pending()){const r=await platform('events-write',row,AbortSignal.timeout(5000));if(!r.ok)break;outbox.delivered(row.key);}}catch{}finally{flushing=false;}
}
async function status(){
 const scope=await authorize();const b=ledger.snapshot({tenant:scope.tenantId,user:scope.ownerId,task:scope.id});
 outbox.append(randomUUID(),{type:'status',time:new Date().toISOString(),data:{running:runtimeRunning,executionClass:config.synthetic?'SYNTHETIC':'LIVE',budget:{usedYuan:b.settled/1e6,reservedYuan:b.held/1e6,occupiedYuan:b.task/1e6,softYuan:b.policy.softMicros/1e6,hardYuan:b.policy.hardMicros/1e6,elapsedMinutes:(runtimeRunning&&turnStarted?Date.now()-turnStarted:turnElapsed)/60000,budgetElapsedMinutes:b.startedMs===null?0:(Date.now()-b.startedMs)/60000,softMinutes:b.policy.softMs/60000,hardMinutes:b.policy.hardMs/60000,dailyUsedYuan:b.daily/1e6,dailyHardYuan:b.policy.dailyMicros/1e6,blocked:b.blocked,includesReservations:true}}});
 await flush();
}
const gateway=config.route?new NativeModelGateway({ledger,resolve:async token=>{
 if(token!==config.capability)return null;const s=await authorize();return {scope:{tenant:s.tenantId,user:s.ownerId,task:s.id},route:config.route,signal:lifetime.signal};
}}):null;
const server=createServer(async(req,res)=>{
 let stage='authorize';
 const abort=new AbortController();res.on('close',()=>{if(!res.writableEnded)abort.abort();});
 try{
  if(req.url.startsWith('/control/')&&req.headers['x-dreamcore-bridge']===config.controlCapability&&req.method==='POST'){
   await authorize();if(config.mode!=='sdk'){res.writeHead(409).end();return;}
   const action=req.url.slice('/control/'.length);if(!['messages','turn-stop','answer','approval','plan-review'].includes(action)){res.writeHead(404).end();return;}
   stage='runtime-command';const response=await fetch('http://native-runtime:18191/command/'+action,{method:'POST',headers:{authorization:`Bearer ${config.controlCapability}`,'content-type':'application/json'},body:Readable.toWeb(req),duplex:'half',signal:abort.signal});
   res.writeHead(response.status,{'content-type':'application/json'}).end(await response.text());return;
  }
  if(req.url.startsWith('/control/')){res.writeHead(403).end();return;}
  if(req.url.startsWith('/runtime/') && req.headers['x-dreamcore-bridge']===config.controlCapability){
   await authorize();const headers={...req.headers,host:config.publicAuthority};delete headers['x-dreamcore-bridge'];delete headers.authorization;
   const proxy=httpRequest('http://native-runtime:18191'+req.url.slice('/runtime'.length),{method:req.method,headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});proxy.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(proxy);res.on('close',()=>proxy.destroy());return;
  }
  const path=new URL(req.url,'http://bridge').pathname;
  const authorized=path==='/notification'?req.headers.authorization===`Bearer ${config.controlCapability}`:req.headers.authorization===`Bearer ${config.capability}`||req.headers['x-api-key']===config.capability;
  if(req.method!=='POST'||!authorized){res.writeHead(403).end();return;}
  if(path==='/notification'&&config.mode==='sdk'){
   await authorize();let raw='';for await(const b of req){raw+=b;if(raw.length>2000000)throw Error('too large');}
   const n=JSON.parse(raw),event=publicNotification(n);if(typeof n.key!=='string'||n.key.length>200)throw Error('invalid key');
   outbox.append(n.key,event);
   if(n.method==='session.status'&&n.params.sessionId===config.id){
    const running=n.params.status==='running';if(running&&!runtimeRunning)turnStarted=Date.now();
    if(!running&&runtimeRunning)turnElapsed=Date.now()-turnStarted;runtimeRunning=running;
   }
   void flush();res.writeHead(200).end('{}');return;
  }
  let response;
  if(path==='/v1/messages'||path==='/v1/chat/completions'){
   if(!gateway){res.writeHead(503).end();return;}
   response=await gateway.handle(new Request(`http://bridge${req.url}`,{method:'POST',headers:req.headers,body:Readable.toWeb(req),duplex:'half',signal:abort.signal}));
  }else{
   const action=path.slice(1);if(!['check','history','search','read','save'].includes(action)||req.url!==path){res.writeHead(404).end();return;}
   await authorize();let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>28*1024*1024)throw Error('too large');chunks.push(chunk);}
   response=await platform(action,JSON.parse(Buffer.concat(chunks).toString()||'{}'),abort.signal);
  }
  res.writeHead(response.status,{'content-type':response.headers.get('content-type')||'application/json','cache-control':'no-store'});
  if(response.body)Readable.fromWeb(response.body).on('error',()=>res.destroy()).pipe(res);else res.end();
 }catch(error){console.error('Native bridge rejected at',stage,error?.name,error?.cause?.code);if(!res.headersSent)res.writeHead(403);res.end();}
});
server.on('upgrade',async(req,socket,head)=>{
 try{
  if(req.headers['x-dreamcore-bridge']!==config.controlCapability||!req.url.startsWith('/runtime/api'))throw Error('denied');
  await authorize();const headers={...req.headers,host:config.publicAuthority};delete headers['x-dreamcore-bridge'];delete headers.authorization;
  upgrade(req,socket,head,'http://native-runtime:18191'+req.url.slice('/runtime'.length),headers,sockets);
 }catch{socket.destroy();}
});
const timer=setInterval(()=> (config.mode==='sdk'?status():authorize()).catch(()=>{lifetime.abort();server.closeAllConnections();server.close();process.exitCode=1;clearInterval(timer);}),2000);
setTimeout(()=>{lifetime.abort();server.closeAllConnections();server.close();clearInterval(timer);},30*60*1000).unref();
server.listen(18190,'0.0.0.0');
