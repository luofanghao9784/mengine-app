import {LlmAdapter} from '@deepseek-ai/dsh-llm';
export const name='native-skills-fixture';export const inject=['llm'];
export function apply(ctx){class Model extends LlmAdapter {
 async resolveModel(provider,id){return {provider,id,name:id,defaultMaxTokens:1024,context:{contextWindow:128000}};}
 async *stream(request){
  const serialized=JSON.stringify(request.messages);const loaded=serialized.includes('Read evidence and cite sources.');
  const block=loaded?{type:'text',text:'PLATFORM_SKILL_LOADED'}:{type:'tool-call',id:'load-skill',name:'skill',arguments:JSON.stringify({name:'evidence-review'})};
  yield {type:'block-start',index:0,blockType:block.type};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:loaded?'stop':'tool-calls'}};
 }
}ctx.llm.registerAdapter(['skills-fixture'],new Model());}
