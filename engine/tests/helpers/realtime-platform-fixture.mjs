// Synthetic HTTP model + actual engine/Harness. Used only by the isolated Java integration test.
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { AgentTasks } from '../../dist/runtime/agent-task.js';
import { ChatCompletionsModel } from '../../dist/runtime/chat-completions-model.js';
import { createEngineServer } from '../../dist/server.js';
const frame=(delta,finish=null)=>`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason:finish}]})}\n\n`;
const model=createServer(async(req,res)=>{
 let raw='';for await(const b of req)raw+=b;const input=JSON.parse(raw);
 const text=input.messages.filter(m=>m.role==='user').map(m=>m.content).join('\n');
 res.writeHead(200,{'content-type':'text/event-stream'});
 if(text.includes('QUESTION')&&!text.includes('ANSWER')) {
  const args=JSON.stringify({text:'请选择合成期间',options:['本期','上期'],blocking:true});
  res.write(frame({tool_calls:[{index:0,id:'q1',type:'function',function:{name:'ask_user',arguments:args}}]},'tool_calls'));
 }else if(text.includes('SUPPLEMENT')&&!input.messages.some(m=>m.role==='tool')){
  await delay(1200);res.write(frame({tool_calls:[{index:0,id:'s1',type:'function',function:{name:'search_sources',arguments:'{"query":"合成"}'}}]},'tool_calls'));
 }else{
  res.write(frame({role:'assistant',content:'合成实时开头。'}));
  await delay(text.includes('STOP')?5000:700);
  if(res.destroyed)return;
  res.write(frame({content:text.includes('途中合成')?'采用途中合成要求。':'合成最终结论。'},'stop'));
 }
 res.end('data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":3}}\n\ndata: [DONE]\n\n');
});
await new Promise(r=>model.listen(0,'127.0.0.1',r));
const agent=new AgentTasks({platformBaseUrl:process.argv[2],executionClass:'live',modelName:'synthetic',createModel:()=>new ChatCompletionsModel({endpoint:new URL(`http://127.0.0.1:${model.address().port}/`),model:'synthetic',apiKey:'synthetic-test-key',timeoutMs:8000,modeParameters:{}})});
const engine=createEngineServer({token:'synthetic-engine-token-0000000000000000',agent});
await new Promise(r=>engine.listen(0,'127.0.0.1',r));
console.log(`http://127.0.0.1:${engine.address().port}`);
