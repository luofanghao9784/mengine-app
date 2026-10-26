import {constants} from 'node:fs';
import {lstat,mkdir,open,readFile,writeFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {RuntimeError,type ModelPort,type ModelPart} from './ports.js';

/** Checkpoint at ModelPort: absence is a durable wait, never a fake model response. */
export class DurableGovernanceModel implements ModelPort {
 constructor(private root:string,private jobId:string,private inputHash:string) {
  if(!isAbsolute(root)||!/^[0-9a-f-]{36}$/.test(jobId)||!/^[a-f0-9]{64}$/.test(inputHash))throw new RuntimeError('INVALID_GOVERNANCE_REQUEST');
 }
 async *generate(input:Parameters<ModelPort['generate']>[0]):AsyncIterable<ModelPart>{
  input.signal.throwIfAborted();
  if(input.tools.length||input.requiredTool||input.requireToolCall)throw new RuntimeError('INVALID_GOVERNANCE_REQUEST');
  const st=await lstat(this.root);
  if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o777)!==0o700||(process.getuid&&st.uid!==process.getuid()))throw new RuntimeError('INVALID_GOVERNANCE_DIRECTORY');
  const dir=join(this.root,this.jobId+'-'+this.inputHash);await mkdir(dir,{mode:0o700,recursive:true});
  const ds=await lstat(dir);if(!ds.isDirectory()||ds.isSymbolicLink()||(ds.mode&0o777)!==0o700)throw new RuntimeError('INVALID_GOVERNANCE_DIRECTORY');
  const payload={version:'1.0',jobId:this.jobId,inputHash:this.inputHash,messages:input.messages,tools:input.tools,maxTokens:input.maxTokens};
  const body=JSON.stringify(payload);const transportHash=createHash('sha256').update(body).digest('hex');
  try{await writeFile(join(dir,'request.json'),JSON.stringify({...payload,transportHash}),{mode:0o600,flag:'wx'});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
   const prior=JSON.parse(await readFile(join(dir,'request.json'),'utf8'));if(prior.transportHash!==transportHash)throw new RuntimeError('GOVERNANCE_INPUT_CHANGED');}
  let f;try{f=await open(join(dir,'response.json'),constants.O_RDONLY|constants.O_NOFOLLOW);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')throw new RuntimeError('GOVERNANCE_MODEL_PENDING');throw e;}
  try{const s=await f.stat();if(!s.isFile()||s.size>262144||(s.mode&0o077)!==0)throw new RuntimeError('INVALID_MODEL_RESPONSE');
   const r=JSON.parse(await f.readFile('utf8'));input.signal.throwIfAborted();
   if(r.jobId!==this.jobId||r.inputHash!==this.inputHash||r.transportHash!==transportHash||r.executor!=='CODEX'||typeof r.text!=='string'||!r.text.trim())throw new RuntimeError('INVALID_MODEL_RESPONSE');
   yield {type:'text',text:r.text};yield {type:'finish',reason:'stop'};
  }finally{await f.close();}
 }
}
