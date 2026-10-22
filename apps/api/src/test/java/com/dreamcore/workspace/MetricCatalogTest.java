package com.dreamcore.workspace;
import com.dreamcore.workspace.scene.*;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.junit.jupiter.api.Assertions.*;

class MetricCatalogTest extends TaskDatasetFixture {
 @Autowired MetricCatalog catalog;
 @MockitoBean SceneBridgeClient bridge;
 @BeforeEach void govern(){
  db.update("UPDATE tenant_memberships SET role='TENANT_ADMIN' WHERE tenant_id=?",tenant);
  db.update("INSERT INTO scene_bindings(tenant_id,workspace_id,connection_id,maintainer_id,governance_valid_until) VALUES(?,?,?,?,now()+interval '5 minutes')",tenant,space,connection,owner);
  String meta=json.writeValueAsString(Map.of("fields",List.of(Map.of("name","数量","type","number")),"governance",Map.of("allowedActors",List.of(owner.toString()),"policyVersion",1)));
  db.update("INSERT INTO scene_asset_links(tenant_id,source_id,kind,target_id,revision,metadata) VALUES(?,'synthetic','TABLE',?,'r1',?::jsonb)",tenant,dataset,meta);
  db.update("INSERT INTO scene_asset_revisions(tenant_id,target_id,kind,revision,metadata) VALUES(?,?,'TABLE','r1',?::jsonb)",tenant,dataset,meta);
  when(bridge.call(eq(tenant),anyString(),eq("GET"),eq("/scene-access"),isNull())).thenReturn(json.readTree("{\"user\":{\"role\":\"admin\"}}"));
 }
 Map<String,Object> definition(){var d=new HashMap<String,Object>(Map.of("name","合成数量","meaning","样本数量合计","unit","件","grain","每行一个样本","scope","仅合成快照","exclusions","无","evidence","测试业务定义，不代表真实业务","aggregation","SUM","valueField","数量"));d.put("execution",Map.of("groupColumns",List.of(),"dateColumn","","dateFrom","","dateTo","","timeZone","Asia/Shanghai","reviewed",true));return d;}
 UUID save(){return UUID.fromString(json.valueToTree(catalog.save(owner,tenant,false,new MetricCatalog.Change(null,0,"synthetic",definition()))).path("id").asText());}
 @Autowired BriefingBootstrapDeployment bootstrap;
 @Autowired DatasetCalculationService calculator;
 @Test void controlledSumUsesExactFilterAndConversionAndRejectsMissingAmountOrChangedPlan(){
  var meta=json.createObjectNode();meta.set("fields",json.valueToTree(List.of(Map.of("name","数量","type","number"),Map.of("name","门店","type","text"))));
  meta.set("governance",json.valueToTree(Map.of("allowedActors",List.of(owner.toString()),"policyVersion",1)));
  meta.set("dictionary",json.valueToTree(Map.of("fields",List.of(Map.of("name","数量","unit","分")))));
  meta.set("analysisPolicy",json.valueToTree(Map.of("excludeFields",List.of(),"noSumFields",List.of("数量"),"conditionalSums",List.of(Map.of("field","数量","equalsFilters",Map.of("门店","SUCCESS"),"conversion","CENTS_TO_YUAN")))));
  db.update("UPDATE scene_asset_links SET metadata=?::jsonb WHERE tenant_id=?",meta.toString(),tenant);
  db.update("UPDATE scene_asset_revisions SET metadata=?::jsonb WHERE tenant_id=?",meta.toString(),tenant);
  snapshot=version(2,List.of(List.of("SUCCESS","100000"),List.of("SUCCESS","200000"),List.of("PENDING","50000"),List.of("FAILED","30000")));
  var d=definition();d.put("unit","元");var execution=new HashMap<String,Object>((Map<String,Object>)d.get("execution"));execution.put("equalsFilters",Map.of("门店","SUCCESS"));execution.put("conversion","CENTS_TO_YUAN");d.put("execution",execution);
  UUID id=UUID.fromString(json.valueToTree(catalog.save(owner,tenant,false,new MetricCatalog.Change(null,0,"synthetic",d))).path("id").asText());
  catalog.transition(owner,tenant,false,id,new MetricCatalog.Transition(1),true);
  var job=task(null,"AUTHORIZED_LIBRARY");call(job,request("dataset_search",null,null,0));
  var plan=MetricPlan.request(json.valueToTree(d),dataset,snapshot,id,1);
  var result=json.valueToTree(calculator.calculate(job,plan));
  assertEquals("3000.00",result.at("/calculation/total").asText());assertEquals(2,result.at("/calculation/matchedRows").asInt());assertEquals(2,result.at("/calculation/ignoredRows").asInt());
  var altered=new DatasetCalculationService.Request(dataset,snapshot,null,null,"数量",null,null,null,"Asia/Shanghai","SUM","SUMMARY",List.of(),null,null,null,null,id,1,Map.of("门店","PENDING"),"CENTS_TO_YUAN");
  assertEquals("METRIC_PLAN_MISMATCH",assertThrows(IdentityException.class,()->calculator.calculate(job,altered)).code);
  db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE id=?",job.id());
  snapshot=version(3,List.of(Arrays.asList("SUCCESS",null),List.of("FAILED","100")));
  var next=task(null,"AUTHORIZED_LIBRARY");call(next,request("dataset_search",null,null,0));
  var missing=MetricPlan.request(json.valueToTree(d),dataset,snapshot,id,1);
  assertEquals("DATASET_AMOUNT_REQUIRED",assertThrows(IdentityException.class,()->calculator.calculate(next,missing)).code);
  assertEquals(0,db.queryForObject("SELECT count(*) FROM metric_calculation_receipts WHERE task_id=?",Integer.class,next.id()));
 }
 @Test void bootstrapPinsOnlyExplicitPublishedPlanAndRejectsWithdrawnOrAlteredPlan(){
  UUID id=save();catalog.transition(owner,tenant,false,id,new MetricCatalog.Transition(1),true);
  // More than the normal context page: exact selection cannot depend on catalog ordering.
  for(int i=0;i<5;i++){UUID other=save();catalog.transition(owner,tenant,false,other,new MetricCatalog.Transition(1),true);}
  var plan=MetricPlan.request(json.valueToTree(definition()),dataset,snapshot,id,1);
  var card=new BriefingBootstrapDeployment.Card("合成指标首轮验证",plan,new BriefingContentService.Request(null,"合成数量口径统计","按已确认的合成口径计算固定快照，不解释真实经营变化。",List.of("计算保留来源与指标版本，所有数据均为合成样本。","不扩大来源授权，不修改已发布计划，不推断真实企业经营表现。"),"DATA"));
  var m=new BriefingBootstrapDeployment.Manifest("1.0",UUID.randomUUID(),tenant,owner,space,List.of(card));
  bootstrap.apply(m,true);
  assertEquals(0,db.queryForObject("SELECT count(*) FROM task_metric_reads r JOIN conversation_tasks t ON t.id=r.task_id WHERE t.tenant_id=?",Integer.class,tenant));
  bootstrap.apply(m,false);
  assertEquals(1,db.queryForObject("SELECT count(*) FROM metric_briefing_receipts r JOIN metric_calculation_receipts c ON c.artifact_id=r.calculation_artifact_id JOIN conversation_tasks t ON t.id=c.task_id WHERE t.tenant_id=?",Integer.class,tenant));
  assertEquals(List.of(id),db.queryForList("SELECT r.metric_id FROM task_metric_reads r JOIN conversation_tasks t ON t.id=r.task_id WHERE t.tenant_id=?",UUID.class,tenant));
  var changed=new DatasetCalculationService.Request(dataset,snapshot,null,null,null,null,null,null,"Asia/Shanghai","COUNT","SUMMARY",List.of(),null,null,null,null,id,1);
  var bad=new BriefingBootstrapDeployment.Manifest("1.0",UUID.randomUUID(),tenant,owner,space,List.of(new BriefingBootstrapDeployment.Card("篡改口径",changed,card.content())));
  assertEquals("METRIC_PLAN_MISMATCH",assertThrows(IdentityException.class,()->bootstrap.apply(bad,true)).code);
  catalog.transition(owner,tenant,false,id,new MetricCatalog.Transition(1),false);
  var withdrawn=new BriefingBootstrapDeployment.Manifest("1.0",UUID.randomUUID(),tenant,owner,space,List.of(card));
  assertEquals("METRIC_DEFINITION_REQUIRED",assertThrows(IdentityException.class,()->bootstrap.apply(withdrawn,true)).code);
 }
 @Test void publicationRetrievalPinAndWithdrawal(){
  UUID id=save();var task=task(null,"AUTHORIZED_LIBRARY");
  assertEquals(0,call(task,request("dataset_search",null,null,0)).path("items").get(0).path("governedMetrics").path("items").size());
  catalog.transition(owner,tenant,false,id,new MetricCatalog.Transition(1),true);
  var result=call(task,new com.dreamcore.workspace.context.TaskContextService.Request("dataset_search",null,"合成数量",0,null,null,null,null,null,null,null));
  assertEquals(id.toString(),result.path("items").get(0).path("governedMetrics").path("items").get(0).path("metricId").asText());
  assertEquals(1,db.queryForObject("SELECT count(*) FROM task_metric_reads WHERE task_id=?",Integer.class,task.id()));
  catalog.transition(owner,tenant,false,id,new MetricCatalog.Transition(1),false);
  assertFalse(db.queryForObject("SELECT task_datasets_readable(?)",Boolean.class,task.id()));
  denied(()->call(task,request("dataset_search",null,null,0)));
  catalog.transition(owner,tenant,false,id,new MetricCatalog.Transition(1),true);
  denied(()->call(task,request("dataset_search",null,null,0)));
 }
 @Test void draftDoesNotReplacePublishedAndSourceChangesBlockPublication(){
  UUID id=save();catalog.transition(owner,tenant,false,id,new MetricCatalog.Transition(1),true);
  catalog.save(owner,tenant,false,new MetricCatalog.Change(id,1,"synthetic",definition()));
  assertEquals(1,db.queryForObject("SELECT published_version FROM scene_metrics WHERE id=?",Integer.class,id));
  assertThrows(IdentityException.class,()->catalog.save(owner,tenant,false,new MetricCatalog.Change(id,1,"synthetic",definition())));
  db.update("UPDATE scene_asset_links SET metadata=jsonb_set(metadata,'{governance,policyVersion}','2') WHERE tenant_id=?",tenant);
  assertThrows(IdentityException.class,()->catalog.transition(owner,tenant,false,id,new MetricCatalog.Transition(2),true));
  var task=task(null,"AUTHORIZED_LIBRARY");assertEquals(0,call(task,request("dataset_search",null,null,0)).path("items").get(0).path("governedMetrics").path("items").size());
 }
 @Test void sourceAclExpiryBadColumnsAndCrossTenantAreRejected(){
  var bad=definition();bad.put("valueField","不存在");assertThrows(IdentityException.class,()->catalog.save(owner,tenant,false,new MetricCatalog.Change(null,0,"synthetic",bad)));
  UUID id=save();assertThrows(IdentityException.class,()->catalog.transition(owner,UUID.randomUUID(),false,id,new MetricCatalog.Transition(1),true));
  db.update("UPDATE scene_bindings SET governance_valid_until=now()-interval '1 second' WHERE tenant_id=?",tenant);
  assertThrows(IdentityException.class,()->catalog.transition(owner,tenant,false,id,new MetricCatalog.Transition(1),true));
  assertThrows(IdentityException.class,()->catalog.save(owner,tenant,false,new MetricCatalog.Change(null,0,"synthetic",definition())));
 }
 @Autowired MetricDraftGenerator generator;
 @Test void automaticDraftsAreDeduplicatedUnpublishedAndCanBePaused(){
  var first=json.valueToTree(generator.generate(owner,tenant,false));assertEquals(1,first.path("created").asInt());
  assertEquals(0,json.valueToTree(generator.generate(owner,tenant,false)).path("created").asInt());
  UUID id=db.queryForObject("SELECT id FROM scene_metrics WHERE tenant_id=?",UUID.class,tenant);
  assertNull(db.queryForObject("SELECT published_version FROM scene_metrics WHERE id=?",Integer.class,id));
  assertEquals("RULE_BASED",db.queryForObject("SELECT generation->>'origin' FROM scene_metric_versions WHERE metric_id=?",String.class,id));
  assertThrows(IdentityException.class,()->catalog.transition(owner,tenant,false,id,new MetricCatalog.Transition(1),true));
  generator.setting(owner,tenant,false,false);assertTrue(json.valueToTree(generator.generate(owner,tenant,false)).path("paused").asBoolean());
  assertEquals(0,db.queryForObject("SELECT count(*) FROM scene_processing_runs WHERE tenant_id=? AND state='RUNNING'",Integer.class,tenant));
 }
 @Test void extraBusinessExclusionsCannotBeSilentlyPublishedAsWholeSnapshotSum(){
  var d=definition();d.put("exclusions","排除退款");UUID id=UUID.fromString(json.valueToTree(catalog.save(owner,tenant,false,new MetricCatalog.Change(null,0,"synthetic",d))).path("id").asText());
  assertThrows(IdentityException.class,()->catalog.transition(owner,tenant,false,id,new MetricCatalog.Transition(1),true));
 }
 @Test void conversationsAndBriefingsUseTheSamePublishedPlanAndReceipt(){
  UUID id=save();catalog.transition(owner,tenant,false,id,new MetricCatalog.Transition(1),true);
  var job=task(null,"AUTHORIZED_LIBRARY");agents.openExecution(job.id(),job.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("task_context","compare_dataset","deliver_briefing")));
  agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(1,"task_context","STARTED"));
  var ctx=call(job,request("dataset_search",null,null,0));var plan=json.treeToValue(ctx.at("/items/0/governedMetrics/items/0/executionRequest"),DatasetCalculationService.Request.class);
  agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(1,"task_context","succeeded"));
  agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(2,"compare_dataset","STARTED"));
  var raw=new DatasetCalculationService.Request(dataset,snapshot,null,null,"数量",null,null,null,"Asia/Shanghai","SUM","SUMMARY",List.of(),null,null,null,null);
  assertEquals("METRIC_DEFINITION_REQUIRED",assertThrows(IdentityException.class,()->agents.compareDataset(job.id(),job.token(),raw)).code);
  var changed=new DatasetCalculationService.Request(dataset,snapshot,null,null,null,null,null,null,"Asia/Shanghai","COUNT","SUMMARY",List.of(),null,null,null,null,id,1);
  assertEquals("METRIC_PLAN_MISMATCH",assertThrows(IdentityException.class,()->agents.compareDataset(job.id(),job.token(),changed)).code);
  var computed=json.valueToTree(calculator.calculate(job,plan));assertEquals("15",computed.at("/calculation/total").asText());assertEquals(id.toString(),computed.at("/governedMetric/id").asText());
  UUID artifact=UUID.fromString(computed.at("/artifact/id").asText());assertEquals(id,db.queryForObject("SELECT metric_id FROM metric_calculation_receipts WHERE artifact_id=?",UUID.class,artifact));
  agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(2,"compare_dataset","succeeded"));agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(3,"deliver_briefing","STARTED"));
  var card=new BriefingContentService.Request(artifact,"合成数量口径统计","按已确认的合成口径，当前固定快照的数量合计为十五件。",List.of("该结果由后端读取固定快照全部记录计算，并保留来源与指标版本。","结果只代表合成样本范围，不推断真实企业的经营表现。"));
  assertNotNull(agents.deliverBriefing(job.id(),job.token(),card));assertEquals(1,db.queryForObject("SELECT count(*) FROM metric_briefing_receipts WHERE calculation_artifact_id=?",Integer.class,artifact));
  db.update("DELETE FROM metric_briefing_receipts WHERE calculation_artifact_id=?",artifact);db.update("DELETE FROM metric_calculation_receipts WHERE artifact_id=?",artifact);
  assertEquals("METRIC_CALCULATION_REQUIRED",assertThrows(IdentityException.class,()->agents.deliverBriefing(job.id(),job.token(),card)).code);
 }

 @Test void delegatedDefinitionsPublishWithoutHumanClickAndDoNotChurnOrOverrideEdits(){
  db.update("INSERT INTO metric_generation_settings(tenant_id,auto_publish) VALUES(?,true)",tenant);
  generator.generate(owner,tenant,false);
  var m=db.queryForMap("SELECT id,head_version,published_version FROM scene_metrics WHERE tenant_id=?",tenant);
  assertEquals(2,m.get("head_version"));assertEquals(2,m.get("published_version"));
  generator.generate(owner,tenant,false);
  assertEquals(2,db.queryForObject("SELECT head_version FROM scene_metrics WHERE id=?",Integer.class,m.get("id")));
  catalog.save(owner,tenant,false,new MetricCatalog.Change((UUID)m.get("id"),2,"synthetic",definition()));
  generator.generate(owner,tenant,false);
  assertEquals(3,db.queryForObject("SELECT head_version FROM scene_metrics WHERE id=?",Integer.class,m.get("id")));
 }

 @Test void catalogBeyondOneHundredIsSearchableAndPagedWithoutDuplicates(){
  for(int i=0;i<105;i++){var d=definition();d.put("name",i==104?"唯一%目录末尾":"合成指标"+i);catalog.save(owner,tenant,false,new MetricCatalog.Change(null,0,"synthetic",d));}
  var seen=new HashSet<String>();
  for(int offset=0;offset<105;offset+=12){var page=json.valueToTree(catalog.list(owner,tenant,false,"",offset,12));assertEquals(105,page.path("total").asInt());for(var m:page.path("items"))assertTrue(seen.add(m.path("id").asText()));}
  assertEquals(105,seen.size());var found=json.valueToTree(catalog.list(owner,tenant,false,"%",0,12));assertEquals(1,found.path("total").asInt());assertFalse(found.path("hasMore").asBoolean());
  assertThrows(IdentityException.class,()->catalog.list(owner,tenant,false,"",-1,12));assertThrows(IdentityException.class,()->catalog.list(owner,tenant,false,"",0,101));assertThrows(IdentityException.class,()->catalog.list(owner,UUID.randomUUID(),false,"",0,12));
 }
 @Test void generationContinuesInBatchesAndKeepsCandidateKeysUnique(){
  for(int i=0;i<54;i++){UUID id=UUID.randomUUID();String key="batch-"+i;db.update("INSERT INTO business_datasets(id,tenant_id,connection_id,workspace_id,dataset_key,name,column_names) SELECT ?,tenant_id,connection_id,workspace_id,?,'合成来源',column_names FROM business_datasets WHERE id=?",id,key,dataset);db.update("INSERT INTO scene_asset_links(tenant_id,source_id,kind,target_id,revision,metadata) SELECT tenant_id,?,'TABLE',?,'batch',metadata FROM scene_asset_links WHERE tenant_id=? AND source_id='synthetic'",key,id,tenant);}
  var first=json.valueToTree(generator.generate(owner,tenant,false));assertEquals(50,first.path("created").asInt());assertTrue(first.path("batchLimited").asBoolean());
  assertEquals(5,json.valueToTree(generator.generate(owner,tenant,false)).path("created").asInt());assertEquals(0,json.valueToTree(generator.generate(owner,tenant,false)).path("created").asInt());assertEquals(55,db.queryForObject("SELECT count(*) FROM metric_generation_keys WHERE tenant_id=?",Integer.class,tenant));
 }
 @Test void delegatedReviewRotatesAcrossLargeCatalogWithoutVersionChurn(){
  for(int i=0;i<105;i++){var d=definition();d.put("aggregation","COUNT");d.put("valueField","");catalog.save(owner,tenant,false,new MetricCatalog.Change(null,0,"synthetic",d));}
  db.update("UPDATE scene_metric_versions SET generation='{\"origin\":\"RULE_BASED\"}'::jsonb WHERE metric_id IN(SELECT id FROM scene_metrics WHERE tenant_id=?)",tenant);
  db.update("INSERT INTO metric_generation_settings(tenant_id,auto_publish) VALUES(?,true)",tenant);
  generator.generate(owner,tenant,false);assertEquals(50,db.queryForObject("SELECT count(*) FROM scene_metrics WHERE tenant_id=? AND published_version=2",Integer.class,tenant));
  generator.generate(owner,tenant,false);assertEquals(100,db.queryForObject("SELECT count(*) FROM scene_metrics WHERE tenant_id=? AND published_version=2",Integer.class,tenant));
  generator.generate(owner,tenant,false);assertEquals(106,db.queryForObject("SELECT count(*) FROM scene_metrics WHERE tenant_id=? AND published_version=2",Integer.class,tenant));
  generator.generate(owner,tenant,false);assertEquals(2,db.queryForObject("SELECT max(head_version) FROM scene_metrics WHERE tenant_id=?",Integer.class,tenant));
 }

 @Test void duplicateGovernedBriefingReturnsNoNewContentAndUncoveredMetricsArePrioritized(){
  UUID metric=save();catalog.transition(owner,tenant,false,metric,new MetricCatalog.Transition(1),true);
  for(int round=0;round<2;round++){
   var job=task(null,"AUTHORIZED_LIBRARY");
   agents.openExecution(job.id(),job.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("task_context","compare_dataset","deliver_briefing")));
   agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(1,"task_context","STARTED"));
   var ctx=call(job,request("dataset_search",null,null,0));
   var plan=json.treeToValue(ctx.at("/items/0/governedMetrics/items/0/executionRequest"),DatasetCalculationService.Request.class);
   agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(1,"task_context","succeeded"));
   agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(2,"compare_dataset","STARTED"));
   var calc=json.valueToTree(calculator.calculate(job,plan));
   agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(2,"compare_dataset","succeeded"));
   agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(3,"deliver_briefing","STARTED"));
   var request=new BriefingContentService.Request(UUID.fromString(calc.at("/artifact/id").asText()),"合成数量合计十五件","按已确认的合成口径，固定快照数量合计十五件。",List.of("本次结果使用固定快照内的全部记录，保留来源和口径依据。","该数量仅代表合成样本统计，不用于判断真实业务收入。"));
   var result=agents.deliverBriefing(job.id(),job.token(),request);
   assertEquals(round==0?"PREPARED":"NO_NEW_CONTENT",result.get("status"));
   agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(3,"deliver_briefing","succeeded"));
   db.update("UPDATE conversation_tasks SET status='SUCCEEDED',finished_at=now() WHERE id=?",job.id());
  }
  UUID fresh=save();catalog.transition(owner,tenant,false,fresh,new MetricCatalog.Transition(1),true);
  var next=task(null,"AUTHORIZED_LIBRARY");var result=call(next,request("dataset_search",null,null,0));
  assertEquals(fresh.toString(),result.at("/items/0/governedMetrics/items/0/metricId").asText());
 }

 @Autowired com.dreamcore.workspace.profile.CompanyInformationService company;
 @Autowired com.dreamcore.workspace.profile.CompanyBackgroundSourceService backgroundSource;
 @Autowired com.dreamcore.workspace.profile.BackgroundKnowledgeService backgroundKnowledge;
 @Autowired com.dreamcore.workspace.context.TaskContextGuard contextGuard;
 UUID addBackground(){return company.change(owner,tenant,new com.dreamcore.workspace.profile.CompanyInformationService.Change(UUID.randomUUID(),com.dreamcore.workspace.profile.CompanyInformationService.Field.TERM,0,"ADD",null,"到账","银行已确认收款")).tagId();}
 UUID saveWithBackground(UUID version){var d=definition();d.put("backgroundVersionIds",List.of(version.toString()));return UUID.fromString(json.valueToTree(catalog.save(owner,tenant,false,new MetricCatalog.Change(null,0,"synthetic",d))).path("id").asText());}
 @Test void backgroundBatchKeepsIndependentLimitsAndSharedDependencies(){
  UUID first=addBackground();
  UUID second=company.change(owner,tenant,new com.dreamcore.workspace.profile.CompanyInformationService.Change(UUID.randomUUID(),com.dreamcore.workspace.profile.CompanyInformationService.Field.TERM,1,"ADD",null,"退款","退款依据")).tagId();
  var firstVersion=backgroundSource.entry(owner,tenant,first,1).versionId();
  var secondVersion=backgroundSource.entry(owner,tenant,second,1).versionId();
  for(int i=0;i<23;i++)saveWithBackground(firstVersion);
  var definition=definition();definition.put("backgroundVersionIds",List.of(firstVersion.toString(),secondVersion.toString()));
  UUID shared=UUID.fromString(json.valueToTree(catalog.save(owner,tenant,false,new MetricCatalog.Change(null,0,"synthetic",definition))).path("id").asText());
  var items=backgroundKnowledge.list(owner,tenant).items();
  assertEquals(21,items.stream().filter(i->i.sourceEntryId().equals(first)).findFirst().orElseThrow().methods().size());
  var methods=items.stream().filter(i->i.sourceEntryId().equals(second)).findFirst().orElseThrow().methods();
  assertEquals(List.of(shared),methods.stream().map(com.dreamcore.workspace.profile.BackgroundKnowledgeService.Method::id).toList());
  db.update("UPDATE scene_asset_links SET metadata=jsonb_set(metadata,'{governance,allowedActors}','[]') WHERE tenant_id=?",tenant);
  assertTrue(backgroundKnowledge.list(owner,tenant).items().stream().allMatch(i->i.methods().isEmpty()));
 }
 @Test void backgroundKnowledgePinsMethodsAndChangesFenceRunningTasks(){
  UUID entry=addBackground();var v=backgroundSource.entry(owner,tenant,entry,1);
  UUID method=saveWithBackground(v.versionId());catalog.transition(owner,tenant,false,method,new MetricCatalog.Transition(1),true);
  var knowledge=backgroundKnowledge.list(owner,tenant).items().getFirst();assertEquals(v.versionId(),knowledge.sourceVersionId());assertEquals("REFERENCE_CURRENT",knowledge.methods().getFirst().status());
  var job=task(null,"AUTHORIZED_LIBRARY");agents.openExecution(job.id(),job.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("task_context","compare_dataset")));
  agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(1,"task_context","STARTED"));
  var ctx=call(job,request("dataset_search",null,null,0));assertEquals(1,ctx.at("/items/0/governedMetrics/items").size());
  var plan=json.treeToValue(ctx.at("/items/0/governedMetrics/items/0/executionRequest"),DatasetCalculationService.Request.class);
  agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(1,"task_context","succeeded"));
  company.change(owner,tenant,new com.dreamcore.workspace.profile.CompanyInformationService.Change(UUID.randomUUID(),com.dreamcore.workspace.profile.CompanyInformationService.Field.TERM,1,"EDIT",entry,"到账","银行确认且财务复核"));
  assertFalse(db.queryForObject("SELECT metric_background_current(?,1)",Boolean.class,method));
  assertFalse(db.queryForObject("SELECT task_datasets_readable(?)",Boolean.class,job.id()));
  assertEquals("REVIEW_REQUIRED",backgroundKnowledge.list(owner,tenant).items().getFirst().methods().getFirst().status());
  assertThrows(IdentityException.class,()->contextGuard.requireCurrent(job.id()));
  assertThrows(IdentityException.class,()->calculator.calculate(job,plan));
  assertEquals("BACKGROUND_REFERENCE_CHANGED",assertThrows(IdentityException.class,()->catalog.transition(owner,tenant,false,method,new MetricCatalog.Transition(1),true)).code);
  assertThrows(IdentityException.class,()->saveWithBackground(v.versionId()));
  var current=backgroundSource.entry(owner,tenant,entry,2);var changed=definition();changed.put("backgroundVersionIds",List.of(current.versionId().toString()));
  catalog.save(owner,tenant,false,new MetricCatalog.Change(method,1,"synthetic",changed));catalog.transition(owner,tenant,false,method,new MetricCatalog.Transition(2),true);
  assertTrue(db.queryForObject("SELECT metric_background_current(?,2)",Boolean.class,method));
  assertFalse(db.queryForObject("SELECT task_datasets_readable(?)",Boolean.class,job.id()));
 }
 @Test void backgroundBindingsRejectForeignMalformedAndWithdrawnVersions(){
  UUID entry=addBackground();var v=backgroundSource.entry(owner,tenant,entry,1);UUID method=saveWithBackground(v.versionId());
  var d=definition();d.put("backgroundVersionIds",List.of("not-a-uuid"));assertThrows(IdentityException.class,()->catalog.save(owner,tenant,false,new MetricCatalog.Change(null,0,"synthetic",d)));
  assertThrows(IdentityException.class,()->saveWithBackground(UUID.randomUUID()));
  company.change(owner,tenant,new com.dreamcore.workspace.profile.CompanyInformationService.Change(UUID.randomUUID(),com.dreamcore.workspace.profile.CompanyInformationService.Field.TERM,1,"REMOVE",entry,"",""));
  assertTrue(backgroundKnowledge.list(owner,tenant).items().isEmpty());assertFalse(db.queryForObject("SELECT metric_background_current(?,1)",Boolean.class,method));
  assertThrows(IdentityException.class,()->saveWithBackground(v.versionId()));
 }
 @Test void backgroundKnowledgeCannotExposeMethodsAfterDatasetRevocation(){
  UUID entry=addBackground();UUID method=saveWithBackground(backgroundSource.entry(owner,tenant,entry,1).versionId());
  assertEquals(1,backgroundKnowledge.list(owner,tenant).items().getFirst().methods().size());
  db.update("UPDATE scene_asset_links SET active=false WHERE tenant_id=?",tenant);
  assertTrue(backgroundKnowledge.list(owner,tenant).items().getFirst().methods().isEmpty());
 }

 @Autowired BackgroundEvidenceController backgroundEvidence;
 @Test void actualCalculationCarriesBackgroundEvidenceAndCannotBeReadCrossTenant(){
  UUID entry=addBackground();var version=backgroundSource.entry(owner,tenant,entry,1);UUID id=saveWithBackground(version.versionId());
  catalog.transition(owner,tenant,false,id,new MetricCatalog.Transition(1),true);
  var job=task(null,"AUTHORIZED_LIBRARY");agents.openExecution(job.id(),job.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("task_context","compare_dataset")));
  agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(1,"task_context","STARTED"));
  var ctx=call(job,request("dataset_search",null,null,0));var plan=json.treeToValue(ctx.at("/items/0/governedMetrics/items/0/executionRequest"),DatasetCalculationService.Request.class);
  agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(1,"task_context","succeeded"));agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(2,"compare_dataset","STARTED"));
  var calculated=json.valueToTree(calculator.calculate(job,plan));assertEquals(version.versionId().toString(),calculated.path("backgroundVersionIds").get(0).asText());
  agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(2,"compare_dataset","succeeded"));finish(job);
  var auth=new org.springframework.security.authentication.UsernamePasswordAuthenticationToken(owner.toString(),null);
  var response=new org.springframework.mock.web.MockHttpServletResponse();
  var proof=json.valueToTree(backgroundEvidence.get(auth,tenant,job.conversation(),job.id(),response));
  assertEquals(id.toString(),proof.path("calculations").get(0).path("metricId").asText());assertTrue(proof.path("calculations").get(0).path("backgroundVersions").asText().contains(version.versionId().toString()));
  assertEquals("private, no-store",response.getHeader("Cache-Control"));
  assertThrows(IdentityException.class,()->backgroundEvidence.get(auth,UUID.randomUUID(),job.conversation(),job.id(),response));
 }
}
