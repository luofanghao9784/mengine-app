package com.dreamcore.workspace;
import com.dreamcore.workspace.experience.*;import com.dreamcore.workspace.identity.IdentityException;import com.dreamcore.workspace.feedback.FeedbackService;
import java.util.*;import java.util.concurrent.*;
import org.junit.jupiter.api.*;import org.springframework.beans.factory.annotation.Autowired;import org.springframework.boot.test.context.SpringBootTest;import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;import static org.mockito.Mockito.*;import static org.mockito.ArgumentMatchers.*;import static com.dreamcore.workspace.experience.ExperienceAnalysisRuntime.*;

@SpringBootTest(properties={"dreamcore.tasks.enabled=false","dreamcore.experience-intake.enabled=false","dreamcore.experience-analysis.enabled=false"})
class ExperienceAnalysisQueueIntegrationTest {
 @Autowired ExperienceAdmissionService admission;@Autowired JdbcTemplate db;@Autowired ExperienceAnalysisQueue queue;@Autowired ExperienceIntakeService intake;@Autowired FeedbackService feedback;
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
 @Test void claimStoresIdentifiersAndHashOnlyAndPinsPrivateInput(){
  var j=claim();assertEquals(3,j.inputs().size());assertTrue(j.inputs().stream().anyMatch(i->i.text().contains("private-prompt")));assertEquals(j,queue.restore(j.id()));assertNull(queue.claim(tenant));
  String row=db.queryForObject("SELECT row_to_json(r)::text FROM experience_analysis_runs r WHERE id=?",String.class,j.id());assertFalse(row.contains("private-"));assertFalse(row.contains("合成主体"));assertTrue(row.contains("job_hash"));
  db.update("UPDATE conversation_tasks SET reply='changed-reply',revision=4 WHERE id=?",task);assertFalse(queue.active(j.id(),j.lease()));assertEquals("SOURCE_UNAVAILABLE",state(j));assertThrows(IdentityException.class,()->queue.restore(j.id()));
 }
 @Test void concurrentClaimsCreateOneRunPerTenant()throws Exception{
  queue.discover();try(var pool=Executors.newFixedThreadPool(2)){var results=pool.invokeAll(List.<Callable<Job>>of(()->queue.claim(tenant),()->queue.claim(tenant)));assertEquals(1,results.stream().filter(f->{try{return f.get()!=null;}catch(Exception e){throw new RuntimeException(e);}}).count());}
  assertEquals(1,db.queryForObject("SELECT count(*) FROM experience_analysis_runs WHERE tenant_id=?",Integer.class,tenant));
 }
 @Test void qualifiedResultKeepsNoRawQuotesAndRevocationErasesItWithoutRevival(){
  var j=claim();queue.dispatched(j,descriptor());queue.complete(result(j,"QUALIFIED"));queue.complete(result(j,"QUALIFIED"));assertEquals("QUALIFIED",state(j));
  String stored=db.queryForObject("SELECT row_to_json(r)::text FROM experience_analysis_runs r WHERE id=?",String.class,j.id());assertFalse(stored.contains("private-"));assertFalse(stored.contains("compare_dataset"));assertTrue(stored.contains("先核验工具状态"));assertTrue(stored.contains("sha256"));
  assertEquals(0,db.queryForObject("SELECT count(*) FROM experience_entries WHERE tenant_id=?",Integer.class,tenant));
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);assertEquals("SOURCE_UNAVAILABLE",state(j));assertNull(db.queryForObject("SELECT candidate::text FROM experience_analysis_runs WHERE id=?",String.class,j.id()));
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES (?,?,?)",tenant,space,owner);queue.discover();assertNull(queue.claim(tenant));
 }
 @Test void physicalSourceCleanupAndObjectWithdrawalEraseDerivedCandidate(){
  var j=claim();queue.dispatched(j,descriptor());queue.complete(result(j,"QUALIFIED"));db.queryForList("SELECT scrub_lifecycle_object('TASK',?)",task);
  assertEquals("SOURCE_UNAVAILABLE",state(j));assertNull(db.queryForObject("SELECT candidate::text FROM experience_analysis_runs WHERE id=?",String.class,j.id()));assertNull(db.queryForObject("SELECT evidence::text FROM experience_analysis_runs WHERE id=?",String.class,j.id()));
 }
 @Test void feedbackReadsTheAssociatedVersionAndWithdrawalInvalidatesTheRun(){
  var f=feedback.create(owner,tenant,UUID.randomUUID(),new FeedbackService.Target("TASK",task,3,1,"task-v1",0),new FeedbackService.Assessment("PARTIAL",List.of("DATA_GAP"),"private-feedback"));queue.discover();
  db.update("UPDATE experience_analysis_items SET state='SKIPPED' WHERE source_id IN(SELECT id FROM experience_intake_sources WHERE tenant_id=? AND kind='TASK')",tenant);
  var j=queue.claim(tenant);assertNotNull(j);assertTrue(j.inputs().stream().anyMatch(i->i.kind().equals("FEEDBACK")&&i.text().contains("private-feedback")));assertTrue(j.inputs().stream().anyMatch(i->i.kind().equals("TASK_RESULT")&&i.text().equals("private-reply")));
  feedback.edit(owner,tenant,f.id(),UUID.randomUUID(),1,null,true);assertFalse(queue.active(j.id(),j.lease()));assertEquals("SOURCE_UNAVAILABLE",state(j));
 }
 @Test void failedAndUnknownProviderResultsHaveDifferentRetryBehavior(){
  var j=claim();queue.dispatched(j,descriptor());queue.uncertain(j.id());assertEquals("RUNNING",state(j));assertNull(queue.claim(tenant));
  db.update("UPDATE experience_analysis_runs SET created_at=now()-interval '10 minutes' WHERE id=?",j.id());assertTrue(queue.recoveries().stream().anyMatch(r->r.id().equals(j.id())&&r.recoveryExpired()));queue.fail(j.id(),"EXPERIENCE_RESULT_UNKNOWN",true,null);assertEquals("UNKNOWN",state(j));assertNull(queue.claim(tenant));
 }
 @Test void confirmedFailureRetriesWithNewLeaseAtMostThreeModelAttempts(){
  var j=claim();for(int attempt=1;attempt<=3;attempt++){queue.dispatched(j,descriptor());queue.fail(j.id(),"EXPERIENCE_ANALYSIS_FAILED",true,null);assertEquals(attempt<3?"RETRY_WAIT":"FAILED",state(j));db.update("UPDATE experience_analysis_items SET next_attempt_at=now()-interval '1 second' WHERE source_id=?",j.source());var next=queue.claim(tenant);if(attempt<3){assertNotNull(next);assertNotEquals(j.lease(),next.lease());j=next;}else assertNull(next);}
 }
 @Test void preflightFailureDoesNotInventProviderUseAndPauseKeepsUndispatchedSourcePending(){
  var j=claim();queue.fail(j.id(),"MODEL_NOT_CONFIGURED",false,null);assertEquals(0,db.queryForObject("SELECT attempts FROM experience_analysis_items WHERE source_id=?",Integer.class,j.source()));assertNull(db.queryForObject("SELECT stages::text FROM experience_analysis_runs WHERE id=?",String.class,j.id()));
  db.update("UPDATE tenants SET status='SUSPENDED' WHERE id=?",tenant);db.update("UPDATE experience_analysis_items SET next_attempt_at=now() WHERE source_id=?",j.source());assertNull(queue.claim(tenant));assertEquals("RETRY_WAIT",state(j));assertTrue(intake.available(j.source()));
 }
 @Test void staleLeaseCannotPersistAndSyntheticQualificationNeverBecomesBusinessCandidate(){
  var j=claim();queue.dispatched(j,descriptor());var r=result(j,"QUALIFIED");var wrong=new Result(r.contractVersion(),r.engineVersion(),r.executionClass(),r.runId(),UUID.randomUUID(),r.source(),false,r.outcome(),r.code(),r.candidate(),r.review(),r.stages());assertThrows(IdentityException.class,()->queue.complete(wrong));assertEquals("RUNNING",state(j));
  db.update("UPDATE experience_analysis_runs SET execution_class='verification' WHERE id=?",j.id());var verification=new Result(r.contractVersion(),r.engineVersion(),"verification",r.runId(),r.lease(),r.source(),false,r.outcome(),r.code(),r.candidate(),r.review(),r.stages());assertEquals("EXPERIENCE_VERIFICATION_ONLY",assertThrows(IdentityException.class,()->queue.complete(verification)).code);assertNull(db.queryForObject("SELECT candidate::text FROM experience_analysis_runs WHERE id=?",String.class,j.id()));
 }
 @Test void aDifferentFeedbackLifecycleDoesNotInvalidateThisSourcesRun(){
  var f=feedback.create(owner,tenant,UUID.randomUUID(),new FeedbackService.Target("TASK",task,3,1,"task-v1",0),new FeedbackService.Assessment("PARTIAL",List.of("DATA_GAP"),"private-feedback"));queue.discover();
  db.update("UPDATE experience_analysis_items SET state='SKIPPED' WHERE source_id IN(SELECT id FROM experience_intake_sources WHERE tenant_id=? AND kind='TASK')",tenant);var j=queue.claim(tenant);assertNotNull(j);
  UUID other=UUID.randomUUID(),version=UUID.randomUUID();db.update("INSERT INTO feedback_entries(id,tenant_id,workspace_id,actor_id,kind,task_id,task_revision,attempt,presentation_version,presentation_revision,snapshot) VALUES (?,?,?,?,'TASK',?,2,1,'task-v1',0,'{}')",other,tenant,space,owner,task);
  db.update("INSERT INTO feedback_versions(id,feedback_id,revision,status,assessment) VALUES (?,?,1,'ACTIVE','{}')",version,other);db.update("UPDATE object_lifecycle SET state='TRASHED' WHERE kind='FEEDBACK_VERSION' AND object_id=?",version);
  assertTrue(queue.active(j.id(),j.lease()));assertEquals("RUNNING",state(j));
 }
 @Test void actualWorkerUsesHarnessAndRecordsSyntheticSkipWithoutBusinessConclusion()throws Exception{bridge("skip");}
 @Test void actualWorkerKeepsSyntheticQualificationOutOfBusinessCandidates()throws Exception{bridge("qualify");}
 void bridge(String mode)throws Exception{
  var root=java.nio.file.Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();String token="synthetic-dispatch-012345678901234567890";
  var engine=new ProcessBuilder("node",root.resolve("engine/tests/fixtures/experience-dispatch-server.mjs").toString(),token,mode).redirectError(ProcessBuilder.Redirect.INHERIT).start();
  try(var pool=Executors.newSingleThreadExecutor();var lines=new java.io.BufferedReader(new java.io.InputStreamReader(engine.getInputStream()))){
   String endpoint=pool.submit(lines::readLine).get(5,TimeUnit.SECONDS);var runtime=new ExperienceAnalysisRuntime(endpoint,token,"verification");Job j;var worker=new ExperienceAnalysisWorker(queue,runtime,admission,mode.equals("skip"));
   try{
    if(mode.equals("skip")){
     long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(8);
     while(System.nanoTime()<until&&db.queryForObject("SELECT count(*) FROM experience_analysis_items WHERE tenant_id=? AND state='FAILED' AND error_code='EXPERIENCE_VERIFICATION_ONLY'",Integer.class,tenant)==0){worker.tick();Thread.sleep(25);}
     var ids=db.queryForList("SELECT run_id FROM experience_analysis_items WHERE tenant_id=? AND state='FAILED' AND error_code='EXPERIENCE_VERIFICATION_ONLY'",UUID.class,tenant);assertEquals(1,ids.size(),()->db.queryForList("SELECT state,error_code FROM experience_analysis_items WHERE tenant_id=?",tenant).toString());j=queue.restore(ids.getFirst());
    }else{j=claim();worker.execute(j);}
   }finally{worker.stop();}
   assertEquals("FAILED",state(j),()->db.queryForMap("SELECT * FROM experience_analysis_runs WHERE id=?",j.id()).toString());
   String stages=db.queryForObject("SELECT stages::text FROM experience_analysis_runs WHERE id=?",String.class,j.id());assertTrue(stages.contains("synthetic-dispatch"));assertTrue(stages.contains("inputTokens"));
   var r=runtime.recover(queue.restore(j.id()),runtime.preflight().engineVersion());assertEquals(mode.equals("skip")?"SKIPPED":"QUALIFIED",r.outcome());
   assertEquals(0,db.queryForObject("SELECT count(*) FROM experience_entries WHERE tenant_id=?",Integer.class,tenant));assertNull(db.queryForObject("SELECT candidate::text FROM experience_analysis_runs WHERE id=?",String.class,j.id()));
  }finally{engine.destroy();if(!engine.waitFor(3,TimeUnit.SECONDS))engine.destroyForcibly();}
 }
 @Test void recoveryAfterLostResponseUsesGetOnlyAndCommitsTheSameRun(){
  var j=claim();var runtime=mock(ExperienceAnalysisRuntime.class);when(runtime.preflight()).thenReturn(descriptor());when(runtime.execute(eq(j),any(),any())).thenThrow(new ExperienceAnalysisRuntime.Failure("EXPERIENCE_RESULT_UNKNOWN",true));
  var original=new ExperienceAnalysisWorker(queue,runtime,admission,false);try{original.execute(j);}finally{original.stop();}assertEquals("RUNNING",state(j));
  db.update("UPDATE experience_analysis_runs SET created_at=now()-interval '6 seconds' WHERE id=?",j.id());var recovery=queue.recoveries().stream().filter(r->r.id().equals(j.id())).findFirst().orElseThrow();when(runtime.recover(eq(j),eq("synthetic-v1"))).thenReturn(result(j,"SKIPPED"));
  var restarted=new ExperienceAnalysisWorker(queue,runtime,admission,false);try{restarted.recover(recovery);}finally{restarted.stop();}
  assertEquals("SKIPPED",state(j));verify(runtime,times(1)).execute(eq(j),any(),any());verify(runtime,times(1)).recover(eq(j),eq("synthetic-v1"));assertEquals(1,db.queryForObject("SELECT attempts FROM experience_analysis_items WHERE source_id=?",Integer.class,j.source()));
 }
 @Test void discoveryContinuesPastAlreadyQueuedPages(){
  db.update("INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,status,revision,attempt,reply,execution_class,engine_version,finished_at) SELECT gen_random_uuid(),tenant_id,workspace_id,conversation_id,requested_by,'synthetic input','AGENT','SUCCEEDED',3,1,'synthetic result','live','synthetic-fixture',now() FROM conversation_tasks CROSS JOIN generate_series(1,210) WHERE id=?",task);
  db.update("INSERT INTO conversation_attempts(task_id,attempt_number,attempt_id,input,status,provenance,snapshot) SELECT id,1,gen_random_uuid(),'synthetic input','SUCCEEDED','RECORDED',to_jsonb(t) FROM conversation_tasks t WHERE tenant_id=? AND id<>?",tenant,task);
  for(int n=0;n<4;n++)queue.discover();assertEquals(211,db.queryForObject("SELECT count(*) FROM experience_analysis_items WHERE tenant_id=?",Integer.class,tenant));
 }
 @Test @org.springframework.transaction.annotation.Transactional
 void aNewTenantIsNotStarvedByAnOlderTenantsBacklog(){
  // Isolate this two-tenant ordering case from unrelated fixtures in the bounded global queue.
  // The enclosing test transaction restores their scheduling times afterwards.
  db.update("UPDATE experience_analysis_items SET next_attempt_at=now()+interval '1 day'");
  UUID earlier=tenant;var j=claim();queue.fail(j.id(),"MODEL_NOT_CONFIGURED",false,null);db.update("UPDATE experience_analysis_items SET next_attempt_at=now() WHERE source_id=?",j.source());
  fixture();queue.discover();var order=queue.tenants();assertTrue(order.contains(tenant));assertTrue(order.contains(earlier));assertTrue(order.indexOf(tenant)<order.indexOf(earlier));
 }
 @Test void largeInputIsMarkedIncompleteInsteadOfSilentlyClaimingFullCoverage(){
  db.update("UPDATE conversation_tasks SET prompt=? WHERE id=?","大".repeat(10000),task);var j=claim();var input=j.inputs().stream().filter(i->i.kind().equals("TASK_INPUT")).findFirst().orElseThrow();assertEquals(8000,input.text().length());assertFalse(input.complete());
 }
}
