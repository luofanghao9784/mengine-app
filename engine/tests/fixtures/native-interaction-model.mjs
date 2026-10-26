import {LlmAdapter} from '@deepseek-ai/dsh-llm';
export const name='interaction-fixture';export const inject=['llm','tools','approval','userQuestions'];
export function apply(ctx){
 ctx.tools.register({name:'fixture_approval',description:'Synthetic approval boundary',parameters:{},output:{schema:{type:'object',additionalProperties:true},render:(_,v)=>[{type:'text',text:JSON.stringify(v)}]},execute:async(_,exec)=>({outcome:await ctx.approval.request({agent:exec.agent,toolName:'fixture_approval',callId:exec.callId,signal:exec.signal})})});
 ctx.tools.register({name:'fixture_plan',description:'Synthetic plan review',parameters:{},output:{schema:{type:'object',additionalProperties:true},render:(_,v)=>[{type:'text',text:JSON.stringify(v)}]},execute:async(_,exec)=>ctx.userQuestions.ask({agent:exec.agent,signal:exec.signal,wait:{callId:exec.callId},questions:[{id:'plan',question:'Review plan',detail:'Synthetic plan',options:[{label:'Proceed'},{label:'Change'}],intent:{kind:'plan-review',approve:'Proceed',callId:exec.callId}}]})});
 class Model extends LlmAdapter{
  async resolveModel(provider,id){return {provider,id,name:id,defaultMaxTokens:1024,context:{contextWindow:128000}};}
  async *stream(request){
   const last=request.messages.findLastIndex(m=>m.role==='user'&&/APPROVAL|QUESTION|PLAN/.test(JSON.stringify(m)));const text=JSON.stringify(request.messages[last]);
   const done=request.messages.slice(last+1).some(m=>m.role==='tool');
   let block={type:'text',text:'interaction-completed'};
   if(!done){
    if(text.includes('PLAN'))block={type:'tool-call',id:'plan-'+request.messages.length,name:'fixture_plan',arguments:'{}'};
    else if(text.includes('APPROVAL'))block={type:'tool-call',id:'approval-'+request.messages.length,name:'fixture_approval',arguments:'{}'};
    else if(text.includes('QUESTION'))block={type:'tool-call',id:'question-'+request.messages.length,name:'ask_user_question',arguments:JSON.stringify({questions:[{id:'choice',question:'Choose',options:[{label:'Yes'},{label:'No'}]}],timeout:text.includes('TIMEOUT')?1:30})};
   }
   yield {type:'block-start',index:0,blockType:block.type};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:block.type==='tool-call'?'tool-calls':'stop'}};
  }
 }
 ctx.llm.registerAdapter(['interaction-test'],new Model());
}
