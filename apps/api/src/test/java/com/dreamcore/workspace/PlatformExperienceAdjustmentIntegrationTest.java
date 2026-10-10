package com.dreamcore.workspace;
import com.dreamcore.workspace.experience.*;import com.dreamcore.workspace.identity.IdentityException;import com.dreamcore.workspace.feedback.FeedbackService;
import java.util.*;import java.util.concurrent.*;
import org.junit.jupiter.api.*;import org.springframework.beans.factory.annotation.Autowired;import org.springframework.boot.test.context.SpringBootTest;import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;import static org.mockito.Mockito.*;import static org.mockito.ArgumentMatchers.*;import static com.dreamcore.workspace.experience.ExperienceAnalysisRuntime.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=false","dreamcore.experience-intake.enabled=false","dreamcore.experience-analysis.enabled=false","dreamcore.tasks.agent-mode=live","dreamcore.experience-generalization.enabled=false"})
class PlatformExperienceAdjustmentIntegrationTest {
 @Autowired ExperienceService experiences;@Autowired ExperienceAdmissionService admission;@Autowired JdbcTemplate db;@Autowired ExperienceAnalysisQueue queue;@Autowired ExperienceIntakeService intake;@Autowired FeedbackService feedback;
 @Autowired com.dreamcore.workspace.material.MaterialService materials;
 @Autowired ExperienceGeneralizationQueue generalization;@Autowired GeneralExperienceAdmissionService generalAdmission;
 UUID tenant,owner,space,task;
 @BeforeEach void fixture(){
  tenant=UUID.randomUUID();owner=UUID.randomUUID();space=UUID.randomUUID();task=UUID.randomUUID();UUID conversation=UUID.randomUUID();
  db.update("INSERT INTO tenants(id,name) VALUES (?,'合成调度企业')",tenant);db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成主体','unused')",owner,owner+"@dispatch.test");db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,owner);
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'合成共享空间','SHARED')",space,tenant,owner);db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES (?,?,?)",tenant,space,owner);
  db.update("INSERT INTO conversations(id,tenant_id,workspace_id,owner_id,title) VALUES (?,?,?,?,'private-title')",conversation,tenant,space,owner);
  // Synthetic live-classified fixture only: no actual model/provider/business result.
  db.update("INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,status,revision,attempt,reply,execution_class,engine_version,finished_at) VALUES (?,?,?,?,?,'private-prompt','AGENT','SUCCEEDED',3,1,'private-reply','live','synthetic-fixture',now())",task,tenant,space,conversation,owner);
  db.update("INSERT INTO conversation_attempts(task_id,attempt_number,attempt_id,input,status,provenance,snapshot) SELECT id,1,?,'private-input','SUCCEEDED','RECORDED',to_jsonb(t) FROM conversation_tasks t WHERE id=?",UUID.randomUUID(),task);
  db.update("INSERT INTO conversation_tool_receipts(task_id,attempt_number,sequence,name,status) VALUES (?,1,1,'compare_dataset','succeeded')",task);
 }
 Job claim(){queue.discover();var job=queue.claim(tenant);assertNotNull(job);return job;}
 String state(Job j){return db.queryForObject("SELECT state FROM experience_analysis_items WHERE source_id=?",String.class,j.source());}
 Descriptor descriptor(){return new Descriptor("1.0","synthetic-v1",true,"live");}
 Result result(Job j,String outcome){
  var input=j.inputs().stream().filter(i->i.kind().equals("EXECUTION_RECORD")).findFirst().orElseThrow();var evidence=List.of(new Evidence(input.id(),input.text()));
  var c=new Candidate(null,"先核验工具状态","回执只证明执行状态，不直接证明业务结论。",List.of("检查工具回执，区分执行与业务结果"),List.of("存在明确工具回执"),List.of("没有回执时不推断成功"),List.of("执行状态"),evidence);
  var r=new Review(Map.of("grounded","PASS","reusable","PASS","bounded","PASS","privacySafe","PASS","novel","PASS"),"OBSERVED_EXECUTION",evidence);
  return new Result("1.0","synthetic-v1","live",j.id(),j.lease(),j.source(),false,outcome,outcome.equals("QUALIFIED")?null:outcome.equals("SKIPPED")?"DUPLICATE":"QUALITY_NOT_ESTABLISHED",outcome.equals("QUALIFIED")?c:null,outcome.equals("QUALIFIED")?r:null,outcome.equals("SKIPPED")?List.of(new Stage("EXTRACT","synthetic",1,10L,2L)):List.of(new Stage("EXTRACT","synthetic",1,10L,2L),new Stage("VERIFY","synthetic",1,10L,2L)));
 }

 Job returned(String title,UUID target){
  var j=claim();queue.dispatched(j,descriptor());var r=result(j,"QUALIFIED");var c=r.candidate();
  var candidate=new Candidate(target,title,c.summary(),c.steps(),c.applicable(),c.excluded(),c.tags(),c.evidence());
  queue.complete(new Result(r.contractVersion(),r.engineVersion(),r.executionClass(),r.runId(),r.lease(),r.source(),false,r.outcome(),r.code(),candidate,r.review(),r.stages()));return j;
 }
 UUID nextTask(){UUID next=UUID.randomUUID();db.update("INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,status,revision,attempt,reply,execution_class,engine_version,finished_at) SELECT ?,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,status,revision,attempt,reply,execution_class,engine_version,now() FROM conversation_tasks WHERE id=?",next,task);db.update("INSERT INTO conversation_attempts(task_id,attempt_number,attempt_id,input,status,provenance,snapshot) SELECT id,1,?,'synthetic','SUCCEEDED','RECORDED',to_jsonb(t) FROM conversation_tasks t WHERE id=?",UUID.randomUUID(),next);db.update("INSERT INTO conversation_tool_receipts(task_id,attempt_number,sequence,name,status) VALUES (?,1,1,'compare_dataset','succeeded')",next);task=next;return next;}
 void grant(){db.update("INSERT INTO governance_capabilities(tenant_id,account_id,workspace_id,capability,granted_by) VALUES (?,?,?,'EXPERIENCE_MAINTAIN',?)",tenant,owner,space,owner);}
 ExperienceService.Entry entry(ExperienceAdmissionService.Receipt r){return experiences.get(owner,tenant,space,r.entryId(),r.versionId());}
 boolean scrubbed(UUID version){return db.queryForObject("SELECT scrubbed FROM experience_versions WHERE id=?",Boolean.class,version);}

 ExperienceAdmissionService.Receipt seed(){return admission.admit(returned("已核验的企业方法",null).id());}
 ExperienceGeneralizationRuntime.Job generalClaim(){generalization.discover();var j=generalization.claim(tenant);assertNotNull(j);return j;}
 ExperienceGeneralizationRuntime.Descriptor generalDescriptor(){return new ExperienceGeneralizationRuntime.Descriptor("1.0","synthetic-general-v1",true,"live");}
 Map<String,String> pass(Set<String> keys){var map=new HashMap<String,String>();keys.forEach(k->map.put(k,"PASS"));return map;}
 ExperienceGeneralizationRuntime.Method method(){return new ExperienceGeneralizationRuntime.Method("合成通用核对 "+tenant.toString().substring(0,8),"回执只证明执行状态",List.of("核对工具实际状态与业务依据"),List.of("有固定执行记录"),List.of("没有依据不宣称成功"),List.of("核对"),"OBSERVED_EXECUTION");}
 ExperienceGeneralizationRuntime.Result qualified(ExperienceGeneralizationRuntime.Job j,ExperienceGeneralizationRuntime.Method m){return new ExperienceGeneralizationRuntime.Result("1.0","synthetic-general-v1","live",j.id(),j.lease(),j.source(),false,"QUALIFIED",null,m,pass(ExperienceGeneralizationRuntime.PRIVACY),pass(ExperienceGeneralizationRuntime.QUALITY),List.of("CLEAN","PRIVACY","QUALITY").stream().map(n->new ExperienceGeneralizationRuntime.Stage(n,"synthetic",1,10L,2L)).toList());}
 GeneralExperienceAdmissionService.Receipt publish(ExperienceGeneralizationRuntime.Method m){var j=generalClaim();generalization.dispatched(j,generalDescriptor());generalization.complete(qualified(j,m));return generalAdmission.admit(j.id());}
 boolean available(UUID version){return db.queryForObject("SELECT general_experience_available(?)",Boolean.class,version);}
 String generalState(UUID version){return db.queryForObject("SELECT state FROM experience_generalization_sources WHERE version_id=?",String.class,version);}

 @Autowired GeneralExperienceLibrary library;
 @Autowired org.springframework.security.crypto.password.PasswordEncoder passwords;
 @org.springframework.boot.test.web.server.LocalServerPort int port;
 UUID platform;
 @BeforeEach void platformFixture(){platform=UUID.randomUUID();db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成平台人员','unused')",platform,platform+"@platform.test");db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",platform);db.update("INSERT INTO platform_accounts(account_id,login_name,password_hash) VALUES (?,?,?)",platform,platform+"@platform.test",passwords.encode("synthetic-platform-456"));}
 @AfterEach void cleanup(){db.update("DELETE FROM platform_sessions WHERE account_id=?",platform);db.update("DELETE FROM platform_accounts WHERE account_id=?",platform);db.update("DELETE FROM platform_roles WHERE account_id=?",platform);}

 @Autowired PlatformExperienceAdjustmentService adjustments;
 @Autowired GeneralExperienceManagement management;
 PlatformExperienceAdjustmentService.Change change(GeneralExperienceAdmissionService.Receipt base){return new PlatformExperienceAdjustmentService.Change(UUID.randomUUID(),base.versionId(),db.queryForObject("SELECT revision FROM general_experience_entries WHERE id=?",Integer.class,base.entryId()),"增加限制：先核对两个期间的覆盖范围，范围不一致时不要计算增长率。此建议不是执行证明。");}
 PlatformExperienceAdjustmentService.Adjustment submit(GeneralExperienceAdmissionService.Receipt base){return adjustments.submit(platform,base.entryId(),change(base));}
 ExperienceAnalysisRuntime.Result correction(PlatformExperienceAdjustmentService.Work w){
  var j=w.analysis();var evidence=j.inputs().stream().map(i->new Evidence(i.id(),i.text().substring(0,Math.min(90,i.text().length())))).toList();
  var c=new Candidate(j.existing().getFirst().versionId(),"范围核对方法 "+j.source().toString().substring(0,8),"核对范围后再判断是否可以比较",List.of("范围不一致时停止计算增长率"),List.of("期间数据比较"),List.of("无法核实范围时不能推断结论"),List.of("核验"),evidence);
  return new Result("1.0","synthetic-platform","live",j.id(),j.lease(),j.source(),false,"QUALIFIED",null,c,new Review(Map.of("grounded","PASS","reusable","PASS","bounded","PASS","privacySafe","PASS","novel","PASS"),"FEEDBACK_CORRECTION",evidence),List.of(new Stage("EXTRACT","synthetic",1,10L,2L),new Stage("VERIFY","synthetic",1,10L,2L)),"PLATFORM");
 }
 ExperienceGeneralizationRuntime.Result cleaned(PlatformExperienceAdjustmentService.Work w){return new ExperienceGeneralizationRuntime.Result("1.0","synthetic-platform","live",w.id(),w.lease(),w.general().source(),false,"QUALIFIED",null,w.general().original(),pass(ExperienceGeneralizationRuntime.PRIVACY),pass(ExperienceGeneralizationRuntime.QUALITY),List.of("CLEAN","PRIVACY","QUALITY").stream().map(n->new ExperienceGeneralizationRuntime.Stage(n,"synthetic",1,10L,2L)).toList(),"PLATFORM");}
 PlatformExperienceAdjustmentService.Work extraction(){var w=adjustments.claim();assertNotNull(w);assertEquals("EXTRACT",w.phase());assertNull(w.analysis().tenant());assertEquals("PLATFORM",w.analysis().scope());adjustments.dispatched(w,"synthetic-platform","live");return w;}
 PlatformExperienceAdjustmentService.Work cleaning(){var w=adjustments.claim();assertNotNull(w);assertEquals("GENERALIZE",w.phase());assertNull(w.general().tenant());assertEquals("FEEDBACK_CORRECTION",w.general().original().basis());adjustments.dispatched(w,"synthetic-platform","live");return w;}
 PlatformExperienceAdjustmentService.Adjustment adjusted(GeneralExperienceAdmissionService.Receipt base){var a=submit(base);var x=extraction();adjustments.complete(correction(x));var g=cleaning();adjustments.complete(cleaned(g));return adjustments.publish(a.id());}
 String proposalState(UUID id){return db.queryForObject("SELECT state FROM general_experience_adjustments WHERE id=?",String.class,id);}
 void cleared(UUID id){assertNull(db.queryForObject("SELECT content FROM general_experience_adjustments WHERE id=?",String.class,id));assertEquals(0,db.queryForObject("SELECT count(*) FROM general_experience_adjustment_runs WHERE proposal_id=? AND receipt IS NOT NULL",Integer.class,id));}

 @Autowired GeneralExperienceSuggestionService suggestions;
 @Test void platformAdjustmentOfRecontributionKeepsOriginalCrossEntryAncestor(){
  seed();var root=publish(method());grant();suggestions.submit(owner,tenant,root.entryId(),new GeneralExperienceSuggestionService.Change(UUID.randomUUID(),root.versionId(),space,"ADAPTATION","明确期间覆盖范围再进行判断"));var j=queue.claim(tenant);assertNotNull(j);queue.dispatched(j,descriptor());var evidence=j.inputs().stream().map(i->new Evidence(i.id(),i.text().substring(0,Math.min(90,i.text().length())))).toList();
  var c=new Candidate(null,"企业期间核对","先核对期间再判断",List.of("核对覆盖期间"),List.of("期间比较"),List.of("无依据停止"),List.of("期间"),evidence);
  queue.complete(new Result("1.0","synthetic-v1","live",j.id(),j.lease(),j.source(),false,"QUALIFIED",null,c,new Review(Map.of("grounded","PASS","reusable","PASS","bounded","PASS","privacySafe","PASS","novel","PASS"),"FEEDBACK_CORRECTION",evidence),List.of(new Stage("EXTRACT","synthetic",1,10L,2L),new Stage("VERIFY","synthetic",1,10L,2L))));var local=admission.admit(j.id());assertEquals("CREATED",local.outcome());
  var contribution=new ExperienceGeneralizationRuntime.Method("通用期间核对 "+tenant.toString().substring(0,8),"先核对覆盖期间",List.of("核对期间依据"),List.of("有明确依据"),List.of("无依据停止"),List.of("期间"),"FEEDBACK_CORRECTION");var contributed=publish(contribution);assertEquals("CREATED",contributed.outcome());
  var adjusted=adjusted(contributed);assertEquals("ADMITTED",adjusted.state());assertTrue(available(adjusted.resultVersionId()));assertEquals(Set.of(root.versionId(),contributed.versionId(),adjusted.resultVersionId()),new HashSet<>(db.queryForList("SELECT base_version FROM general_experience_ancestry WHERE version_id=?",UUID.class,adjusted.resultVersionId())));
  db.update("UPDATE general_experience_entries SET status='STOPPED' WHERE id=?",root.entryId());assertFalse(available(adjusted.resultVersionId()));assertNotNull(db.queryForObject("SELECT method::text FROM general_experience_versions WHERE id=?",String.class,adjusted.resultVersionId()));db.queryForList("SELECT scrub_lifecycle_object('TASK',?)",task);assertNull(db.queryForObject("SELECT method::text FROM general_experience_versions WHERE id=?",String.class,adjusted.resultVersionId()));
 }
 @Test void onlyFiveQualifiedStagesPublishVersionAndRetainRealSourceWithoutPrivateProjection(){
  seed();var base=publish(method());var request=change(base);var a=adjustments.submit(platform,base.entryId(),request);
  assertEquals(a,adjustments.submit(platform,base.entryId(),request));assertEquals("QUEUED",a.state());
  var page=adjustments.list(platform,base.entryId(),base.versionId(),false);assertFalse(page.enabled());assertFalse(page.canSubmit());assertEquals(1,page.items().size());
  var x=extraction();assertTrue(x.analysis().inputs().stream().allMatch(i->Set.of("SOURCE_EXCERPT","FEEDBACK").contains(i.kind())));assertEquals(x,adjustments.restore(x.id()));
  adjustments.complete(correction(x));assertEquals("QUEUED",proposalState(a.id()));assertEquals(base.versionId(),db.queryForObject("SELECT published_version FROM general_experience_entries WHERE id=?",UUID.class,base.entryId()));
  var g=cleaning();adjustments.complete(cleaned(g));assertEquals("PUBLISHING",proposalState(a.id()));assertTrue(available(base.versionId()));
  var accepted=adjustments.publish(a.id());assertEquals("ADMITTED",accepted.state());assertNotNull(accepted.resultVersionId());assertEquals(accepted,adjustments.publish(a.id()));cleared(a.id());
  assertEquals(List.of(accepted.resultVersionId(),base.versionId()),library.versions(platform,null,base.entryId(),accepted.resultVersionId(),0).items().stream().map(GeneralExperienceLibrary.Version::versionId).toList());
  assertEquals(1,library.historical(platform,null,base.entryId(),accepted.resultVersionId(),base.versionId()).number());
  assertEquals(2,library.detail(platform,null,base.entryId(),accepted.resultVersionId()).number());assertFalse(available(base.versionId()));assertTrue(db.queryForObject("SELECT general_experience_history_readable(?)",Boolean.class,base.versionId()));assertTrue(available(accepted.resultVersionId()));
  assertEquals(0,db.queryForObject("SELECT count(*) FROM general_experience_origins WHERE version_id=?",Integer.class,accepted.resultVersionId()));
  assertEquals(base.versionId(),db.queryForObject("SELECT base_version FROM general_experience_version_dependencies WHERE version_id=?",UUID.class,accepted.resultVersionId()));
  grant();String visible=new tools.jackson.databind.json.JsonMapper().writeValueAsString(library.detail(owner,tenant,base.entryId(),accepted.resultVersionId()));
  for(String privateValue:List.of(platform.toString(),tenant.toString(),task.toString(),owner.toString(),"content","建议不是执行证明"))assertFalse(visible.contains(privateValue));
  assertEquals(accepted,adjustments.submit(platform,base.entryId(),request));
 }
 @Test void customerCannotProposeAndOriginalRequestKeyCannotChangeItsBody(){
  seed();var base=publish(method());var c=change(base);
  assertThrows(IdentityException.class,()->adjustments.submit(owner,base.entryId(),c));assertThrows(IdentityException.class,()->adjustments.list(owner,base.entryId(),base.versionId(),true));
  adjustments.submit(platform,base.entryId(),c);
  assertEquals("IDEMPOTENCY_CONFLICT",assertThrows(IdentityException.class,()->adjustments.submit(platform,base.entryId(),new PlatformExperienceAdjustmentService.Change(c.requestId(),c.versionId(),c.expectedRevision(),"different"))).code);
  assertEquals("GENERAL_ADJUSTMENT_PENDING",assertThrows(IdentityException.class,()->submit(base)).code);
 }
 @Test void stopCancelsPendingProposalAndRestoringDoesNotReplayIt(){
  seed();var base=publish(method());var a=submit(base);var w=extraction();
  management.change(platform,base.entryId(),new GeneralExperienceManagement.Change(UUID.randomUUID(),base.versionId(),1,"STOPPED","暂停采用"));
  assertEquals("UNAVAILABLE",proposalState(a.id()));cleared(a.id());assertFalse(adjustments.active(w.id(),w.lease()));
  management.change(platform,base.entryId(),new GeneralExperienceManagement.Change(UUID.randomUUID(),base.versionId(),2,"AVAILABLE","恢复采用"));
  assertThrows(IdentityException.class,()->adjustments.complete(correction(w)));assertNull(adjustments.claim());assertEquals(base.versionId(),db.queryForObject("SELECT published_version FROM general_experience_entries WHERE id=?",UUID.class,base.entryId()));
 }
 @Test void stopAfterCleaningBeforePublicationCannotBeOverwritten(){
  seed();var base=publish(method());var a=submit(base);var x=extraction();adjustments.complete(correction(x));var g=cleaning();adjustments.complete(cleaned(g));
  management.change(platform,base.entryId(),new GeneralExperienceManagement.Change(UUID.randomUUID(),base.versionId(),1,"STOPPED","停止"));
  assertEquals("UNAVAILABLE",adjustments.publish(a.id()).state());cleared(a.id());assertFalse(available(base.versionId()));
 }
 @Test void roleRevocationCancelsUnfinishedWorkButDoesNotEraseAlreadyQualifiedGeneralVersion(){
  seed();var base=publish(method());var accepted=adjusted(base);
  var next=new GeneralExperienceAdmissionService.Receipt(null,"UPDATED",base.entryId(),accepted.resultVersionId());var pending=submit(next);var x=extraction();
  db.update("DELETE FROM platform_roles WHERE account_id=?",platform);
  assertEquals("UNAVAILABLE",proposalState(pending.id()));cleared(pending.id());assertFalse(adjustments.active(x.id(),x.lease()));assertTrue(available(accepted.resultVersionId()));
  assertThrows(IdentityException.class,()->adjustments.publish(pending.id()));
 }
 @Test void rootSourceWithdrawalErasesEveryAdjustedVersionAndNeverRestoresWithRegrant(){
  seed();var base=publish(method());var a=adjusted(base);var b=adjusted(new GeneralExperienceAdmissionService.Receipt(null,"UPDATED",base.entryId(),a.resultVersionId()));assertTrue(available(b.resultVersionId()));
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);
  for(UUID version:List.of(base.versionId(),a.resultVersionId(),b.resultVersionId())){assertFalse(db.queryForObject("SELECT general_experience_history_readable(?)",Boolean.class,version));assertNull(db.queryForObject("SELECT method::text FROM general_experience_versions WHERE id=?",String.class,version));}
  assertEquals("WITHDRAWN",db.queryForObject("SELECT status FROM general_experience_entries WHERE id=?",String.class,base.entryId()));
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES (?,?,?)",tenant,space,owner);assertFalse(available(b.resultVersionId()));
 }
 @Test void malformedOrUngroundedResultCannotAdvanceToCleaning(){
  seed();var base=publish(method());var a=submit(base);var x=extraction();var r=correction(x);var c=r.candidate();
  var wrong=new Candidate(null,c.title(),c.summary(),c.steps(),c.applicable(),c.excluded(),c.tags(),c.evidence());
  assertThrows(ExperienceAnalysisRuntime.Failure.class,()->adjustments.complete(new Result(r.contractVersion(),r.engineVersion(),r.executionClass(),r.runId(),r.lease(),r.source(),false,r.outcome(),r.code(),wrong,r.review(),r.stages(),"PLATFORM")));
  assertEquals("RUNNING",proposalState(a.id()));assertNull(adjustments.claim());assertTrue(available(base.versionId()));
 }
 @Test void unknownAttemptRetainsOriginalReceiptIdentityThenTerminatesWithoutRedispatch(){
  seed();var base=publish(method());var a=submit(base);var x=extraction();adjustments.uncertain(x.id());assertEquals("UNCERTAIN",proposalState(a.id()));assertNull(adjustments.claim());assertEquals(x,adjustments.restore(x.id()));
  assertTrue(adjustments.recoveries().stream().anyMatch(r->r.id().equals(x.id())&&!r.expired()));
  db.update("UPDATE general_experience_adjustment_runs SET lease_until=clock_timestamp()-interval '2 minutes' WHERE id=?",x.id());
  assertTrue(adjustments.recoveries().stream().anyMatch(r->r.id().equals(x.id())&&r.recoveryExpired()));adjustments.fail(x.id(),"UNKNOWN",true);assertEquals("UNKNOWN",proposalState(a.id()));cleared(a.id());assertNull(adjustments.claim());assertTrue(available(base.versionId()));
 }
 @Test void preflightFailuresRetryBoundedlyWithoutPublishingOrKeepingPrivateInputForever(){
  seed();var base=publish(method());var a=submit(base);
  for(int attempt=1;attempt<=3;attempt++){var w=adjustments.claim();assertNotNull(w);adjustments.fail(w.id(),"OFFLINE",false);assertEquals(attempt==3?"FAILED":"RETRY_WAIT",proposalState(a.id()));db.update("UPDATE general_experience_adjustments SET next_attempt_at=clock_timestamp() WHERE id=?",a.id());}
  cleared(a.id());assertNull(adjustments.claim());assertTrue(available(base.versionId()));
 }
 @Test void concurrentProposalsHaveOneWinnerAndDoNotLoseTheOriginalRequest(){
  seed();var base=publish(method());
  try(var pool=Executors.newFixedThreadPool(2)){
   var first=pool.submit(()->{try{return submit(base).id();}catch(IdentityException conflict){return null;}});var second=pool.submit(()->{try{return submit(base).id();}catch(IdentityException conflict){return null;}});
   int winners=(first.get(10,TimeUnit.SECONDS)!=null?1:0)+(second.get(10,TimeUnit.SECONDS)!=null?1:0);assertEquals(1,winners);
  }catch(Exception e){throw new RuntimeException(e);}
 } final class Browser {
  final java.net.http.HttpClient http=java.net.http.HttpClient.newBuilder().cookieHandler(new java.net.CookieManager(null,java.net.CookiePolicy.ACCEPT_ALL)).build();
  final tools.jackson.databind.json.JsonMapper json=new tools.jackson.databind.json.JsonMapper();
  java.net.http.HttpResponse<String> get(String path)throws Exception{return http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://127.0.0.1:"+port+path)).GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString());}
  void login(String realm,Map<String,String> body)throws Exception{String path=realm.equals("platform")?"/api/platform-admin/v1/auth":"/api/v1/auth";var csrf=json.readTree(get(path+"/csrf").body());var response=http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://127.0.0.1:"+port+path+"/login")).header("Content-Type","application/json").header(csrf.get("headerName").asString(),csrf.get("token").asString()).POST(java.net.http.HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build(),java.net.http.HttpResponse.BodyHandlers.ofString());assertEquals(200,response.statusCode(),response.body());}
 }

 @Autowired org.springframework.transaction.PlatformTransactionManager transactionManager;
 @Autowired com.dreamcore.workspace.identity.IdentityService identities;
 @Autowired com.dreamcore.workspace.identity.IdentityAudit audit;
 @Test void platformHttpRequiresItsOwnCookieAndCsrfAndNeverReturnsProposalBody()throws Exception{
  seed();var base=publish(method());db.update("UPDATE accounts SET password_hash=? WHERE id=?",passwords.encode("synthetic-customer-123"),owner);
  String path="/api/platform-admin/v1/experience-library/"+base.entryId()+"/adjustments";
  var customer=new Browser();customer.login("customer",Map.of("email",owner+"@dispatch.test","password","synthetic-customer-123"));assertEquals(403,customer.get(path+"?version="+base.versionId()).statusCode());
  var admin=new Browser();admin.login("platform",Map.of("username",platform+"@platform.test","password","synthetic-platform-456"));
  var page=admin.get(path+"?version="+base.versionId());assertEquals(200,page.statusCode(),page.body());assertTrue(page.headers().firstValue("cache-control").orElseThrow().contains("no-store"));
  var change=change(base);var builder=java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://127.0.0.1:"+port+path)).header("Content-Type","application/json").POST(java.net.http.HttpRequest.BodyPublishers.ofString(admin.json.writeValueAsString(change)));
  assertEquals(403,admin.http.send(builder.build(),java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
  var csrf=admin.json.readTree(admin.get("/api/platform-admin/v1/auth/csrf").body());builder.header(csrf.get("headerName").asString(),csrf.get("token").asString());
  var response=admin.http.send(builder.build(),java.net.http.HttpResponse.BodyHandlers.ofString());assertEquals(200,response.statusCode(),response.body());assertEquals(response.body(),admin.http.send(builder.build(),java.net.http.HttpResponse.BodyHandlers.ofString()).body());
  for(String forbidden:List.of(change.content(),"actorId","runId","content","request_hash","receipt","evidence",tenant.toString(),task.toString()))assertFalse(response.body().contains(forbidden));
  assertEquals(404,customer.get("/api/v1/tenants/"+tenant+"/general-experiences/"+base.entryId()+"/adjustments?version="+base.versionId()).statusCode());
 }
 @Test void verificationClassCannotAdvanceOrPublishAndTerminalCleanupIsImmediate(){
  seed();var base=publish(method());var a=submit(base);var w=adjustments.claim();adjustments.dispatched(w,"synthetic-platform","verification");var r=correction(w);
  var service=new PlatformExperienceAdjustmentService(db,identities,audit,library,new ExperienceAnalysisRuntime("http://127.0.0.1:1","","verification"),new ExperienceGeneralizationRuntime("http://127.0.0.1:1","","verification"));
  new org.springframework.transaction.support.TransactionTemplate(transactionManager).execute(status->{service.complete(new Result(r.contractVersion(),r.engineVersion(),"verification",r.runId(),r.lease(),r.source(),false,r.outcome(),r.code(),r.candidate(),r.review(),r.stages(),r.scope()));return null;});
  assertEquals("FAILED",proposalState(a.id()));cleared(a.id());assertNull(adjustments.claim());assertTrue(available(base.versionId()));
 }
 @Test void publicationRechecksErasureAfterWaitingForFixedVersionLock()throws Exception{
  seed();var base=publish(method());var a=submit(base);var x=extraction();adjustments.complete(correction(x));var g=cleaning();adjustments.complete(cleaned(g));var started=new CountDownLatch(1);
  try(var pool=Executors.newSingleThreadExecutor()){
   var future=new org.springframework.transaction.support.TransactionTemplate(transactionManager).execute(status->{
    db.queryForList("SELECT id FROM general_experience_versions WHERE id=? FOR UPDATE",base.versionId());
    var pending=pool.submit(()->{started.countDown();return adjustments.publish(a.id());});
    try{assertTrue(started.await(10,TimeUnit.SECONDS));assertThrows(TimeoutException.class,()->pending.get(200,TimeUnit.MILLISECONDS));}catch(InterruptedException e){throw new RuntimeException(e);}
    db.update("UPDATE general_experience_versions SET method=NULL WHERE id=?",base.versionId());return pending;
   });
   assertEquals("UNAVAILABLE",future.get(10,TimeUnit.SECONDS).state());
  }
  cleared(a.id());assertEquals(1,db.queryForObject("SELECT count(*) FROM general_experience_versions WHERE entry_id=?",Integer.class,base.entryId()));
 }
 @Test void publishedAdjustmentCanBeStoppedRestoredAndReadThroughBothRealms(){
  seed();var base=publish(method());var a=adjusted(base);grant();
  management.change(platform,base.entryId(),new GeneralExperienceManagement.Change(UUID.randomUUID(),a.resultVersionId(),2,"STOPPED","停止已调整版本"));
  assertEquals("STOPPED",library.detail(platform,null,base.entryId(),a.resultVersionId()).status());assertThrows(IdentityException.class,()->library.detail(owner,tenant,base.entryId(),a.resultVersionId()));
  management.change(platform,base.entryId(),new GeneralExperienceManagement.Change(UUID.randomUUID(),a.resultVersionId(),3,"AVAILABLE","恢复已调整版本"));
  assertEquals(2,library.detail(owner,tenant,base.entryId(),a.resultVersionId()).number());
  var page=adjustments.list(platform,base.entryId(),base.versionId(),true);assertFalse(page.canSubmit());assertEquals(a.resultVersionId(),page.currentVersionId());
 }

 @Autowired com.dreamcore.workspace.identity.PlatformRecordsService records;
 @Test void recordsShowCleanFixedVersionNamesButNeverPrivateCorrectionOrContributingTenant(){
  seed();var base=publish(method());var a=adjusted(base);
  var own=records.list(platform,"EXPERIENCE","SUCCESS",0,100).stream().filter(r->platform.equals(r.actorId())&&a.id().equals(r.targetId())).toList();assertEquals(2,own.size());
  assertTrue(own.stream().allMatch(r->r.tenantId()==null&&r.internalReason()==null));
  String serialized=new tools.jackson.databind.json.JsonMapper().writeValueAsString(own);assertFalse(serialized.contains("此建议不是执行证明"));assertFalse(serialized.contains(tenant.toString()));assertTrue(serialized.contains("v2"));
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);
  assertTrue(records.list(platform,"EXPERIENCE","SUCCESS",0,100).stream().filter(r->a.id().equals(r.targetId())).allMatch(r->r.targetName().equals("已失效的通用经验")));
 }
 @Test void adjustedVersionAdoptionPreservesStoppedHistoryButRealRootErasurePropagatesToConsumer(){
  seed();var base=publish(method());var a=adjusted(base);UUID originalTask=task,consumer=nextTask();
  db.update("INSERT INTO task_general_experience_reads(task_id,attempt_number,entry_id,version_id,read_bits) VALUES (?,1,?,?,1)",consumer,base.entryId(),a.resultVersionId());
  assertTrue(db.queryForObject("SELECT task_general_experiences_readable(?)",Boolean.class,consumer));
  management.change(platform,base.entryId(),new GeneralExperienceManagement.Change(UUID.randomUUID(),a.resultVersionId(),2,"STOPPED","停止后续采用"));
  assertTrue(db.queryForObject("SELECT task_general_experiences_readable(?)",Boolean.class,consumer));
  db.queryForList("SELECT scrub_lifecycle_object('TASK',?)",originalTask);
  assertFalse(db.queryForObject("SELECT task_general_experiences_readable(?)",Boolean.class,consumer));
  assertTrue(db.queryForObject("SELECT invalidated FROM task_general_experience_reads WHERE task_id=?",Boolean.class,consumer));assertNull(db.queryForObject("SELECT method::text FROM general_experience_versions WHERE id=?",String.class,a.resultVersionId()));
 }

 @Test void unsupportedCleanMethodFormatFailsAndClearsInsteadOfLoopingOrPretendingSourceWithdrawal(){
  seed();var base=publish(method());var a=submit(base);var x=extraction();var r=correction(x);var c=r.candidate();
  var longTag=new Candidate(c.targetVersionId(),c.title(),c.summary(),c.steps(),c.applicable(),c.excluded(),List.of("X".repeat(50)),c.evidence());
  adjustments.complete(new Result(r.contractVersion(),r.engineVersion(),r.executionClass(),r.runId(),r.lease(),r.source(),false,r.outcome(),r.code(),longTag,r.review(),r.stages(),r.scope()));
  assertNull(adjustments.claim());assertEquals("FAILED",proposalState(a.id()));cleared(a.id());assertTrue(available(base.versionId()));
 }

}
