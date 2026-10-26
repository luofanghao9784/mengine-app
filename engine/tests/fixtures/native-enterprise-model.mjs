import {LlmAdapter} from '@deepseek-ai/dsh-llm';
export const name='native-enterprise-synthetic';export const inject=['llm'];
export function apply(ctx){
 class Model extends LlmAdapter {
  async resolveModel(provider,id){return {provider,id,name:id,defaultMaxTokens:1024,context:{contextWindow:128000}};}
  async *stream(request){
   const count=request.messages.filter(m=>m.role==='tool').length;
   const actions=[['enterprise_history',{}],['enterprise_search',{query:'native'}],['enterprise_read',{materialId:process.env.TEST_MATERIAL,versionId:process.env.TEST_VERSION,path:process.env.TEST_FILE}],['enterprise_save',{requestId:process.env.TEST_SAVE_ID,path:process.env.TEST_FILE,filename:'native-result.txt'}],['enterprise_save',{requestId:process.env.TEST_SAVE_ID,path:process.env.TEST_FILE,filename:'native-result.txt'}]];
   const action=actions[count];const block=action?{type:'tool-call',id:`enterprise-${count}`,name:action[0],arguments:JSON.stringify(action[1])}:{type:'text',text:'企业资料已读取，私人成果平台回执已保存；未自动发布。'};
   yield {type:'block-start',index:0,blockType:block.type};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:action?'tool-calls':'stop'}};
  }
 }
 ctx.llm.registerAdapter(['enterprise-test'],new Model());
}
