package com.dreamcore.workspace;
import com.dreamcore.workspace.experience.*;import com.dreamcore.workspace.identity.IdentityException;import com.dreamcore.workspace.feedback.FeedbackService;
import java.util.*;import java.util.concurrent.*;
import org.junit.jupiter.api.*;import org.springframework.beans.factory.annotation.Autowired;import org.springframework.boot.test.context.SpringBootTest;import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;import static org.mockito.Mockito.*;import static org.mockito.ArgumentMatchers.*;import static com.dreamcore.workspace.experience.ExperienceAnalysisRuntime.*;

@SpringBootTest(properties={"dreamcore.tasks.enabled=false","dreamcore.experience-intake.enabled=false","dreamcore.experience-analysis.enabled=false"})
class GeneralExperiencePipelineIntegrationTest {
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
 @Test void onlyRecordedAutomaticBasisIsEligibleAndOriginalTaskContentIsNeverCopied(){
  var e=seed();assertEquals("OBSERVED_EXECUTION",db.queryForObject("SELECT automatic_basis FROM experience_versions WHERE id=?",String.class,e.versionId()));
  var j=generalClaim();assertEquals(e.versionId(),j.source());assertEquals("OBSERVED_EXECUTION",j.original().basis());assertFalse(j.toString().contains("private-prompt"));assertFalse(j.toString().contains("private-reply"));assertEquals(j,generalization.restore(j.id()));
  db.update("UPDATE experience_versions SET automatic_basis=NULL WHERE id=?",e.versionId());assertThrows(IdentityException.class,()->generalization.restore(j.id()));
  generalization.discover();assertEquals("SOURCE_UNAVAILABLE",generalState(e.versionId()));
 }
 @Test void oldAutomaticAndManualMethodsAreNotGivenGuessedEvidence(){
  var e=seed();db.update("UPDATE experience_versions SET automatic_basis=NULL WHERE id=?",e.versionId());grant();var manual=experiences.create(owner,tenant,space,UUID.randomUUID(),entry(e).version().content(),entry(e).version().evidence());experiences.publish(owner,tenant,space,manual.id(),UUID.randomUUID(),manual.revision(),manual.version().id(),false);generalization.discover();assertNull(generalization.claim(tenant));assertEquals(0,db.queryForObject("SELECT count(*) FROM experience_generalization_sources WHERE tenant_id=?",Integer.class,tenant));
 }
 @Test void concurrentClaimsAndAdmissionProduceOneCurrentGeneralVersion()throws Exception{
  var e=seed();generalization.discover();ExperienceGeneralizationRuntime.Job job;
  try(var pool=Executors.newFixedThreadPool(2)){var futures=pool.invokeAll(List.<Callable<ExperienceGeneralizationRuntime.Job>>of(()->generalization.claim(tenant),()->generalization.claim(tenant)));var a=futures.get(0).get();var b=futures.get(1).get();assertTrue((a==null)!=(b==null));job=a!=null?a:b;}
  generalization.dispatched(job,generalDescriptor());generalization.complete(qualified(job,method()));
  try(var pool=Executors.newFixedThreadPool(2)){var futures=pool.invokeAll(List.<Callable<GeneralExperienceAdmissionService.Receipt>>of(()->generalAdmission.admit(job.id()),()->generalAdmission.admit(job.id())));var r=futures.get(0).get();assertEquals(r,futures.get(1).get());assertEquals("CREATED",r.outcome());assertTrue(available(r.versionId()));String content=db.queryForObject("SELECT method::text FROM general_experience_versions WHERE id=?",String.class,r.versionId());for(String secret:List.of("private",tenant.toString(),owner.toString(),e.versionId().toString(),"合成调度企业"))assertFalse(content.contains(secret));assertNull(db.queryForObject("SELECT method::text FROM experience_generalization_runs WHERE id=?",String.class,job.id()));assertEquals("ADMITTED",generalState(e.versionId()));}
 }
 @Test void duplicateAcrossEnterprisesNeverAddsIndependentEvidenceOrChangesOriginalSource(){
  var first=seed();var m=method();var published=publish(m);UUID firstTask=task;fixture();var second=seed();var duplicate=publish(m);assertEquals("DUPLICATE",duplicate.outcome());assertEquals(published.versionId(),duplicate.versionId());assertEquals(first.versionId(),db.queryForObject("SELECT source_version FROM general_experience_origins WHERE version_id=?",UUID.class,published.versionId()));
  db.queryForList("SELECT scrub_lifecycle_object('TASK',?)",firstTask);assertFalse(available(published.versionId()));assertNull(db.queryForObject("SELECT method::text FROM general_experience_versions WHERE id=?",String.class,published.versionId()));assertEquals("DUPLICATE",generalState(second.versionId()));generalization.discover();assertNull(generalization.claim(tenant));
 }
 @Test void stoppingAndRestoringEnterpriseMethodDoesNotReviveQueuedOrPublishedContribution(){
  var source=seed();grant();var j=generalClaim();generalization.dispatched(j,generalDescriptor());generalization.complete(qualified(j,method()));var e=entry(source);var stopped=experiences.stop(owner,tenant,space,e.id(),UUID.randomUUID(),e.revision(),e.version().id());assertEquals("SOURCE_UNAVAILABLE",generalState(source.versionId()));assertEquals("SOURCE_UNAVAILABLE",generalAdmission.admit(j.id()).outcome());experiences.restore(owner,tenant,space,e.id(),UUID.randomUUID(),stopped.revision(),e.version().id());generalization.discover();assertNull(generalization.claim(tenant));assertNull(db.queryForObject("SELECT method::text FROM experience_generalization_runs WHERE id=?",String.class,j.id()));
 }
 @Test void membershipRevocationErasesGeneralContentAndRegrantNeverResurrects(){
  var source=seed();var r=publish(method());assertTrue(available(r.versionId()));db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);assertFalse(available(r.versionId()));assertEquals("SOURCE_UNAVAILABLE",generalState(source.versionId()));assertNull(db.queryForObject("SELECT method::text FROM general_experience_versions WHERE id=?",String.class,r.versionId()));db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES (?,?,?)",tenant,space,owner);generalization.discover();assertNull(generalization.claim(tenant));assertFalse(available(r.versionId()));
 }
 @Test void actualSourceErasureImmediatelyWithdrawsGeneralVersion(){
  var source=seed();var r=publish(method());db.queryForList("SELECT scrub_lifecycle_object('TASK',?)",task);assertNull(db.queryForObject("SELECT automatic_steps::text FROM experience_versions WHERE id=?",String.class,source.versionId()));assertFalse(available(r.versionId()));assertEquals("WITHDRAWN",db.queryForObject("SELECT status FROM general_experience_entries WHERE id=?",String.class,r.entryId()));assertNull(db.queryForObject("SELECT method::text FROM general_experience_versions WHERE id=?",String.class,r.versionId()));
 }
 @Test void acceptedHistoricalSourceRemainsValidAfterANewerEnterpriseVersion(){
  var source=seed();var r=publish(method());nextTask();var next=admission.admit(returned("新的企业方法",source.versionId()).id());assertEquals("UPDATED",next.outcome());assertTrue(available(r.versionId()));generalization.discover();var j=generalization.claim(tenant);assertNotNull(j);assertEquals(next.versionId(),j.source());
 }
 @Test void unfinishedOldVersionCannotBeReplacedSilentlyByNewEnterpriseVersion(){
  var source=seed();var j=generalClaim();nextTask();admission.admit(returned("改变后的企业方法",source.versionId()).id());assertEquals("SOURCE_UNAVAILABLE",generalState(source.versionId()));assertFalse(generalization.active(j.id(),j.lease()));assertThrows(IdentityException.class,()->generalization.restore(j.id()));
 }
 @Test void confirmedFailuresAreBoundedButUnknownResultsNeverResend(){
  var source=seed();for(int n=0;n<3;n++){var j=generalClaim();generalization.dispatched(j,generalDescriptor());generalization.fail(j.id(),"GENERALIZATION_FAILED",true,null);db.update("UPDATE experience_generalization_sources SET next_attempt_at=now() WHERE version_id=?",source.versionId());}assertEquals("FAILED",generalState(source.versionId()));assertNull(generalization.claim(tenant));
  fixture();var unknown=seed();var j=generalClaim();generalization.dispatched(j,generalDescriptor());generalization.fail(j.id(),"GENERALIZATION_RESULT_UNKNOWN",true,null);generalization.discover();assertEquals("UNKNOWN",generalState(unknown.versionId()));assertNull(generalization.claim(tenant));
 }
 @Test void receiptQualificationAndSensitiveContentAreRecheckedBeforeStaging(){
  seed();var j=generalClaim();generalization.dispatched(j,generalDescriptor());var r=qualified(j,method());var privateMethod=new ExperienceGeneralizationRuntime.Method("合成调度企业",r.method().summary(),r.method().steps(),r.method().applicable(),r.method().excluded(),r.method().tags(),r.method().basis());assertThrows(IdentityException.class,()->generalization.complete(qualified(j,privateMethod)));
  var privacy=pass(ExperienceGeneralizationRuntime.PRIVACY);privacy.put("combinationsSafe","UNKNOWN");var bad=new ExperienceGeneralizationRuntime.Result(r.contractVersion(),r.engineVersion(),r.executionClass(),r.runId(),r.lease(),r.source(),false,r.outcome(),r.code(),r.method(),privacy,r.quality(),r.stages());assertThrows(IdentityException.class,()->generalization.complete(bad));assertNull(db.queryForObject("SELECT method::text FROM experience_generalization_runs WHERE id=?",String.class,j.id()));generalization.complete(r);assertEquals("CREATED",generalAdmission.admit(j.id()).outcome());
 }
 @Test void globalManualStopBlocksAnIdenticalAutomaticContribution(){
  seed();var m=method();var r=publish(m);db.update("UPDATE general_experience_entries SET status='STOPPED' WHERE id=?",r.entryId());fixture();seed();assertEquals("CONFLICT",publish(m).outcome());assertFalse(available(r.versionId()));
 }
 @Test void sourceWithdrawalDoesNotPreventAnIndependentFreshlyCheckedContribution(){
  seed();var m=method();var r=publish(m);db.queryForList("SELECT scrub_lifecycle_object('TASK',?)",task);fixture();seed();var independent=publish(m);assertEquals("CREATED",independent.outcome());assertNotEquals(r.versionId(),independent.versionId());assertFalse(available(r.versionId()));assertTrue(available(independent.versionId()));
 }
 @Test void pausedTenantCannotClaimAndChangedInputCannotReuseAnOldRun(){
  var source=seed();generalization.discover();db.update("UPDATE tenants SET status='SUSPENDED' WHERE id=?",tenant);assertNull(generalization.claim(tenant));db.update("UPDATE tenants SET status='ACTIVE' WHERE id=?",tenant);var j=generalization.claim(tenant);assertNotNull(j);db.update("UPDATE tenants SET name='不同的保护名称' WHERE id=?",tenant);assertThrows(IdentityException.class,()->generalization.restore(j.id()));
 }

 @Test void suspensionInterruptsActiveWorkAndResumesPendingProcessingWithoutErasingAcceptedAssets(){
  seed();var r=publish(method());nextTask();var next=admission.admit(returned("新的可处理方法",null).id());var j=generalClaim();generalization.dispatched(j,generalDescriptor());
  db.update("UPDATE tenants SET status='SUSPENDED' WHERE id=?",tenant);assertFalse(generalization.active(j.id(),j.lease()));generalization.fail(j.id(),"GENERALIZATION_SOURCE_CHANGED",true,null);assertEquals("RETRY_WAIT",generalState(next.versionId()));assertTrue(available(r.versionId()));assertNull(generalization.claim(tenant));
  db.update("UPDATE tenants SET status='ACTIVE' WHERE id=?",tenant);db.update("UPDATE experience_generalization_sources SET next_attempt_at=now() WHERE version_id=?",next.versionId());assertNotNull(generalization.claim(tenant));assertTrue(available(r.versionId()));
 }
 @Test void workerRecoversAnUnknownReceiptByGetOnlyAndExpiresItWithoutRepeatingModelWork(){
  var source=seed();var j=generalClaim();generalization.dispatched(j,generalDescriptor());var runtime=mock(ExperienceGeneralizationRuntime.class);when(runtime.recover(any(),any())).thenThrow(new ExperienceGeneralizationRuntime.Failure("GENERALIZATION_RESULT_UNKNOWN",true));var worker=new ExperienceGeneralizationWorker(generalization,runtime,generalAdmission,false);
  try{var recovery=new ExperienceGeneralizationQueue.Recovery(j.id(),j.lease(),"DISPATCHED","synthetic-general-v1",false,false);worker.recover(recovery);assertEquals("RUNNING",generalState(source.versionId()));verify(runtime,never()).execute(any(),any(),any());worker.recover(new ExperienceGeneralizationQueue.Recovery(j.id(),j.lease(),"DISPATCHED","synthetic-general-v1",false,true));assertEquals("UNKNOWN",generalState(source.versionId()));assertNull(generalization.claim(tenant));verify(runtime,times(1)).recover(any(),any());}finally{worker.stop();}
 }
 @Test void workerCompletesRealHarnessReceiptWithoutAdmittingVerificationData()throws Exception{
  var source=seed();var j=generalClaim();java.nio.file.Path root=java.nio.file.Path.of(System.getProperty("user.dir")).toAbsolutePath();while(root!=null&&!java.nio.file.Files.exists(root.resolve("engine/tests/fixtures/experience-generalization-server.mjs")))root=root.getParent();assertNotNull(root);String token="synthetic-generalization-worker-012345678901234567890";
  var engine=new ProcessBuilder("node",root.resolve("engine/tests/fixtures/experience-generalization-server.mjs").toString(),token).redirectError(ProcessBuilder.Redirect.INHERIT).start();
  try(var pool=Executors.newSingleThreadExecutor();var lines=new java.io.BufferedReader(new java.io.InputStreamReader(engine.getInputStream()))){String endpoint=pool.submit(lines::readLine).get(5,TimeUnit.SECONDS);assertNotNull(endpoint);var runtime=new ExperienceGeneralizationRuntime(endpoint,token,"verification");var worker=new ExperienceGeneralizationWorker(generalization,runtime,generalAdmission,false);try{worker.execute(j);}finally{worker.stop();}assertEquals("FAILED",generalState(source.versionId()));assertEquals("GENERALIZATION_VERIFICATION_ONLY",db.queryForObject("SELECT error_code FROM experience_generalization_sources WHERE version_id=?",String.class,source.versionId()));assertEquals(0,db.queryForObject("SELECT count(*) FROM general_experience_admissions WHERE run_id=?",Integer.class,j.id()));assertNull(db.queryForObject("SELECT method::text FROM experience_generalization_runs WHERE id=?",String.class,j.id()));assertNotNull(db.queryForObject("SELECT stages::text FROM experience_generalization_runs WHERE id=?",String.class,j.id()));}
  finally{engine.destroy();if(!engine.waitFor(3,TimeUnit.SECONDS))engine.destroyForcibly();}
 }
 @Test void unfinishedInputSnapshotIsCheckedAgainAtAdmission(){
  var source=seed();var j=generalClaim();generalization.dispatched(j,generalDescriptor());generalization.complete(qualified(j,method()));db.update("UPDATE tenants SET name='新的保护标识' WHERE id=?",tenant);assertEquals("SOURCE_UNAVAILABLE",generalAdmission.admit(j.id()).outcome());assertEquals("SOURCE_UNAVAILABLE",generalState(source.versionId()));assertNull(db.queryForObject("SELECT method::text FROM experience_generalization_runs WHERE id=?",String.class,j.id()));
 }

 @Test void beginningThenCancellingDepartureCannotReviveAWithdrawnGeneralMethod(){
  var source=seed();var r=publish(method());UUID execution=UUID.randomUUID();db.update("INSERT INTO departure_executions(id,tenant_id,kind,target_account_id,state,requested_by,reason,policy_key,policy_revision,effective_at,deadline,prior_member_status,prior_tenant_status) VALUES (?,?,'MEMBER_OFFBOARD',?,'ISOLATING',?,'合成离职事实','MEMBER_RETENTION',0,now(),now()+interval '30 days','ACTIVE','ACTIVE')",execution,tenant,owner,owner);assertFalse(available(r.versionId()));assertEquals("SOURCE_UNAVAILABLE",generalState(source.versionId()));db.update("UPDATE departure_executions SET state='CANCELLED' WHERE id=?",execution);assertFalse(available(r.versionId()));assertNull(db.queryForObject("SELECT method::text FROM general_experience_versions WHERE id=?",String.class,r.versionId()));
 }
 @Test void fullLengthAutomaticStepsArePreservedInsteadOfBeingReconstructedFromDisplayLineBreaks(){
  var j=claim();queue.dispatched(j,descriptor());var r=result(j,"QUALIFIED");var c=r.candidate();var steps=java.util.stream.IntStream.range(0,10).mapToObj(n->"步骤"+n+"验".repeat(797)).toList();assertEquals(800,steps.getFirst().length());
  queue.complete(new Result(r.contractVersion(),r.engineVersion(),r.executionClass(),r.runId(),r.lease(),r.source(),false,r.outcome(),r.code(),new Candidate(null,c.title(),c.summary(),steps,c.applicable(),c.excluded(),c.tags(),c.evidence()),r.review(),r.stages()));admission.admit(j.id());assertEquals(steps,generalClaim().original().steps());
 }

 @Test void recyclingAndRestoringOriginalMaterialDoesNotReviveGeneralizedContent(){
  db.update("UPDATE workspace_members SET can_maintain=true WHERE workspace_id=? AND account_id=?",space,owner);
  var file=materials.upload(owner,tenant,space,null,null,null,UUID.randomUUID(),new org.springframework.mock.web.MockMultipartFile("file","synthetic.txt","text/plain","合成原文".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
  UUID version=materials.detail(owner,tenant,space,file.id(),0,20).versions().getFirst().id();db.update("INSERT INTO conversation_originals(tenant_id,workspace_id,task_id,material_id,version_id) VALUES (?,?,?,?,?)",tenant,space,task,file.id(),version);
  var source=seed();var r=publish(method());assertTrue(available(r.versionId()));db.update("INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state) VALUES (?,?,'MATERIAL',?,'TRASHED')",tenant,space,file.id());assertFalse(available(r.versionId()));assertEquals("SOURCE_UNAVAILABLE",generalState(source.versionId()));db.update("UPDATE content_lifecycle SET state='ACTIVE' WHERE object_id=?",file.id());assertFalse(available(r.versionId()));assertNull(db.queryForObject("SELECT method::text FROM general_experience_versions WHERE id=?",String.class,r.versionId()));
 }
}
