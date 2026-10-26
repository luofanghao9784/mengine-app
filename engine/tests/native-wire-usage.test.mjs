import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WireUsage} from '../dist/native/wire-usage.js';
const encode=events=>Buffer.from(events.map(e=>`data: ${typeof e==='string'?e:JSON.stringify(e)}\n\n`).join(''));
const observe=(protocol,events)=>{const meter=new WireUsage(protocol);for(const b of encode(events))meter.push(Uint8Array.of(b));return meter.finish();};
test('Messages accounting preserves disjoint cache usage across byte-split UTF-8 SSE',()=>{
 assert.deepEqual(observe('messages',[
 {type:'message_start',message:{usage:{input_tokens:10,output_tokens:0,cache_read_input_tokens:30,cache_creation_input_tokens:5}}},
 {type:'content_block_delta',delta:{text:'原生图文与工具消息不经过文本投影'}},
 {type:'message_delta',usage:{output_tokens:20}}, {type:'message_stop'}
 ]),{inputTokens:10,outputTokens:20,cacheReadTokens:30,cacheWriteTokens:5});
});
test('OpenAI cumulative prompt cache is subtracted, reasoning remains part of output',()=>{
 assert.deepEqual(observe('openai',[{choices:[],usage:{prompt_tokens:50,completion_tokens:20,prompt_tokens_details:{cached_tokens:30},completion_tokens_details:{reasoning_tokens:15}}},'[DONE]']),
 {inputTokens:20,outputTokens:20,cacheReadTokens:30,reasoningTokens:15});
});
test('missing, malformed, decreasing and interrupted usage never become a zero bill',()=>{
 for(const events of [[],['[DONE]'],[{usage:{prompt_tokens:1,completion_tokens:2}}],
 [{usage:{prompt_tokens:1,completion_tokens:2,prompt_tokens_details:{cached_tokens:3}}},'[DONE]'],
 [{usage:{prompt_tokens:1,completion_tokens:2}},{usage:{prompt_tokens:2,completion_tokens:2}},'[DONE]']])assert.equal(observe('openai',events),null);
 assert.equal(observe('messages',[{type:'message_start',message:{usage:{input_tokens:10,output_tokens:0}}},{type:'message_delta',usage:{input_tokens:1,output_tokens:20}},{type:'message_stop'}]),null);
 const meter=new WireUsage('openai');meter.push(Buffer.from('data: {"usage":{"prompt_tokens":1,"completion_tokens":2}}'));assert.equal(meter.finish(),null);
});
