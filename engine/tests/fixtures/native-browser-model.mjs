// Only copied into the dedicated acceptance image; never selected by live model configuration.
import {LlmAdapter} from '@deepseek-ai/dsh-llm';
export const name='native-browser-fixture';export const inject=['llm','tools','approval','userQuestions'];
export function apply(ctx){
 const output={schema:{type:'object',additionalProperties:true},render:(_,v)=>[{type:'text',text:JSON.stringify(v)}]};
 ctx.tools.register({name:'fixture_approval',description:'Synthetic approval boundary',parameters:{},output,execute:async(_,exec)=>({outcome:await ctx.approval.request({agent:exec.agent,toolName:'fixture_approval',callId:exec.callId,signal:exec.signal})})});
 ctx.tools.register({name:'fixture_plan',description:'Synthetic plan review',parameters:{},output,execute:async(_,exec)=>ctx.userQuestions.ask({agent:exec.agent,signal:exec.signal,wait:{callId:exec.callId},questions:[{id:'plan',question:'Review plan',detail:'Synthetic plan',options:[{label:'Proceed'},{label:'Change'}],intent:{kind:'plan-review',approve:'Proceed',callId:exec.callId}}]})});
 class Model extends LlmAdapter{
  async listModels(provider){return [await this.resolveModel(provider,'fixture')];}
  async resolveModel(provider,id){return {provider,id,name:id,defaultMaxTokens:1024,context:{contextWindow:128000}};}
  async *stream(request){
   const start=request.messages.findLastIndex(m=>m.role==='user');
   const text=JSON.stringify(request.messages[start]);
   const results=request.messages.slice(start+1).filter(m=>m.role==='tool');
   const count=results.length;
   let block={type:'text',text:'browser-completed '+JSON.stringify(results)};
   let action;
   if(!count && text.includes('BROWSER_APPROVAL'))action=['fixture_approval',{}];
   else if(!count && text.includes('BROWSER_PLAN'))action=['fixture_plan',{}];
   else if(!count && text.includes('BROWSER_QUESTION'))action=['ask_user_question',{questions:[{id:'choice',question:'Choose',options:[{label:'Yes'},{label:'No'}]}],timeout:text.includes('TIMEOUT')?2:120}];
   else if(text.includes('BROWSER_SAVE'))action=[['write',{file_path:'/work/browser-result.txt',content:'Synthetic browser artifact'}],['enterprise_save',{requestId:'55555555-5555-4555-8555-555555555555',path:'/work/browser-result.txt',filename:'browser-result.txt'}]][count];
   else if(text.includes('BROWSER_READ')){
    const content=request.messages[start].content.filter(b=>b.type==='text').map(b=>b.text).join('\n');
    const refs=[...content.matchAll(/\{"materialId":"([^"]+)","versionId":"([^"]+)"\}/g)];
    const actions=refs.flatMap((r,i)=>[['enterprise_read',{materialId:r[1],versionId:r[2],path:'/work/input-'+i+'.txt'}],['read',{file_path:'/work/input-'+i+'.txt'}]]);
    action=actions[count];
   }
   if(JSON.stringify(request.messages).includes('BROWSER_CAPABILITIES'))block={type:'text',text:'CAPABILITIES:'+JSON.stringify(request.tools?.map(t=>t.name))};
   if(action)block={type:'tool-call',id:'browser-'+request.messages.length+'-'+count,name:action[0],arguments:JSON.stringify(action[1])};
   yield {type:'block-start',index:0,blockType:block.type};yield {type:'block-end',index:0,block};yield {type:'usage',usage:{inputTokens:100,outputTokens:20,cacheReadTokens:0,reasoningTokens:0}};yield {type:'finish',reason:{kind:action?'tool-calls':'stop'}};
  }
 }
 ctx.llm.registerAdapter(['synthetic'],new Model());
}
