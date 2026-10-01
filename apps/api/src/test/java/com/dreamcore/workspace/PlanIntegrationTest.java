package com.dreamcore.workspace;
import com.dreamcore.workspace.plans.*;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.*;
import com.dreamcore.workspace.knowledge.*;
import java.net.*;
import java.net.http.*;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=off","dreamcore.tasks.initial-delay-ms=3600000","dreamcore.knowledge.enabled=true","dreamcore.knowledge.initial-delay-ms=3600000","dreamcore.plans.initial-delay-ms=3600000"})
class PlanIntegrationTest {
 @Autowired PlanService plans;@Autowired PlanTaskGate gate;@Autowired PlanAttentionService attention;@Autowired ConversationService conversations;@Autowired AgentTaskService agentTasks;@Autowired MaterialService materials;@Autowired KnowledgeService knowledge;@Autowired JdbcTemplate db;@Autowired PasswordEncoder passwords;
 @MockitoBean PlanClock clock;@MockitoBean AgentSettings agents;@LocalServerPort int port;
 UUID tenant,owner,other,space,personal;Instant now;static String passwordHash;JsonMapper json=new JsonMapper();
 @BeforeEach void fixture(){
  now=Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS);when(clock.now()).thenReturn(now);when(agents.mode()).thenReturn("off");when(agents.enabled()).thenReturn(false);
  if(passwordHash==null)passwordHash=passwords.encode("synthetic-plans-password");tenant=UUID.randomUUID();owner=UUID.randomUUID();other=UUID.randomUUID();space=UUID.randomUUID();personal=UUID.randomUUID();
  for(UUID u:List.of(owner,other))db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",u,u+"@plans.test","计划合成用户",passwordHash);
  db.update("INSERT INTO tenants(id,name) VALUES (?,'计划隔离企业')",tenant);for(UUID u:List.of(owner,other))db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'TENANT_ADMIN')",tenant,u);
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'计划资料','SHARED'),(?,?,?,'私人资料','PERSONAL')",space,tenant,owner,personal,tenant,owner);
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true),(?,?,?,false)",tenant,space,owner,tenant,space,other);
 }
 @AfterEach void cleanup(){db.update("UPDATE ongoing_plans SET status='STOPPED' WHERE tenant_id=?",tenant);db.update("UPDATE ongoing_plan_runs SET status='CANCELLED' WHERE tenant_id=?",tenant);db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('RUNNING','QUEUED','WAITING_CAPABILITY')",tenant);db.update("UPDATE knowledge_runs SET status='CANCELLED' WHERE tenant_id=? AND status IN ('RUNNING','QUEUED')",tenant);db.update("DELETE FROM login_attempts WHERE bucket=?",IdentityService.hash("ip:127.0.0.1"));}
 void time(Instant value){now=value;when(clock.now()).thenReturn(value);}
 PlanService.Configuration config(String behavior){return new PlanService.Configuration(space,"持续核查进度","仅本人查看获权资料中的进度依据","进度",behavior,true,null,"Asia/Shanghai",60,4,10,now.plus(Duration.ofDays(10)),true);}
 PlanService.Configuration withDaily(PlanService.Configuration c,boolean event,String local){return new PlanService.Configuration(c.workspaceId(),c.goal(),c.purpose(),c.query(),c.behavior(),event,local,c.timeZone(),c.minIntervalSeconds(),c.maxRunsPerDay(),c.maxTotalRuns(),c.expiresAt(),c.notificationsEnabled());}
 PlanService.Plan create(String behavior){return plans.create(owner,tenant,UUID.randomUUID(),config(behavior));}
 PlanService.Plan enable(PlanService.Plan p){return plans.action(owner,tenant,p.id(),UUID.randomUUID(),p.revision(),"ENABLE",true);}
 PlanService.Plan action(UUID id,String action){var p=plans.get(owner,tenant,id);return plans.action(owner,tenant,id,UUID.randomUUID(),p.revision(),action,true);}
 UUID upload(UUID id){
  var receipt=materials.upload(owner,tenant,space,null,id,id==null?null:db.queryForObject("SELECT current_version FROM materials WHERE id=?",Integer.class,id),UUID.randomUUID(),new MockMultipartFile("file","progress.txt","text/plain",("进度 "+UUID.randomUUID()).getBytes(java.nio.charset.StandardCharsets.UTF_8)));
  var parse=knowledge.claim();assertNotNull(parse);knowledge.finish(parse,new DocumentParser.Result("synthetic","READY",List.of(),List.of(new DocumentParser.Fragment("L1","进度 合成证据","TEXT"))));return receipt.id();
 }
 PlanService.Run run(UUID id){return plans.runs(owner,tenant,id,0,20).items().getFirst();}
 void succeed(UUID plan){var j=conversations.claim();assertNotNull(j);assertEquals(run(plan).taskId(),j.id());var ids=conversations.sources(j);conversations.finish(j,new TaskRuntime.Result("1.0","0.12.0",j.id(),j.token(),"SOURCE_LOOKUP",ids.isEmpty()?"NO_SOURCES":"SOURCES_FOUND",ids));plans.tick(plan);}
 void denied(int status,Runnable work){assertEquals(status,assertThrows(IdentityException.class,work::run).status);}
 @Test void explicitDelegationAndOwnershipAreEnforced(){
  upload(null);var draft=create("SOURCE_LOOKUP");plans.tick(draft.id());assertEquals(0,plans.get(owner,tenant,draft.id()).runs());
  denied(400,()->plans.action(owner,tenant,draft.id(),UUID.randomUUID(),draft.revision(),"ENABLE",false));denied(404,()->plans.get(other,tenant,draft.id()));
  var p=enable(draft);plans.tick(p.id());assertEquals(1,plans.get(owner,tenant,p.id()).runs());assertEquals(owner,db.queryForObject("SELECT requested_by FROM conversation_tasks WHERE id=?",UUID.class,run(p.id()).taskId()));assertEquals(p.configuration(),plans.version(owner,tenant,p.id(),run(p.id()).planRevision()).configuration());denied(404,()->plans.version(other,tenant,p.id(),p.revision()));
  UUID outside=UUID.randomUUID();db.update("INSERT INTO tenants(id,name) VALUES (?,'其他企业')",outside);denied(403,()->plans.list(owner,outside,0,20));
 }
 @Test void persistentVersionEventsDedupeAcrossWorkersAndKeepChangesDuringRun()throws Exception{
  UUID material=upload(null);var p=enable(create("SOURCE_LOOKUP"));
  try(var pool=Executors.newFixedThreadPool(2)){var a=pool.submit(()->plans.tick(p.id()));var b=pool.submit(()->plans.tick(p.id()));a.get(10,TimeUnit.SECONDS);b.get(10,TimeUnit.SECONDS);}
  assertEquals(1,plans.get(owner,tenant,p.id()).runs());upload(material);plans.tick(p.id());assertEquals(1,plans.get(owner,tenant,p.id()).runs());succeed(p.id());assertEquals("MINIMUM_INTERVAL",plans.get(owner,tenant,p.id()).reason());
  time(now.plusSeconds(61));new PlanWorker(plans).tick();assertEquals(2,plans.get(owner,tenant,p.id()).runs());succeed(p.id());
  for(int i=0;i<4;i++)new PlanWorker(plans).tick();assertEquals(2,plans.get(owner,tenant,p.id()).runs());assertEquals("NO_NEW_VERSION",plans.get(owner,tenant,p.id()).reason());
  assertEquals(2,db.queryForObject("SELECT count(*) FROM ongoing_plan_material_events WHERE material_id=?",Integer.class,material));
 }
 @Test void modelOffWaitsOnceWithoutTasksOrBudgetAndCapabilityRecoveryDoesNotFlood(){
  upload(null);var p=enable(create("ANALYZE"));for(int i=0;i<5;i++){plans.tick(p.id());time(now.plusSeconds(120));}
  assertEquals("WAITING_CAPABILITY",plans.get(owner,tenant,p.id()).runtimeState());assertEquals(0,plans.get(owner,tenant,p.id()).runs());assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_tasks WHERE tenant_id=?",Integer.class,tenant));
  when(agents.enabled()).thenReturn(true);when(agents.mode()).thenReturn("verification");plans.tick(p.id());plans.tick(p.id());assertEquals(1,plans.get(owner,tenant,p.id()).runs());
 }
 @Test void missingDataWaitsAndWakesOnARealVersion(){var p=enable(create("SOURCE_LOOKUP"));plans.tick(p.id());assertEquals("WAITING_DATA",plans.get(owner,tenant,p.id()).runtimeState());upload(null);plans.tick(p.id());assertEquals(1,plans.get(owner,tenant,p.id()).runs());}
 @Test void dailyCommitmentReusesEvidenceAndMissedDatesCoalesce(){
  upload(null);var c=withDaily(config("SOURCE_LOOKUP"),false,"09:00");var p=enable(plans.create(owner,tenant,UUID.randomUUID(),c));plans.tick(p.id());assertEquals(0,plans.get(owner,tenant,p.id()).runs());
  time(p.nextDue().plus(Duration.ofDays(3)));plans.tick(p.id());assertEquals(3,run(p.id()).missedSlots());assertEquals("DAILY",run(p.id()).triggerKind());succeed(p.id());
  time(plans.get(owner,tenant,p.id()).nextDue());plans.tick(p.id());assertEquals(2,plans.get(owner,tenant,p.id()).runs());assertEquals(run(p.id()).sourceVersions(),plans.runs(owner,tenant,p.id(),1,20).items().getFirst().sourceVersions());
 }
 @Test void pauseFencesLateFinishAndResumeUsesANewRun(){
  upload(null);var p=enable(create("SOURCE_LOOKUP"));plans.tick(p.id());var job=conversations.claim();var sources=conversations.sources(job);action(p.id(),"PAUSE");assertFalse(gate.allows(job.id()));
  conversations.finish(job,new TaskRuntime.Result("1.0","0.12.0",job.id(),job.token(),"SOURCE_LOOKUP","SOURCES_FOUND",sources));assertEquals("INTERRUPTED",db.queryForObject("SELECT status FROM conversation_tasks WHERE id=?",String.class,job.id()));
  action(p.id(),"RESUME");time(now.plusSeconds(61));plans.tick(p.id());assertNotEquals(job.id(),run(p.id()).taskId());assertFalse(gate.allows(job.id()));
  int revision=db.queryForObject("SELECT revision FROM conversation_tasks WHERE id=?",Integer.class,job.id());denied(409,()->conversations.action(owner,tenant,job.conversation(),job.id(),UUID.randomUUID(),revision,"RETRY"));
 }
 @Test void expiryRejectsLateCompletionBeforeSchedulerVisitsPlan(){
  upload(null);var p=enable(create("SOURCE_LOOKUP"));plans.tick(p.id());var job=conversations.claim();time(p.configuration().expiresAt());assertFalse(gate.allows(job.id()));
  conversations.finish(job,new TaskRuntime.Result("1.0","0.12.0",job.id(),job.token(),"SOURCE_LOOKUP","NO_SOURCES",List.of()));assertEquals("RUNNING",db.queryForObject("SELECT status FROM conversation_tasks WHERE id=?",String.class,job.id()));plans.tick(p.id());assertEquals("EXPIRED",plans.get(owner,tenant,p.id()).status());assertEquals("INTERRUPTED",db.queryForObject("SELECT status FROM conversation_tasks WHERE id=?",String.class,job.id()));
 }
 @Test void transientGrantRevocationCannotReviveOldPlanOrAttempt(){
  upload(null);var p=enable(create("SOURCE_LOOKUP"));plans.tick(p.id());var job=conversations.claim();
  db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,owner);db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",tenant,space,owner);
  var changed=plans.get(owner,tenant,p.id());assertEquals("AUTHORIZATION_REQUIRED",changed.status());assertTrue(changed.executionEpoch()>p.executionEpoch());assertFalse(gate.allows(job.id()));plans.tick(p.id());assertEquals("INTERRUPTED",db.queryForObject("SELECT status FROM conversation_tasks WHERE id=?",String.class,job.id()));action(p.id(),"RESUME");assertFalse(gate.allows(job.id()));
 }
 @Test void transientAccountMemberAndTenantDisableFencePlansWithoutGrantingRights(){
  for(String target:List.of("account","member","tenant")){
   var p=enable(create("SOURCE_LOOKUP"));switch(target){case "account"->{db.update("UPDATE accounts SET status='DISABLED' WHERE id=?",owner);db.update("UPDATE accounts SET status='ACTIVE' WHERE id=?",owner);}case "member"->{db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,owner);db.update("UPDATE tenant_memberships SET status='ACTIVE' WHERE tenant_id=? AND account_id=?",tenant,owner);}default->{db.update("UPDATE tenants SET status='SUSPENDED' WHERE id=?",tenant);db.update("UPDATE tenants SET status='ACTIVE' WHERE id=?",tenant);}}
   assertEquals("AUTHORIZATION_REQUIRED",plans.get(owner,tenant,p.id()).status());assertEquals(p.executionEpoch()+1,plans.get(owner,tenant,p.id()).executionEpoch());action(p.id(),"STOP");
  }
 }
 @Test void rateDailyAndLifetimeBudgetsRemainAfterEdits(){
  UUID material=upload(null);var c=config("SOURCE_LOOKUP");c=new PlanService.Configuration(c.workspaceId(),c.goal(),c.purpose(),c.query(),c.behavior(),true,null,c.timeZone(),60,1,2,c.expiresAt(),true);var p=enable(plans.create(owner,tenant,UUID.randomUUID(),c));plans.tick(p.id());succeed(p.id());upload(material);plans.tick(p.id());assertEquals("DAILY_RUN_LIMIT",plans.get(owner,tenant,p.id()).reason());
  time(now.plus(Duration.ofDays(1)));plans.tick(p.id());succeed(p.id());upload(material);time(now.plus(Duration.ofDays(1)));plans.tick(p.id());assertEquals("TOTAL_RUN_LIMIT",plans.get(owner,tenant,p.id()).reason());assertEquals(2,plans.get(owner,tenant,p.id()).runs());
 }
 @Test void muteIsNotPauseAndConfigurationVersionsDoNotOverwrite(){
  var p=enable(create("SOURCE_LOOKUP"));var muted=action(p.id(),"MUTE");assertEquals("ACTIVE",muted.status());assertEquals(p.executionEpoch(),muted.executionEpoch());assertFalse(muted.configuration().notificationsEnabled());
  denied(409,()->plans.update(owner,tenant,p.id(),UUID.randomUUID(),muted.revision(),config("SOURCE_LOOKUP")));var paused=action(p.id(),"PAUSE");var changed=plans.update(owner,tenant,p.id(),UUID.randomUUID(),paused.revision(),config("ANALYZE"));assertEquals("DRAFT",changed.status());assertEquals(5,db.queryForObject("SELECT count(*) FROM ongoing_plan_versions WHERE plan_id=?",Integer.class,p.id()));assertTrue(db.queryForObject("SELECT configuration::text FROM ongoing_plan_versions WHERE plan_id=? AND revision=1",String.class,p.id()).contains("SOURCE_LOOKUP"));
 }
 @Test void idempotencyAndConcurrentEnableCannotDuplicateDelegation()throws Exception{
  UUID key=UUID.randomUUID();var config=config("SOURCE_LOOKUP");var p=plans.create(owner,tenant,key,config);assertEquals(p,plans.create(owner,tenant,key,config));
  try(var pool=Executors.newFixedThreadPool(2)){var results=new ArrayList<Future<Boolean>>();for(int i=0;i<2;i++)results.add(pool.submit(()->{try{enable(p);return true;}catch(IdentityException e){assertEquals(409,e.status);return false;}}));assertEquals(1,results.stream().map(f->{try{return f.get(10,TimeUnit.SECONDS);}catch(Exception e){throw new RuntimeException(e);}}).filter(Boolean::booleanValue).count());}
 }
 @Test void httpRequiresSessionCsrfAndKeepsDelegationPrivate()throws Exception{
  String base="http://127.0.0.1:"+port;var http=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();String path="/api/v1/tenants/"+tenant+"/plans";
  assertEquals(401,http.send(HttpRequest.newBuilder(URI.create(base+path)).GET().build(),HttpResponse.BodyHandlers.ofString()).statusCode());
  var csrf=json.readTree(http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());
  assertEquals(200,http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/login")).header(csrf.get("headerName").asString(),csrf.get("token").asString()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("email",owner+"@plans.test","password","synthetic-plans-password")))).build(),HttpResponse.BodyHandlers.ofString()).statusCode());
  String body=json.writeValueAsString(Map.of("requestId",UUID.randomUUID(),"configuration",config("SOURCE_LOOKUP")));assertEquals(403,http.send(HttpRequest.newBuilder(URI.create(base+path)).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString()).statusCode());
  csrf=json.readTree(http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());var saved=http.send(HttpRequest.newBuilder(URI.create(base+path)).header(csrf.get("headerName").asString(),csrf.get("token").asString()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());assertEquals(201,saved.statusCode(),saved.body());assertTrue(saved.headers().firstValue("cache-control").orElseThrow().contains("no-store"));assertEquals("DRAFT",json.readTree(saved.body()).get("status").asString());
  String id=json.readTree(saved.body()).get("id").asString();var conflict=http.send(HttpRequest.newBuilder(URI.create(base+path+"/"+id+"/actions")).header(csrf.get("headerName").asString(),csrf.get("token").asString()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("requestId",UUID.randomUUID(),"expectedRevision",99,"action","ENABLE","delegationAccepted",true)))).build(),HttpResponse.BodyHandlers.ofString());assertEquals(409,conflict.statusCode(),conflict.body());assertEquals("1.0",json.readTree(conflict.body()).get("contractVersion").asString());assertEquals("PLAN_REVISION_CONFLICT",json.readTree(conflict.body()).get("code").asString());
 }
 @Test void attentionShowsActionableOwnFactsAndNotTechnicalWaitingOrRevokedScope(){
  var p=enable(create("ANALYZE"));plans.tick(p.id());assertEquals(1,attention.list(owner,tenant,0,20).items().size());assertTrue(attention.list(other,tenant,0,20).items().isEmpty());
  upload(null);plans.tick(p.id());assertEquals("WAITING_CAPABILITY",plans.get(owner,tenant,p.id()).runtimeState());assertTrue(attention.list(owner,tenant,0,20).items().isEmpty());
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);assertTrue(attention.list(owner,tenant,0,20).items().isEmpty());
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES (?,?,?)",tenant,space,owner);assertEquals("AUTHORIZATION_REQUIRED",attention.list(owner,tenant,0,20).items().getFirst().status());
 }
 @Test void pausedPlanExpiresWithoutBeingResumed(){var p=enable(create("SOURCE_LOOKUP"));action(p.id(),"PAUSE");time(p.configuration().expiresAt());new PlanWorker(plans).tick();assertEquals("EXPIRED",plans.get(owner,tenant,p.id()).status());}
 @Test void planRetryCannotBypassUnknownTaskResultReconciliation(){
  upload(null);when(agents.enabled()).thenReturn(true);when(agents.mode()).thenReturn("verification");var p=enable(create("ANALYZE"));plans.tick(p.id());UUID task=run(p.id()).taskId();
  db.update("UPDATE conversation_tasks SET status='RESULT_UNKNOWN',reconciliation_required=true WHERE id=?",task);plans.tick(p.id());denied(409,()->action(p.id(),"RETRY"));action(p.id(),"PAUSE");denied(409,()->action(p.id(),"RESUME"));assertEquals(1,plans.get(owner,tenant,p.id()).runs());
 }
 @Test void agentCallbacksAndFinishCannotBypassPausedPlanEpoch(){
  upload(null);when(agents.enabled()).thenReturn(true);when(agents.mode()).thenReturn("verification");var p=enable(create("ANALYZE"));plans.tick(p.id());var job=conversations.claim();assertEquals(true,agentTasks.check(job.id(),job.token()).get("allowed"));action(p.id(),"PAUSE");denied(403,()->agentTasks.check(job.id(),job.token()));denied(403,()->agentTasks.finish(job,null));assertEquals("INTERRUPTED",db.queryForObject("SELECT status FROM conversation_tasks WHERE id=?",String.class,job.id()));
 }
}
