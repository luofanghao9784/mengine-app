package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;import com.dreamcore.workspace.identity.*;
import java.time.*;import java.sql.Timestamp;import java.util.*;import java.net.*;import java.net.http.*;
import org.junit.jupiter.api.*;import org.springframework.beans.factory.annotation.Autowired;import org.springframework.boot.test.context.SpringBootTest;import org.springframework.boot.test.web.server.LocalServerPort;import org.springframework.jdbc.core.JdbcTemplate;import org.springframework.security.crypto.password.PasswordEncoder;import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=verification","dreamcore.tasks.initial-delay-ms=3600000","dreamcore.knowledge.enabled=false","dreamcore.collection.enabled=false"})
class UsageIntegrationTest {
 @Autowired ConversationService tasks;@Autowired AgentTaskService agents;@Autowired AgentUsageLedger ledger;@Autowired UsageService usage;@Autowired JdbcTemplate db;@Autowired PasswordEncoder passwords;@LocalServerPort int port;
 UUID tenant,actor,space,operator;static final String PRIVATE="private-metering-content",PASSWORD="synthetic-usage-password";
 @BeforeEach void setup(){tenant=UUID.randomUUID();actor=UUID.randomUUID();space=UUID.randomUUID();operator=UUID.randomUUID();
  for(UUID a:List.of(actor,operator))db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",a,a+"@example.test",PRIVATE,passwords.encode(PASSWORD));
  db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",operator);db.update("INSERT INTO platform_accounts(account_id,login_name,password_hash) VALUES (?,?,?)",operator,operator+"@example.test",passwords.encode(PASSWORD));
  db.update("INSERT INTO tenants(id,name) VALUES (?,?)",tenant,PRIVATE);db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'TENANT_ADMIN')",tenant,actor);db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,?,'PERSONAL')",space,tenant,actor,PRIVATE);
 }
 @AfterEach void cleanup(){db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('RUNNING','QUEUED')",tenant);db.update("DELETE FROM platform_sessions WHERE account_id=?",operator);db.update("DELETE FROM platform_accounts WHERE account_id=?",operator);db.update("DELETE FROM platform_roles WHERE account_id=?",operator);}
 ConversationService.Job start(){tasks.submit(actor,tenant,null,space,UUID.randomUUID(),PRIVATE,"AGENT");return tasks.claim();}
 UsageService.Overview read(){return usage.tenant(actor,tenant,"THIS_MONTH");}
 void model(ConversationService.Job j,int n,String outcome,Long in,Long out){agents.startUsage(j.id(),j.token(),new AgentUsageLedger.Start(n,2048));ledger.finish(j.id(),j.token(),new AgentUsageLedger.Receipt(n,outcome,in,out));}
 @Autowired com.dreamcore.workspace.governance.GovernanceUsageLedger governanceUsage;
 @Test void undatedLegacyGovernanceRemainsVisibleAcrossPeriodsWithoutInventingCallDates(){
  UUID job=UUID.randomUUID();long platformBefore=usage.platform(operator,null,"THIS_MONTH").usage().coverage().legacyGovernanceJobs();
  assertEquals(0,read().coverage().legacyGovernanceJobs());
  db.update("INSERT INTO governance_model_jobs(id,tenant_id,actor_id,kind,source_id,request_id,source_name,basis_hash,input,state,created_at) VALUES (?,?,?,'DATASET',?,?,'历史合成来源','basis','{}','DRAFT_READY',date_trunc('month',now())-interval '1 month')",job,tenant,actor,UUID.randomUUID(),UUID.randomUUID());
  // Created last month, retried/completed this month; neither timestamp proves the historical call start.
  db.update("INSERT INTO governance_model_dispatch(job_id,executor,state,attempts,updated_at) VALUES (?,'SYSTEM_MODEL','SUCCEEDED',2,now())",job);
  try {
   for(int revision:List.of(1,2))db.update("INSERT INTO governance_model_usage(job_id,revision,tenant_id,execution_class,state,started_at,reported_at) VALUES (?,?,?,'live','UNKNOWN',NULL,now())",job,revision,tenant);
   for(String period:List.of("THIS_MONTH","LAST_MONTH","LAST_30_DAYS")) {
    var report=usage.tenant(actor,tenant,period);assertEquals(1,report.coverage().legacyGovernanceJobs());
    assertTrue(report.groups().isEmpty());
    assertTrue(report.days().stream().allMatch(d->Long.valueOf(0).equals(d.maintenanceCalls())&&d.unknownMaintenanceRuns()==0&&d.inputTokens()==null&&d.outputTokens()==null));
    assertEquals(1,usage.platform(operator,tenant,period).usage().coverage().legacyGovernanceJobs());
   }
   assertEquals(platformBefore+1,usage.platform(operator,null,"THIS_MONTH").usage().coverage().legacyGovernanceJobs());
   // A newly metered retry keeps its real timestamp and does enter this month's totals.
   governanceUsage.start(job,3,UUID.randomUUID());governanceUsage.returned(job,3,Map.of("modelCalls",1,"inputTokens",12L,"outputTokens",3L));
   assertNotNull(db.queryForObject("SELECT started_at FROM governance_model_usage WHERE job_id=? AND revision=3",Timestamp.class,job));
   assertEquals(1,read().groups().getFirst().modelCalls());assertEquals(12,read().groups().getFirst().inputTokens());
   assertEquals(1,read().coverage().legacyGovernanceJobs());assertTrue(usage.tenant(actor,tenant,"LAST_MONTH").groups().isEmpty());
  } finally {db.update("DELETE FROM governance_model_usage WHERE job_id=?",job);db.update("DELETE FROM governance_model_dispatch WHERE job_id=?",job);db.update("DELETE FROM governance_model_jobs WHERE id=?",job);}
 }
 @Test void governanceCallsRetainTokensUnknownOutcomesAndRetryWithoutDoubleCounting(){
  UUID job=UUID.randomUUID(),lease=UUID.randomUUID(),retryLease=UUID.randomUUID();
  db.update("INSERT INTO governance_model_jobs(id,tenant_id,actor_id,kind,source_id,request_id,source_name,basis_hash,input,state) VALUES (?,?,?,'DATASET',?,?,'合成来源','basis','{}','FAILED')",job,tenant,actor,UUID.randomUUID(),UUID.randomUUID());
  db.update("INSERT INTO governance_model_dispatch(job_id,executor,state) VALUES (?,'SYSTEM_MODEL','FAILED')",job);
  try {
   governanceUsage.start(job,1,lease);governanceUsage.start(job,1,lease);
   assertEquals(1,read().groups().getFirst().pendingUnits());
   governanceUsage.returned(job,1,Map.of("modelName","synthetic-model","modelCalls",1,"inputTokens",123L,"outputTokens",45L));
   governanceUsage.returned(job,1,Map.of("modelCalls",99,"inputTokens",999L,"outputTokens",999L));
   governanceUsage.unknown(job,lease);
   var first=read().groups().getFirst();assertEquals("MAINTENANCE",first.purpose());assertEquals("live",first.executionClass());
   assertEquals(1,first.units());assertEquals(1,first.modelCalls());assertEquals(123,first.inputTokens());assertEquals(45,first.outputTokens());
   governanceUsage.start(job,2,retryLease);governanceUsage.unknown(job,lease);
   assertEquals(1,read().groups().getFirst().pendingUnits());governanceUsage.unknown(job,retryLease);
   var second=read().groups().getFirst();assertEquals(2,second.units());assertEquals(1,second.unknownCallUnits());assertEquals(123,second.inputTokens());
   assertEquals(1,read().days().stream().mapToLong(UsageService.Day::unknownMaintenanceRuns).sum());
   db.update("UPDATE governance_model_usage SET started_at=now()-interval '2 months' WHERE job_id=? AND revision=1",job);
   assertNull(read().groups().getFirst().modelCalls());
   assertFalse(new JsonMapper().writeValueAsString(read()).contains("合成来源"));
  } finally {db.update("DELETE FROM governance_model_usage WHERE job_id=?",job);db.update("DELETE FROM governance_model_dispatch WHERE job_id=?",job);db.update("DELETE FROM governance_model_jobs WHERE id=?",job);}
 }
 @Test void requestTimesNotTaskOrAttemptStartChooseWindowAndIncludeFailedRetryUsage(){
  var j=start();agents.openUsage(j.id(),j.token());model(j,1,"FAILED",12L,3L);model(j,2,"RETURNED",null,null);agents.startUsage(j.id(),j.token(),new AgentUsageLedger.Start(3,2048));
  db.update("UPDATE agent_attempt_usage SET started_at=now()-interval '2 months' WHERE attempt_id=?",j.token());
  var r=read();assertEquals(1,r.groups().size());var g=r.groups().getFirst();assertEquals("verification",g.executionClass());assertEquals(3,g.units());assertEquals(3,g.modelCalls());assertEquals(1,g.reportedUnits());assertEquals(1,g.pendingUnits());assertEquals(12,g.inputTokens());assertEquals(0,r.days().stream().mapToLong(UsageService.Day::workRequests).sum());
  db.update("UPDATE agent_attempt_usage SET execution_class='live' WHERE attempt_id=?",j.token());assertEquals(3,read().days().stream().mapToLong(UsageService.Day::workRequests).sum());
  tasks.fail(j,"TASK_MODEL_FAILED");assertEquals(3,read().groups().getFirst().units());
  db.update("UPDATE agent_model_requests SET started_at=now()+interval '1 day' WHERE attempt_id=? AND sequence=3",j.token());assertEquals(2,read().groups().getFirst().units());
  db.update("UPDATE agent_model_requests SET started_at=now()-interval '2 months' WHERE attempt_id=? AND sequence=2",j.token());assertEquals(1,read().groups().getFirst().units());
 }
 @Test void actualToolReceiptsRecordTimingAndRepeatedTerminalReceiptCannotInflateDuration(){
  var j=start();agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("search_sources")));
  agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,"search_sources","STARTED"));var started=db.queryForObject("SELECT started_at FROM conversation_tool_receipts WHERE task_id=?",Timestamp.class,j.id());assertNotNull(started);
  agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,"search_sources","STARTED"));assertEquals(started,db.queryForObject("SELECT started_at FROM conversation_tool_receipts WHERE task_id=?",Timestamp.class,j.id()));
  db.update("UPDATE conversation_tool_receipts SET started_at=clock_timestamp()-interval '2 seconds' WHERE task_id=?",j.id());agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,"search_sources","succeeded"));var first=db.queryForMap("SELECT started_at,finished_at,received_at FROM conversation_tool_receipts WHERE task_id=?",j.id());
  agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,"search_sources","succeeded"));assertEquals(first,db.queryForMap("SELECT started_at,finished_at,received_at FROM conversation_tool_receipts WHERE task_id=?",j.id()));
  var t=read().tools().getFirst();assertEquals(1,t.starts());assertEquals(1,t.timed());assertTrue(t.elapsedMillis()>=2000);assertEquals(1,t.succeeded());
  db.update("UPDATE conversation_tool_receipts SET started_at=NULL WHERE task_id=?",j.id());assertTrue(read().tools().isEmpty());assertEquals(1,read().coverage().legacyToolReceipts());
 }
 @Test void noReceiptsAreNotAssumedZeroCostOrConfiguredQuota(){start();var r=read();assertTrue(r.groups().isEmpty());assertTrue(r.days().stream().allMatch(d->d.inputTokens()==null));assertEquals(1,r.coverage().unmeteredWorkAttempts());assertEquals("NOT_CONFIGURED",r.quota().state());assertNull(r.quota().limit());assertNull(r.quota().remaining());var p=usage.platform(operator,tenant,"THIS_MONTH");assertEquals(r.groups(),p.usage().groups());assertEquals("NOT_CONNECTED",p.cost().state());assertNull(p.cost().verifiedMinor());assertNull(p.cost().currency());assertEquals("NOT_ENABLED",r.coverage().evolution());assertFalse(new JsonMapper().writeValueAsString(r).contains("cost"));}
 @Test void maintenanceSeparatesLegacyUnknownClassAndPartialReceiptsFromLive(){
  UUID run=UUID.randomUUID();db.update("INSERT INTO company_inference_runs(id,tenant_id,actor_id,lease_token,lease_until,state,group_revisions) VALUES (?,?,?,?,now()+interval '1 hour','RUNNING','{}'::jsonb)",run,tenant,actor,UUID.randomUUID());
  db.update("INSERT INTO company_analysis_attempts(run_id,tenant_id,state,model_calls,input_tokens,output_tokens) VALUES (?,?,'RETURNED',2,15,4)",run,tenant);
  var g=read().groups().getFirst();assertEquals("MAINTENANCE",g.purpose());assertEquals("unknown",g.executionClass());assertEquals(2,g.modelCalls());assertEquals(1,g.reportedUnits());assertEquals(0,read().days().stream().mapToLong(d->d.maintenanceCalls()==null?0:d.maintenanceCalls()).sum());
  db.update("UPDATE company_analysis_attempts SET execution_class='live',model_calls=NULL,input_tokens=NULL,output_tokens=NULL,state='UNKNOWN' WHERE run_id=?",run);g=read().groups().getFirst();assertNull(g.modelCalls());assertNull(g.inputTokens());assertEquals(1,g.unknownCallUnits());assertEquals(1,g.pendingUnits());assertEquals(1,read().days().stream().mapToLong(UsageService.Day::unknownMaintenanceRuns).sum());
 }
 @Test void partialMaintenanceStageTokensStayPartialAndPlatformWorkDoesNotEnterEnterpriseUsage(){
  var j=start();UUID source=UUID.randomUUID(),run=UUID.randomUUID();
  db.update("INSERT INTO experience_intake_sources(id,tenant_id,owner_id,workspace_id,kind,source_id,source_revision,source_attempt,task_id) VALUES (?,?,?,?,'TASK',?,0,1,?)",source,tenant,actor,space,j.id(),j.id());
  String stages="[{\"stage\":\"EXTRACT\",\"modelName\":\"private-model\",\"modelCalls\":2,\"inputTokens\":10,\"outputTokens\":5},{\"stage\":\"VERIFY\",\"modelName\":\"private-model\",\"modelCalls\":3,\"inputTokens\":null,\"outputTokens\":null}]";
  db.update("INSERT INTO experience_analysis_runs(id,source_id,tenant_id,lease,lease_until,state,job_hash,manifest,execution_class,stages) VALUES (?,?,?,?,now()+interval '1 hour','FAILED','synthetic','{}'::jsonb,'live',?::jsonb)",run,source,tenant,UUID.randomUUID(),stages);
  var group=read().groups().getFirst();assertEquals(5,group.modelCalls());assertEquals(0,group.reportedUnits());assertEquals(10,group.inputTokens());assertEquals(0,group.unknownCallUnits());assertEquals(5,read().days().stream().mapToLong(d->d.maintenanceCalls()==null?0:d.maintenanceCalls()).sum());
  long before=usage.platform(operator,null,"THIS_MONTH").usage().groups().stream().filter(g->g.purpose().equals("MAINTENANCE")&&g.executionClass().equals("live")).mapToLong(g->g.modelCalls()==null?0:g.modelCalls()).sum();
  UUID entry=UUID.randomUUID(),version=UUID.randomUUID(),proposal=UUID.randomUUID();db.update("INSERT INTO general_experience_entries(id) VALUES (?)",entry);db.update("INSERT INTO general_experience_versions(id,entry_id,number,method,content_fingerprint) VALUES (?,?,1,'{}'::jsonb,'synthetic')",version,entry);
  db.update("INSERT INTO general_experience_adjustments(id,actor_id,request_id,request_hash,entry_id,version_id,expected_revision,state) VALUES (?,?,?,'synthetic',?,?,1,'ADMITTED')",proposal,operator,UUID.randomUUID(),entry,version);
  db.update("INSERT INTO general_experience_adjustment_runs(id,proposal_id,phase,lease,lease_until,job_hash,state,execution_class,stages) VALUES (?,?,'EXTRACT',?,now()+interval '1 hour','synthetic','RETURNED','live',?::jsonb)",UUID.randomUUID(),proposal,UUID.randomUUID(),stages);
  assertEquals(before+5,usage.platform(operator,null,"THIS_MONTH").usage().groups().stream().filter(g->g.purpose().equals("MAINTENANCE")&&g.executionClass().equals("live")).mapToLong(g->g.modelCalls()==null?0:g.modelCalls()).sum());assertEquals(group,read().groups().getFirst());assertFalse(new JsonMapper().writeValueAsString(read()).contains("private-model"));
 }
 @Test void scopeAndMetadataDoNotGrantContentOrOtherTenantAccess(){var j=start();agents.openUsage(j.id(),j.token());model(j,1,"RETURNED",1L,1L);var r=read();String text=new JsonMapper().writeValueAsString(r);for(String secret:List.of(PRIVATE,j.id().toString(),actor.toString(),space.toString(),"modelName","prompt","filename"))assertFalse(text.contains(secret),secret);
  assertThrows(IdentityException.class,()->usage.tenant(actor,UUID.randomUUID(),"THIS_MONTH"));assertEquals(403,assertThrows(IdentityException.class,()->usage.platform(actor,tenant,"THIS_MONTH")).status);assertEquals(404,assertThrows(IdentityException.class,()->usage.platform(operator,UUID.randomUUID(),"THIS_MONTH")).status);assertEquals(400,assertThrows(IdentityException.class,()->usage.tenant(actor,tenant,"FOREVER")).status);
 }
 @Test void calendarWindowsIncludeLocalBoundariesAndDstWithoutAssumingThirtyDays(){
  var now=Instant.parse("2026-03-31T18:00:00Z");var w=UsageService.window("THIS_MONTH",now,ZoneId.of("Asia/Shanghai"));assertEquals(Instant.parse("2026-03-31T16:00:00Z"),w.from());
  w=UsageService.window("LAST_MONTH",now,ZoneId.of("Asia/Shanghai"));assertEquals(Instant.parse("2026-02-28T16:00:00Z"),w.from());assertEquals(Instant.parse("2026-03-31T16:00:00Z"),w.end());
  w=UsageService.window("LAST_MONTH",Instant.parse("2026-04-05T10:00:00Z"),ZoneId.of("America/New_York"));assertEquals(Instant.parse("2026-03-01T05:00:00Z"),w.from());assertEquals(Instant.parse("2026-04-01T04:00:00Z"),w.end());
 }
 HttpClient login(boolean platform)throws Exception{db.update("DELETE FROM login_attempts");var http=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();String base="http://127.0.0.1:"+port+(platform?"/api/platform-admin/v1/auth":"/api/v1/auth");var json=new JsonMapper();var csrf=json.readTree(http.send(HttpRequest.newBuilder(URI.create(base+"/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());var req=HttpRequest.newBuilder(URI.create(base+"/login")).header(csrf.get("headerName").asString(),csrf.get("token").asString()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of(platform?"username":"email",(platform?operator:actor)+"@example.test","password",PASSWORD)))).build();assertEquals(200,http.send(req,HttpResponse.BodyHandlers.ofString()).statusCode());return http;}
 HttpResponse<String> get(HttpClient http,String path)throws Exception{return http.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).GET().build(),HttpResponse.BodyHandlers.ofString());}
 @Test void httpScopesAndCostProjectionAreSeparateAndRevocationApplies()throws Exception{
  var customer=login(false);String platformPath="/api/platform-admin/v1/tenants/"+tenant+"/usage",tenantPath="/api/tenant-admin/v1/tenants/"+tenant+"/usage";
  // Each realm requires its own authenticated cookie; a customer session is not a platform principal.
  var denied=get(customer,platformPath);assertEquals(401,denied.statusCode());assertEquals("AUTHENTICATION_REQUIRED",new JsonMapper().readTree(denied.body()).get("code").asString());
  var r=get(customer,tenantPath);assertEquals(200,r.statusCode());assertFalse(r.body().contains("cost"));assertEquals("private, no-store",r.headers().firstValue("Cache-Control").orElseThrow());
  var platform=login(true);assertEquals(401,get(platform,tenantPath).statusCode());r=get(platform,platformPath);assertEquals(200,r.statusCode());assertTrue(r.body().contains("NOT_CONNECTED"));
  db.update("DELETE FROM platform_roles WHERE account_id=?",operator);assertEquals(401,get(platform,platformPath).statusCode());
  db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",operator);
  assertEquals(401,get(platform,platformPath).statusCode(),"Regranting the role must not revive a revoked session");
  assertEquals(200,get(login(true),platformPath).statusCode());
  db.update("UPDATE tenant_memberships SET role='MEMBER' WHERE tenant_id=? AND account_id=?",tenant,actor);
  assertEquals(200,get(customer,"/api/v1/me").statusCode());assertEquals(403,get(customer,tenantPath).statusCode());
 }
}
