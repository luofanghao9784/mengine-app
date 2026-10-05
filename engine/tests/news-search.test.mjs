import test from 'node:test';import assert from 'node:assert/strict';
import {BingNewsSearch,newsSearchScope} from '../dist/runtime/news-search.js';
import {PublicReader,PublicWebTask} from '../dist/runtime/public-web.js';
const signal=()=>new AbortController().signal;const date=new Date(Date.now()-86400000).toISOString();
const scope={version:'1.0',topics:[{id:'FITNESS',label:'健身',query:'健身 体育 政策'},{id:'BUSINESS',label:'经营',query:'企业 政策'},{id:'RETAIL',label:'零售',query:'零售 消费'}],sources:[]};
function fixture(){const calls=[];const reader=new PublicReader(async()=>[{address:'8.8.8.8',family:4}],async u=>{calls.push(u.href);return {status:200,headers:{'content-type':u.hostname==='www.bing.com'?'application/xml':'text/html'},bytes:Buffer.from(u.hostname==='www.bing.com'?`<rss><channel><item><title>近期行业资讯</title><link>http://www.bing.com/news/apiclick.aspx?ref=RSS&amp;url=https%3A%2F%2Fpublisher.example.org%2Fa</link><pubDate>${date}</pubDate><description>只读搜索摘要</description></item><item><title>不可读取私网</title><link>http://www.bing.com/news/apiclick.aspx?url=https%3A%2F%2F127.0.0.1%2F</link></item></channel></rss>`:`<title>近期行业资讯</title><meta property="article:published_time" content="${date}"><p>这是足够长的合成原文，行业政策发布后会影响相关经营安排。这里的正文仅为隔离测试，不是真实新闻，不产生客户画报。</p>`)}});return{reader,calls};}
test('RSS topic search unwraps original URLs and excludes private addresses',async()=>{const {reader,calls}=fixture();const found=await new BingNewsSearch(reader).search(scope.topics[0].query,signal());assert.equal(found.length,1);assert.equal(found[0].url,'https://publisher.example.org/a');assert.equal(found[0].publishedAt,date);assert.equal(new URL(calls[0]).searchParams.get('q'),scope.topics[0].query);});
test('topic selection sends only granted fixed phrase, reads original and caches repeated search',async()=>{const {reader,calls}=fixture();const task=new PublicWebTask('news:topic-search:v1',reader,new BingNewsSearch(reader),true,[],scope);await assert.rejects(task.find(signal(),'私有营收'),/NEWS_TOPIC_NOT_GRANTED/);const rows=await task.find(signal(),'FITNESS');assert.equal(rows[0].kind,'PAGE');await task.find(signal(),'FITNESS');assert.equal(calls.length,2);assert.equal((await task.read(rows[0].id,signal())).publishedAt,date);await task.find(signal(),'BUSINESS');await assert.rejects(task.find(signal(),'RETAIL'),/NEWS_SEARCH_LIMIT/);assert.ok(!calls.join('').includes('私有营收'));});
test('delivered articles dedupe after body reads, not search snippets',async()=>{const {reader}=fixture();const first=await new PublicWebTask('news:topic-search:v1',reader,new BingNewsSearch(reader),true,[],scope).find(signal(),'FITNESS');const seen=first.map(({url,sha256})=>({url,sha256}));assert.equal((await new PublicWebTask('news:topic-search:v1',reader,new BingNewsSearch(reader),true,seen,scope).find(signal(),'FITNESS')).length,0);});
test('search prerequisite remains explicit even when a supplemental site exists',async()=>{const {reader}=fixture();const task=new PublicWebTask('news:topic-search:v1',reader,undefined,true,[],{...scope,sources:['https://publisher.example.org/list']});await assert.rejects(task.find(signal(),'FITNESS'),/PUBLIC_SEARCH_NOT_CONFIGURED/);assert.equal(newsSearchScope({...scope,topics:[{id:'PRIVATE',label:'隐私',query:'abc\ncredential'}]}),undefined);});
test('actual Harness records granted topic before any outbound query and reads source handles',async t=>{
 const {createServer}=await import('node:http');const {randomUUID}=await import('node:crypto');const {AgentTasks}=await import('../dist/runtime/agent-task.js');const {listen,close,json}=await import('./fixtures/agent.mjs');const {usageFixture}=await import('./fixtures/usage.mjs');
 let selected=false;const server=createServer(async(req,res)=>{if(usageFixture(req,res))return;if(req.url.endsWith('/select-news-query')){let data='';for await(const chunk of req)data+=chunk;assert.deepEqual(JSON.parse(data),{topic:'FITNESS'});selected=true;return json(res,scope.topics[0]);}json(res,{allowed:true,executionClass:'verification',publicQuery:'news:topic-search:v1',briefingGeneration:true,newsSearch:scope});});const endpoint=await listen(server);t.after(()=>close(server));
 const {reader,calls}=fixture();const search=new BingNewsSearch(reader);let step=0;
 const agent=new AgentTasks({platformBaseUrl:endpoint,executionClass:'verification',modelName:'synthetic',publicWeb:{reader,search:{search:(q,s)=>{assert.ok(selected);return search.search(q,s);}}},createModel:()=>({async *generate(req){step++;let name,args;if(step===1){name='activate_skill';args={id:'public-research',version:'1.0.0'};}else if(step===2){name='public_search';args={topic:'FITNESS'};assert.deepEqual(req.tools.find(t=>t.name===name).parameters.required,['topic']);}else if(step===3){const last=req.messages.flatMap(m=>m.content).filter(b=>b.type==='tool_result').at(-1);const result=JSON.parse(JSON.parse(last.content)[0].text);assert.ok(result.items.length);name='read_public_page';args={id:result.items[0].id};}else{yield{type:'text',text:'合成联网资讯链路已验证，未调用真实模型。'};yield{type:'finish',reason:'stop'};return;}yield{type:'tool_call',id:'step'+step,name,arguments:JSON.stringify(args)};yield{type:'finish',reason:'tool_calls'};}})});t.after(()=>agent.stop());
 const result=await agent.run({contractVersion:'1.4',taskId:randomUUID(),attemptId:randomUUID(),prompt:'PRIVATE_COMPANY 内部营收 123456789'},signal());assert.equal(result.tools.filter(x=>x.name==='activate_skill').length,1);assert.equal(result.webSources[0].kind,'PAGE');assert.equal(result.tools.find(x=>x.name==='public_search').status,'succeeded');assert.ok(!calls.join('').includes('123456789'));
});
test('explicit proxy pins CONNECT to the checked IP and never accepts a remote proxy or private DNS answer',async t=>{
 const {loopbackProxyRequest}=await import('../dist/runtime/public-web.js');const {publicDnsResolver}=await import('../dist/runtime/public-routing.js');const {createServer}=await import('node:http');const {listen,close}=await import('./fixtures/agent.mjs');
 assert.throws(()=>loopbackProxyRequest('http://remote.example.org:8080'),/INVALID_PUBLIC_PROXY/);assert.throws(()=>loopbackProxyRequest('http://user:secret@127.0.0.1:7897'),/INVALID_PUBLIC_PROXY/);
 const server=createServer();let target='';server.on('connect',(req,socket)=>{target=req.url;socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');});const url=await listen(server);t.after(()=>close(server));
 await assert.rejects(loopbackProxyRequest(url)(new URL('https://publisher.example.org'),{address:'8.8.8.8',family:4},signal()),/PUBLIC_PROXY_FAILED/);assert.equal(target,'8.8.8.8:443');
 const bootstrap={fetch:async()=>({response:{headers:{'content-type':'application/json'},bytes:Buffer.from(JSON.stringify({Status:0,Question:[{name:'publisher.example.org.'}],Answer:[{type:1,data:'127.0.0.1'}]}))}})};
 await assert.rejects(publicDnsResolver(bootstrap)('publisher.example.org',signal()),/PUBLIC_ADDRESS_DENIED/);
});

for (const [earlyWait,work,invalid] of [[false,false,false],[true,false,false],[false,true,false],[false,true,true]]) test(`INFO verified delivery wait=${earlyWait} scopedWork=${work} invalidDelivery=${invalid}`,async t=>{
 const {createServer}=await import('node:http');const {randomUUID}=await import('node:crypto');const {AgentTasks}=await import('../dist/runtime/agent-task.js');const {listen,close,json,body}=await import('./fixtures/agent.mjs');const {usageFixture}=await import('./fixtures/usage.mjs');
 const contexts=[],receipts=[];let selected=false,step=0;const artifactId=randomUUID();
 const server=createServer(async(req,res)=>{
  if(usageFixture(req,res))return;const input=await body(req);
  if(req.url.endsWith('/check'))return json(res,{allowed:true,executionClass:'verification',publicQuery:'news:topic-search:v1',briefingGeneration:true,briefingRequestedType:'INFO',briefingContentVersion:'1.0',contextVersion:'1.0',topicStrategyVersion:'1.0',topicSelectionRecorded:selected,newsSearch:scope,...(work?{taskWorkVersion:'1.0'}:{})});
  if(req.url.endsWith('/context')){contexts.push(input);return json(res,{contractVersion:'1.0',action:input.action,referenceOnly:true,result:input.action==='bootstrap'?{}:{items:[{value:input.scope==='TENANT'?'PRIVATE_COMPANY 健身经营 123456789':'关注运动安全',authority:false}],hasMore:false}});}
  if(req.url.endsWith('/execution/open'))return json(res,{accepted:true,policy:work?'SCOPED_PRIVATE_V2':'READ_ONLY_PRIVATE_V1'});
  if(req.url.endsWith('/execution/tool')){receipts.push(input);return json(res,{accepted:true});}
  if(req.url.endsWith('/select-news-query'))return json(res,scope.topics[0]);
  if(req.url.endsWith('/select-briefing-topic')){selected=true;return json(res,{recorded:true,proposalOnly:true,selectedIndex:0,strategyVersion:'1.0.0'});}
  if(req.url.endsWith('/deliver-briefing')){assert.equal(input.businessType,'INFO');return json(res,{contractVersion:'1.0',status:'PREPARED',artifactId,title:input.title,visibility:'PRIVATE_AFTER_TASK_SUCCEEDS'});}
  json(res,{},404);
 });const endpoint=await listen(server);t.after(()=>close(server));const {reader,calls}=fixture();let source;
 const agent=new AgentTasks({platformBaseUrl:endpoint,executionClass:'verification',modelName:'synthetic-info',publicWeb:{reader,search:new BingNewsSearch(reader)},createModel:()=>({usage:null,async *generate(req){
  step++;assert.ok(!req.tools.some(x=>['task_context','find_skills','activate_skill','search_sources','compare_dataset'].includes(x.name)));
  let name,args;
  if(earlyWait && step===1){yield{type:'tool_call',id:'early-wait',name:'task_control',arguments:JSON.stringify({outcome:'WAITING_CAPABILITY',message:'合成早期能力判断，后续实际执行已成功。'})};yield{type:'finish',reason:'tool_calls'};return;}
  const phase=step-(earlyWait?1:0);
  if(phase===1){assert.equal(req.requiredTool,'public_search');assert.deepEqual(contexts.filter(x=>x.action==='profiles').map(x=>x.scope),['TENANT','WORKSPACE','PERSONAL']);assert.match(JSON.stringify(req.messages),/PRIVATE_COMPANY/);assert.ok(req.tools.some(x=>x.name==='public_search'));name='public_search';args={topic:'FITNESS'};}
  else if(phase===2){assert.equal(req.requiredTool,'read_public_page');const last=req.messages.flatMap(m=>m.content).filter(b=>b.type==='tool_result').at(-1);source=JSON.parse(JSON.parse(last.content)[0].text).items[0].id;assert.ok(!req.tools.some(x=>['public_search','deliver_briefing','select_briefing_topic'].includes(x.name)));name='read_public_page';args={id:source};}
  else if(phase===3){assert.equal(req.requiredTool,'select_briefing_topic');name='select_briefing_topic';args={candidates:[{question:'新政策影响哪些健身安排',evidenceNeeded:'已读取的政策原文',requiresCalculation:false,difference:'新增政策',businessType:'INFO'}],selectedIndex:0};}
  else {assert.equal(req.requiredTool,'deliver_briefing');assert.ok(phase===4 || invalid && phase===5);name='deliver_briefing';args={businessType:'INFO',title:'健身行业新政策',summary:'合成资讯验收摘要',analysis:invalid && phase===4?'合成原文支持相关经营安排。':['合成原文支持相关经营安排。']};if(phase===5)assert.match(JSON.stringify(req.messages),/analysis.*array/);}
  yield{type:'tool_call',id:'info'+step,name,arguments:JSON.stringify(args)};yield{type:'finish',reason:'tool_calls'};
 }})});t.after(()=>agent.stop());const result=await agent.run({contractVersion:'1.5',taskId:randomUUID(),attemptId:randomUUID(),prompt:'合成资讯生成'},signal());
 assert.equal(step,4+(earlyWait?1:0)+(invalid?1:0));if(invalid)assert.equal(receipts.filter(x=>x.status==='failed' && x.name==='deliver_briefing').length,1);assert.equal(result.outcome,'COMPLETE');assert.equal(result.requiredInput,null);assert.deepEqual(receipts.filter(x=>x.status==='succeeded').map(x=>x.name),['activate_skill',...(earlyWait?['task_control']:[]),'public_search','read_public_page','select_briefing_topic','deliver_briefing']);assert.equal(result.webSources.length,1);assert.ok(!calls.join('').includes('123456789'));
});

test('news summaries use fixed scopes, reject malformed grants and retain narrow tool phases',async()=>{
 const {newsBriefingBackground,newsBriefingToolAllowed}=await import('../dist/runtime/news-briefing-flow.js');let calls=0;
 await assert.rejects(newsBriefingBackground(async()=>{calls++;return {contractVersion:'1.0',action:'profiles',referenceOnly:false,result:{items:[]}};}),/INVALID_CONTEXT_RESPONSE/);assert.equal(calls,1);
 for(const stage of [[false,false],[true,false],[true,true]])for(const tool of ['task_context','find_skills','activate_skill','dataset_read','compare_dataset'])assert.equal(newsBriefingToolAllowed(tool,...stage),false);
 assert.equal(newsBriefingToolAllowed('deliver_briefing',false,false),false);assert.equal(newsBriefingToolAllowed('deliver_briefing',true,false),false);assert.equal(newsBriefingToolAllowed('task_control',false,false),true);
});

test('article image is bounded, privately pinned, optional and excluded from ordinary reads',async()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');let images=0;
 const reader=new PublicReader(async host=>[{address:host==='private.example.org'?'127.0.0.1':'8.8.8.8',family:4}],async u=>{if(u.pathname.endsWith('.png')){images++;return{status:200,headers:{'content-type':'image/png'},bytes:png};}return{status:200,headers:{'content-type':'text/html'},bytes:Buffer.from(`<title>政策原文</title><article><img alt="运动场" src="https://${u.pathname==='/private'?'private':'publisher'}.example.org/photo.png"></article><p>足够长的公开文章原文，仅为测试图片来源安全与文本读取独立性。</p>`)}});
 assert.equal((await reader.read('https://publisher.example.org/article',signal())).image,undefined);assert.equal(images,0);
 const page=await reader.read('https://publisher.example.org/article',signal(),true);assert.equal(page.image.base64,png.toString('base64'));
 assert.equal((await reader.read('https://publisher.example.org/private',signal(),true)).image,undefined);assert.equal(images,1);
});

test('cover extraction ignores share logos, avatars and filename-only promotion images',async()=>{
 const {articleImage}=await import('../dist/runtime/news-discovery.js');
 assert.equal(articleImage('<meta property="og:image" content="https://cdn.example.org/logo.png"><div class="author-avatar"><img src="https://cdn.example.org/avatar.png"></div>','https://publisher.example.org'),undefined);
 assert.equal(articleImage('<article><img alt="1.jpg" src="https://cdn.example.org/promo.png"></article><div class="media-wrap"><img alt="运动赛事现场" src="https://cdn.example.org/event.png"></div>','https://publisher.example.org'),'https://cdn.example.org/event.png');
});
