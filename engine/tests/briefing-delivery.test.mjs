import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { briefingDeliveryTool, hasPreparedBriefing, hasTerminalBriefing, normalizeBriefingArguments } from '../dist/runtime/briefing-delivery.js';
import { AgentTasks } from '../dist/runtime/agent-task.js';
import { runHarness } from '../dist/runtime/harness.js';
import { listen, close, body, json } from './fixtures/agent.mjs';
import { usageFixture } from './fixtures/usage.mjs';
test('a model claim or malformed envelope is not a real prepared briefing', async () => {
  const tool = briefingDeliveryTool({
    authorize: async () => {},
    invoke: async () => ({ status: 'SUCCESS', text: '已经生成图表' }),
  });
  await assert.rejects(tool.execute({}, new AbortController().signal), { code: 'BRIEFING_RECEIPT_INVALID' });
});
test('native generation concludes on the verified receipt without another model call', async (t) => {
  const realNow = performance.now.bind(performance);
  let elapsed = 0;
  t.mock.method(performance, 'now', () => realNow() + elapsed);
  let calls = 0,
    delivered = 0;
  const receipts = [],
    artifactId = randomUUID(),
    calc = randomUUID();
  const platform = createServer(async (req, res) => {
    if (usageFixture(req, res)) return;
    const input = await body(req);
    if (req.url.endsWith('/check'))
      return json(res, {
        allowed: true,
        executionClass: 'live',
        briefingContentVersion: '1.0',
        briefingGeneration: true,
      });
    if (req.url.endsWith('/execution/open')) {
      assert.ok(input.tools.includes('deliver_briefing'));
      return json(res, { accepted: true, policy: 'READ_ONLY_PRIVATE_V1' });
    }
    if (req.url.endsWith('/execution/tool')) {
      receipts.push(input);
      return json(res, { accepted: true });
    }
    if (req.url.endsWith('/deliver-briefing')) {
      delivered++;
      elapsed = 1000;
      assert.equal(input.calculationArtifactId, calc);
      return json(res, {
        contractVersion: '1.0',
        status: 'PREPARED',
        artifactId,
        title: input.title,
        visibility: 'PRIVATE_AFTER_TASK_SUCCEEDS',
      });
    }
    json(res, {}, 404);
  });
  const url = await listen(platform);
  t.after(() => close(platform));
  const agent = new AgentTasks({
    platformBaseUrl: url,
    executionClass: 'live',
    modelName: 'synthetic-briefing',
    createModel: () => ({
      usage: null,
      async *generate(r) {
        calls++;
        if (calls === 1) {
          yield {
            type: 'tool_call',
            id: 'brief',
            name: 'deliver_briefing',
            arguments: JSON.stringify({
              calculationArtifactId: calc,
              title: '合成经营分析画报',
              summary: '本次分析仅用于验证画报生成链路。',
              analysis: ['金额由实际计算回执提供给画报工具。', '画报默认只对本次会话的本人可见。'],
            }),
          };
          yield { type: 'finish', reason: 'tool_calls' };
        } else {
          assert.ok(JSON.stringify(r.messages).includes('PREPARED'));
          assert.equal(r.tools.length, 0);
          assert.match(r.messages[0].content[0].text, /verified a terminal delivery receipt/);
          yield { type: 'text', text: '画报已生成，可在智能画报查看。' };
          yield { type: 'finish', reason: 'stop' };
        }
      },
    }),
  });
  const r = await agent.run(
    { contractVersion: '1.5', taskId: randomUUID(), attemptId: randomUUID(), prompt: '生成合成画报' },
    new AbortController().signal,
  );
  assert.equal(r.outcome, 'COMPLETE');
  assert.equal(delivered, 1);
  assert.deepEqual(
    receipts.map((x) => x.status),
    ['STARTED', 'succeeded'],
  );
  assert.equal(calls, 1);
  assert.equal(r.text, '画报已生成，可在智能画报查看。');
});

test('a claim, failed tool, or unfinished post-delivery tool cannot release a partial result', () => {
  const valid = {
    name: 'deliver_briefing',
    status: 'succeeded',
    output: {
      contractVersion: '1.0',
      status: 'PREPARED',
      artifactId: randomUUID(),
      visibility: 'PRIVATE_AFTER_TASK_SUCCEEDS',
    },
  };
  assert.equal(hasPreparedBriefing([valid]), true);
  for (const tools of [
    [],
    [{ ...valid, output: { text: '已经生成' } }],
    [{ ...valid, status: 'failed' }],
    [{ name: 'search_sources', status: 'failed' }, valid],
    [valid, { name: 'search_sources', status: 'succeeded' }],
  ])
    assert.equal(hasPreparedBriefing(tools), false);
});

test('verified duplicate receipt completes without pretending to save a new card', async () => {
  const receipt = { contractVersion: '1.0', status: 'NO_NEW_CONTENT', reason: 'DUPLICATE_CONTENT' };
  const tool = briefingDeliveryTool({ authorize: async () => {}, invoke: async () => receipt });
  assert.deepEqual(await tool.execute({}, new AbortController().signal), receipt);
  assert.equal(
    hasPreparedBriefing([{ name: 'deliver_briefing', status: 'succeeded', output: receipt }]),
    true,
  );
  assert.equal(
    hasPreparedBriefing([
      { name: 'deliver_briefing', status: 'succeeded', output: { ...receipt, reason: 'model says so' } },
    ]),
    false,
  );
});

test('receipt-based completion respects duplicates, cancellation, failed tools and conversation mode', async () => {
  for (const mode of ['duplicate', 'cancel', 'failed-tool', 'conversation']) {
    let calls = 0;
    const controller = new AbortController();
    const result = await runHarness({
      prompt: 'synthetic terminal receipt check',
      signal: controller.signal,
      finishOnDeliverable: mode !== 'conversation',
      hasCompletedDeliverable: hasPreparedBriefing,
      tools: [
        {
          name: 'deliver_briefing',
          description: 'synthetic',
          parameters: { type: 'object', properties: {} },
          execute: async () => {
            if (mode === 'cancel') controller.abort();
            if (mode === 'failed-tool') throw Error('synthetic failure');
            return { contractVersion: '1.0', status: 'NO_NEW_CONTENT', reason: 'DUPLICATE_CONTENT' };
          },
        },
      ],
      model: {
        async *generate() {
          calls++;
          if (calls === 1) {
            yield { type: 'tool_call', id: 'delivery', name: 'deliver_briefing', arguments: '{}' };
            yield { type: 'finish', reason: 'tool_calls' };
          } else {
            yield { type: 'text', text: 'No new content.' };
            yield { type: 'finish', reason: 'stop' };
          }
        },
      },
    });
    assert.equal(calls, ['duplicate', 'cancel'].includes(mode) ? 1 : 2, mode);
    assert.equal(result.status, mode === 'cancel' ? 'cancelled' : 'completed', mode);
    assert.equal(hasPreparedBriefing(result.tools), ['duplicate', 'conversation'].includes(mode), mode);
  }
});

test('dataset briefing closes retrieval after three lookups and delivers an honest bounded insight without scanning all rows', async (t) => {
  const datasetId = randomUUID(), snapshotId = randomUUID(), artifactId = randomUUID();
  const source = { datasetId, snapshotId, version: 1, name: '合成收款', description: '',
    columns: ['门店', '收款状态'], columnOffset: 0, nextColumnOffset: null, totalColumns: 2,
    rowCount: 100, coverageThrough: null, collectedAt: '2026-10-05T00:00:00Z', authority: false };
  const actions = [];
  const platform = createServer(async (req, res) => {
    if (usageFixture(req, res)) return;
    const input = await body(req);
    if (req.url.endsWith('/check')) return json(res, { allowed: true, executionClass: 'live',
      contextVersion: '1.0', datasetContextVersion: '1.0', datasetComparisonVersion: '1.0',
      briefingContentVersion: '1.0', briefingGeneration: true });
    if (req.url.endsWith('/context')) {
      actions.push(input.action);
      const result = input.action === 'bootstrap' ? {} : input.action === 'dataset_search'
        ? { items: [source], hasMore: false }
        : { source, rows: [['合成门店', '待确认']], offset: input.offset ?? 0, nextOffset: (input.offset ?? 0) + 1,
          hasMore: true, completeDataset: false, referenceOnly: true };
      return json(res, { contractVersion: '1.0', action: input.action, referenceOnly: true, result });
    }
    if (req.url.endsWith('/execution/open')) return json(res, { accepted: true, policy: 'READ_ONLY_PRIVATE_V1' });
    if (req.url.endsWith('/execution/tool')) return json(res, { accepted: true });
    if (req.url.endsWith('/deliver-briefing')) {
      assert.equal(input.businessType, 'INSIGHT');
      assert.equal(input.calculationArtifactId, undefined);
      assert.match(input.summary, /样本/);
      return json(res, { contractVersion: '1.0', status: 'PREPARED', artifactId,
        title: input.title, visibility: 'PRIVATE_AFTER_TASK_SUCCEEDS' });
    }
    json(res, {}, 404);
  });
  const url = await listen(platform); t.after(() => close(platform));
  let calls = 0;
  const agent = new AgentTasks({ platformBaseUrl: url, executionClass: 'live', modelName: 'synthetic-dataset-insight',
    createModel: () => ({ usage: null, async *generate(request) {
      calls++;
      const instructions = request.messages.filter(m=>m.role==='system').flatMap(m=>m.content).filter(b=>b.type==='text').map(b=>b.text).join('\n');
      assert.match(instructions, /compare_dataset/);
      assert.match(instructions, /每张卡回答：发现了什么/);
      assert.match(instructions, /只有来源介绍而没有新业务发现时不凑卡/);
      for (const text of [instructions, request.tools.find(t => t.name === 'deliver_briefing').description]) {
        assert.match(text, /实际匹配记录中的有效零值可以交付为有价值业务基线/);
        assert.match(text, /没有匹配记录、必需数值为NULL或缺失时不能补零/);
        assert.match(text, /交付后采用平台核对并保存的事实内容/);
        assert.doesNotMatch(text, /核验计算所有组的两列数值全部为0或缺失时不交付/);
      }
      assert.ok(request.tools.find(t => t.name === 'deliver_briefing').description.includes('智能画报表达规范 1.5.9'));
      assert.match(instructions, /先明确接收人的真实岗位/);
      assert.match(instructions, /卡面预览与详情使用同一组方案、行动和编号/);
      assert.match(request.tools.find(t => t.name === 'deliver_briefing').description, /卡面只截取完整文字行，详情保留全文/);
      assert.match(instructions, /关联必须核实同一对象/);
      assert.match(instructions, /未见到课、购课或沟通记录不等于/);
      assert.match(request.tools.find(t => t.name === 'deliver_briefing').description, /不绑定示例人物、门店、日期、标题/);
      let name = 'task_context', args;
      if (calls === 1) args = { action: 'dataset_search' };
      else if (calls === 2) args = { action: 'dataset_read', referenceId: datasetId, versionId: snapshotId, columnLimit: 10 };
      else if (calls === 3) args = { action: 'dataset_read', referenceId: datasetId, versionId: snapshotId, columnLimit: 10, offset: 1 };
      else {
        assert.equal(calls, 4);
        assert.ok(!request.tools.some(tool => tool.name === 'compare_dataset'), 'no published metric plan was supplied');
        assert.ok(!request.tools.some(tool => tool.name === 'task_context'));
        assert.equal(request.requiredTool, undefined);
        assert.equal(request.requireToolCall, true);
        assert.match(instructions, /retrieval is complete: a published executable plan is available or the lookup limit was reached/);
        name = 'deliver_briefing';
        args = { businessType: 'INSIGHT', title: '收款确认状态值得进一步核对',
          summary: '已读取样本中存在待确认收款，仍需核对其业务依据。',
          analysis: ['本次仅观察到固定版本中的一条样本，不代表完整数据集的分布。',
            '建议结合业务回执核对确认状态，当前证据不足以推断经营原因。'] };
      }
      yield { type: 'tool_call', id: `dataset-insight-${calls}`, name, arguments: JSON.stringify(args) };
      yield { type: 'finish', reason: 'tool_calls' };
    } }) });
  const result = await agent.run({ contractVersion: '1.5', taskId: randomUUID(), attemptId: randomUUID(),
    prompt: 'Generate one useful briefing from selected synthetic sources.' }, new AbortController().signal);
  assert.equal(result.outcome, 'COMPLETE');
  assert.equal(calls, 4);
  assert.deepEqual(actions, ['bootstrap', 'dataset_search', 'dataset_read', 'dataset_read']);
  assert.deepEqual(result.tools.map(r => r.name), ['task_context', 'task_context', 'task_context', 'deliver_briefing']);
});

test('editorial rejections provide actionable corrections instead of inviting repeated bad delivery',async()=>{
 const {BRIEFING_EDITORIAL_HINTS}=await import('../dist/runtime/briefing-delivery.js');
 assert.ok(BRIEFING_EDITORIAL_HINTS.BRIEFING_INTERNAL_LANGUAGE.includes('business Chinese'));
 assert.ok(BRIEFING_EDITORIAL_HINTS.BRIEFING_UNVERIFIED_QUANTITY.includes('Sample observations'));
 assert.ok(BRIEFING_EDITORIAL_HINTS.BRIEFING_NO_BUSINESS_INSIGHT.includes('暂无新内容'));
});

test('lossless paragraph compatibility reaches the real checked delivery without a retry',async()=>{
 const {normalizeBriefingArguments}=await import('../dist/runtime/briefing-delivery.js');
 const paragraphs=['第一段保留公开原文支持的完整事实。','第二段保留对企业的关联判断，不改变业务内容。'];
 for(const analysis of [paragraphs,JSON.stringify(paragraphs),paragraphs.join('\n\n')]){
  let received,calls=0;const artifactId=randomUUID();
  const tool=briefingDeliveryTool({authorize:async()=>{},invoke:async body=>{received=body;return{contractVersion:'1.0',status:'PREPARED',artifactId,title:body.title,visibility:'PRIVATE_AFTER_TASK_SUCCEEDS'};}});
  const result=await runHarness({prompt:'合成段落格式验收',tools:[tool],finishOnDeliverable:true,hasCompletedDeliverable:hasPreparedBriefing,model:{async *generate(){calls++;yield{type:'tool_call',id:'lossless',name:'deliver_briefing',arguments:JSON.stringify({businessType:'INFO',title:'合成公开新闻主题',summary:'合成公开新闻的完整关联摘要。',analysis})};yield{type:'finish',reason:'tool_calls'};}}});
  assert.equal(result.status,'completed');assert.equal(calls,1);assert.deepEqual(received.analysis,paragraphs);
 }
 for(const analysis of ['只有一个段落，不能凭空补充另一个段落。',JSON.stringify([7,8]),JSON.stringify(Array(5).fill(paragraphs[0])),'x'.repeat(2201)]){
  const original={analysis};assert.equal(normalizeBriefingArguments(original),original);
 }
});

test('delivery stays with the selected topic type before any platform write', async () => {
  let writes = 0;
  const tool = briefingDeliveryTool({ selectedType: () => 'DATA', authorize: async () => {},
    invoke: async () => { writes++; return { contractVersion: '1.0', status: 'PREPARED', artifactId: randomUUID(), title: '业务发现', visibility: 'PRIVATE_AFTER_TASK_SUCCEEDS' }; } });
  await assert.rejects(tool.execute({ businessType: 'INSIGHT' }, new AbortController().signal), { code: 'BRIEFING_TYPE_MISMATCH' });
  assert.equal(writes, 0);
  await tool.execute({ businessType: 'DATA' }, new AbortController().signal);
  assert.equal(writes, 1);
});

test('existing single-newline paragraphs normalize without rewriting or inventing paragraphs', () => {
  const paragraphs = ['第一段仅保留原来已经表达的完整业务内容。','第二段继续使用原有业务依据，不添加任何结论。'];
  assert.deepEqual(normalizeBriefingArguments({ analysis: paragraphs.join('\n') }), { analysis: paragraphs });
  const single = { analysis: paragraphs.join('') };
  assert.equal(normalizeBriefingArguments(single), single);
});

test('missing presentation receives conservative composition without invented business content', async () => {
 for(const businessType of ['DATA','INSIGHT']) {
  let received;
  const tool=briefingDeliveryTool({presentationAvailable:true,authorize:async()=>{},invoke:async body=>{received=body;return{contractVersion:'1.0',status:'PREPARED',artifactId:randomUUID(),title:body.title,visibility:'PRIVATE_AFTER_TASK_SUCCEEDS'};}});
  const body={businessType,title:'合成经营分析结果',summary:'这是根据获权资料形成的完整分析摘要。',analysis:['第一段只使用已经取得的经营数据证据。','第二段明确当前数据范围和待核实事项。']};
  const result=await runHarness({prompt:'合成结构兼容验收',tools:[tool],finishOnDeliverable:true,hasCompletedDeliverable:hasPreparedBriefing,model:{async *generate(){yield{type:'tool_call',id:'compose',name:'deliver_briefing',arguments:JSON.stringify(body)};yield{type:'finish',reason:'tool_calls'};}}});
  assert.equal(result.status,'completed');assert.deepEqual(received.analysis,body.analysis);
  assert.deepEqual(received.presentation,{version:'briefing-presentation-v1',layout:'EDITORIAL',chartStyle:businessType==='DATA'?'GROUPED_BAR':null,focusGroup:null,focusValue:null,sections:[]});
  const explicit={...body,presentation:{wrong:'shape'}};assert.deepEqual(tool.normalizeArguments(explicit).presentation,explicit.presentation);
 }
});

test('synthetic model corrects a topic-only title before delivery; long conclusions are advisory',async()=>{
 let calls=0,writes=0;
 const tool=briefingDeliveryTool({requestedType:'DATA',authorize:async()=>{},invoke:async body=>{writes++;return {contractVersion:'1.0',status:'PREPARED',artifactId:randomUUID(),title:body.title,visibility:'PRIVATE_AFTER_TASK_SUCCEEDS'};}});
 const r=await runHarness({prompt:'合成标题检查',tools:[tool],finishOnDeliverable:true,hasCompletedDeliverable:hasTerminalBriefing,model:{async *generate(request){
  calls++;
  if(calls===2)assert.match(JSON.stringify(request.messages),/BRIEFING_TITLE_TOPIC_ONLY/);
  assert.match(tool.description,/不超过28个字/);
  yield {type:'tool_call',id:`title-${calls}`,name:'deliver_briefing',arguments:JSON.stringify({businessType:'DATA',title:calls===1?'门店订单金额分布与支付完成情况分析':'甲店收款增长一倍，当前结论仅覆盖已核验的两期同口径完整记录',summary:'两期同口径收款增长一倍，需要结合业务背景解读。',analysis:['本次只使用已核验的完整固定记录进行比较。','变化原因仍需结合其他业务资料进一步核实。']})};
  yield {type:'finish',reason:'tool_calls'};
 }}});
 assert.equal(r.status,'completed');assert.equal(calls,2);assert.equal(writes,1);
});

test('verified calculation delivery accepts a business topic and returns the platform factual title',async()=>{
 const factualTitle='2026-10 · 应收付金额合计 -120.00 人民币元';let writes=0;
 const tool=briefingDeliveryTool({requestedType:'DATA',authorize:async()=>{},invoke:async body=>{
  writes++;assert.equal(body.title,'月度门店登记金额分析');
  return {contractVersion:'1.0',status:'PREPARED',artifactId:randomUUID(),title:factualTitle,visibility:'PRIVATE_AFTER_TASK_SUCCEEDS'};
 }});
 const r=await tool.execute({businessType:'DATA',calculationArtifactId:randomUUID(),title:'月度门店登记金额分析',summary:'按已发布账单日期口径核对登记金额。',analysis:['建议核对各门店原始账单与登记凭据。','来源覆盖范围依照本次固定快照说明。']},new AbortController().signal);
 assert.equal(writes,1);assert.equal(r.title,factualTitle);
});

test('provider Harness uses catalog, topic, typed monthly plan and one delivery',async(t)=>{
 const calc=randomUUID(),artifact=randomUUID(),actions=[];let step=0,selected=false;
 const candidate={question:'本月销售与收款分别是多少',goal:'股东经营概况',userValue:'一次看清各店两种口径',destination:'BRIEFING',evidenceNeeded:'获准门店固定计算',requiresCalculation:true,difference:'合并相同期间双指标',businessType:'DATA'};
 const platform=createServer(async(req,res)=>{
  if(usageFixture(req,res))return;const input=await body(req);
  if(req.url.endsWith('/check'))return json(res,{allowed:true,executionClass:'live',briefingContentVersion:'1.0',briefingGeneration:true,briefingRequestedType:'DATA',contextVersion:'1.0',datasetContextVersion:'1.0',briefingBusinessPlanVersion:'1.0',topicStrategyVersion:'1.0',topicSelectionRecorded:selected});
  if(req.url.endsWith('/context')){actions.push(input.action);return json(res,{contractVersion:'1.0',action:input.action,referenceOnly:true,result:input.action==='bootstrap'?{}:input.action==='reconciliation_catalog'?{stores:[{id:'a'},{id:'b'}]}:{plan:{cards:1,chartStyle:'GROUPED_BAR'},evidence:{calculationArtifactId:calc}}});}
  if(req.url.endsWith('/select-briefing-topic')){selected=true;return json(res,{recorded:true,proposalOnly:true,selectedIndex:input.selectedIndex,strategyVersion:'1.0.0'});}
  if(req.url.endsWith('/execution/open')||req.url.endsWith('/execution/tool'))return json(res,{accepted:true,policy:'READ_ONLY_PRIVATE_V1'});
  if(req.url.endsWith('/deliver-briefing')){actions.push('deliver');assert.equal(input.calculationArtifactId,calc);return json(res,{contractVersion:'1.0',status:'PREPARED',artifactId:artifact,title:input.title,visibility:'PRIVATE_AFTER_TASK_SUCCEEDS'});}
  json(res,{},404);
 });const url=await listen(platform);t.after(()=>close(platform));
 const agent=new AgentTasks({platformBaseUrl:url,executionClass:'live',modelName:'synthetic-monthly-plan',createModel:()=>({usage:null,async *generate(r){
  step++;let name,args;
  if(step===1){name='task_context';args={action:'reconciliation_catalog'};}
  else if(step===2){name='select_briefing_topic';args={candidates:[candidate],selectedIndex:0};}
  else if(step===3){name='task_context';args={action:'briefing_plan',plan:{question:candidate.question,goal:candidate.goal,recipe:'MONTHLY_SALES_RECEIPTS',storeIds:['a','b'],dateFrom:'2026-10-01',dateTo:'2026-10-19'}};}
  else{assert.equal(step,4);assert.equal(r.requiredTool,'deliver_briefing');name='deliver_briefing';args={businessType:'DATA',calculationArtifactId:calc,title:'两店销售与收款各100元',summary:'本月1至19日两店销售与收款分别统计。',analysis:['订单销售按订单确认日期统计，收款按收款确认日期统计。','两项合计相同，不代表逐笔一致或已经银行到账。']};}
  assert.ok(r.tools.some(x=>x.name===name));yield{type:'tool_call',id:'monthly-'+step,name,arguments:JSON.stringify(args)};yield{type:'finish',reason:'tool_calls'};
 }})});
 const result=await agent.run({contractVersion:'1.5',taskId:randomUUID(),attemptId:randomUUID(),prompt:'将获准门店本月销售和收款同卡展示'},new AbortController().signal);
 assert.equal(result.outcome,'COMPLETE');assert.equal(step,4);assert.deepEqual(actions,['bootstrap','reconciliation_catalog','briefing_plan','deliver']);
});
