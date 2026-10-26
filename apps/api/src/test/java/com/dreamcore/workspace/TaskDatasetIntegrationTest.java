package com.dreamcore.workspace;
import com.dreamcore.workspace.context.*;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import java.net.*;
import java.net.http.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.JsonNode;
import static org.junit.jupiter.api.Assertions.*;
class TaskDatasetIntegrationTest extends TaskDatasetFixture {
 @Autowired com.dreamcore.workspace.collection.NativeGovernanceDeployment governance;
 @Autowired com.dreamcore.workspace.profile.CompanyInformationService company;
 @Autowired DatasetTaskContext datasetContext;
 @Autowired com.dreamcore.workspace.governance.GovernanceModelService governanceChecks;
 @Autowired DatasetCalculationService calculations;
 @Autowired BriefingContentService briefings;
 @Test void ordinaryConversationReceivesOnlyCurrentPublishedDefinitionsAndOldPinnedSnapshotsDoNot(@org.junit.jupiter.api.io.TempDir java.nio.file.Path dir) throws Exception {
  db.update("INSERT INTO tenant_governance(tenant_id,owner_id) VALUES (?,?)",tenant,owner);
  company.change(owner,tenant,new com.dreamcore.workspace.profile.CompanyInformationService.Change(UUID.randomUUID(),com.dreamcore.workspace.profile.CompanyInformationService.Field.NAME,0,"ADD",null,"合成数据企业",""));
  var c=governance.context(owner,tenant,List.of(dataset));
  var fields=List.of(new com.dreamcore.workspace.collection.DatasetField("门店","text","来源门店名称","","合成负责人确认","SOURCE_DOCUMENTED"),new com.dreamcore.workspace.collection.DatasetField("数量","decimal","来源计数，单位件","件","合成负责人确认","SOURCE_DOCUMENTED"));
  governance.submit(new com.dreamcore.workspace.collection.NativeGovernanceDeployment.Package("1.0",UUID.randomUUID(),tenant,owner,c.backgroundVersion(),List.of(new com.dreamcore.workspace.collection.NativeGovernanceDeployment.Item(dataset,c.sources().getFirst().token(),fields,"",List.of("合成负责人确认")))),true);
  var plan=Map.of("name","合成门店数量","meaning","来源数量，不推断销售额","unit","件","grain","来源记录","scope","全部当前快照","exclusions","无","evidence","合成负责人已核对","aggregation","SUM","valueField","数量","execution",Map.of("groupColumns",List.of("门店"),"dateColumn","","dateFrom","","dateTo","","timeZone","Asia/Shanghai","reviewed",true));
  var sourceRule=Map.of("datasetId",dataset.toString(),"kind","column","name","门店","type","text","key","PRI","nullable","NO");
  var export=Map.of("datasetId",dataset.toString(),"kind","export-validation","snapshotId",snapshot.toString(),"rowCount",rowsFor("旧版本").size(),"columns",columns(),"candidateKeyColumns",List.of("门店"),"rowsSha256",com.dreamcore.workspace.identity.IdentityService.hash(json.writeValueAsString(rowsFor("旧版本"))));
  var file=dir.resolve("plans.json");java.nio.file.Files.writeString(file,json.writeValueAsString(Map.of("tenantId",tenant.toString(),"schema",List.of(Map.of("datasetId",dataset.toString(),"kind","analysis-plan","definition",plan),sourceRule,export))));
  org.springframework.test.util.ReflectionTestUtils.setField(governanceChecks,"evidencePath",file.toString());
  org.springframework.test.util.ReflectionTestUtils.setField(datasetContext,"evidencePath",file.toString());
  try {
  var t=task(null,"AUTHORIZED_LIBRARY");var read=call(t,request("dataset_read",dataset,snapshot,0));
  assertEquals("数量",read.at("/source/nativeAnalysisPlans/items/0/executionRequest/valueColumn").asString());
  assertEquals("PUBLISHED_GOVERNANCE",read.at("/source/definitionOrigin").asString());
  assertEquals("件",read.at("/source/fieldDefinitions/1/unit").asString());
  assertEquals("件",read.at("/source/publishedFieldUnits/数量").asString());
  assertEquals("NATIVE_GOVERNANCE_RELEASE",read.at("/source/governedFields/source").asString());
  assertEquals("件",read.at("/source/governedFields/fields/1/unit").asString());
  assertEquals("SOURCE_DOCUMENTED",read.at("/source/governedFields/fields/1/status").asString());
  var calculated=json.valueToTree(calculations.calculate(t,new DatasetCalculationService.Request(dataset,snapshot,null,null,"数量",null,null,null,"Asia/Shanghai","SUM","SUMMARY",List.of("门店"),null,null,null,null)));
  db.update("INSERT INTO conversation_tool_receipts(task_id,attempt_number,sequence,name,status) VALUES (?,1,1,'compare_dataset','succeeded')",t.id());
  var document=briefings.create(t,new BriefingContentService.Request(UUID.fromString(calculated.at("/artifact/id").asString()),"合成门店来源数量汇总","当前仅核对已授权合成来源数量，完整记录按固定快照计算。",List.of("本次仅依据合成门店登记的数量，单位为件。","这些是来源记录，不代表销售额或银行到账。"),"DATA",new BriefingPresentationPolicy.Presentation("briefing-presentation-v1","EDITORIAL","CURRENT_BAR",null,null,List.of())));
  assertEquals("件",document.content().chart().unit());
  version(2,"修改来源");
  var old=call(t,request("dataset_read",dataset,snapshot,0));
  assertEquals("NONE",old.at("/source/governedFields/source").asString());assertTrue(old.at("/source/nativeAnalysisPlans").isMissingNode());
  db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,owner);
  denied(()->call(t,request("dataset_read",dataset,snapshot,0)));
  } finally {org.springframework.test.util.ReflectionTestUtils.setField(datasetContext,"evidencePath","");org.springframework.test.util.ReflectionTestUtils.setField(governanceChecks,"evidencePath","");}
 }
 @Test void searchAndReadPinExactVersionAndClearlyBoundThePage(){
  var t=task(null,"AUTHORIZED_LIBRARY");assertEquals("1.0",agents.check(t.id(),t.token()).get("datasetContextVersion"));var found=call(t,request("dataset_search",null,null,0));assertEquals(1,found.get("items").size());assertFalse(found.toString().contains("部署路径"));assertFalse(found.toString().contains("部署权限说明"));
  UUID next=version(2,"新版本");var read=call(t,request("dataset_read",dataset,snapshot,0));assertEquals(1,read.get("source").get("version").asInt());assertTrue(read.get("source").get("coverageThrough").isNull());assertEquals(5,read.get("rows").size());assertTrue(read.get("hasMore").asBoolean());assertFalse(read.get("completeDataset").asBoolean());assertEquals(5,read.get("nextOffset").asInt());assertEquals("旧版本0",read.get("rows").get(0).get(0).asString());
  var tail=call(t,request("dataset_read",dataset,snapshot,5));assertFalse(tail.get("hasMore").asBoolean());assertEquals(1,tail.get("rows").size());denied(()->call(t,request("dataset_read",dataset,next,0)));assertTrue(agents.active(t));
 }
 @Test void deploymentExplanationsReachOnlyAuthorizedTaskColumnsWithoutRuntimeInference(){
  UUID defined=UUID.randomUUID(),snap=UUID.randomUUID(),run=UUID.randomUUID();
  String fields="[{\"column\":\"编号\",\"type\":\"text\",\"meaning\":\"来源标识\",\"unit\":\"\",\"evidence\":\"部署时源字典\",\"status\":\"SOURCE_DOCUMENTED\"}]";
  db.update("INSERT INTO business_datasets(id,tenant_id,connection_id,workspace_id,dataset_key,name,column_names,field_definitions) VALUES (?,?,?,?,'defined','部署定义数据','[\"编号\"]',CAST(? AS jsonb))",defined,tenant,connection,space,fields);
  db.update("INSERT INTO collection_runs(id,tenant_id,connection_id,execution_epoch,trigger_kind,status) VALUES (?,?,?,1,'SCHEDULED','SUCCEEDED')",run,tenant,connection);
  db.update("INSERT INTO dataset_snapshots(id,tenant_id,connection_id,dataset_id,run_id,version,data_rows,row_count,collected_at) VALUES (?,?,?,?,?,1,'[[\"001\"]]',1,now())",snap,tenant,connection,defined,run);
  db.update("UPDATE business_datasets SET current_snapshot=? WHERE id=?",snap,defined);
  var t=task(null,"AUTHORIZED_LIBRARY");var result=call(t,request("dataset_read",defined,snap,0));
  assertEquals("DEPLOYMENT",result.at("/source/definitionOrigin").asString());
  assertEquals("部署时源字典",result.at("/source/fieldDefinitions/0/evidence").asString());
  assertFalse(result.at("/source/authority").asBoolean());
  db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,owner);
  denied(()->call(t,request("dataset_read",defined,snap,0)));
 }
 @Test void deniedWorkspaceIsExcludedBeforeTaskMetadataOrFieldsAreProjected(){
  db.update("INSERT INTO library_permission_rollouts VALUES (?,true)",tenant);
  db.update("INSERT INTO library_policies(tenant_id,object_kind,object_id,workspace_id) VALUES (?,'WORKSPACE',?,?)",tenant,space,space);
  db.update("INSERT INTO library_grants(tenant_id,object_kind,object_id,principal_kind,principal_id,content,download) VALUES (?,'WORKSPACE',?,'ACCOUNT',?,'NONE','DENY')",tenant,space,owner);
  var t=task(null,"AUTHORIZED_LIBRARY");
  assertEquals(0,call(t,request("dataset_search",null,null,0)).get("items").size());
  denied(()->call(t,request("dataset_read",dataset,snapshot,0)));
 }
 @Test void taskScopeAndDatasetIdentityNeverGrantOtherContent(){
  var t=task(null,"WORKSPACE");assertEquals(0,call(t,request("dataset_search",null,null,0)).get("items").size());denied(()->call(t,request("dataset_read",dataset,snapshot,0)));
  db.update("UPDATE conversation_tasks SET source_scope='SELECTED' WHERE id=?",t.id());assertEquals("SELECTED_ONLY",call(t,request("dataset_search",null,null,0)).get("reason").asString());assertTrue(call(t,request("dataset_read",dataset,snapshot,0)).get("unavailable").asBoolean());
  db.update("UPDATE conversation_tasks SET source_scope='AUTHORIZED_LIBRARY' WHERE id=?",t.id());denied(()->call(t,request("dataset_read",UUID.randomUUID(),snapshot,0)));denied(()->call(t,request("dataset_read",dataset,UUID.randomUUID(),0)));
  db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,owner);assertEquals(0,call(t,request("dataset_search",null,null,0)).get("items").size());denied(()->call(t,request("dataset_read",dataset,snapshot,0)));
 }
 @Test void revokedSourceHidesHistoryDerivedAnswersAndStopsTheLiveTask(){
  var first=task(null,"AUTHORIZED_LIBRARY");call(first,request("dataset_read",dataset,snapshot,0));finish(first);
  var second=task(first.conversation(),"AUTHORIZED_LIBRARY");call(second,request("history",null,null,0));finish(second);
  var live=task(first.conversation(),"AUTHORIZED_LIBRARY");call(live,request("history",null,null,0));
  db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,owner);
  assertFalse(agents.active(live));var detail=conversations.detail(owner,tenant,first.conversation(),0,20);assertTrue(detail.tasks().stream().allMatch(ConversationService.Task::sourcesUnavailable));assertTrue(detail.tasks().stream().allMatch(x->x.reply()==null));
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",tenant,space,owner);
  assertFalse(agents.active(live));denied(()->finish(live));
  assertEquals(1,db.queryForObject("SELECT count(*) FROM task_dataset_fences WHERE task_id=?",Integer.class,live.id()));
 }
 @Test void sourceBoundExperienceCarriesDatasetDependencyWithoutCitingItAgain(){
  var source=task(null,"AUTHORIZED_LIBRARY");call(source,request("dataset_read",dataset,snapshot,0));finish(source);
  var content=new com.dreamcore.workspace.experience.ExperienceService.Content("METHOD","合成数据参考","摘要","基于来源的合成方法",List.of("测试"),"适用","排除","无","合成","SOURCE_BOUND");
  var e=experiences.create(owner,tenant,privateSpace,UUID.randomUUID(),content,List.of(new com.dreamcore.workspace.experience.ExperienceService.Evidence("TASK",source.id(),privateSpace)));
  e=experiences.publish(owner,tenant,privateSpace,e.id(),UUID.randomUUID(),e.revision(),e.version().id(),false);
  // Synthetic admitted provenance only: the test exercises downstream dataset dependence, not model quality.
  db.update("UPDATE experience_versions SET origin='AUTOMATIC',evaluation='AUTOMATIC_CHECKED' WHERE id=?",e.version().id());
  var current=task(null,"AUTHORIZED_LIBRARY");call(current,request("experience_read",e.id(),e.version().id(),0));finish(current);
  db.update("UPDATE business_datasets SET status='WITHDRAWN' WHERE id=?",dataset);
  assertEquals(0,db.queryForObject("SELECT count(*) FROM readable_source_tasks WHERE id IN (?,?)",Integer.class,source.id(),current.id()));
 }
 @Test void cleanupErasesPrivateDerivedTextWhileNormalRefreshKeepsItReadable(){
  var source=task(null,"AUTHORIZED_LIBRARY");call(source,request("dataset_read",dataset,snapshot,0));finish(source);var current=task(source.conversation(),"AUTHORIZED_LIBRARY");call(current,request("history",null,null,0));finish(current);
  version(2,"更新数据");assertEquals(2,db.queryForObject("SELECT count(*) FROM readable_source_tasks WHERE id IN (?,?)",Integer.class,source.id(),current.id()));
  db.update("UPDATE dataset_snapshots SET data_rows='[]'::jsonb,scrubbed=true WHERE id=?",snapshot);
  assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_tasks WHERE id IN (?,?) AND coalesce(reply,'') LIKE '%合成结论%'",Integer.class,source.id(),current.id()));assertEquals(0,db.queryForObject("SELECT count(*) FROM readable_source_tasks WHERE id IN (?,?)",Integer.class,source.id(),current.id()));
 }
 @Test void wideRowsCanBeReadByColumnWithoutSilentlyTruncatingCells(){
  UUID wide=UUID.randomUUID(),snap=UUID.randomUUID(),run=UUID.randomUUID();
  var columns=new ArrayList<String>();var values=new ArrayList<String>();for(int i=0;i<12;i++){columns.add("列"+i);values.add("数".repeat(8192));}
  db.update("INSERT INTO business_datasets(id,tenant_id,connection_id,workspace_id,dataset_key,name,column_names) VALUES (?,?,?,?,'wide','宽表',CAST(? AS jsonb))",wide,tenant,connection,space,json.writeValueAsString(columns));
  db.update("INSERT INTO collection_runs(id,tenant_id,connection_id,execution_epoch,trigger_kind,status) VALUES (?,?,?,1,'SCHEDULED','SUCCEEDED')",run,tenant,connection);
  db.update("INSERT INTO dataset_snapshots(id,tenant_id,connection_id,dataset_id,run_id,version,data_rows,row_count,collected_at) VALUES (?,?,?,?,?,1,CAST(? AS jsonb),1,now())",snap,tenant,connection,wide,run,json.writeValueAsString(List.of(values)));
  db.update("UPDATE business_datasets SET current_snapshot=? WHERE id=?",snap,wide);var task=task(null,"AUTHORIZED_LIBRARY");
  assertEquals("TASK_DATASET_ROW_LIMIT",assertThrows(IdentityException.class,()->call(task,request("dataset_read",wide,snap,0))).code);
  var read=call(task,new TaskContextService.Request("dataset_read",null,null,0,wide,snap,null,null,null,null,null,11,1));
  assertEquals("列11",read.get("source").get("columns").get(0).asString());assertTrue(read.get("source").get("nextColumnOffset").isNull());assertEquals(8192,read.get("rows").get(0).get(0).asString().length());assertFalse(read.get("completeDataset").asBoolean());
 }
 @Test void feedbackAndDiscussionKeepTheOriginalDataBoundary(){
  var task=task(null,"AUTHORIZED_LIBRARY");call(task,request("dataset_read",dataset,snapshot,0));finish(task);
  UUID feedback=UUID.randomUUID();var state=db.queryForMap("SELECT revision,attempt FROM conversation_tasks WHERE id=?",task.id());
  db.update("INSERT INTO feedback_entries(id,tenant_id,workspace_id,actor_id,kind,task_id,task_revision,attempt,presentation_version,presentation_revision,snapshot) VALUES (?,?,?,?,'TASK',?,?,?,'task-v1',0,'{}'::jsonb)",feedback,tenant,privateSpace,owner,task.id(),state.get("revision"),state.get("attempt"));
  db.update("INSERT INTO feedback_versions(id,feedback_id,revision,status,assessment) VALUES (?,?,1,'ACTIVE','{}'::jsonb)",UUID.randomUUID(),feedback);
  var discussion=task(null,"AUTHORIZED_LIBRARY");db.update("INSERT INTO briefing_discussions(conversation_id,source_task_id,source_revision,source_attempt,owner_id) VALUES (?,?,?,?,?)",discussion.conversation(),task.id(),state.get("revision"),state.get("attempt"),owner);
  assertEquals(1,db.queryForObject("SELECT count(*) FROM readable_feedback WHERE id=?",Integer.class,feedback));assertTrue(agents.active(discussion));
  db.update("UPDATE business_datasets SET status='WITHDRAWN' WHERE id=?",dataset);
  assertEquals(0,db.queryForObject("SELECT count(*) FROM readable_feedback WHERE id=?",Integer.class,feedback));assertFalse(agents.active(discussion));
  db.update("UPDATE business_datasets SET status='ACTIVE' WHERE id=?",dataset);assertFalse(agents.active(discussion));denied(()->finish(discussion));
 }
 @Test void callbackRequiresLiveAttemptAndNeverUsesAClientSuppliedActor()throws Exception{
  var t=task(null,"AUTHORIZED_LIBRARY");String url="http://127.0.0.1:"+port+"/internal/v1/agent-access/"+t.id()+"/context";
  var body=json.writeValueAsString(request("dataset_search",null,null,0));var client=HttpClient.newHttpClient();
  var forbidden=client.send(HttpRequest.newBuilder(URI.create(url)).header("Content-Type","application/json").header("Authorization","Bearer "+UUID.randomUUID()).POST(HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());assertEquals(403,forbidden.statusCode());
  var response=client.send(HttpRequest.newBuilder(URI.create(url)).header("Content-Type","application/json").header("Authorization","Bearer "+t.token()).POST(HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,response.statusCode());assertTrue(response.headers().firstValue("Cache-Control").orElse("").contains("no-store"));assertFalse(response.body().contains(t.token().toString()));
  db.update("UPDATE tenants SET status='SUSPENDED' WHERE id=?",tenant);denied(()->call(t,request("dataset_read",dataset,snapshot,0)));
 }
}
