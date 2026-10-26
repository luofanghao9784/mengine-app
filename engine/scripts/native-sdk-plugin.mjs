// Fixed-version enterprise SDK extension. No arbitrary remote method dispatch.
import {HarnessSdkJsonRpcServer} from '@deepseek-ai/dsh-sdk-jsonrpc-server';
import {JsonRpcLineTransport} from '@deepseek-ai/dsh-sdk-protocol';
import {UserQuestionError} from '@deepseek-ai/dsh-user-questions';
import * as AskUserTool from '@deepseek-ai/dsh-tool-ask-user';
import {randomUUID} from 'node:crypto';
export const name='enterprise-sdk-server';
export const inject=['agents','workingDirectory','userQuestions'];
export async function apply(ctx){
 await ctx.plugin(AskUserTool,{mode:'timed',timeout:120});
 const transport=new JsonRpcLineTransport(process.stdin,process.stdout);
 const server=new HarnessSdkJsonRpcServer(ctx,transport);
 const approvals=new Map(),asked=new Map(),questions=new Map();
 const notice=(type,sessionId,data)=>transport.notify('enterprise.interaction',{key:randomUUID(),sessionId,type,time:new Date().toISOString(),data});
 ctx.on('session/event',(session,event)=>{if(event.type==='approval/asked')asked.set(session.id,event.data.id);});
 ctx.on('approval/request',req=>new Promise(resolve=>{
  const id=asked.get(req.agent.session.id);if(!id){resolve('unavailable');return;}
  const finish=outcome=>{approvals.delete(id);req.signal?.removeEventListener('abort',abort);resolve(outcome);};
  const abort=()=>finish('cancelled');approvals.set(id,{sessionId:req.agent.session.id,finish});
  req.signal?.addEventListener('abort',abort,{once:true});if(req.signal?.aborted)abort();
 }));
 ctx.on('user-questions/request',req=>new Promise((resolve,reject)=>{
  const agent=req.agent,callId=req.wait?.callId||randomUUID();
  if(!agent){reject(new UserQuestionError('No live agent','CALLER_NOT_LIVE'));return;}
  let timeout,waitStream;
  const finish=(answer,error)=>{
   clearTimeout(timeout);questions.delete(callId);req.signal?.removeEventListener('abort',abort);waitStream?.return?.();
   notice('question/closed',agent.session.id,{callId,outcome:error?.code||'answered'});
   error?reject(error):resolve(answer);
  };
  const abort=()=>finish(null,req.signal.reason||new UserQuestionError('cancelled','ASK_ABORTED'));
  questions.set(callId,{sessionId:agent.session.id,questions:req.questions,finish});
  req.signal?.addEventListener('abort',abort,{once:true});if(req.signal?.aborted){abort();return;}
  notice('question/asked',agent.session.id,{callId,questions:req.questions,timed:!!req.wait?.timed});
  if(req.wait?.timed){
   waitStream=ctx.userQuestions.attachWait(agent,callId,req.signal)[Symbol.asyncIterator]();
   void waitStream.next().then(({value,done})=>{
    if(done||!questions.has(callId))return;
    notice('question/deadline',agent.session.id,{callId,remainingMs:value.remainingMs,deadline:new Date(Date.now()+value.remainingMs).toISOString()});
    timeout=setTimeout(()=>finish(null,new UserQuestionError('timed out','ASK_TIMED_OUT')),value.remainingMs);
   }).catch(abort);
  }
 }));
 const live=id=>{const agent=ctx.agents.get(id);if(!agent||!ctx.agents.roots().includes(agent))throw Error('NATIVE_SESSION_NOT_LIVE');return agent;};
 const pending=(agent,callId)=>questions.get(callId)||ctx.get('sessionProjections')?.stateOf(agent.session,'userQuestions')?.questions.active.find(q=>q.callId===callId);
 function validate(items,answers){
  if(!Array.isArray(answers)||answers.length!==items.length||new Set(answers.map(a=>a.id)).size!==items.length)throw Error('BAD_ANSWER');
  for(const item of items){const a=answers.find(a=>a.id===item.id);if(!a||!Array.isArray(a.selected)||a.selected.some(v=>typeof v!=='string'||!item.options?.some(o=>o.label===v))||new Set(a.selected).size!==a.selected.length||!item.multiSelect&&a.selected.length>1||a.custom!==undefined&&typeof a.custom!=='string')throw Error('BAD_ANSWER');}
 }
 transport.onRequest(async(method,p)=>{
  if(method==='initialize')await ctx.get('loader')?.await();
  if(!method.startsWith('enterprise/')){
   const result=await server.handleRequest(method,p);
   if(method==='shutdown')setImmediate(async()=>{await transport.flush();await ctx.root.fiber.dispose();process.exit(0);});
   return result;
  }
  const agent=live(p.sessionId);
  if(method==='enterprise/stop'){agent.cancel({kind:'user'},{keepInbox:true});return {accepted:true};}
  if(method==='enterprise/approval'){
   const entry=approvals.get(p.approvalId);const family=new Set([agent.id]);let changed=true;while(changed){changed=false;for(const child of ctx.agents.list())if(!family.has(child.id)&&[...family].some(id=>ctx.agents.isOwnedBy(child.id,ctx.agents.get(id)))){family.add(child.id);changed=true;}}
   if(!entry||!family.has(entry.sessionId)||!['ALLOW_ONCE','REJECT'].includes(p.decision))throw Error('APPROVAL_NOT_PENDING');
   entry.finish(p.decision==='ALLOW_ONCE'?'allowed-once':'rejected');return {accepted:true};
  }
  if(method==='enterprise/answer'||method==='enterprise/plan-review'){
   const entry=pending(agent,p.callId);if(!entry||entry.sessionId&&entry.sessionId!==p.sessionId)throw Error('QUESTION_NOT_PENDING');
   let answers=p.answers;
   if(method==='enterprise/plan-review'){
    if(entry.questions.length!==1||entry.questions[0].intent?.kind!=='plan-review'||!['APPROVE','REVISE'].includes(p.decision))throw Error('PLAN_NOT_PENDING');
    const item=entry.questions[0];const label=p.decision==='APPROVE'?item.intent.approve:item.options?.find(o=>o.label!==item.intent.approve)?.label;
    answers=[{id:item.id,selected:label?[label]:[],...(p.decision==='REVISE'&&p.comment?{custom:p.comment}:{})}];
   }
   validate(entry.questions,answers);
   if(entry.finish)entry.finish({answers});else if(!ctx.userQuestions.answer(agent,p.callId,{answers}))throw Error('QUESTION_NOT_PENDING');
   return {accepted:true};
  }
  throw Error('UNSUPPORTED_OPERATION');
 });
 ctx.effect(()=>{transport.start();return async()=>{await server.shutdown();transport.close();};},'enterprise.sdk');
}
