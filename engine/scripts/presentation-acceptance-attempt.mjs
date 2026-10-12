// Called only by the explicit isolated acceptance runner. Stdout is one result; never log supplier errors.
import {readFile} from 'node:fs/promises';
import {AgentTasks} from '../dist/runtime/agent-task.js';
import {PresentationRenderer} from '../dist/runtime/presentation-renderer.js';
import {configuredModel} from '../dist/runtime/model-config.js';
import {presentationFixture} from '../tests/fixtures/presentation.mjs';
const [mode,inputFile] = process.argv.slice(2);
let agent;
try {
  if (!['synthetic','live'].includes(mode)) throw new Error();
  const input=JSON.parse(await readFile(inputFile,'utf8'));
  const url=new URL(input.platformBaseUrl);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1') throw new Error();
  const renderer=new PresentationRenderer();await renderer.check();
  let config;
  if(mode==='live') {config=configuredModel(process.env);if(!config)throw new Error();}
  else config={modelName:'synthetic-ppt-acceptance',createModel:()=>{
    let step=0;const spec=presentationFixture(input.sourceId?[input.sourceId]:[]);
    spec.theme=input.theme;spec.slides=spec.slides.slice(0,input.pages);
    while(spec.slides.length<input.pages)spec.slides.push({kind:'bullets',title:`后续安排 ${spec.slides.length+1}`,bullets:['此页为合成验收内容。'],sourceIds:[]});
    const calls=[['activate_skill',{id:'pptx-generator',version:'1.0.0'}],...(input.sourceId?[['search_sources',{query:'营收'}]]:[]),['render_presentation',spec]];
    return {async *generate(request){if(step<calls.length){const [name,args]=calls[step++];yield {type:'tool_call',id:`acceptance-${step}`,name,arguments:JSON.stringify(name === 'render_presentation' && Object.keys(request.tools.find(t => t.name === name)?.parameters.properties ?? {}).length === 0 ? {} : args)};yield {type:'finish',reason:'tool_calls'};}else{yield {type:'text',text:'合成模型验收回执。'};yield {type:'finish',reason:'stop'};}}};
  }};
  agent=new AgentTasks({platformBaseUrl:input.platformBaseUrl,executionClass:'live',modelName:config.modelName,createModel:config.createModel,presentationRenderer:renderer});
  const result=await agent.run({contractVersion:'1.5',taskId:input.taskId,attemptId:input.attemptId,prompt:input.prompt},AbortSignal.timeout(60000));
  process.stdout.write(JSON.stringify(result));
} catch {process.exitCode=1;} finally {agent?.stop();}
