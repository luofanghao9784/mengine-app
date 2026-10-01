package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.*;
import com.dreamcore.workspace.knowledge.*;
import org.springframework.mock.web.MockMultipartFile;
import java.net.*;
import java.net.http.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=verification","dreamcore.tasks.initial-delay-ms=3600000","dreamcore.knowledge.enabled=true","dreamcore.knowledge.initial-delay-ms=3600000"})
class TaskControlIntegrationTest {
 @Autowired com.dreamcore.workspace.lifecycle.MaterialLifecycleService lifecycle;
 @Autowired MaterialService materials;@Autowired KnowledgeService knowledge;
 @Autowired ConversationService conversations;@Autowired AgentTaskService agents;@Autowired JdbcTemplate db;@Autowired PasswordEncoder passwords;@LocalServerPort int port;
 UUID tenant,owner,other,space;JsonMapper json=new JsonMapper();
 @BeforeEach void setup(){tenant=UUID.randomUUID();owner=UUID.randomUUID();other=UUID.randomUUID();space=UUID.randomUUID();for(UUID u:List.of(owner,other))db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",u,u+"@example.test","合成控制测试",passwords.encode("synthetic-control-password"));db.update("INSERT INTO tenants(id,name) VALUES (?,'合成控制企业')",tenant);for(UUID u:List.of(owner,other))db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,u);db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'合成共享空间','SHARED')",space,tenant,owner);db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true),(?,?,?,false)",tenant,space,owner,tenant,space,other);}
 @AfterEach void stop(){db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('RUNNING','QUEUED')",tenant);}
 ConversationService.Detail send(){return conversations.submit(owner,tenant,null,space,UUID.randomUUID(),"分析合成进度","AGENT");}
 ConversationService.Task task(ConversationService.Detail d){return d.tasks().getLast();}
 ConversationService.Detail detail(UUID c){return conversations.detail(owner,tenant,c,0,20);}
 ConversationService.Detail action(UUID c,UUID t,String a,String input){return conversations.action(owner,tenant,c,t,UUID.randomUUID(),detail(c).tasks().stream().filter(v->v.id().equals(t)).findFirst().orElseThrow().revision(),a,input);}
 void denied(int n,Runnable r){assertEquals(n,assertThrows(IdentityException.class,r::run).status);}
 void record(ConversationService.Job j,String name,String state){agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,name,"STARTED"));if(!state.equals("STARTED"))agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,name,state));}
 AgentResult result(ConversationService.Job j,String outcome,String message,List<AgentResult.Tool> tools){return new AgentResult("1.5","0.11.0",j.id(),j.token(),"AGENT","verification","synthetic","合成已取得结果；仍需指定截止日期",List.of(),tools,List.of(),1,null,List.of(),List.of(),List.of(),outcome,message);}
 void finish(ConversationService.Job j,String outcome){agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("task_control")));record(j,"task_control","succeeded");agents.finish(j,result(j,outcome,"请指定本次截止日期",List.of(new AgentResult.Tool("control","task_control","succeeded"))));}
 @Test void exactTaskDetailSupportsAttentionStatesWithoutWeakeningPublishableHistory(){
  send();var j=conversations.claim();finish(j,"WAITING_INPUT");
  var focused=conversations.taskDetail(owner,tenant,j.conversation(),j.id());assertEquals(1,focused.tasks().size());assertEquals(j.id(),focused.tasks().getFirst().id());assertEquals("WAITING_INPUT",focused.tasks().getFirst().status());
  denied(404,()->conversations.historical(owner,tenant,j.conversation(),j.id()));denied(404,()->conversations.taskDetail(other,tenant,j.conversation(),j.id()));denied(404,()->conversations.taskDetail(owner,tenant,j.conversation(),UUID.randomUUID()));
  action(j.conversation(),j.id(),"PAUSE",null);assertEquals("PAUSED",conversations.taskDetail(owner,tenant,j.conversation(),j.id()).tasks().getFirst().status());
 }
 @Test void waitingInputResumesWithIdempotentSupplementAndPreservesAttempt(){
  var d=send();var j=conversations.claim();finish(j,"WAITING_INPUT");assertEquals("WAITING_INPUT",task(detail(d.conversation().id())).status());assertNull(conversations.claim());
  denied(400,()->action(j.conversation(),j.id(),"RESUME",null));int revision=task(detail(j.conversation())).revision();UUID key=UUID.randomUUID();
  var resumed=conversations.action(owner,tenant,j.conversation(),j.id(),key,revision,"RESUME","截止到本周五");assertEquals("QUEUED",task(resumed).status());assertEquals(1,task(resumed).attempt());
  assertEquals(resumed,conversations.action(owner,tenant,j.conversation(),j.id(),key,revision,"RESUME","截止到本周五"));denied(409,()->conversations.action(owner,tenant,j.conversation(),j.id(),key,revision,"RESUME","改为下周"));
  var next=conversations.claim();assertTrue(next.prompt().contains("截止到本周五"));assertEquals(2,task(detail(j.conversation())).attempt());var history=conversations.attempts(owner,tenant,j.conversation(),j.id(),0,10);assertEquals(List.of("RUNNING","WAITING_INPUT"),history.items().stream().map(ConversationService.Attempt::status).toList());assertEquals("合成已取得结果；仍需指定截止日期",history.items().getLast().reply());assertFalse(json.writeValueAsString(history).contains(j.token().toString()));
 }
 @Test void pauseFencesCallbacksAndLateResultsWithoutErasingRecordedToolReceipt(){
  send();var j=conversations.claim();agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("search_sources")));record(j,"search_sources","STARTED");action(j.conversation(),j.id(),"PAUSE",null);assertFalse(agents.active(j));denied(403,()->agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,"search_sources","succeeded")));denied(403,()->agents.finish(j,result(j,"COMPLETE",null,List.of())));conversations.fail(j,"TASK_RESULT_UNKNOWN");assertEquals("PAUSED",task(detail(j.conversation())).status());assertEquals("STARTED",conversations.attempts(owner,tenant,j.conversation(),j.id(),0,10).items().getFirst().tools().getFirst().status());action(j.conversation(),j.id(),"RESUME",null);assertNotEquals(j.token(),conversations.claim().token());
 }
 @Test void unknownCannotEscapeByCancelOrUserAssertionAndNeedsServerPolicy(){
  send();var j=conversations.claim();conversations.fail(j,"TASK_RESULT_UNKNOWN");assertTrue(task(detail(j.conversation())).reconciliationRequired());denied(409,()->action(j.conversation(),j.id(),"RECONCILE",null));denied(400,()->action(j.conversation(),j.id(),"RECONCILE","我确认没有影响"));action(j.conversation(),j.id(),"CANCEL",null);denied(409,()->action(j.conversation(),j.id(),"RETRY",null));assertEquals("RESULT_UNKNOWN",conversations.attempts(owner,tenant,j.conversation(),j.id(),0,10).items().getFirst().status());
 }
 @Test void actualReadOnlyPolicyAllowsReconcileButNeverMarksOldResultSuccessful(){
  send();var j=conversations.claim();denied(502,()->agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("send_payment"))));agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("search_sources")));record(j,"search_sources","STARTED");conversations.fail(j,"TASK_RESULT_UNKNOWN");action(j.conversation(),j.id(),"RECONCILE",null);var current=task(detail(j.conversation()));assertEquals("FAILED",current.status());assertFalse(current.reconciliationRequired());assertNull(current.reply());var previous=conversations.attempts(owner,tenant,j.conversation(),j.id(),0,10).items().getFirst();assertEquals("RESULT_UNKNOWN",previous.status());assertEquals("NO_BUSINESS_WRITES",previous.reconciliationCode());action(j.conversation(),j.id(),"RETRY",null);assertNotNull(conversations.claim());
 }
 @Test void partialAndCapabilityWaitAreRecordedAndNeverAutoRetry(){
  send();var j=conversations.claim();finish(j,"PARTIAL");assertEquals("PARTIAL",task(detail(j.conversation())).status());assertNull(conversations.claim());action(j.conversation(),j.id(),"RESUME","仅处理已知部分");var next=conversations.claim();finish(next,"WAITING_CAPABILITY");assertEquals("WAITING_CAPABILITY",task(detail(j.conversation())).status());assertNull(conversations.claim());assertEquals(2,conversations.attempts(owner,tenant,j.conversation(),j.id(),0,10).items().size());
 }
 @Test void failedToolCannotBeCompleteAndUnrecordedReceiptsCannotFabricatePartial(){
  send();var j=conversations.claim();agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("search_sources")));record(j,"search_sources","failed");var tools=List.of(new AgentResult.Tool("search","search_sources","failed"));denied(502,()->agents.finish(j,result(j,"COMPLETE",null,tools)));denied(502,()->agents.finish(j,result(j,"PARTIAL",null,List.of(new AgentResult.Tool("other","run_javascript","succeeded")))));agents.finish(j,result(j,"PARTIAL",null,tools));assertEquals("PARTIAL",task(detail(j.conversation())).status());
 }
 @Test void resumeAndHistoryRecheckMembershipAndMode(){
  send();var j=conversations.claim();finish(j,"WAITING_INPUT");denied(404,()->conversations.attempts(other,tenant,j.conversation(),j.id(),0,10));db.update("UPDATE conversation_tasks SET execution_class='live' WHERE id=?",j.id());denied(409,()->action(j.conversation(),j.id(),"RESUME","合成补充"));db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);denied(404,()->conversations.action(owner,tenant,j.conversation(),j.id(),UUID.randomUUID(),2,"RESUME","合成补充"));denied(404,()->conversations.attempts(owner,tenant,j.conversation(),j.id(),0,10));
 }
 @Test void expiredAgentLeaseBecomesUnknownWithNoAutomaticRestart(){send();var j=conversations.claim();db.update("UPDATE conversation_tasks SET lease_until=now()-interval '1 second' WHERE id=?",j.id());assertNull(conversations.claim());assertEquals("RESULT_UNKNOWN",task(detail(j.conversation())).status());assertEquals("RESULT_UNKNOWN",conversations.attempts(owner,tenant,j.conversation(),j.id(),0,10).items().getFirst().status());assertNull(conversations.claim());}
 @Test void httpControlsRequireCsrfAndHistoryNeverExposesCapability() throws Exception {
  send();var j=conversations.claim();String base="http://127.0.0.1:"+port;var http=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();
  var csrf=json.readTree(http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());
  assertEquals(200,http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/login")).header(csrf.get("headerName").asString(),csrf.get("token").asString()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("email",owner+"@example.test","password","synthetic-control-password")))).build(),HttpResponse.BodyHandlers.ofString()).statusCode());
  csrf=json.readTree(http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());
  String url=base+"/api/v1/tenants/"+tenant+"/conversations/"+j.conversation()+"/tasks/"+j.id();String body=json.writeValueAsString(Map.of("requestId",UUID.randomUUID(),"expectedRevision",1,"action","PAUSE"));
  assertEquals(403,http.send(HttpRequest.newBuilder(URI.create(url)).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString()).statusCode());
  var paused=http.send(HttpRequest.newBuilder(URI.create(url)).header("Content-Type","application/json").header(csrf.get("headerName").asString(),csrf.get("token").asString()).POST(HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,paused.statusCode());assertTrue(paused.body().contains("PAUSED"));
  var focused=http.send(HttpRequest.newBuilder(URI.create(url)).GET().build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,focused.statusCode());assertTrue(focused.body().contains("PAUSED"));
  var history=http.send(HttpRequest.newBuilder(URI.create(url+"/attempts")).GET().build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,history.statusCode());assertTrue(history.headers().firstValue("cache-control").orElseThrow().contains("no-store"));assertFalse(history.body().contains(j.token().toString()));
 }
 @Test void withdrawnActuallyReadSourceHidesOnlyAffectedTaskAndFencesRecovery(){
  var uploaded=materials.upload(owner,tenant,space,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","synthetic.txt","text/plain","secret-source".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
  var parse=knowledge.claim();knowledge.finish(parse,new DocumentParser.Result("synthetic","READY",List.of(),List.of(new DocumentParser.Fragment("L1","secret-source","TEXT"))));
  var first=send();var j=conversations.claim();assertFalse(agents.search(j.id(),j.token(),"secret-source").isEmpty());action(j.conversation(),j.id(),"PAUSE",null);
  var second=conversations.submit(owner,tenant,j.conversation(),space,UUID.randomUUID(),"另一个不读该资料的任务","AGENT");UUID secondId=task(second).id();
  db.update("INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state) VALUES (?,?,'MATERIAL',?,'TRASHED')",tenant,space,uploaded.id());
  var details=detail(j.conversation());var restricted=details.tasks().stream().filter(t->t.id().equals(j.id())).findFirst().orElseThrow();assertTrue(restricted.sourcesUnavailable());assertNull(restricted.reply());assertTrue(restricted.sources().isEmpty());assertFalse(details.tasks().stream().filter(t->t.id().equals(secondId)).findFirst().orElseThrow().sourcesUnavailable());
  denied(403,()->conversations.attempts(owner,tenant,j.conversation(),j.id(),0,10));denied(403,()->action(j.conversation(),j.id(),"RESUME",null));assertEquals("CANCELLED",action(j.conversation(),j.id(),"CANCEL",null).tasks().stream().filter(t->t.id().equals(j.id())).findFirst().orElseThrow().status());
 }
 @Test void partialArtifactRemainsDownloadableFromItsOwnRecordedAttemptAfterResume() throws Exception {
  send();var j=conversations.claim();agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("run_javascript")));record(j,"run_javascript","succeeded");byte[] bytes="synthetic partial".getBytes(java.nio.charset.StandardCharsets.UTF_8);String digest=HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes));
  var output=new AgentResult("1.5","0.11.0",j.id(),j.token(),"AGENT","verification","synthetic","部分结果",List.of(),List.of(new AgentResult.Tool("code","run_javascript","succeeded")),List.of(new AgentResult.Artifact("partial.txt",digest,Base64.getEncoder().encodeToString(bytes))),1,null,List.of(),List.of(),List.of(),"PARTIAL",null);agents.finish(j,output);UUID artifact=task(detail(j.conversation())).artifacts().getFirst().id();
  action(j.conversation(),j.id(),"RESUME",null);var next=conversations.claim();assertTrue(task(detail(j.conversation())).artifacts().isEmpty());assertArrayEquals(bytes,agents.download(owner,tenant,j.conversation(),j.id(),artifact).bytes());var previous=conversations.attempts(owner,tenant,j.conversation(),j.id(),0,10).items().getLast();assertEquals("PARTIAL",previous.status());assertEquals(artifact,previous.artifacts().getFirst().id());
 }

 @Test void resumingPausedInputWaitRestoresWaitWithoutClaimingAnExecution(){send();var j=conversations.claim();finish(j,"WAITING_INPUT");action(j.conversation(),j.id(),"PAUSE",null);assertEquals("WAITING_INPUT",task(action(j.conversation(),j.id(),"RESUME",null)).status());assertNull(conversations.claim());assertEquals(1,task(detail(j.conversation())).attempt());}

 @Test void materialInvalidationPermanentlyFencesOldAttemptEvenAfterImmediateRestore(){
  var file=materials.upload(owner,tenant,space,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","restore.txt","text/plain","restore-source".getBytes(java.nio.charset.StandardCharsets.UTF_8)));var parse=knowledge.claim();knowledge.finish(parse,new DocumentParser.Result("synthetic","READY",List.of(),List.of(new DocumentParser.Fragment("L1","restore-source","TEXT"))));
  send();var j=conversations.claim();var reads=agents.search(j.id(),j.token(),"restore-source");assertFalse(reads.isEmpty());
  lifecycle.act(owner,tenant,space,"MATERIAL",file.id(),UUID.randomUUID(),0,"TRASH");assertEquals("INTERRUPTED",task(detail(j.conversation())).status());denied(403,()->conversations.attempts(owner,tenant,j.conversation(),j.id(),0,10));
  lifecycle.act(owner,tenant,space,"MATERIAL",file.id(),UUID.randomUUID(),1,"RESTORE");
  assertFalse(agents.active(j));denied(403,()->agents.finish(j,new AgentResult("1.4","0.11.0",j.id(),j.token(),"AGENT","verification","synthetic","迟到结果",reads.stream().map(AgentTaskService.Input::id).toList(),List.of(),List.of(),1,null,List.of(),List.of(),List.of())));
  assertNull(conversations.claim());assertNull(task(detail(j.conversation())).reply());action(j.conversation(),j.id(),"RETRY",null);var fresh=conversations.claim();assertNotEquals(j.token(),fresh.token());assertTrue(agents.active(fresh));
 }

 @Test void internalPlanFenceIsTenantBoundIdempotentAndNeverInventsSuccess(){send();var j=conversations.claim();denied(400,()->conversations.interruptTasks(tenant,List.of(j.id()),"SUCCEEDED"));conversations.interruptTasks(UUID.randomUUID(),List.of(j.id()),"TASK_PLAN_STOPPED");assertTrue(agents.active(j));conversations.interruptTasks(tenant,List.of(j.id()),"TASK_PLAN_STOPPED");conversations.interruptTasks(tenant,List.of(j.id()),"TASK_PLAN_STOPPED");assertEquals("INTERRUPTED",task(detail(j.conversation())).status());assertEquals(2,task(detail(j.conversation())).revision());assertNull(task(detail(j.conversation())).reply());assertFalse(agents.active(j));assertEquals("INTERRUPTED",db.queryForObject("SELECT status FROM agent_attempt_usage WHERE task_id=?",String.class,j.id()));}

}
