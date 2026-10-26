// Runs outside the tool container. Configuration arrives on stdin, not a volume
// shared with the agent. Only explicit platform operations are forwarded.
import {createServer,request as httpRequest} from 'node:http';
import {upgrade} from './native-web-upgrade.mjs';
import {Readable} from 'node:stream';
import {NativeModelGateway} from '../dist/native/model-gateway.js';
import {LongTaskBudget} from '../dist/native/budget.js';
let raw='';for await(const chunk of process.stdin)raw+=chunk;
const config=JSON.parse(raw);raw='';
const ledger=new LongTaskBudget('/ledger/budget.sqlite');
const lifetime=new AbortController();const sockets=new Set();lifetime.signal.addEventListener('abort',()=>{for(const s of sockets)s.destroy();});
const platform=async(action,body,signal)=>fetch(`${config.platform}/internal/v1/native-conversations/${config.id}/${action}`,{
 method:'POST',headers:{authorization:`Bearer ${config.token}`,'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal,
});
const authorize=async()=>{const r=await platform('check',{},AbortSignal.timeout(5000));if(!r.ok)throw Error('access denied');return r.json();};
const gateway=config.route?new NativeModelGateway({ledger,resolve:async token=>{
 if(token!==config.capability)return null;const s=await authorize();return {scope:{tenant:s.tenantId,user:s.ownerId,task:s.id},route:config.route,signal:lifetime.signal};
}}):null;
const server=createServer(async(req,res)=>{
 const abort=new AbortController();res.on('close',()=>{if(!res.writableEnded)abort.abort();});
 try{
  if(req.url.startsWith('/runtime/') && req.headers['x-dreamcore-bridge']===config.capability){
   await authorize();const headers={...req.headers,host:config.publicAuthority};delete headers['x-dreamcore-bridge'];delete headers.authorization;
   const proxy=httpRequest('http://native-runtime:18191'+req.url.slice('/runtime'.length),{method:req.method,headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});proxy.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(proxy);res.on('close',()=>proxy.destroy());return;
  }
  if(req.method!=='POST'||req.headers.authorization!==`Bearer ${config.capability}`&&req.headers['x-api-key']!==config.capability){res.writeHead(403).end();return;}
  const path=new URL(req.url,'http://bridge').pathname;
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
 }catch{if(!res.headersSent)res.writeHead(403);res.end();}
});
server.on('upgrade',async(req,socket,head)=>{
 try{
  if(req.headers['x-dreamcore-bridge']!==config.capability||!req.url.startsWith('/runtime/api'))throw Error('denied');
  await authorize();const headers={...req.headers,host:config.publicAuthority};delete headers['x-dreamcore-bridge'];delete headers.authorization;
  upgrade(req,socket,head,'http://native-runtime:18191'+req.url.slice('/runtime'.length),headers,sockets);
 }catch{socket.destroy();}
});
const timer=setInterval(()=>authorize().catch(()=>{lifetime.abort();server.closeAllConnections();server.close();process.exitCode=1;clearInterval(timer);}),2000);
setTimeout(()=>{lifetime.abort();server.closeAllConnections();server.close();clearInterval(timer);},30*60*1000).unref();
server.listen(18190,'0.0.0.0');
