import {createHash} from 'node:crypto';
import {RuntimeError} from './ports.js';
import {ENGINE_VERSION} from '../release.js';
import {platformEndpoint} from './http-json.js';

/** Persist before acknowledging; never replay an accepted but uncertain paid execution. */
export class ExecutionReceipts {
 private readonly base: URL;
 constructor(base: string, private readonly token: string) {this.base=platformEndpoint(base);if(token.length<32)throw new RuntimeError('INVALID_MODEL_CONFIG');}
 private async post(path:string,body:unknown){
  try{
   const response=await fetch(new URL(path,this.base),{method:'POST',headers:{authorization:`Bearer ${this.token}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(3000),redirect:'error'});
   if(!response.ok)throw new Error('receipt rejected');
   const raw=await response.text();if(raw.length>300000)throw new Error('receipt too large');return JSON.parse(raw);
  }catch{throw new RuntimeError('EXECUTION_RECEIPT_UNAVAILABLE');}
 }
 async run<T>(kind:'AGENT'|'COMPANY',id:string,attempt:string,input:unknown,execute:()=>Promise<T>):Promise<T>{
  if(![id,attempt].every(v=>typeof v==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v)))throw new RuntimeError('INVALID_AGENT_REQUEST');
  const path=`/internal/v1/engine-receipts/${kind}/${id}/${attempt}`;
  const inputHash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const claimed=await this.post(path+'/claim',{inputHash,engineVersion:ENGINE_VERSION});
  if(claimed.state==='COMPLETED'&&claimed.result)return claimed.result as T;
  if(claimed.state!=='NEW')throw new RuntimeError(kind==='COMPANY'?'COMPANY_ATTEMPT_CONFLICT':'TASK_RESULT_UNKNOWN');
  const result=await execute();
  // Retrying this idempotent storage write never calls the model again.
  try{await this.post(path+'/finish',{inputHash,result});}
  catch{await this.post(path+'/finish',{inputHash,result});}
  return result;
 }
}
