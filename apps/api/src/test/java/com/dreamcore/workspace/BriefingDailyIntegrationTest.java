package com.dreamcore.workspace;
import com.dreamcore.workspace.briefing.*;
import com.dreamcore.workspace.conversation.*;
import java.time.*;
import java.net.*;
import java.net.http.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import static org.junit.jupiter.api.Assertions.*;
@TestPropertySource(properties={"dreamcore.knowledge.enabled=true","dreamcore.briefing.daily-enabled=true","dreamcore.briefing.automatic-enabled=false","dreamcore.briefing.merge-seconds=0","dreamcore.briefing.initial-delay-ms=3600000"})
class BriefingDailyIntegrationTest extends DatasetCalculationFixture {
 @Autowired BriefingGenerationService generation;
 @Autowired BriefingFlowGuard guard;
 @BeforeEach void owner(){db.update("INSERT INTO tenant_governance(tenant_id,owner_id) VALUES (?,?) ON CONFLICT(tenant_id) DO UPDATE SET owner_id=excluded.owner_id",tenant,owner);}
 @Override UUID version(int n,List<?> rows){UUID id=UUID.randomUUID(),run=UUID.randomUUID();db.update("INSERT INTO collection_runs(id,tenant_id,connection_id,execution_epoch,trigger_kind,status) VALUES (?,?,?,1,'SCHEDULED','SUCCEEDED')",run,tenant,connection);db.update("INSERT INTO dataset_snapshots(id,tenant_id,connection_id,dataset_id,run_id,version,data_rows,row_count,collected_at,coverage_through) VALUES (?,?,?,?,?,?,?::jsonb,?,now(),now())",id,tenant,connection,dataset,run,n,json.writeValueAsString(rows),rows.size());db.update("UPDATE business_datasets SET current_snapshot=? WHERE id=?",id,dataset);return id;}
 UUID schedule(){generation.configureDaily(owner,tenant,space,0,true,null);UUID p=generation.state(owner,tenant).policies().getFirst().id();db.update("UPDATE briefing_daily_schedules SET next_due=now()-interval '1 second' WHERE policy_id=?",p);return p;}
 @Test void timerIsDurableOncePerLocalDayAndNextNine(){UUID p=schedule();generation.dispatchDaily(p);generation.dispatchDaily(p);assertEquals(1,db.queryForObject("SELECT count(*) FROM briefing_daily_runs WHERE policy_id=?",Integer.class,p));var daily=generation.daily(owner,tenant,space);assertEquals(LocalTime.of(9,0),daily.nextDue().atZone(ZoneId.of("Asia/Shanghai")).toLocalTime());assertTrue(daily.nextDue().isAfter(Instant.now()));generation.tick(p);var b=generation.state(owner,tenant).batches().getFirst();assertEquals("SCHEDULE",b.trigger());assertEquals("RUNNING",b.status());assertTrue(generation.candidates().contains(p));assertEquals(1,db.queryForObject("SELECT count(*) FROM briefing_flow_tasks WHERE task_id=?",Integer.class,b.taskId()));}
 @Test void clickAndTimerMergeIntoSamePrivateBatch(){UUID p=schedule();generation.dispatchDaily(p);var click=generation.generateSelection(owner,tenant,UUID.randomUUID(),null,1,List.of()).getFirst();assertEquals(space,click.workspaceId());assertEquals("SCHEDULE",click.trigger());generation.tick(p);assertEquals(1,generation.state(owner,tenant).batches().size());var job=conversations.claim();assertEquals(click.id(),db.queryForObject("SELECT id FROM briefing_generation_batches WHERE task_id=?",UUID.class,job.id()));guard.requireCurrent(job.id());}
 @Test void manualFirstThenTimerAlsoMerges(){UUID p=schedule();var click=generation.generate(owner,tenant,UUID.randomUUID(),null,null);generation.dispatchDaily(p);assertEquals(click.id(),db.queryForObject("SELECT batch_id FROM briefing_daily_runs WHERE policy_id=?",UUID.class,p));assertEquals(1,generation.state(owner,tenant).batches().size());}
 @Test void changedDataBlocksRunningTaskButIdenticalSnapshotDoesNot(){UUID p=schedule();generation.dispatchDaily(p);generation.tick(p);var job=conversations.claim();guard.requireCurrent(job.id());version(2,rowsFor("old"));guard.requireCurrent(job.id());version(3,"new");denied(()->guard.requireCurrent(job.id()));denied(()->agents.check(job.id(),job.token()));}
 @Test void ownerChangeAndScheduleRevisionFenceRunningTask(){UUID p=schedule();generation.dispatchDaily(p);generation.tick(p);var job=conversations.claim();generation.configureDaily(owner,tenant,space,1,false,null);denied(()->guard.requireCurrent(job.id()));}
 @Test void nonOwnerCannotEnableAndRevisionCannotOverwrite(){db.update("UPDATE tenant_governance SET owner_id=NULL WHERE tenant_id=?",tenant);denied(()->generation.configureDaily(owner,tenant,space,0,true,null));db.update("UPDATE tenant_governance SET owner_id=? WHERE tenant_id=?",owner,tenant);schedule();denied(()->generation.configureDaily(owner,tenant,space,0,true,null));}
 @Test void waitingHasBoundedDeadline(){UUID p=schedule();generation.dispatchDaily(p);db.update("UPDATE briefing_generation_batches SET created_at=now()-interval '16 minutes' WHERE policy_id=?",p);generation.tick(p);assertEquals("GENERATION_DEADLINE_EXCEEDED",generation.state(owner,tenant).batches().getFirst().reason());generation.dispatchDaily(p);assertEquals(1,generation.state(owner,tenant).batches().size());}
 java.util.UUID compute(com.dreamcore.workspace.conversation.ConversationService.Job j){
  agents.openExecution(j.id(),j.token(),new com.dreamcore.workspace.conversation.AgentTaskService.ExecutionOpen("1.5",List.of("task_context","compare_dataset")));
  agents.toolReceipt(j.id(),j.token(),new com.dreamcore.workspace.conversation.AgentTaskService.ToolReceipt(1,"task_context","STARTED"));call(j,request("dataset_search",null,null,0));
  agents.toolReceipt(j.id(),j.token(),new com.dreamcore.workspace.conversation.AgentTaskService.ToolReceipt(1,"task_context","succeeded"));
  agents.toolReceipt(j.id(),j.token(),new com.dreamcore.workspace.conversation.AgentTaskService.ToolReceipt(2,"compare_dataset","STARTED"));
  var result=json.valueToTree(agents.compareDataset(j.id(),j.token(),new com.dreamcore.workspace.conversation.DatasetCalculationService.Request(dataset,snapshot,"门店","期间","收款（元）","前期","本期")));
  agents.toolReceipt(j.id(),j.token(),new com.dreamcore.workspace.conversation.AgentTaskService.ToolReceipt(2,"compare_dataset","succeeded"));
  agents.finish(j,new com.dreamcore.workspace.conversation.AgentResult("1.5","0.16.0",j.id(),j.token(),"AGENT","verification","synthetic-pool","固定版本计算完成。",List.of(),List.of(new com.dreamcore.workspace.conversation.AgentResult.Tool("s","task_context","succeeded"),new com.dreamcore.workspace.conversation.AgentResult.Tool("c","compare_dataset","succeeded")),List.of(),2,null,List.of(),List.of(),List.of(),"COMPLETE",null));
  return UUID.fromString(result.at("/artifact/id").asString());
 }
 @Test void successfulCalculationRetainsAutomaticallyAndSecondTaskActuallyReuses(){
  UUID p=schedule();generation.dispatchDaily(p);generation.tick(p);var first=conversations.claim();compute(first);generation.tick(p);
  assertEquals(1,db.queryForObject("SELECT count(*) FROM briefing_flow_materials WHERE task_id=?",Integer.class,first.id()));
  snapshot=version(2,rowsFor("old"));var manual=generation.generate(owner,tenant,UUID.randomUUID(),null,null);generation.tick(p);var second=conversations.claim();assertNull(manual.taskId());compute(second);
  assertEquals(1,db.queryForObject("SELECT count(*) FROM briefing_material_uses WHERE task_id=?",Integer.class,second.id()));
  assertEquals(1,db.queryForObject("SELECT count(*) FROM analysis_material_versions WHERE tenant_id=?",Integer.class,tenant));
  assertEquals(db.queryForObject("SELECT version_id FROM briefing_flow_materials WHERE task_id=?",UUID.class,first.id()),db.queryForObject("SELECT version_id FROM briefing_flow_materials WHERE task_id=?",UUID.class,second.id()));
 }

 @Autowired com.dreamcore.workspace.material.MaterialService materials;
 @Autowired com.dreamcore.workspace.knowledge.KnowledgeService knowledge;
 void documentEvidence(){
  var f=materials.uploadReceipt(owner,tenant,space,null,null,null,UUID.randomUUID(),new org.springframework.mock.web.MockMultipartFile("file","procedure.txt","application/octet-stream","synthetic procedure evidence".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
  var j=knowledge.claim();assertEquals(f.acceptedVersion().id(),j.version());
  knowledge.finish(j,new com.dreamcore.workspace.knowledge.DocumentParser.Result("synthetic","READY",List.of(),List.of(new com.dreamcore.workspace.knowledge.DocumentParser.Fragment("L1","synthetic procedure evidence","TEXT"))));
 }
 void unknownCoverage(){
  UUID fresh=UUID.randomUUID(),run=UUID.randomUUID();
  db.update("INSERT INTO collection_runs(id,tenant_id,connection_id,execution_epoch,trigger_kind,status) VALUES (?,?,?,1,'SCHEDULED','SUCCEEDED')",run,tenant,connection);
  db.update("INSERT INTO dataset_snapshots(id,tenant_id,connection_id,dataset_id,run_id,version,data_rows,row_count,collected_at) SELECT ?,tenant_id,connection_id,dataset_id,?,2,data_rows,row_count,collected_at FROM dataset_snapshots WHERE id=?",fresh,run,snapshot);
  db.update("UPDATE business_datasets SET current_snapshot=? WHERE id=?",fresh,dataset);
 }
 @Test void dailyAutoUsesDocumentsWhenDatasetIsStale(){
  documentEvidence();unknownCoverage();
  UUID p=schedule();generation.dispatchDaily(p);generation.tick(p);
  var b=generation.state(owner,tenant).batches().getFirst();assertEquals("RUNNING",b.status());
  assertEquals(0,db.queryForObject("SELECT count(*) FROM briefing_dataset_selections WHERE task_id=?",Integer.class,b.taskId()));
 }
 @Test void explicitDataStillWaitsEvenWithDocuments(){
  documentEvidence();unknownCoverage();
  UUID p=schedule();var b=generation.generate(owner,tenant,UUID.randomUUID(),space,"DATA");generation.tick(p);
  assertEquals("SOURCE_COVERAGE_TOO_OLD",generation.get(owner,tenant,b.id()).reason());
 }
 @Test void unknownCoverageWaitsWithoutModelAndNoCatchUpStorm(){UUID p=schedule();UUID old=snapshot;UUID fresh=UUID.randomUUID(),run=UUID.randomUUID();db.update("INSERT INTO collection_runs(id,tenant_id,connection_id,execution_epoch,trigger_kind,status) VALUES (?,?,?,1,'SCHEDULED','SUCCEEDED')",run,tenant,connection);db.update("INSERT INTO dataset_snapshots(id,tenant_id,connection_id,dataset_id,run_id,version,data_rows,row_count,collected_at) SELECT ?,tenant_id,connection_id,dataset_id,?,2,data_rows,row_count,collected_at FROM dataset_snapshots WHERE id=?",fresh,run,old);db.update("UPDATE business_datasets SET current_snapshot=? WHERE id=?",fresh,dataset);generation.dispatchDaily(p);generation.tick(p);assertEquals("SOURCE_COVERAGE_TOO_OLD",generation.state(owner,tenant).batches().getFirst().reason());assertNull(generation.state(owner,tenant).batches().getFirst().taskId());}
 @Test void identicalNewSnapshotDoesNotSpendModelBudgetForDeliveredTopic(){UUID p=schedule();generation.dispatchDaily(p);generation.tick(p);var b=generation.state(owner,tenant).batches().getFirst();db.update("UPDATE conversation_tasks SET status='SUCCEEDED',lease_token=NULL,lease_until=NULL,finished_at=now() WHERE id=?",b.taskId());db.update("UPDATE briefing_generation_batches SET status='SUCCEEDED',finished_at=now() WHERE id=?",b.id());snapshot=version(2,rowsFor("old"));var manual=generation.generate(owner,tenant,UUID.randomUUID(),null,null);generation.tick(p);var result=generation.get(owner,tenant,manual.id());assertEquals("NO_NEW_CONTENT",result.status());assertEquals("SOURCES_UNCHANGED",result.reason());assertNull(result.taskId());}
    @Autowired org.springframework.security.crypto.password.PasswordEncoder passwords;
    class Browser {
        final HttpClient client=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();
        String csrf;
        HttpResponse<String> call(String method,String path,Object body,boolean withCsrf) throws Exception {
            var builder=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).header("Content-Type","application/json");
            if(withCsrf) builder.header("X-CSRF-TOKEN",csrf);
            return client.send(builder.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build(),HttpResponse.BodyHandlers.ofString());
        }
        Browser(UUID actor) throws Exception {
            db.update("UPDATE accounts SET password_hash=? WHERE id=?",passwords.encode("synthetic-pool-password"),actor);
            csrf=json.readTree(call("GET","/api/v1/auth/csrf",null,false).body()).path("token").asString();
            String email=db.queryForObject("SELECT email FROM accounts WHERE id=?",String.class,actor);
            assertEquals(200,call("POST","/api/v1/auth/login",Map.of("email",email,"password","synthetic-pool-password"),true).statusCode());
            csrf=json.readTree(call("GET","/api/v1/auth/csrf",null,false).body()).path("token").asString();
        }
    }

 @Test void dailyHttpRequiresOwnerCsrfAndExactRevision() throws Exception {
  var browser=new Browser(owner);String path="/api/v1/tenants/"+tenant+"/briefing/generation/daily";
  var body=Map.of("workspaceId",space,"expectedRevision",0,"enabled",true);
  assertEquals(403,browser.call("POST",path,body,false).statusCode());
  var saved=browser.call("POST",path,body,true);assertEquals(200,saved.statusCode(),saved.body());assertTrue(saved.headers().firstValue("Cache-Control").orElse("").contains("no-store"));
  assertEquals(409,browser.call("POST",path,body,true).statusCode());
  db.update("UPDATE tenant_governance SET owner_id=NULL WHERE tenant_id=?",tenant);
  assertEquals(403,browser.call("GET",path+"?workspaceId="+space,null,false).statusCode());
 }

 @Test void summaryCalculationDeliversSingleSeriesCardAndRetainsEvidence(){
  UUID p=schedule();generation.dispatchDaily(p);generation.tick(p);var j=conversations.claim();
  agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("task_context","compare_dataset","deliver_briefing")));
  agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,"task_context","STARTED"));call(j,request("dataset_search",null,null,0));agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,"task_context","succeeded"));
  agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(2,"compare_dataset","STARTED"));
  var result=json.valueToTree(agents.compareDataset(j.id(),j.token(),new DatasetCalculationService.Request(dataset,snapshot,null,null,null,null,null,null,null,"COUNT","SUMMARY",List.of("门店"),null,null,null,null)));
  agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(2,"compare_dataset","succeeded"));
  agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(3,"deliver_briefing","STARTED"));
  agents.deliverBriefing(j.id(),j.token(),new BriefingContentService.Request(UUID.fromString(result.at("/artifact/id").asString()),"甲店当前记录数量高于乙店","本次完整快照共有六条记录，其中甲店四条，乙店两条。",List.of("这一结果统计记录条数，不代表去重会员数量或实际收入。","后续可结合记录状态核实差异原因，当前数据不能证明经营效率存在差异。"),"DATA"));
  agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(3,"deliver_briefing","succeeded"));
  agents.finish(j,new AgentResult("1.5","0.16.0",j.id(),j.token(),"AGENT","verification","synthetic-summary","画报已经交付。",List.of(),List.of(new AgentResult.Tool("s","task_context","succeeded"),new AgentResult.Tool("c","compare_dataset","succeeded"),new AgentResult.Tool("d","deliver_briefing","succeeded")),List.of(),3,null,List.of(),List.of(),List.of(),"COMPLETE",null));
  generation.tick(p);assertEquals("SUCCEEDED",generation.state(owner,tenant).batches().getFirst().status());
  var body=json.readTree(db.queryForObject("SELECT convert_from(content,'UTF8') FROM conversation_artifacts WHERE task_id=? AND filename LIKE 'briefing-dataset-%'",String.class,j.id()));
  assertEquals("SUMMARY",body.at("/datasetBasis/periodMode").asString());assertEquals("CURRENT_BAR",body.at("/presentation/chartStyle").asString());assertTrue(body.at("/chart/totals/baseline").isNull());assertEquals("6",body.at("/chart/totals/current").asString());
  assertEquals(1,db.queryForObject("SELECT count(*) FROM briefing_flow_materials WHERE task_id=?",Integer.class,j.id()));
 }
 @Test void failedDailyHasOnlyOneExplicitTimerRetryAndPreservesOriginal(){UUID p=schedule();generation.dispatchDaily(p);var first=generation.state(owner,tenant).batches().getFirst();db.update("UPDATE briefing_generation_batches SET status='FAILED',reason='SYNTHETIC_FAILURE',finished_at=now() WHERE id=?",first.id());generation.configureDaily(owner,tenant,space,1,true,Instant.now().plusSeconds(30));db.update("UPDATE briefing_daily_schedules SET next_due=now()-interval '1 second' WHERE policy_id=?",p);db.update("UPDATE briefing_daily_retries SET scheduled_for=now()-interval '1 second' WHERE policy_id=?",p);generation.dispatchDaily(p);generation.dispatchDaily(p);assertEquals(2,generation.state(owner,tenant).batches().size());assertEquals(first.id(),db.queryForObject("SELECT batch_id FROM briefing_daily_runs WHERE policy_id=?",UUID.class,p));assertNotNull(db.queryForObject("SELECT batch_id FROM briefing_daily_retries WHERE policy_id=?",UUID.class,p));denied(()->generation.configureDaily(owner,tenant,space,2,true,Instant.now().plusSeconds(30)));}

 @Test void hourlyUnchangedSnapshotsDoNotStarveUnexaminedDatasets(){
  for(int n=0;n<3;n++){UUID extra=UUID.randomUUID(),snap=UUID.randomUUID();db.update("INSERT INTO business_datasets(id,tenant_id,connection_id,workspace_id,dataset_key,name,column_names) VALUES (?,?,?,?,?,?,?::jsonb)",extra,tenant,connection,space,"extra"+n,"其他数据"+n,json.writeValueAsString(columns()));db.update("INSERT INTO dataset_snapshots(id,tenant_id,connection_id,dataset_id,run_id,version,data_rows,row_count,collected_at,coverage_through) SELECT ?,tenant_id,connection_id,?,run_id,1,data_rows,row_count,collected_at,coverage_through FROM dataset_snapshots WHERE id=?",snap,extra,snapshot);db.update("UPDATE business_datasets SET current_snapshot=? WHERE id=?",snap,extra);}
  UUID p=schedule();generation.dispatchDaily(p);generation.tick(p);var first=generation.state(owner,tenant).batches().getFirst();
  var selected=db.queryForList("SELECT dataset_id FROM briefing_dataset_selections WHERE task_id=?",UUID.class,first.taskId());assertEquals(3,selected.size());
  db.update("UPDATE conversation_tasks SET status='SUCCEEDED',lease_token=NULL,lease_until=NULL,finished_at=now() WHERE id=?",first.taskId());db.update("UPDATE briefing_generation_batches SET status='SUCCEEDED',finished_at=now() WHERE id=?",first.id());
  UUID run=UUID.randomUUID();db.update("INSERT INTO collection_runs(id,tenant_id,connection_id,execution_epoch,trigger_kind,status) VALUES (?,?,?,1,'SCHEDULED','SUCCEEDED')",run,tenant,connection);
  for(var source:db.queryForList("SELECT id,current_snapshot FROM business_datasets WHERE tenant_id=?",tenant)){UUID snap=UUID.randomUUID();db.update("INSERT INTO dataset_snapshots(id,tenant_id,connection_id,dataset_id,run_id,version,data_rows,row_count,collected_at,coverage_through) SELECT ?,tenant_id,connection_id,dataset_id,?,2,data_rows,row_count,now(),now() FROM dataset_snapshots WHERE id=?",snap,run,source.get("current_snapshot"));db.update("UPDATE business_datasets SET current_snapshot=? WHERE id=?",snap,source.get("id"));}
  var clicked=generation.generate(owner,tenant,UUID.randomUUID(),null,null);generation.tick(p);var next=generation.get(owner,tenant,clicked.id());
  var nextSources=db.queryForList("SELECT dataset_id FROM briefing_dataset_selections WHERE task_id=?",UUID.class,next.taskId());assertEquals(1,nextSources.size());assertFalse(selected.contains(nextSources.getFirst()));
 }

}
