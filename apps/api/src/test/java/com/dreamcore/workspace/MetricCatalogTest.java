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
  var computed=json.valueToTree(agents.compareDataset(job.id(),job.token(),plan));assertEquals("15",computed.at("/calculation/total").asText());assertEquals(id.toString(),computed.at("/governedMetric/id").asText());
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
}
