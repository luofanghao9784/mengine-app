package com.dreamcore.workspace;
import com.dreamcore.workspace.experience.*;import com.dreamcore.workspace.identity.IdentityException;import com.dreamcore.workspace.feedback.FeedbackService;
import java.util.*;import java.util.concurrent.*;
import org.junit.jupiter.api.*;import org.springframework.beans.factory.annotation.Autowired;import org.springframework.boot.test.context.SpringBootTest;import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;import static org.mockito.Mockito.*;import static org.mockito.ArgumentMatchers.*;import static com.dreamcore.workspace.experience.ExperienceAnalysisRuntime.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=false","dreamcore.experience-intake.enabled=false","dreamcore.experience-analysis.enabled=false"})
class ExperienceAdjustmentIntegrationTest {
 @org.springframework.boot.test.web.server.LocalServerPort int port;
 @Autowired ExperienceAdjustmentService adjustments;
 @Autowired org.springframework.security.crypto.password.PasswordEncoder passwords;@Autowired ExperienceManagementService management;@Autowired ExperienceService experiences;@Autowired ExperienceAdmissionService admission;@Autowired JdbcTemplate db;@Autowired ExperienceAnalysisQueue queue;@Autowired ExperienceIntakeService intake;@Autowired FeedbackService feedback;
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


 ExperienceService.Entry seed(){grant();return entry(admission.admit(returned("原始固定方法",null).id()));}
 ExperienceAdjustmentService.Proposal proposal(){return new ExperienceAdjustmentService.Proposal("修订后的核对方法","补充覆盖范围限制","核对覆盖范围后再解释执行回执",List.of("核对","范围"),"有实际回执和覆盖说明","口径不一致时不推断业务效果","原方法遗漏覆盖范围，补充限制以免误用。");}
 ExperienceAdjustmentService.Adjustment submit(ExperienceService.Entry e){return adjustments.submit(owner,tenant,space,e.id(),UUID.randomUUID(),e.revision(),e.version().id(),proposal());}
 Result adjustmentResult(Job job,String outcome,UUID target){
  var evidence=job.inputs().stream().map(i->new Evidence(i.id(),i.text().substring(0,Math.min(700,i.text().length())))).toList();var p=proposal();
  var candidate=new Candidate(target,p.title(),p.summary(),List.of(p.body()),List.of(p.applicable()),List.of(p.excluded()),p.tags(),evidence);var review=new Review(Map.of("grounded","PASS","reusable","PASS","bounded","PASS","privacySafe","PASS","novel","PASS"),"FEEDBACK_CORRECTION",evidence);
  return new Result("1.0","synthetic-v1","live",job.id(),job.lease(),job.source(),false,outcome,outcome.equals("QUALIFIED")?null:"QUALITY_NOT_ESTABLISHED",outcome.equals("QUALIFIED")?candidate:null,outcome.equals("QUALIFIED")?review:null,List.of(new Stage("EXTRACT","synthetic",1,10L,2L),new Stage("VERIFY","synthetic",1,10L,2L)));
 }
 @Test void submissionIsIdempotentPrivateAndLeavesCurrentVersionInPlace(){
  var e=seed();UUID key=UUID.randomUUID();var first=adjustments.submit(owner,tenant,space,e.id(),key,e.revision(),e.version().id(),proposal());var second=adjustments.submit(owner,tenant,space,e.id(),key,e.revision(),e.version().id(),proposal());assertEquals(first,second);assertEquals("WAITING",first.state());assertEquals(e.version().id(),experiences.get(owner,tenant,space,e.id(),null).publishedVersion());assertTrue(intake.available(first.id()));assertFalse(adjustments.list(owner,tenant,space,e.id(),false).enabled());
  assertEquals("EXPERIENCE_ADJUSTMENT_PENDING",assertThrows(IdentityException.class,()->submit(e)).code);var json=new tools.jackson.databind.json.JsonMapper().writeValueAsString(adjustments.list(owner,tenant,space,e.id(),true));assertFalse(json.contains(proposal().body()));assertFalse(json.contains(proposal().reason()));
 }
 @Test void onlyAutomaticQualificationUpdatesTheExactEntryAndSurvivesRediscovery(){
  var e=seed();var a=submit(e);var job=claim();assertEquals(a.id(),job.source());assertEquals(List.of(e.version().id()),job.existing().stream().map(Existing::versionId).toList());assertTrue(job.inputs().stream().anyMatch(i->i.kind().equals("FEEDBACK")));assertTrue(job.inputs().stream().noneMatch(i->i.text().contains("private-prompt")||i.text().contains("private-reply")));
  queue.dispatched(job,descriptor());queue.complete(adjustmentResult(job,"QUALIFIED",e.version().id()));assertEquals(e.version().id(),experiences.get(owner,tenant,space,e.id(),null).publishedVersion());var receipt=admission.admit(job.id());assertEquals("UPDATED",receipt.outcome());assertEquals(e.id(),receipt.entryId());var latest=experiences.get(owner,tenant,space,e.id(),null);assertEquals(2,latest.version().number());assertEquals("AUTOMATIC_CHECKED",latest.version().evaluation());assertEquals(proposal().title(),latest.version().content().title());assertNull(db.queryForObject("SELECT content::text FROM experience_adjustments WHERE id=?",String.class,a.id()));queue.discover();assertTrue(intake.available(a.id()));assertEquals("UPDATED",adjustments.list(owner,tenant,space,e.id(),true).items().getFirst().state());assertFalse(scrubbed(receipt.versionId()));
  db.queryForList("SELECT scrub_lifecycle_object('TASK',?)",task);assertTrue(scrubbed(receipt.versionId()));
 }
 @Test void rejectionKeepsTheOriginalAndAllowsANewCorrectionWithoutHumanApproval(){
  var e=seed();var a=submit(e);var job=claim();queue.dispatched(job,descriptor());queue.complete(adjustmentResult(job,"REJECTED",null));assertEquals("NOT_ADMITTED",adjustments.list(owner,tenant,space,e.id(),true).items().getFirst().state());assertEquals(e.version().id(),experiences.get(owner,tenant,space,e.id(),null).publishedVersion());assertNull(db.queryForObject("SELECT content::text FROM experience_adjustments WHERE id=?",String.class,a.id()));assertNotEquals(a.id(),submit(e).id());
 }
 @Test void wrongTargetCannotCreateANewEntryOrReplaceAnotherVersion(){
  var e=seed();var a=submit(e);var job=claim();queue.dispatched(job,descriptor());queue.complete(adjustmentResult(job,"QUALIFIED",null));assertEquals("CONFLICT",admission.admit(job.id()).outcome());assertEquals("NOT_ADMITTED",adjustments.list(owner,tenant,space,e.id(),true).items().getFirst().state());assertEquals(1,db.queryForObject("SELECT count(*) FROM experience_entries WHERE tenant_id=?",Integer.class,tenant));assertEquals(e.version().id(),experiences.get(owner,tenant,space,e.id(),null).publishedVersion());
 }
 @Test void stoppingAndRestoringNeverRevivesAnOldProposal(){
  var e=seed();var a=submit(e);var job=claim();queue.dispatched(job,descriptor());var stopped=experiences.stop(owner,tenant,space,e.id(),UUID.randomUUID(),e.revision(),e.version().id());assertFalse(intake.available(a.id()));assertFalse(queue.active(job.id(),job.lease()));assertNull(db.queryForObject("SELECT content::text FROM experience_adjustments WHERE id=?",String.class,a.id()));var restored=experiences.restore(owner,tenant,space,e.id(),UUID.randomUUID(),stopped.revision(),e.version().id());assertFalse(intake.available(a.id()));assertNotEquals(a.id(),submit(restored).id());
 }
 @Test void revokingTheMaintenanceGrantCancelsPendingContentEvenIfRegranted(){
  var e=seed();var a=submit(e);db.update("DELETE FROM governance_capabilities WHERE tenant_id=? AND account_id=?",tenant,owner);assertFalse(intake.available(a.id()));assertNull(db.queryForObject("SELECT content::text FROM experience_adjustments WHERE id=?",String.class,a.id()));grant();assertFalse(intake.available(a.id()));assertEquals("UNAVAILABLE",adjustments.list(owner,tenant,space,e.id(),true).items().getFirst().state());
 }
 @Test void aPrivateMethodDoesNotBecomeEditableThroughAdministratorIdentity(){
  var e=seed();UUID admin=UUID.randomUUID();db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'admin','unused')",admin,admin+"@adjustment.test");db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'TENANT_ADMIN')",tenant,admin);db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES (?,?,?)",tenant,space,admin);db.update("INSERT INTO governance_capabilities(tenant_id,account_id,workspace_id,capability,granted_by) VALUES (?,?,?,'EXPERIENCE_MAINTAIN',?)",tenant,admin,space,owner);assertThrows(IdentityException.class,()->adjustments.submit(admin,tenant,space,e.id(),UUID.randomUUID(),e.revision(),e.version().id(),proposal()));assertThrows(IdentityException.class,()->adjustments.list(admin,tenant,space,e.id(),true));
 }
 @Test void correctionOfALegacyMethodAlsoRequiresAutomaticQualification(){
  var seed=seed();var manual=experiences.create(owner,tenant,space,UUID.randomUUID(),seed.version().content(),seed.version().evidence());var e=experiences.publish(owner,tenant,space,manual.id(),UUID.randomUUID(),manual.revision(),manual.version().id(),false);submit(e);var job=claim();queue.dispatched(job,descriptor());queue.complete(adjustmentResult(job,"QUALIFIED",e.version().id()));var receipt=admission.admit(job.id());assertEquals("UPDATED",receipt.outcome());assertEquals(e.id(),receipt.entryId());assertEquals("AUTOMATIC",experiences.get(owner,tenant,space,e.id(),null).version().origin());
 }
 @Test void largeCorrectionsAreSegmentedWithoutDroppingText(){
  var e=seed();var p=proposal();String body="修订".repeat(6000)+"末尾边界";adjustments.submit(owner,tenant,space,e.id(),UUID.randomUUID(),e.revision(),e.version().id(),new ExperienceAdjustmentService.Proposal(p.title(),p.summary(),body,p.tags(),p.applicable(),p.excluded(),p.reason()));var job=claim();var parts=job.inputs().stream().filter(i->i.kind().equals("FEEDBACK")).toList();assertTrue(parts.size()>1);assertTrue(parts.stream().noneMatch(Input::complete));assertTrue(parts.stream().map(Input::text).reduce("",String::concat).contains(body));assertTrue(job.inputs().size()<=8);
 }
 @Test void resultLossDoesNotResubmitAndUnknownLeavesOriginalAvailable(){
  var e=seed();var a=submit(e);var job=claim();queue.dispatched(job,descriptor());queue.fail(job.id(),"EXPERIENCE_RESULT_UNKNOWN",true,null);assertEquals("UNKNOWN",adjustments.list(owner,tenant,space,e.id(),true).items().getFirst().state());assertNull(db.queryForObject("SELECT content::text FROM experience_adjustments WHERE id=?",String.class,a.id()));assertEquals(e.version().id(),experiences.get(owner,tenant,space,e.id(),null).publishedVersion());assertNull(queue.claim(tenant));
 }
 @Test void twoConcurrentCorrectionsCannotQueueCompetingUpdates()throws Exception{
  var e=seed();var latch=new CountDownLatch(1);try(var pool=Executors.newFixedThreadPool(2)){
   Callable<String> call=()->{latch.await();try{return submit(e).state();}catch(IdentityException conflict){return conflict.code;}};var a=pool.submit(call);var b=pool.submit(call);latch.countDown();assertEquals(Set.of("WAITING","EXPERIENCE_ADJUSTMENT_PENDING"),Set.of(a.get(10,TimeUnit.SECONDS),b.get(10,TimeUnit.SECONDS)));
  }
  assertEquals(1,db.queryForObject("SELECT count(*) FROM experience_adjustments WHERE entry_id=?",Integer.class,e.id()));
 }
 @Test void verificationTaskSourcesCannotBePromotedByAHumanCorrection(){
  grant();db.update("UPDATE conversation_tasks SET execution_class='verification' WHERE id=?",task);var c=new ExperienceService.Content("METHOD","验证方法","合成方法","仅用于验证",List.of("核对"),"合成输入","不作为真实结果","","未核验","SOURCE_BOUND");var e=experiences.create(owner,tenant,space,UUID.randomUUID(),c,List.of(new ExperienceService.Evidence("TASK",task,space)));e=experiences.publish(owner,tenant,space,e.id(),UUID.randomUUID(),e.revision(),e.version().id(),false);var fixed=e;assertEquals("EXPERIENCE_EVIDENCE_UNAVAILABLE",assertThrows(IdentityException.class,()->submit(fixed)).code);assertEquals(0,db.queryForObject("SELECT count(*) FROM experience_adjustments WHERE tenant_id=?",Integer.class,tenant));
 }
 @Test void actualHarnessUsesFixedCorrectionAndNeverAdmitsAVerificationRun()throws Exception{
  var e=seed();var a=submit(e);var j=claim();var root=java.nio.file.Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();String token="synthetic-adjustment-012345678901234567890";
  var engine=new ProcessBuilder("node",root.resolve("engine/tests/fixtures/experience-dispatch-server.mjs").toString(),token,"adjust").redirectError(ProcessBuilder.Redirect.INHERIT).start();
  try(var pool=Executors.newSingleThreadExecutor();var lines=new java.io.BufferedReader(new java.io.InputStreamReader(engine.getInputStream()))){
   var runtime=new ExperienceAnalysisRuntime(pool.submit(lines::readLine).get(5,TimeUnit.SECONDS),token,"verification");var worker=new ExperienceAnalysisWorker(queue,runtime,admission,false);try{worker.execute(j);}finally{worker.stop();}
   var result=runtime.recover(j,runtime.preflight().engineVersion());assertEquals("QUALIFIED",result.outcome());assertEquals(e.version().id(),result.candidate().targetVersionId());assertEquals("FEEDBACK_CORRECTION",result.review().basis());assertEquals(2,result.stages().size());assertEquals("FAILED",state(j));assertEquals("EXPERIENCE_VERIFICATION_ONLY",db.queryForObject("SELECT error_code FROM experience_analysis_items WHERE source_id=?",String.class,a.id()));assertEquals(e.version().id(),experiences.get(owner,tenant,space,e.id(),null).publishedVersion());assertNull(db.queryForObject("SELECT content::text FROM experience_adjustments WHERE id=?",String.class,a.id()));
  }finally{engine.destroy();if(!engine.waitFor(3,TimeUnit.SECONDS))engine.destroyForcibly();}
 }
 @Test void httpSubmissionAndObservationRequireCustomerCsrfAndExposeNoProposedBody()throws Exception{
  var e=seed();db.update("UPDATE accounts SET password_hash=? WHERE id=?",passwords.encode("synthetic-correction-password"),owner);var http=java.net.http.HttpClient.newBuilder().cookieHandler(new java.net.CookieManager(null,java.net.CookiePolicy.ACCEPT_ALL)).build();var json=new tools.jackson.databind.json.JsonMapper();String base="http://127.0.0.1:"+port;var csrf=json.readTree(http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(base+"/api/v1/auth/csrf")).GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString()).body());
  assertEquals(200,http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(base+"/api/v1/auth/login")).header(csrf.get("headerName").asString(),csrf.get("token").asString()).header("Content-Type","application/json").POST(java.net.http.HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("email",owner+"@dispatch.test","password","synthetic-correction-password")))).build(),java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
  csrf=json.readTree(http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(base+"/api/v1/auth/csrf")).GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString()).body());var uri=java.net.URI.create(base+"/api/v1/tenants/"+tenant+"/workspaces/"+space+"/experiences/"+e.id()+"/adjustments");String body=json.writeValueAsString(Map.of("requestId",UUID.randomUUID(),"expectedRevision",e.revision(),"versionId",e.version().id(),"proposal",proposal()));var request=java.net.http.HttpRequest.newBuilder(uri).header("Content-Type","application/json").POST(java.net.http.HttpRequest.BodyPublishers.ofString(body));assertEquals(403,http.send(request.build(),java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());var response=http.send(request.header(csrf.get("headerName").asString(),csrf.get("token").asString()).build(),java.net.http.HttpResponse.BodyHandlers.ofString());assertEquals(200,response.statusCode(),response.body());assertEquals("WAITING",json.readTree(response.body()).get("state").asString());assertFalse(response.body().contains(proposal().body()));var listing=http.send(java.net.http.HttpRequest.newBuilder(uri).GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString());assertEquals(200,listing.statusCode());assertFalse(json.readTree(listing.body()).get("enabled").asBoolean());assertTrue(listing.headers().firstValue("cache-control").orElseThrow().contains("no-store"));assertFalse(listing.body().contains(proposal().reason()));
 }

 @Test void adjustmentStatusUsesPublishedContentInsteadOfAnUnreadableLaterDraft(){
  var seed=seed();var manual=experiences.create(owner,tenant,space,UUID.randomUUID(),seed.version().content(),seed.version().evidence());
  var published=experiences.publish(owner,tenant,space,manual.id(),UUID.randomUUID(),manual.revision(),manual.version().id(),false);
  var draft=experiences.revise(owner,tenant,space,published.id(),UUID.randomUUID(),published.revision(),published.version().content(),published.version().evidence());
  db.queryForList("SELECT scrub_lifecycle_object('EXPERIENCE_VERSION',?)",draft.version().id());
  assertNotNull(experiences.get(owner,tenant,space,published.id(),published.version().id()));
  assertTrue(adjustments.list(owner,tenant,space,published.id(),true).items().isEmpty());
 }
}
