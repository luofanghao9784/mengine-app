package com.dreamcore.workspace;

import com.dreamcore.workspace.briefing.BriefingGenerationService;
import com.dreamcore.workspace.conversation.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import static org.junit.jupiter.api.Assertions.*;

@TestPropertySource(properties={"dreamcore.briefing.merge-seconds=0"})
class BriefingDatasetGenerationIntegrationTest extends DatasetCalculationFixture {
 @Autowired BriefingGenerationService generation;
 @Autowired com.dreamcore.workspace.collection.NativeGovernanceDeployment nativeGovernance;
 @Autowired com.dreamcore.workspace.governance.GovernanceModelService governanceChecks;
 @Autowired com.dreamcore.workspace.context.DatasetTaskContext datasetContext;
 @Autowired com.dreamcore.workspace.profile.CompanyInformationService company;
 @BeforeEach void configureWork(){db.update("INSERT INTO work_role_profiles(tenant_id,account_id,responsibilities,revision,changed_by) VALUES (?,?,'核对各店收款与凭证，按一致期间比较变化',1,?)",tenant,owner,owner);}
 UUID policy(){for(int i=0;i<50;i++){generation.discover();var policies=generation.state(owner,tenant).policies().stream().filter(p->p.workspaceId().equals(space)).toList();if(!policies.isEmpty())return policies.getFirst().id();}throw new AssertionError("Fixture policy not discovered");}
 BriefingGenerationService.Batch first(UUID p){generation.tick(p);return generation.state(owner,tenant).batches().stream().filter(b->b.workspaceId().equals(space)).findFirst().orElseThrow();}
 void succeeded(UUID task){db.update("UPDATE conversation_tasks SET status='SUCCEEDED',reply='合成调度完成，仅用于状态验证。',finished_at=now(),lease_token=NULL,lease_until=NULL WHERE id=?",task);}

 @Autowired com.dreamcore.workspace.identity.EngineRetryService platformRetries;
 @Test void platformRetryCreatesNewAutomaticTaskAndKeepsFailedTask(){
  UUID operator=UUID.randomUUID();db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成总台','unused')",operator,operator+"@briefing-retry.test");
  db.update("INSERT INTO platform_accounts(account_id,login_name,password_hash) VALUES (?,?,'unused')",operator,operator+"@briefing-retry.test");db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",operator);
  UUID p=policy();var b=first(p);db.update("UPDATE conversation_tasks SET status='FAILED',error_code='TASK_LIMIT',finished_at=now() WHERE id=?",b.taskId());
  var req=new com.dreamcore.workspace.identity.EngineRetryService.Request(UUID.randomUUID(),tenant,"TASK",b.taskId(),"FAILED",null);
  var receipt=platformRetries.retry(operator,req);assertNotEquals(b.id(),receipt.id());
  assertEquals("FAILED",db.queryForObject("SELECT status FROM conversation_tasks WHERE id=?",String.class,b.taskId()));
  assertEquals(2,db.queryForObject("SELECT count(*) FROM briefing_generation_batches WHERE policy_id=? AND task_id IS NOT NULL",Integer.class,p));
  assertEquals(receipt.id(),platformRetries.retry(operator,req).id());
 }
 @Test void unknownAutomaticResultCannotRetryWithoutReadOnlyExecutionEvidence(){
  UUID operator=UUID.randomUUID();db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成总台','unused')",operator,operator+"@unknown-retry.test");
  db.update("INSERT INTO platform_accounts(account_id,login_name,password_hash) VALUES (?,?,'unused')",operator,operator+"@unknown-retry.test");db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",operator);
  UUID p=policy();var b=first(p);db.update("UPDATE conversation_tasks SET status='RESULT_UNKNOWN',reconciliation_required=true WHERE id=?",b.taskId());
  var req=new com.dreamcore.workspace.identity.EngineRetryService.Request(UUID.randomUUID(),tenant,"TASK",b.taskId(),"RESULT_UNKNOWN",null);
  var ex=assertThrows(com.dreamcore.workspace.identity.IdentityException.class,()->platformRetries.retry(operator,req));assertEquals("TASK_RECONCILIATION_REQUIRED",ex.code);
  assertEquals(1,db.queryForObject("SELECT count(*) FROM briefing_generation_batches WHERE policy_id=?",Integer.class,p));
 }
 @Test void datasetOnlyInitializationPinsBeforeClaimAndNextVersionTriggersAfterCompletion(){
  UUID p=policy();var b=first(p);assertEquals("INITIALIZATION",b.trigger());assertEquals("RUNNING",b.status());
  assertEquals(snapshot,db.queryForObject("SELECT snapshot_id FROM briefing_dataset_selections WHERE task_id=?",UUID.class,b.taskId()));
  UUID next=version(2,"new");var job=conversations.claim();assertEquals(b.taskId(),job.id());
  assertEquals(snapshot.toString(),call(job,request("bootstrap",null,null,null)).at("/selectedDatasets/0/snapshot_id").asString());
  assertEquals(snapshot.toString(),call(job,request("dataset_search",null,null,0)).at("/items/0/snapshotId").asString());
  denied(()->call(job,request("dataset_read",dataset,next,0)));
  assertEquals("0.10",call(job,request("dataset_read",dataset,snapshot,0)).at("/rows/0/2").asString());
  agents.openExecution(job.id(),job.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("compare_dataset")));
  agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(1,"compare_dataset","STARTED"));
  assertEquals("1.20",json.valueToTree(agents.compareDataset(job.id(),job.token(),new DatasetCalculationService.Request(dataset,snapshot,"门店","期间","收款（元）","前期","本期"))).at("/calculation/totals/current").asString());
  succeeded(job.id());generation.tick(p);generation.tick(p);
  var second=generation.state(owner,tenant).batches().stream().filter(x->!x.id().equals(b.id())).findFirst().orElseThrow();
  assertEquals("DATA_READY",second.trigger());assertEquals(next,db.queryForObject("SELECT snapshot_id FROM briefing_dataset_selections WHERE task_id=?",UUID.class,second.taskId()));
 }
 @Test void identicalContentInFreshSnapshotsDoesNotSpendAutomaticModelBudget(){
  UUID p=policy();var first=first(p);succeeded(first.taskId());generation.tick(p);
  for(int n=2;n<=5;n++){snapshot=version(n,"old");generation.tick(p);}
  assertEquals(1,db.queryForObject("SELECT count(*) FROM briefing_generation_batches WHERE policy_id=? AND task_id IS NOT NULL",Integer.class,p));
  assertEquals(5,db.queryForObject("SELECT count(*) FROM dataset_snapshots WHERE dataset_id=?",Integer.class,dataset));
  snapshot=version(6,"new");generation.tick(p);
  assertEquals(2,db.queryForObject("SELECT count(*) FROM briefing_generation_batches WHERE policy_id=? AND task_id IS NOT NULL",Integer.class,p));
 }
 @Test void changingBusinessMeaningTriggersAnalysisEvenWithIdenticalRows(){
  UUID p=policy();var first=first(p);succeeded(first.taskId());generation.tick(p);
  db.update("UPDATE business_datasets SET description='金额为应收，不是实收；需要重新解释' WHERE id=?",dataset);
  generation.tick(p);assertEquals(2,db.queryForObject("SELECT count(*) FROM briefing_generation_batches WHERE policy_id=? AND task_id IS NOT NULL",Integer.class,p));
 }
 @Test void failureDoesNotAutomaticallyRepeatForIdenticalNewSnapshot(){
  UUID p=policy();var first=first(p);
  db.update("UPDATE conversation_tasks SET status='FAILED',error_code='TASK_LIMIT',finished_at=now() WHERE id=?",first.taskId());generation.tick(p);
  snapshot=version(2,"old");generation.tick(p);
  assertEquals(1,db.queryForObject("SELECT count(*) FROM briefing_generation_batches WHERE policy_id=? AND task_id IS NOT NULL",Integer.class,p));
  assertEquals("FAILED",generation.get(owner,tenant,first.id()).status());
  snapshot=version(3,"new");generation.tick(p);
  assertEquals(2,db.queryForObject("SELECT count(*) FROM briefing_generation_batches WHERE policy_id=? AND task_id IS NOT NULL",Integer.class,p));
 }
 @Test void identicalAuthorizedSourcesAcrossOwnerSpacesRunOnlyOnce(){
  UUID p=policy();var first=first(p);
  UUID other=generation.state(owner,tenant).policies().stream().filter(x->x.workspaceId().equals(privateSpace)).findFirst().orElseThrow().id();
  generation.tick(other);
  assertEquals(1,db.queryForObject("SELECT count(*) FROM briefing_generation_batches WHERE tenant_id=? AND task_id IS NOT NULL",Integer.class,tenant));
  assertEquals("EQUIVALENT_ANALYSIS_EXISTS",db.queryForObject("SELECT reason FROM briefing_generation_policies WHERE id=?",String.class,other));
  succeeded(first.taskId());generation.tick(p);generation.tick(other);
  assertEquals(1,db.queryForObject("SELECT count(*) FROM briefing_generation_batches WHERE tenant_id=? AND task_id IS NOT NULL",Integer.class,tenant));
 }
 @Test void rowReorderingDoesNotReanalyzeButDuplicateRowDoes(){
  UUID p=policy();var first=first(p);succeeded(first.taskId());generation.tick(p);
  var rows=new ArrayList<>(rowsFor("old"));Collections.reverse(rows);snapshot=version(2,rows);generation.tick(p);
  assertEquals(1,db.queryForObject("SELECT count(*) FROM briefing_generation_batches WHERE policy_id=? AND task_id IS NOT NULL",Integer.class,p));
  rows.add(rows.getFirst());snapshot=version(3,rows);generation.tick(p);
  assertEquals(2,db.queryForObject("SELECT count(*) FROM briefing_generation_batches WHERE policy_id=? AND task_id IS NOT NULL",Integer.class,p));
 }
 @Test void datasetReadReportsActualCalculationCapabilities(){
  UUID p=policy();first(p);var job=conversations.claim();var read=call(job,request("dataset_read",dataset,snapshot,0));
  assertTrue(read.path("source").has("calculationCapabilities"));
  assertFalse(read.at("/source/calculationCapabilities/crossDatasetJoin").asBoolean());
  assertFalse(read.at("/source/calculationCapabilities/derivedExpressions").asBoolean());
  assertEquals(50,read.at("/source/calculationCapabilities/maxGroups").asInt());
 }
 @Test void unchangedSnapshotAndCollectionScheduleDoNotCreateExtraBriefings(){
  UUID p=policy();var b=first(p);var j=conversations.claim();succeeded(j.id());generation.tick(p);generation.tick(p);
  assertEquals(1,generation.state(owner,tenant).batches().size());
  db.update("UPDATE data_connections SET auto_enabled=true,frequency='HOURLY' WHERE id=?",connection);
  generation.tick(p);assertEquals(1,generation.state(owner,tenant).batches().size());
  assertEquals(1,db.queryForObject("SELECT count(*) FROM collection_runs WHERE connection_id=?",Integer.class,connection));
 }
 @Test void withdrawalAndRestoreWhileQueuedCannotReviveOldTask(){
  UUID p=policy();var b=first(p);db.update("UPDATE business_datasets SET status='WITHDRAWN' WHERE id=?",dataset);db.update("UPDATE business_datasets SET status='ACTIVE' WHERE id=?",dataset);
  assertTrue(db.queryForObject("SELECT invalidated FROM briefing_dataset_selections WHERE task_id=?",Boolean.class,b.taskId()));
  assertNull(conversations.claim());assertNotEquals("RUNNING",db.queryForObject("SELECT status FROM conversation_tasks WHERE id=?",String.class,b.taskId()));
  generation.tick(p);assertEquals("FAILED",generation.get(owner,tenant,b.id()).status());
 }
 @Test void revocationBeforeFirstReadFencesAttemptEvenAfterRestoration(){
  UUID p=policy();first(p);var j=conversations.claim();db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES (?,?,?)",tenant,space,owner);
  denied(()->agents.check(j.id(),j.token()));denied(()->call(j,request("dataset_search",null,null,0)));
 }
 @Test void unrelatedNewDatasetCannotEnterFixedSelection(){
  UUID p=policy();first(p);UUID extra=UUID.randomUUID(),extraSnapshot=UUID.randomUUID();
  db.update("INSERT INTO business_datasets(id,tenant_id,connection_id,workspace_id,dataset_key,name,column_names) VALUES (?,?,?,?,'extra','其他数据',?::jsonb)",extra,tenant,connection,space,json.writeValueAsString(columns()));
  db.update("INSERT INTO dataset_snapshots(id,tenant_id,connection_id,dataset_id,run_id,version,data_rows,row_count,collected_at) SELECT ?,tenant_id,connection_id,?,run_id,1,data_rows,row_count,collected_at FROM dataset_snapshots WHERE id=?",extraSnapshot,extra,snapshot);db.update("UPDATE business_datasets SET current_snapshot=? WHERE id=?",extraSnapshot,extra);
  var j=conversations.claim();assertEquals(1,call(j,request("dataset_search",null,null,0)).path("items").size());denied(()->call(j,request("dataset_read",extra,extraSnapshot,0)));
 }
 @Test void cleaningSelectedSnapshotBeforeClaimErasesTaskAndDeniesExecution(){
  UUID p=policy();var b=first(p);db.update("UPDATE dataset_snapshots SET scrubbed=true,data_rows='[]'::jsonb WHERE id=?",snapshot);
  assertFalse(db.queryForObject("SELECT task_datasets_readable(?)",Boolean.class,b.taskId()));assertNull(conversations.claim());
 }
 @Test void textInsightCanUsePinnedDatasetEvidenceWithoutInventingFileSource(){
  UUID p=policy();first(p);var j=conversations.claim();call(j,request("dataset_read",dataset,snapshot,0));
  agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("select_briefing_topic","deliver_briefing")));
  agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,"select_briefing_topic","STARTED"));BriefingP0TestPlanning.select(agents,j,"INSIGHT",false);agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,"select_briefing_topic","succeeded"));
  agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(2,"deliver_briefing","STARTED"));
  agents.deliverBriefing(j.id(),j.token(),new BriefingContentService.Request(null,"收款比较需先选定期间","当前记录存在多个期间，比较收款时需要先选定一致的范围。",List.of("该观察基于本次读取的记录，尚未执行全部记录的汇总计算。","后续比较应选择完整且一致的期间，缺失值不能直接当作零值。"),"INSIGHT",new BriefingPresentationPolicy.Presentation("briefing-presentation-v1","EDITORIAL",null,null,null,List.of())));
  var raw=db.queryForObject("SELECT convert_from(content,'UTF8') FROM conversation_artifacts WHERE task_id=? AND filename LIKE 'briefing-text-%'",String.class,j.id());var content=json.readTree(raw);
  assertEquals(snapshot.toString(),content.at("/datasetSource/snapshotId").asString());assertTrue(content.path("source").isNull());assertTrue(content.path("chart").isNull());
 }

 @Test void datasetEvidenceCanReportNoUsefulBusinessInsightWithoutPublishingInventory(){
  UUID p=policy();var b=first(p);var j=conversations.claim();
  agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.6",List.of("deliver_briefing")));
  agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,"deliver_briefing","STARTED"));
  var request=new BriefingContentService.Request(null,"暂无新内容","现有记录尚不足以形成有依据的新业务发现。",List.of("目前只能确认资料结构，不据此推断经营变化。","需要明确分析期间和业务问题后，再判断是否值得关注。"),"INSIGHT");
  assertEquals("BRIEFING_SOURCES_REQUIRED",assertThrows(com.dreamcore.workspace.identity.IdentityException.class,()->agents.deliverBriefing(j.id(),j.token(),request)).code);
  call(j,request("dataset_read",dataset,snapshot,0));
  var receipt=agents.deliverBriefing(j.id(),j.token(),request);
  assertEquals("NO_NEW_CONTENT",receipt.get("status"));assertEquals("NO_USEFUL_CONTENT",receipt.get("reason"));
  assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_artifacts WHERE task_id=?",Integer.class,j.id()));
  assertEquals(1,db.queryForObject("SELECT count(*) FROM identity_audit WHERE target_id=? AND action='TASK_BRIEFING_SKIPPED' AND outcome='SUCCESS'",Integer.class,j.token()));
 }

 @Autowired com.dreamcore.workspace.identity.PlatformAdminService platform;
 @Test void serviceResumeDoesNotCatchUpOldDatasetEventsButAcceptsFreshCollection(){
  UUID operator=UUID.randomUUID();db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成平台','unused')",operator,operator+"@auto-dataset-platform.test");
  db.update("INSERT INTO platform_accounts(account_id,login_name,password_hash) VALUES (?,?,'unused')",operator,operator+"@auto-dataset-platform.test");db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",operator);
  try {
  UUID p=policy();var b=first(p);var j=conversations.claim();
  platform.status(operator,tenant,UUID.randomUUID(),0,"SUSPENDED","合成维护检查","服务暂停");
  generation.tick(p);assertEquals(1,db.queryForObject("SELECT count(*) FROM briefing_generation_batches WHERE policy_id=?",Integer.class,p));
  platform.status(operator,tenant,UUID.randomUUID(),1,"ACTIVE","合成检查结束","服务恢复");
  generation.tick(p);assertEquals(1,generation.state(owner,tenant).batches().size());denied(()->agents.check(j.id(),j.token()));
  UUID next=version(2,"new");generation.tick(p);var after=generation.state(owner,tenant).batches().stream().filter(x->!x.id().equals(b.id())).findFirst().orElseThrow();
  assertEquals(next,db.queryForObject("SELECT snapshot_id FROM briefing_dataset_selections WHERE task_id=?",UUID.class,after.taskId()));
  } finally { db.update("DELETE FROM tenant_service_changes WHERE actor_id=?",operator);db.update("DELETE FROM platform_accounts WHERE account_id=?",operator);db.update("DELETE FROM platform_roles WHERE account_id=?",operator); }
 }
 @Test void automaticSourcesRemainBoundedAndUnselectedVersionsContinueLater(){
  for(int n=0;n<3;n++){
   UUID extra=UUID.randomUUID(),snap=UUID.randomUUID();db.update("INSERT INTO business_datasets(id,tenant_id,connection_id,workspace_id,dataset_key,name,column_names) VALUES (?,?,?,?,?,?,?::jsonb)",extra,tenant,connection,space,"extra"+n,"额外数据"+n,json.writeValueAsString(columns()));
   db.update("INSERT INTO dataset_snapshots(id,tenant_id,connection_id,dataset_id,run_id,version,data_rows,row_count,collected_at) SELECT ?,tenant_id,connection_id,?,run_id,1,data_rows,row_count,collected_at FROM dataset_snapshots WHERE id=?",snap,extra,snapshot);db.update("UPDATE business_datasets SET current_snapshot=? WHERE id=?",snap,extra);
  }
  UUID p=policy();var b=first(p);assertEquals(3,db.queryForObject("SELECT count(*) FROM briefing_dataset_selections WHERE task_id=?",Integer.class,b.taskId()));
  var j=conversations.claim();assertEquals(3,call(j,request("dataset_search",null,null,0)).path("items").size());succeeded(j.id());generation.tick(p);generation.tick(p);
  var next=generation.state(owner,tenant).batches().stream().filter(x->!x.id().equals(b.id())).findFirst().orElseThrow();assertEquals(1,db.queryForObject("SELECT count(*) FROM briefing_dataset_selections WHERE task_id=?",Integer.class,next.taskId()));
  assertEquals(4,db.queryForObject("SELECT count(DISTINCT snapshot_id) FROM briefing_dataset_selections WHERE batch_id IN (SELECT id FROM briefing_generation_batches WHERE policy_id=?)",Integer.class,p));
 }
 void publishSyntheticCurrentPeriodMethod(java.nio.file.Path dir) throws Exception {
  db.update("INSERT INTO tenant_governance(tenant_id,owner_id) VALUES (?,?)",tenant,owner);
  company.change(owner,tenant,new com.dreamcore.workspace.profile.CompanyInformationService.Change(UUID.randomUUID(),com.dreamcore.workspace.profile.CompanyInformationService.Field.NAME,0,"ADD",null,"合成收款企业",""));
  var fields=List.of(new com.dreamcore.workspace.collection.DatasetField("门店","text","来源门店","","合成业务确认","SOURCE_DOCUMENTED"),new com.dreamcore.workspace.collection.DatasetField("期间","text","来源登记期间","","合成业务确认","SOURCE_DOCUMENTED"),new com.dreamcore.workspace.collection.DatasetField("收款（元）","decimal","来源登记金额，不代表银行到账","元","合成业务确认","SOURCE_DOCUMENTED"));
  var execution=new LinkedHashMap<String,Object>(Map.of("groupColumns",List.of("门店"),"dateColumn","","dateFrom","","dateTo","","timeZone","Asia/Shanghai","reviewed",true));execution.put("equalsFilters",Map.of("期间","本期"));
  var plan=Map.of("name","合成本期门店收款","meaning","按门店核对本期来源登记金额","unit","元","grain","来源记录","scope","本期","exclusions","无","evidence","合成负责人已确认本期登记口径","aggregation","SUM","valueField","收款（元）","execution",execution);
  var schema=new ArrayList<Map<String,Object>>();schema.add(Map.of("datasetId",dataset.toString(),"kind","analysis-plan","definition",plan));
  for(String column:columns())schema.add(Map.of("datasetId",dataset.toString(),"kind","column","name",column,"type",column.equals("收款（元）")?"decimal":"text","key","","nullable","NO"));
  schema.add(Map.of("datasetId",dataset.toString(),"kind","export-validation","snapshotId",snapshot.toString(),"rowCount",6,"columns",columns(),"candidateKeyColumns",columns(),"rowsSha256",com.dreamcore.workspace.identity.IdentityService.hash(json.writeValueAsString(rowsFor("旧版本")))));
  var file=dir.resolve("synthetic-plans.json");java.nio.file.Files.writeString(file,json.writeValueAsString(Map.of("tenantId",tenant.toString(),"schema",schema)));
  org.springframework.test.util.ReflectionTestUtils.setField(governanceChecks,"evidencePath",file.toString());org.springframework.test.util.ReflectionTestUtils.setField(datasetContext,"evidencePath",file.toString());
  var c=nativeGovernance.context(owner,tenant,List.of(dataset));
  nativeGovernance.submit(new com.dreamcore.workspace.collection.NativeGovernanceDeployment.Package("1.0",UUID.randomUUID(),tenant,owner,c.backgroundVersion(),List.of(new com.dreamcore.workspace.collection.NativeGovernanceDeployment.Item(dataset,c.sources().getFirst().token(),fields,"",List.of("合成业务确认")))),true);
 }
 @Test void automaticDatasetBatchRunsActualHarnessAndPublishesPrivateCard(@org.junit.jupiter.api.io.TempDir java.nio.file.Path dir) throws Exception {
  publishSyntheticCurrentPeriodMethod(dir);
  try {
  UUID p=policy();var b=first(p);var job=conversations.claim();
  var root=java.nio.file.Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();String token="synthetic-auto-dataset-012345678901234567890";
  var audience=(com.dreamcore.workspace.audience.WorkAudienceService.Context)agents.check(job.id(),job.token()).get("workAudience");
  var engine=new ProcessBuilder("node",root.resolve("engine/tests/fixtures/dataset-briefing-server.mjs").toString(),"http://127.0.0.1:"+port,token,"",audience.key()).redirectError(ProcessBuilder.Redirect.INHERIT).start();
  try(var pool=java.util.concurrent.Executors.newSingleThreadExecutor();var lines=new java.io.BufferedReader(new java.io.InputStreamReader(engine.getInputStream()))){
   String endpoint=pool.submit(lines::readLine).get(5,java.util.concurrent.TimeUnit.SECONDS);var runtime=new EngineTaskRuntime(endpoint,token,"verification",false);
   var result=runtime.executeAgent(job.id(),job.token(),job.prompt(),()->agents.active(job));assertEquals("COMPLETE",result.outcome());agents.finish(job,result);generation.tick(p);
   var complete=generation.get(owner,tenant,b.id());assertEquals("SUCCEEDED",complete.status());assertEquals(List.of(job.id()),complete.cardIds());
   var t=conversations.taskDetail(owner,tenant,job.conversation(),job.id()).tasks().getFirst();var card=agents.briefing(owner,tenant,job.conversation(),job.id(),t.revision(),1);assertEquals(snapshot,card.content().datasetSource().snapshotId());assertEquals("1.20",card.content().chart().totals().current());
  }finally{engine.destroyForcibly();engine.waitFor();}
  }finally{org.springframework.test.util.ReflectionTestUtils.setField(governanceChecks,"evidencePath","");org.springframework.test.util.ReflectionTestUtils.setField(datasetContext,"evidencePath","");}
 }
}
