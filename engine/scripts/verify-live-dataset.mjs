// Explicit opt-in diagnostic; API task/snapshot permissions remain enforced by the backend.
import {readFileSync,writeFileSync} from 'node:fs';
import {configuredModel} from '../dist/runtime/model-config.js';
import {runHarness} from '../dist/runtime/harness.js';
import {contextTool} from '../dist/runtime/task-context.js';
import {datasetComparisonTool} from '../dist/runtime/dataset-comparison.js';
import {briefingDeliveryTool,hasPreparedBriefing} from '../dist/runtime/briefing-delivery.js';
const cfg=JSON.parse(readFileSync(process.env.LIVE_MODEL_CONFIG,'utf8'));
const model=configuredModel({AGENT_MODEL_PROVIDER:cfg.provider,AGENT_MODEL_NAME:cfg.model,AGENT_MODEL_API_KEY:cfg.apiKey,AGENT_BAILIAN_WORKSPACE_ID:cfg.workspaceId}).createModel();
const base=process.env.LIVE_TASK_URL;
async function invoke(path,body={}) {
 const response=await fetch(`${base}/${path}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.LIVE_TASK_TOKEN}`},body:JSON.stringify(body)});
 if(!response.ok)throw Object.assign(new Error('backend rejected'),{code:`HTTP_${response.status}`});
 return response.json();
}
const authorize=async()=>{await invoke('check');};
const tools=[contextTool(invoke,authorize,true),datasetComparisonTool({authorize,invoke:(b)=>invoke('compare-dataset',b)}),briefingDeliveryTool({presentationAvailable:true,authorize,invoke:(b)=>invoke('deliver-briefing',b)})];
await invoke('execution/open',{contractVersion:'1.5',tools:tools.map(t=>t.name)});
let seq=0;
for(const tool of tools){const execute=tool.execute;tool.execute=async(...args)=>{const sequence=++seq;await invoke('execution/tool',{sequence,name:tool.name,status:'STARTED'});try{const r=await execute(...args);await invoke('execution/tool',{sequence,name:tool.name,status:'succeeded'});return r;}catch(e){await invoke('execution/tool',{sequence,name:tool.name,status:'failed'});throw e;}};}
const continuity=await invoke('context',{action:'bootstrap'});
const result=await runHarness({context:continuity,prompt:'分析获权销售数据：汇总全部支付记录按支付方式 method 分组的 amount_cents 金额，使用完整固定快照。原始单位为分，保持以分呈现金额，不把支付记录合计当成净营业收入；不同状态均计入，明确这一口径。创建一张有完整分析和范围说明的 DATA 画报。不要自行填写图表数值。',model,tools,limits:{modelCalls:8,toolCalls:8,timeoutMs:55000},finishOnDeliverable:true,hasCompletedDeliverable:hasPreparedBriefing,finalResponseReserveMs:10000});
writeFileSync(process.env.LIVE_RESULT_PATH,JSON.stringify(result),{mode:0o600});
console.log(JSON.stringify({status:result.status,modelCalls:result.modelCalls,tools:result.tools.map(t=>({name:t.name,status:t.status}))}));
if(result.status!=='completed'||!hasPreparedBriefing(result.tools))throw new Error(`LIVE_DATASET_FAILED:${result.code??result.status}`);
