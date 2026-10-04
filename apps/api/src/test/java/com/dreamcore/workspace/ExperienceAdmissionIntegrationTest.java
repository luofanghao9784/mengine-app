package com.dreamcore.workspace;
import com.dreamcore.workspace.experience.*;import com.dreamcore.workspace.identity.IdentityException;import com.dreamcore.workspace.feedback.FeedbackService;
import java.util.*;import java.util.concurrent.*;
import org.junit.jupiter.api.*;import org.springframework.beans.factory.annotation.Autowired;import org.springframework.boot.test.context.SpringBootTest;import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;import static org.mockito.Mockito.*;import static org.mockito.ArgumentMatchers.*;import static com.dreamcore.workspace.experience.ExperienceAnalysisRuntime.*;

@SpringBootTest(properties={"dreamcore.tasks.enabled=false","dreamcore.experience-intake.enabled=false","dreamcore.experience-analysis.enabled=false"})
class ExperienceAdmissionIntegrationTest {
 @Autowired ExperienceService experiences;@Autowired ExperienceAdmissionService admission;@Autowired JdbcTemplate db;@Autowired ExperienceAnalysisQueue queue;@Autowired ExperienceIntakeService intake;@Autowired FeedbackService feedback;
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
 @Test void qualifiedExperienceIsSearchableExactlyOnceWithoutExposingPrivateSource()throws Exception{
  var j=returned("先核验工具状态",null);try(var pool=Executors.newFixedThreadPool(2)){var futures=pool.invokeAll(List.<Callable<ExperienceAdmissionService.Receipt>>of(()->admission.admit(j.id()),()->admission.admit(j.id())));var receipt=futures.get(0).get();assertEquals(receipt,futures.get(1).get());assertEquals("CREATED",receipt.outcome());var e=entry(receipt);assertEquals("PUBLISHED",e.status());assertEquals("AUTOMATIC",e.version().origin());assertEquals("AUTOMATIC_CHECKED",e.version().evaluation());assertFalse(e.version().content().toString().contains("private-"));assertEquals(1,experiences.list(owner,tenant,space,"核验","",false,0,20).items().size());assertNull(db.queryForObject("SELECT candidate::text FROM experience_analysis_runs WHERE id=?",String.class,j.id()));}
  assertEquals(1,db.queryForObject("SELECT count(*) FROM experience_entries WHERE tenant_id=?",Integer.class,tenant));
  for(String role:List.of("MEMBER","TENANT_ADMIN")){UUID reader=UUID.randomUUID();db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'reader','unused')",reader,reader+"@synthetic.test");db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,reader,role);db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES (?,?,?)",tenant,space,reader);assertTrue(experiences.list(reader,tenant,space,"","",false,0,20).items().isEmpty());}
 }
 @Test void repeatedContentDoesNotMutateVersionEvidenceOrAcquireNewRevocationDependencies(){
  var original=admission.admit(returned("先核验工具状态",null).id());var before=entry(original).version().evidence();nextTask();var duplicate=returned("先核验工具状态",null);var r=admission.admit(duplicate.id());assertEquals("DUPLICATE",r.outcome());assertEquals(original.versionId(),r.versionId());assertEquals(before,entry(original).version().evidence());db.queryForList("SELECT scrub_lifecycle_object('TASK',?)",task);assertFalse(scrubbed(original.versionId()));assertEquals(1,db.queryForObject("SELECT count(*) FROM experience_versions WHERE entry_id=?",Integer.class,r.entryId()));
 }
 @Test void updateCreatesNewImmutableVersionAndSourceErasureCascades(){
  var first=admission.admit(returned("先核验工具状态",null).id());UUID sourceTask=task;nextTask();var second=admission.admit(returned("同时核对执行与结论",first.versionId()).id());assertEquals("UPDATED",second.outcome());assertEquals(first.entryId(),second.entryId());assertEquals(2,entry(second).version().number());assertEquals("先核验工具状态",entry(first).version().content().title());db.queryForList("SELECT scrub_lifecycle_object('TASK',?)",sourceTask);assertTrue(scrubbed(first.versionId()));assertTrue(scrubbed(second.versionId()));assertTrue(experiences.list(owner,tenant,space,"","",false,0,20).items().isEmpty());
 }
 @Test void manualStopPreventsAutomaticRevivalAndLegacyWriteRoutesCannotOverride(){
  grant();var first=admission.admit(returned("先核验工具状态",null).id());var e=entry(first);
  assertEquals("EXPERIENCE_AUTOMATIC_MANAGED",assertThrows(IdentityException.class,()->experiences.publish(owner,tenant,space,e.id(),UUID.randomUUID(),e.revision(),e.version().id(),false)).code);
  assertEquals("EXPERIENCE_AUTOMATIC_MANAGED",assertThrows(IdentityException.class,()->experiences.revise(owner,tenant,space,e.id(),UUID.randomUUID(),e.revision(),e.version().content(),e.version().evidence())).code);
  experiences.withdraw(owner,tenant,space,e.id(),UUID.randomUUID(),e.revision());nextTask();var r=admission.admit(returned("先核验工具状态",null).id());assertEquals("CONFLICT",r.outcome());assertEquals(1,db.queryForObject("SELECT count(*) FROM experience_versions WHERE entry_id=?",Integer.class,e.id()));
 }
 @Test void sourceWithdrawalAfterVerificationProducesNoEntry(){
  var j=returned("先核验工具状态",null);db.queryForList("SELECT scrub_lifecycle_object('TASK',?)",task);assertEquals("SOURCE_UNAVAILABLE",admission.admit(j.id()).outcome());assertEquals(0,db.queryForObject("SELECT count(*) FROM experience_entries WHERE tenant_id=?",Integer.class,tenant));
 }
 @Test void withdrawnReferencedVersionAfterVerificationEndsAdmissionWithoutPoisonedTransaction(){
  grant();var first=admission.admit(returned("先核验工具状态",null).id());nextTask();var j=returned("新方法",first.versionId());var e=entry(first);experiences.withdraw(owner,tenant,space,e.id(),UUID.randomUUID(),e.revision());assertEquals("SOURCE_UNAVAILABLE",admission.admit(j.id()).outcome());assertEquals(1,db.queryForObject("SELECT count(*) FROM experience_versions WHERE entry_id=?",Integer.class,e.id()));
 }
 @Test void manualStopOfReferencedEntryRemovesDerivedEntries(){
  grant();var first=admission.admit(returned("先核验工具状态",null).id());nextTask();var derived=admission.admit(returned("另一种核对方法",null).id());assertNotEquals(first.entryId(),derived.entryId());var e=entry(first);experiences.withdraw(owner,tenant,space,e.id(),UUID.randomUUID(),e.revision());assertTrue(scrubbed(derived.versionId()));assertFalse(scrubbed(first.versionId()));
 }
 @Test void tenantPauseBeforeAdmissionDoesNotPublish(){
  var j=returned("先核验工具状态",null);db.update("UPDATE tenants SET status='SUSPENDED' WHERE id=?",tenant);assertFalse(admission.pending().contains(j.id()));assertEquals("TENANT_SUSPENDED",assertThrows(IdentityException.class,()->admission.admit(j.id())).code);assertEquals(0,db.queryForObject("SELECT count(*) FROM experience_entries WHERE tenant_id=?",Integer.class,tenant));db.update("UPDATE tenants SET status='ACTIVE' WHERE id=?",tenant);assertEquals("CREATED",admission.admit(j.id()).outcome());
 }
 @Test void nonQualifiedAndVerificationReceiptsCannotEnterLibrary(){
  var j=claim();queue.dispatched(j,descriptor());queue.complete(result(j,"SKIPPED"));UUID skipped=j.id();assertEquals("EXPERIENCE_NOT_QUALIFIED",assertThrows(IdentityException.class,()->admission.admit(skipped)).code);
  nextTask();j=returned("先核验工具状态",null);db.update("UPDATE experience_analysis_runs SET execution_class='verification' WHERE id=?",j.id());UUID id=j.id();assertEquals("EXPERIENCE_NOT_QUALIFIED",assertThrows(IdentityException.class,()->admission.admit(id)).code);assertEquals(0,db.queryForObject("SELECT count(*) FROM experience_entries WHERE tenant_id=?",Integer.class,tenant));
 }

 @Test void workerAutomaticallyAdmitsQualifiedReceiptWithoutHumanAction(){
  var j=claim();var runtime=mock(ExperienceAnalysisRuntime.class);when(runtime.preflight()).thenReturn(descriptor());when(runtime.execute(eq(j),any(),any())).thenReturn(result(j,"QUALIFIED"));var worker=new ExperienceAnalysisWorker(queue,runtime,admission,false);try{worker.execute(j);}finally{worker.stop();}
  assertEquals("CREATED",db.queryForObject("SELECT outcome FROM experience_admissions WHERE run_id=?",String.class,j.id()));assertEquals(1,experiences.list(owner,tenant,space,"","",false,0,20).items().size());verify(runtime,times(1)).execute(eq(j),any(),any());
 }
 @Test void feedbackRevisionChangeRemovesItsAdmittedMethod(){
  var f=feedback.create(owner,tenant,UUID.randomUUID(),new FeedbackService.Target("TASK",task,3,1,"task-v1",0),new FeedbackService.Assessment("PARTIAL",List.of("DATA_GAP"),"private-feedback"));queue.discover();db.update("UPDATE experience_analysis_items SET state='SKIPPED' WHERE source_id IN(SELECT id FROM experience_intake_sources WHERE tenant_id=? AND kind='TASK')",tenant);
  var r=admission.admit(returned("先核验工具状态",null).id());feedback.edit(owner,tenant,f.id(),UUID.randomUUID(),1,null,true);assertTrue(scrubbed(r.versionId()));assertTrue(experiences.list(owner,tenant,space,"","",false,0,20).items().isEmpty());
 }
 @Test void revokedOwnerScopeCannotRestoreTheSameAdmittedVersion(){
  var r=admission.admit(returned("先核验工具状态",null).id());db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);assertTrue(scrubbed(r.versionId()));db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES (?,?,?)",tenant,space,owner);assertTrue(experiences.list(owner,tenant,space,"","",false,0,20).items().isEmpty());
 }
 @Test void manualVersionCannotBeRewrittenByAutomaticTarget(){
  grant();var c=new ExperienceService.Content("METHOD","人工方法","摘要","先核对",List.of("核对"),"当前来源可用","不可推断成功","","人工原始","INDEPENDENT_COPY");var manual=experiences.create(owner,tenant,space,UUID.randomUUID(),c,List.of());manual=experiences.publish(owner,tenant,space,manual.id(),UUID.randomUUID(),manual.revision(),manual.version().id(),true);
  var j=returned("新的方法",manual.version().id());assertEquals("CONFLICT",admission.admit(j.id()).outcome());assertEquals("MANUAL",experiences.get(owner,tenant,space,manual.id(),null).version().origin());assertEquals(1,db.queryForObject("SELECT count(*) FROM experience_versions WHERE entry_id=?",Integer.class,manual.id()));
 }
 @Test void oversizedAcceptedEngineTagsEndWithConflictInsteadOfPartiallyWriting(){
  var j=returned("先核验工具状态",null);db.update("UPDATE experience_analysis_runs SET candidate=jsonb_set(candidate,'{tags}',?::jsonb) WHERE id=?","[\""+"字".repeat(45)+"\"]",j.id());assertEquals("CONFLICT",admission.admit(j.id()).outcome());assertEquals(0,db.queryForObject("SELECT count(*) FROM experience_entries WHERE tenant_id=?",Integer.class,tenant));assertNull(db.queryForObject("SELECT candidate::text FROM experience_analysis_runs WHERE id=?",String.class,j.id()));
 }

 @Test void differentReturnedRunsWithSameContentConvergeUnderConcurrentAdmission()throws Exception{
  var first=returned("先核验工具状态",null);nextTask();var second=returned("先核验工具状态",null);
  try(var pool=Executors.newFixedThreadPool(2)){var futures=pool.invokeAll(List.<Callable<ExperienceAdmissionService.Receipt>>of(()->admission.admit(first.id()),()->admission.admit(second.id())));var a=futures.get(0).get();var b=futures.get(1).get();assertEquals(Set.of("CREATED","DUPLICATE"),Set.of(a.outcome(),b.outcome()));assertEquals(a.versionId(),b.versionId());}
  assertEquals(1,db.queryForObject("SELECT count(*) FROM experience_entries WHERE tenant_id=?",Integer.class,tenant));
 }
}
