import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { PresentationRenderer } from '../dist/runtime/presentation-renderer.js';
import { parseDeck } from '../dist/runtime/presentation-spec.js';
import { TrustedCatalog } from '../dist/runtime/catalog.js';
import { presentationFixture } from './fixtures/presentation.mjs';
test('real fixed renderer produces native Chinese slides, editable chart workbook, table and reproducible source', async () => {
  const input = presentationFixture(),
    files = await new PresentationRenderer().render(input, {}, new AbortController().signal);
  assert.deepEqual(
    files.map((f) => f.name),
    ['presentation.pptx', 'presentation-source.json'],
  );
  const zip = await JSZip.loadAsync(files[0].bytes);
  assert.equal(Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length, 6);
  assert.match(await zip.file('ppt/slides/slide3.xml').async('string'), /<a:tbl>/);
  assert.match(await zip.file('ppt/slides/slide4.xml').async('string'), /<c:chart/);
  assert.ok(Object.keys(zip.files).some((n) => n.endsWith('.xlsx')));
  assert.match(await zip.file('ppt/charts/chart1.xml').async('string'), />180</);
  assert.match(await zip.file('ppt/slides/slide1.xml').async('string'), /季度经营复盘/);
  const source = JSON.parse(Buffer.from(files[1].bytes));
  assert.deepEqual(source.slides, input.slides);
  assert.equal(source.renderer, 'pptxgenjs@4.0.1');
});
test('renderer rejects executable/path fields, oversize content, mismatched table/chart and cancellation', async () => {
  const renderer = new PresentationRenderer();
  const input = presentationFixture();
  for (const invalid of [
    { ...input, script: 'process.exit()' },
    { ...input, slides: [{ ...input.slides[0], image: 'file:///private/x' }] },
    { ...input, slides: [{ ...input.slides[2], rows: [['missing columns']] }] },
    { ...input, slides: [{ ...input.slides[3], values: [1] }] },
    { ...input, slides: [{ ...input.slides[1], bullets: ['x'.repeat(91)] }] },
    { ...input, slides: Array(9).fill(input.slides[0]) },
  ])
    assert.throws(() => parseDeck(invalid), { code: 'INVALID_PRESENTATION' });
  const controller = new AbortController();
  const running = renderer.render(input, {}, controller.signal);
  controller.abort();
  await assert.rejects(running, { code: 'CANCELLED' });
  await renderer.check();
});
test('PPT skill is only discoverable with both ready dependencies and the typed renderer permission', async () => {
  const tools = new Set(['render_presentation']);
  assert.deepEqual((await TrustedCatalog.load()).available(tools), []);
  const catalog = await TrustedCatalog.load(undefined, new Set(['artifact-transfer-v1', 'pptx-renderer-v1']));
  assert.equal(catalog.available(tools)[0].id, 'pptx-generator');
  assert.deepEqual(catalog.available(new Set()), []);
  assert.match(
    (await catalog.activate('pptx-generator', '1.0.0', tools)).instructions,
    /render_presentation/,
  );
});

import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools';
import { presentationSchema, presentationToolSchema } from '../dist/runtime/presentation-spec.js';
import { readFile } from 'node:fs/promises';
test('Harness receives its supported schema subset while documented limits remain enforced before execution', async () => {
  assert.doesNotThrow(() => assertObjectJsonSchema(presentationToolSchema));
  const spec = JSON.parse(
    await readFile(new URL('../../contracts/engine-api/presentation.schema.json', import.meta.url), 'utf8'),
  );
  const { $schema, $id, ...documented } = spec;
  assert.deepEqual(documented, presentationSchema);
  assert.throws(() => parseDeck({ ...presentationFixture(), title: 'x'.repeat(49) }), {
    code: 'INVALID_PRESENTATION',
  });
});

import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {AgentTasks} from '../dist/runtime/agent-task.js';
import {listen,close,body,json} from './fixtures/agent.mjs';
import {usageFixture} from './fixtures/usage.mjs';
test('task denies unactivated skill and invented source before renderer or upload',async(t)=>{
 let renderCalls=0,uploadCalls=0,step=0,scenario='unactivated';
 const server=createServer(async(req,res)=>{
  await body(req);if(usageFixture(req,res))return;
  if(req.url.endsWith('/check'))return json(res,{allowed:true,executionClass:'live',artifactTransferVersion:'1.0',presentationRendererVersion:'1.0',presentationWorkflow:{version:'1.0',state:'NONE'}});
  if(req.url.endsWith('/execution/open'))return json(res,{accepted:true,policy:'READ_ONLY_PRIVATE_V1'});
  if(req.url.includes('/artifacts/'))uploadCalls++;
  return json(res,{accepted:true});
 });const url=await listen(server);t.after(()=>close(server));
 const agent=new AgentTasks({platformBaseUrl:url,executionClass:'live',modelName:'synthetic',presentationRenderer:{async render(){renderCalls++;throw new Error('must not run')}},createModel:()=>({async *generate(){
  const activate=scenario==='unknown-source'&&step===0;
  if(step++ < (scenario==='unknown-source'?2:1)){
   const spec=presentationFixture([randomUUID()]);yield {type:'tool_call',id:`call-${step}`,name:activate?'activate_skill':'render_presentation',arguments:JSON.stringify(activate?{id:'pptx-generator',version:'1.0.0'}:spec)};yield {type:'finish',reason:'tool_calls'};
  }else{yield {type:'text',text:'工具未完成。'};yield {type:'finish',reason:'stop'};}
 }})});t.after(()=>agent.stop());
 for(scenario of ['unactivated','unknown-source']){
  step=0;const result=await agent.run({contractVersion:'1.5',taskId:randomUUID(),attemptId:randomUUID(),prompt:'合成PPT权限负例'},new AbortController().signal);assert.equal(result.outcome,'PARTIAL');assert.deepEqual(result.artifacts,[]);
 }
 assert.equal(renderCalls,0);assert.equal(uploadCalls,0);
});
test('PPT refuses a platform that advertises rendering without the confirmation protocol',async(t)=>{
 let calls=0;
 const server=createServer(async(req,res)=>{await body(req);if(usageFixture(req,res))return;return json(res,{allowed:true,executionClass:'live',artifactTransferVersion:'1.0',presentationRendererVersion:'1.0'});});
 const url=await listen(server);t.after(()=>close(server));
 const agent=new AgentTasks({platformBaseUrl:url,executionClass:'live',modelName:'synthetic',presentationRenderer:{async render(){calls++;throw new Error('must not run')}},createModel:()=>({async *generate(){calls++;throw new Error('must not run')}})});t.after(()=>agent.stop());
 await assert.rejects(agent.run({contractVersion:'1.5',taskId:randomUUID(),attemptId:randomUUID(),prompt:'PPT'},new AbortController().signal),{code:'TASK_ACCESS_DENIED'});assert.equal(calls,0);
});
