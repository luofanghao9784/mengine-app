// Synthetic model only. This plugin is never loaded by the product runtime.
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { LongTaskBudget } from '../../dist/native/budget.js';
import { withBudget } from '../../dist/native/budget-adapter.js';
export const name = 'dreamcore-native-test-model';
export const inject = ['llm'];
export function apply(ctx) {
  const ledger = new LongTaskBudget(process.env.DH_TEST_LEDGER);
  ctx.on('dispose', () => ledger.close());
  class Synthetic extends LlmAdapter {
    async listModels(provider) { return [await this.resolveModel(provider, "fixture")]; }
    async resolveModel(provider, model) { return { provider, id:model, name:model, defaultMaxTokens:1024, context:{contextWindow:128000} }; }
    async *stream(request) {
      const users = request.messages.filter(m=>m.role==='user');
      const text = JSON.stringify(users);
      const tools = request.messages.filter(m=>m.role==='tool');
      // Exercise native tool protocol beyond the legacy eight-call ceiling.
      const count = tools.length;
      const reading = text.includes('NATIVE_READ') && count < 10;
      const spawnChild = text.includes('NATIVE_CHILD') && !request.messages.some(m=>m.content?.some(b=>b.type==='tool-call' && b.name==='subagent'));
      const shell = text.includes('NATIVE_SHELL') && !request.messages.some(m=>m.content?.some(b=>b.type==='tool-call' && b.name==='bash'));
      const enterpriseActions=[
        ['enterprise_search',{query:'合成'}],
        ['write',{file_path:'/work/enterprise-draft.txt',content:'合成资料整理草稿。仅用于企业链路验收。'}],
        ['enterprise_save',{requestId:'55555555-5555-4555-8555-555555555555',path:'/work/enterprise-draft.txt',filename:'enterprise-draft.txt'}],
      ];
      const enterprise=text.includes('ENTERPRISE_WEB') && count<enterpriseActions.length;
      const block = enterprise
        ? {type:'tool-call',id:`enterprise-${count}`,name:enterpriseActions[count][0],arguments:JSON.stringify(enterpriseActions[count][1])}
        : shell
        ? {type:'tool-call',id:'fixture-shell',name:'bash',arguments:JSON.stringify({description:'Run isolated synthetic shell acceptance',command:process.env.DH_TEST_SHELL_COMMAND || "printf 'native-shell-ok'"})}
        : spawnChild
        ? {type:'tool-call',id:'fixture-child',name:'subagent',arguments:JSON.stringify({description:'Synthetic child budget proof',prompt:'CHILD_FIXTURE: return a synthetic result.'})}
        : reading
        ? {type:'tool-call',id:`fixture-read-${count}`,name:'read',arguments:JSON.stringify({file_path:process.env.DH_TEST_FILE})}
        : {type:'text',text:`synthetic-ok history=${text.includes('NATIVE_READ')} tools=${count}`};
      if (reading && !request.tools?.some(t=>t.name==='read')) throw Error('Native read tool missing');
      yield {type:'block-start',index:0,blockType:block.type};
      yield {type:'block-end',index:0,block};
      yield {type:'usage',usage:{inputTokens:100,outputTokens:20,cacheReadTokens:10,reasoningTokens:0}};
      yield {type:'finish',reason:{kind:enterprise || reading || spawnChild || shell?'tool-calls':'stop'}};
    }
  }
  ctx.llm.registerAdapter(['synthetic'], withBudget(new Synthetic(), {
    ledger, resolve: () => ({ scope:{tenant:'synthetic',user:'synthetic',task:'persistent-root'},
      route:{price:{version:'synthetic-not-a-provider-price',input:1000000,output:1000000,cacheRead:1000000,cacheWrite:1000000,reasoningIncluded:true},maxInputTokens:128000,maxOutputTokens:8192} }),
  }));
}
