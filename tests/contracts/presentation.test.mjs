import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';import Ajv from 'ajv/dist/2020.js';
const schema=JSON.parse(await readFile(new URL('../../contracts/engine-api/presentation.schema.json',import.meta.url),'utf8'));const check=new Ajv({strict:false,formats:{uuid:true}}).compile(schema);
test('presentation schema accepts Chinese and Latin text but rejects controls, arbitrary code and large payloads',()=>{
 const input={title:'Quarter 1 经营分析',theme:'ocean',slides:[{kind:'cover',title:'Q1 Operations',sourceIds:[]}]};assert.ok(check(input),JSON.stringify(check.errors));
 for(const patch of [{title:'line\nbreak'},{title:'zero\0'},{title:'x'.repeat(49)},{script:'fetch("https://example.com")'},{slides:Array(9).fill(input.slides[0])}])assert.equal(check({...input,...patch}),false);
});
const api=JSON.parse(await readFile(new URL('../../contracts/public-api/conversation.openapi.json',import.meta.url),'utf8'));
const ajv=new Ajv({strict:false,formats:{uuid:true}});
test('PPT request and confirmation contracts bound pages, indices and titles and reject content injection',()=>{
 const send=ajv.compile(api.components.schemas.Send),confirm=ajv.compile(api.components.schemas.PresentationConfirmation);
 const id='00000000-0000-4000-8000-000000000001';const request={requestId:id,workspaceId:id,prompt:'主题',mode:'AGENT',presentation:{pages:6,theme:'ink'}};
 assert.ok(send(request));assert.equal(send({...request,presentation:{pages:9,theme:'ink'}}),false);
 const body={requestId:id,expectedRevision:2,draftRevision:1,title:'确认稿',theme:'ocean',slides:[{index:0,title:'第一页'}]};
 assert.ok(confirm(body));assert.equal(confirm({...body,slides:[{index:0,title:'第一页',sourceIds:[id]}]}),false);assert.equal(confirm({...body,draftRevision:0}),false);assert.equal(confirm({...body,title:'x\ny'}),false);
});
