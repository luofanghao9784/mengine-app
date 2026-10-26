// Explicit local integration, never part of ordinary unit tests. No host binds,
// inherited secrets, published ports or network are granted to agent containers.
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const context=process.env.DREAMCORE_NATIVE_DOCKER_CONTEXT || 'colima-dh120';
if(!/^[a-zA-Z0-9_.-]{1,100}$/.test(context))throw Error('Invalid Docker context');
function docker(args,capture=false){return new Promise((resolve,reject)=>{
 const child=spawn('docker',['--context',context,...args],{cwd:root,env:{...process.env,DH_PRIVATE_CANARY:'synthetic-host-canary'},stdio:['ignore',capture?'pipe':'inherit','inherit']});
 let output='';child.stdout?.on('data',b=>{output+=b;if(output.length>1048576)child.kill();});
 child.on('error',reject);child.on('exit',code=>code===0?resolve(output.trim()):reject(Error(`Docker command failed (${code}): ${args[0]}`)));
});}
const temporary=await mkdtemp(join(tmpdir(),'dh120-container-'));
const volumes=[`dh120-${randomUUID()}-a`,`dh120-${randomUUID()}-b`];
const createdVolumes=[];
try{
 const platform=JSON.parse(await docker(['info','--format','{{json .}}'],true));
 if(platform.OSType!=='linux')throw Error('Linux container daemon required');
 const iid=join(temporary,'image.id');
 await docker(['build','--iidfile',iid,'-f','native/Dockerfile','.']);
 const image=(await readFile(iid,'utf8')).trim();
 if(!/^sha256:[a-f0-9]{64}$/.test(image))throw Error('Immutable image id missing');
 const limits=['--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
   '--pids-limit','128','--memory','1g','--cpus','2','--tmpfs','/tmp:rw,nosuid,nodev,size=256m,uid=1000,gid=1000','--user','1000:1000'];
 await docker(['run',...limits,image]);
 const probe=`import fs from 'node:fs';import net from 'node:net';import assert from 'node:assert/strict';
 assert.equal(process.getuid(),1000);
 assert.equal(fs.existsSync('/var/run/docker.sock'),false);
 assert.equal(fs.existsSync('/Users'),false);
 assert.equal(process.env.DH_PRIVATE_CANARY,undefined);
 assert.throws(()=>fs.writeFileSync('/app/forbidden','x'));
 const outcome=await new Promise(resolve=>{const s=net.connect(443,'1.1.1.1');s.on('connect',()=>{s.destroy();resolve('CONNECTED')});s.on('error',e=>resolve(e.code));s.setTimeout(2000,()=>{s.destroy();resolve('TIMEOUT')})});
 assert.ok(['ENETUNREACH','EHOSTUNREACH'].includes(outcome),outcome);console.log('Kernel isolation: uid, read-only root, no host/socket/secret/network verified');`;
 await docker(['run',...limits,image,'--input-type=module','-e',probe]);
 for(const volume of volumes){
  await docker(['volume','create','--label','io.dreamcore.native-test=dh120',volume],true);
  createdVolumes.push(volume);
  await docker(['run','--rm','--network','none','--read-only','--cap-drop','ALL','--cap-add','CHOWN',
    '--security-opt','no-new-privileges','--user','0:0','--mount',`type=volume,src=${volume},dst=/work`,image,
    '-e',"require('fs').chownSync('/work',1000,1000)"]);
 }
 const withVolume=(volume,code)=>docker(['run',...limits,'--mount',`type=volume,src=${volume},dst=/work`,image,'-e',code]);
 await withVolume(volumes[0],"require('fs').writeFileSync('/work/synthetic','task-a')");
 await withVolume(volumes[1],"require('assert').equal(require('fs').existsSync('/work/synthetic'),false)");
 await withVolume(volumes[0],"require('assert').equal(require('fs').readFileSync('/work/synthetic','utf8'),'task-a')");
 console.log(JSON.stringify({status:'passed',image,context,scope:'synthetic local container acceptance; not enterprise integration'}));
}finally{
 for(const volume of createdVolumes)await docker(['volume','rm',volume],true).catch(()=>{});
 await rm(temporary,{recursive:true,force:true});
}
