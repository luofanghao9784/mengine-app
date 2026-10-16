package com.dreamcore.workspace;
import com.dreamcore.workspace.analysis.governed.*;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.scene.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.junit.jupiter.api.Assertions.*;

class GovernedFusionIntegrationTest extends TaskDatasetFixture {
 @Autowired GovernedFusionService fusion;@Autowired MetricCatalog catalog;@Autowired PlatformTransactionManager manager;
 @Autowired BriefingContentService contents;
 @MockitoBean SceneBridgeClient bridge;
 UUID dimension,other,policy,batch,taskId,metricA,metricB;
 @Override List<String> columns(){return List.of("id","owner","amount");}
 @Override List<List<String>> rowsFor(String marker){return List.of(List.of("a","s","10.10"),List.of("b","s","20.20"));}
 @Override UUID version(int n,List<?> rows){
  UUID id=UUID.randomUUID(),run=UUID.randomUUID();
  db.update("INSERT INTO collection_runs(id,tenant_id,connection_id,execution_epoch,trigger_kind,status) VALUES(?,?,?,1,'SCHEDULED','SUCCEEDED')",run,tenant,connection);
  db.update("INSERT INTO dataset_snapshots(id,tenant_id,connection_id,dataset_id,run_id,version,data_rows,row_count,collected_at,coverage_through) VALUES(?,?,?,?,?,?,?::jsonb,?,now(),now())",id,tenant,connection,dataset,run,n,json.writeValueAsString(rows),rows.size());
  db.update("UPDATE business_datasets SET current_snapshot=? WHERE id=?",id,dataset);return id;
 }
 void meta(UUID data,String source,boolean relation){
  var fields=source.equals("dim")?List.of(Map.of("name","id","type","text"),Map.of("name","name","type","text")):List.of(Map.of("name","id","type","text"),Map.of("name","owner","type","text"),Map.of("name","amount","type","number"));
  var r=Map.of("id","registered","name","所属组织","evidence","合成来源登记关系","targetId","dim","targetFingerprint","schema:dim","keys",List.of(Map.of("local","owner","foreign","id")));
  var m=Map.of("fields",fields,"dictionaryFingerprint","schema:"+source,"dictionary",Map.of("relations",relation?List.of(r):List.of()),"governance",Map.of("allowedActors",List.of(owner.toString()),"policyVersion",1));
  String text=json.writeValueAsString(m);db.update("INSERT INTO scene_asset_links(tenant_id,source_id,kind,target_id,revision,metadata) VALUES(?,?,'TABLE',?,'v1',?::jsonb)",tenant,source,data,text);
  db.update("INSERT INTO scene_asset_revisions(tenant_id,target_id,kind,revision,metadata) VALUES(?,?,'TABLE','v1',?::jsonb)",tenant,data,text);
 }
 UUID add(String name,List<String> cols,List<List<String>> rows){
  UUID old=dataset;dataset=UUID.randomUUID();db.update("INSERT INTO business_datasets(id,tenant_id,connection_id,workspace_id,dataset_key,name,column_names) VALUES(?,?,?,?,?,?,?::jsonb)",dataset,tenant,connection,space,name,name,json.writeValueAsString(cols));version(1,rows);UUID id=dataset;dataset=old;return id;
 }
 UUID publish(String source,String name){
  var d=new LinkedHashMap<String,Object>();d.putAll(Map.of("name",name,"meaning","合成登记金额合计","unit","元","grain","每条登记事实","scope","合成全快照","exclusions","无","evidence","合成用例的明确口径","aggregation","SUM","valueField","amount"));
  d.put("execution",Map.of("groupColumns",List.of(),"dateColumn","","dateFrom","","dateTo","","timeZone","Asia/Shanghai","reviewed",true));
  UUID id=UUID.fromString(json.valueToTree(catalog.save(owner,tenant,false,new MetricCatalog.Change(null,0,source,d))).path("id").asText());catalog.transition(owner,tenant,false,id,new MetricCatalog.Transition(1),true);return id;
 }
 @BeforeEach void prepare(){
  db.update("UPDATE tenant_memberships SET role='TENANT_ADMIN' WHERE tenant_id=?",tenant);
  db.update("INSERT INTO scene_bindings(tenant_id,workspace_id,connection_id,maintainer_id,governance_valid_until) VALUES(?,?,?,?,now()+interval '10 minutes')",tenant,space,connection,owner);
  when(bridge.call(eq(tenant),anyString(),eq("GET"),eq("/scene-access"),isNull())).thenReturn(json.readTree("{\"user\":{\"role\":\"admin\"}}"));
  dimension=add("dim",List.of("id","name"),List.of(List.of("s","同一组织")));
  other=add("b",columns(),List.of(List.of("p1","s","3.30"),List.of("p2","s","6.80"),List.of("p3","s","20.20")));
  meta(dataset,"a",true);meta(other,"b",true);meta(dimension,"dim",false);

  metricA=publish("a","订单登记金额");metricB=publish("b","收款登记金额");
  policy=UUID.randomUUID();batch=UUID.randomUUID();
  db.update("INSERT INTO briefing_generation_policies(id,tenant_id,owner_id,workspace_id,enabled) VALUES(?,?,?,?,false)",policy,tenant,owner,space);
  var submitted=conversations.submit(owner,tenant,null,space,UUID.randomUUID(),"根据已发布指标执行关联分析","AGENT");taskId=submitted.tasks().getLast().id();
  db.update("UPDATE conversation_tasks SET source_scope='SELECTED' WHERE id=?",taskId);
  db.update("INSERT INTO briefing_generation_batches(id,tenant_id,owner_id,workspace_id,policy_id,policy_epoch,trigger_kind,business_type,status,task_id) VALUES(?,?,?,?,?,1,'INITIALIZATION','DATA','QUEUED',?)",batch,tenant,owner,space,policy,taskId);
  db.update("INSERT INTO briefing_dataset_selections(task_id,batch_id,dataset_id,snapshot_id) VALUES(?,?,?,?)",taskId,batch,dataset,snapshot);
 }
 void plan(){new TransactionTemplate(manager).executeWithoutResult(x->fusion.prepareQueued(policy));}
 ConversationService.Job start(){plan();assertEquals(1,db.queryForObject("SELECT count(*) FROM governed_fusion_task_plans WHERE task_id=?",Integer.class,taskId));var job=conversations.claim();assertEquals(taskId,job.id());agents.openExecution(job.id(),job.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("task_context","compare_dataset","deliver_briefing")));return job;}
 tools.jackson.databind.JsonNode calculate(ConversationService.Job job){
  agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(1,"task_context","STARTED"));var ctx=call(job,request("dataset_search",null,null,0));assertTrue(ctx.has("fusionPlan"));
  var request=json.treeToValue(ctx.at("/fusionPlan/metrics/0/executionRequest"),DatasetCalculationService.Request.class);
  agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(1,"task_context","succeeded"));agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(2,"compare_dataset","STARTED"));
  var result=json.valueToTree(agents.compareDataset(job.id(),job.token(),request));agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(2,"compare_dataset","succeeded"));return result;
 }
 @Test void fixesAllSourcesBeforeClaimAndPublishesRealJoinedGroups(){
  var job=start();var result=calculate(job);assertEquals(3,db.queryForObject("SELECT count(*) FROM task_dataset_reads WHERE task_id=?",Integer.class,taskId));
  assertEquals(2,result.at("/fusion/results").size());assertEquals("30.30",result.at("/fusion/results/0/total").asText());assertEquals("30.30",result.at("/fusion/results/1/total").asText());
  assertEquals("s",result.at("/fusion/results/0/groups/0/dimensions/0").asText());
  UUID artifact=UUID.fromString(result.at("/artifact/id").asText());
  agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(3,"deliver_briefing","STARTED"));
  var req=new BriefingContentService.Request(artifact,"订单与收款的关联汇总","按相同组织关联维度，核对订单登记金额与收款登记金额。",List.of("订单登记金额来自订单事实独立汇总，不能按多笔收款重复累计。","收款登记金额来自收款事实独立汇总，两项金额相同不代表订单逐笔完成结算。"));
  assertEquals("PREPARED",agents.deliverBriefing(job.id(),job.token(),req).get("status"));agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(3,"deliver_briefing","succeeded"));
  var doc=contents.find(job.id(),1);assertNotNull(doc);assertEquals(2,doc.content().fusion().path("results").size());assertEquals("同一组织",doc.content().chart().rows().getFirst().group());
 }
 @Test void revokingAuxiliarySourcePreventsBothCalculationAndDelivery(){
  var job=start();var result=calculate(job);UUID artifact=UUID.fromString(result.at("/artifact/id").asText());
  db.update("UPDATE scene_asset_links SET active=false WHERE tenant_id=? AND target_id=?",tenant,other);
  assertThrows(IdentityException.class,()->new TransactionTemplate(manager).execute(x->fusion.evidence(job.id(),1,artifact)));
 }
 @Test void duplicateDimensionKeysDeclineFusionRatherThanMultiplyAmounts(){
  UUID saved=dataset;dataset=dimension;version(2,List.of(List.of("s","first"),List.of("s","second")));dataset=saved;assertThrows(IdentityException.class,this::plan);
  assertEquals(0,db.queryForObject("SELECT count(*) FROM governed_fusion_task_plans WHERE task_id=?",Integer.class,taskId));
 }
 @Test void missingAuxiliaryPermissionDoesNotExpandSelection(){
  db.update("UPDATE scene_asset_links SET metadata=jsonb_set(metadata,'{governance,allowedActors}','[]'::jsonb) WHERE tenant_id=? AND target_id=?",tenant,other);plan();
  assertEquals(0,db.queryForObject("SELECT count(*) FROM governed_fusion_task_plans WHERE task_id=?",Integer.class,taskId));assertEquals(1,db.queryForObject("SELECT count(*) FROM briefing_dataset_selections WHERE task_id=?",Integer.class,taskId));
 }
 @Test void changingRegisteredRelationAfterClaimRejectsRetrieval(){var job=start();db.update("UPDATE scene_asset_links SET metadata=jsonb_set(metadata,'{dictionary,relations}','[]'::jsonb) WHERE tenant_id=? AND target_id=?",tenant,dataset);assertThrows(IdentityException.class,()->call(job,request("dataset_search",null,null,0)));}
}
