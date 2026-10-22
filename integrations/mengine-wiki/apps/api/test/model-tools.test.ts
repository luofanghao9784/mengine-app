import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Model } from '../src/model.js';
import { harnessTools } from '../src/harness.js';
test('DeepSeek 普通回复和工具回放使用非思考协议且状态不暴露密钥',async()=>{
 const original=globalThis.fetch,model=new Model({provider:'deepseek',apiKey:'synthetic-secret',baseUrl:'https://api.deepseek.com',model:'deepseek-flash'});
 let calls=0;
 try{globalThis.fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body));assert.deepEqual(body.thinking,{type:'disabled'});assert.equal(body.enable_thinking,undefined);calls++;return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'连接正常'}}]}));};
 await model.complete('测试','连接检查');
 await model.toolTurn([{role:'tool',tool_call_id:'previous',content:'测试结果'}],harnessTools,AbortSignal.timeout(1000));
 assert.equal(calls,2);assert.equal(model.status().provider,'DeepSeek');assert.ok(!JSON.stringify(model.status()).includes('synthetic-secret'));
 }finally{globalThis.fetch=original;}
});
test('百炼原生工具协议透传 schema、tool_calls 与工具结果', async()=>{
 const original=globalThis.fetch,model=new Model({apiKey:'test-placeholder',baseUrl:'https://example.test/v1',model:'qwen-test'});
 try{globalThis.fetch=async(_input,init)=>{const payload=JSON.parse(String(init?.body));assert.equal(payload.tool_choice,'auto');assert.equal(payload.parallel_tool_calls,false);assert.equal(payload.tools[0].function.name,'search_documents');assert.equal(payload.messages[0].role,'tool');return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'call-1',type:'function',function:{name:'search_documents',arguments:'{"query":"权限"}'}}]}}]}));};
 const result=await model.toolTurn([{role:'tool',tool_call_id:'previous',content:'证据'}],harnessTools,AbortSignal.timeout(1000));assert.equal(result.tool_calls?.[0].function.name,'search_documents');
 globalThis.fetch=async()=>new Response('{}',{status:503});await assert.rejects(model.toolTurn([],harnessTools,AbortSignal.timeout(1000)),(e:any)=>e.retryable===true);
 globalThis.fetch=async()=>new Response('{}',{status:403});await assert.rejects(model.toolTurn([],harnessTools,AbortSignal.timeout(1000)),(e:any)=>e.retryable===false);
 globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{message:{tool_calls:[{id:'bad'}]}}]}));await assert.rejects(model.toolTurn([],harnessTools,AbortSignal.timeout(1000)),/格式无效/);
 }finally{globalThis.fetch=original;}
});
test('模型适配器传递强制工具选择，普通后续调用仍默认自动选择',async()=>{
 const original=globalThis.fetch,model=new Model({apiKey:'test',baseUrl:'https://example.test/v1',model:'test'}),choices:string[]=[];
 try{globalThis.fetch=async(_url,init)=>{choices.push(JSON.parse(String(init?.body)).tool_choice);return new Response(JSON.stringify({choices:[{message:{content:'测试'}}]}));};
 await model.toolTurn([],harnessTools,AbortSignal.timeout(1000),'required');
 await model.toolTurn([],harnessTools,AbortSignal.timeout(1000));assert.deepEqual(choices,['required','auto']);
 }finally{globalThis.fetch=original;}
});
