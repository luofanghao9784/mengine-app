package com.dreamcore.workspace;
import com.dreamcore.workspace.experience.*;import com.dreamcore.workspace.identity.IdentityException;import com.dreamcore.workspace.feedback.FeedbackService;
import com.dreamcore.workspace.context.*;import com.dreamcore.workspace.conversation.*;
import java.util.*;import java.util.concurrent.*;
import org.junit.jupiter.api.*;import org.springframework.beans.factory.annotation.Autowired;import org.springframework.boot.test.context.SpringBootTest;import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;import static org.mockito.Mockito.*;import static org.mockito.ArgumentMatchers.*;import static com.dreamcore.workspace.experience.ExperienceAnalysisRuntime.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=verification","dreamcore.tasks.initial-delay-ms=3600000","dreamcore.experience-intake.enabled=false","dreamcore.experience-analysis.enabled=false"})
class GeneralExperienceTaskContextIntegrationTest {
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

 @Autowired TaskContextService context;@Autowired TaskContextGuard guard;@Autowired ConversationService conversations;@Autowired AgentTaskService agents;
 @org.springframework.boot.test.web.server.LocalServerPort int port;
 UUID clientTenant,clientActor,clientSpace;
 @BeforeEach void consumer(){clientTenant=UUID.randomUUID();clientActor=UUID.randomUUID();clientSpace=UUID.randomUUID();db.update("INSERT INTO tenants(id,name) VALUES (?,'合成使用企业')",clientTenant);db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成使用者','unused')",clientActor,clientActor+"@consumer.test");db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",clientTenant,clientActor);db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'合成使用空间','PERSONAL')",clientSpace,clientTenant,clientActor);}
 @AfterEach void stopTasks(){db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('RUNNING','QUEUED')",clientTenant);}
 ConversationService.Job working(UUID conversation){conversations.submit(clientActor,clientTenant,conversation,clientSpace,UUID.randomUUID(),"合成当前任务，参考通用方法整理草稿","AGENT");var job=conversations.claim();assertNotNull(job);assertEquals(clientTenant,job.tenant());return job;}
 ConversationService.Job working(){return working(null);}
 TaskContextService.Request request(String action,GeneralExperienceAdmissionService.Receipt r,Integer offset,UUID key,String decision,String conditions,String adjustments){return new TaskContextService.Request(action,null,null,offset,r==null?null:r.entryId(),r==null?null:r.versionId(),null,key,decision,conditions,adjustments);}
 tools.jackson.databind.JsonNode call(ConversationService.Job t,TaskContextService.Request r){return new tools.jackson.databind.json.JsonMapper().valueToTree(context.context(t.id(),t.token(),r)).get("result");}
 tools.jackson.databind.JsonNode search(ConversationService.Job t){return call(t,new TaskContextService.Request("general_experience_search",null,method().title(),0,null,null,null,null,null,null,null));}
 tools.jackson.databind.JsonNode read(ConversationService.Job t,GeneralExperienceAdmissionService.Receipt r,int offset){return call(t,request("general_experience_read",r,offset,null,null,null,null));}
 tools.jackson.databind.JsonNode use(ConversationService.Job t,GeneralExperienceAdmissionService.Receipt r,UUID key,String decision){return call(t,request("general_experience_use",r,null,key,decision,"当前输入、场景和工具满足限制","只调整本任务展示格式"));}
 void finish(ConversationService.Job t,String reply){agents.finish(t,new AgentResult("1.4","0.11.0",t.id(),t.token(),"AGENT","verification","synthetic-general-context",reply,List.of(),List.of(),List.of(),1,null,List.of(),List.of(),List.of()));}
 void denied(int status,Runnable r){assertEquals(status,assertThrows(IdentityException.class,r::run).status);}
 @Test void ordinaryTaskCanReadCleanedMethodsWithoutAnyContributionIdentity(){
  var source=seed();var general=publish(method());var t=working();var found=search(t);assertEquals(1,found.get("items").size());assertEquals("GENERAL_CLEANED",found.get("scope").asString());assertFalse(found.get("items").get(0).get("authority").asBoolean());
  var detail=read(t,general,0);assertTrue(detail.get("nextOffset").isNull());assertTrue(detail.get("requiresApplicabilityCheck").asBoolean());
  for(String secret:List.of(tenant.toString(),space.toString(),owner.toString(),task.toString(),source.versionId().toString(),"private-prompt","private-reply","sourceId","runId"))assertFalse((found.toString()+detail).contains(secret),secret);
  assertEquals(0,db.queryForObject("SELECT count(*) FROM task_context_materials WHERE task_id=?",Integer.class,t.id()));assertEquals(1,db.queryForObject("SELECT count(*) FROM task_general_experience_reads WHERE task_id=?",Integer.class,t.id()));assertEquals("1.0",agents.check(t.id(),t.token()).get("generalExperienceVersion"));
 }
 @Test void completePagedReadIsRequiredForIdempotentAdoptionAndNeverProvesBusinessSuccess(){
  seed();var m=method();var longMethod=new ExperienceGeneralizationRuntime.Method(m.title(),m.summary(),java.util.stream.IntStream.range(0,10).mapToObj(n->("步骤"+n)+"方".repeat(790)).toList(),m.applicable(),m.excluded(),m.tags(),m.basis());var r=publish(longMethod);var t=working();UUID key=UUID.randomUUID();
  denied(409,()->use(t,r,key,"DIRECT"));search(t);denied(409,()->use(t,r,key,"DIRECT"));assertFalse(use(t,r,UUID.randomUUID(),"UNKNOWN").get("selectionRecorded").asBoolean());
  var steps=new ArrayList<String>();for(int offset:List.of(0,3,6,9)){var page=read(t,r,offset);page.get("steps").forEach(v->steps.add(v.asString()));if(offset<9)denied(409,()->use(t,r,key,"DIRECT"));}
  assertEquals(longMethod.steps(),steps);var receipt=use(t,r,key,"ADAPTED");assertTrue(receipt.get("selectionRecorded").asBoolean());assertFalse(receipt.get("businessActionPerformed").asBoolean());assertEquals("UNKNOWN",receipt.get("applicationOutcome").asString());assertEquals("MODEL_REPORTED",receipt.get("assessmentSource").asString());assertEquals(receipt,use(t,r,key,"ADAPTED"));denied(409,()->use(t,r,key,"DIRECT"));
  denied(400,()->call(t,request("general_experience_use",r,null,UUID.randomUUID(),"ADAPTED","满足条件","")));assertEquals(2,db.queryForObject("SELECT count(*) FROM task_general_experience_reviews WHERE task_id=?",Integer.class,t.id()));
 }
 @Test void selectedOnlyTasksAndWrongVersionsCannotReadOrRegisterAdoption(){
  seed();var r=publish(method());var t=working();db.update("UPDATE conversation_tasks SET source_scope='SELECTED' WHERE id=?",t.id());assertEquals("SELECTED_ONLY",search(t).get("reason").asString());assertTrue(read(t,r,0).get("unavailable").asBoolean());assertTrue(use(t,r,UUID.randomUUID(),"DIRECT").get("unavailable").asBoolean());assertEquals(0,db.queryForObject("SELECT count(*) FROM task_general_experience_reads WHERE task_id=?",Integer.class,t.id()));
  var next=working();denied(404,()->call(next,new TaskContextService.Request("general_experience_read",null,null,null,r.entryId(),UUID.randomUUID(),null,null,null,null,null)));denied(403,()->context.context(next.id(),UUID.randomUUID(),request("general_experience_read",r,0,null,null,null,null)));
 }
 @Test void stoppingAndRestoringFencesInflightAttemptWithoutErasingPastResults(){
  seed();var r=publish(method());var done=working();read(done,r,0);finish(done,"保留过去基于通用方法的合成结果");var active=working();read(active,r,0);
  db.update("UPDATE general_experience_entries SET status='STOPPED' WHERE id=?",r.entryId());assertFalse(agents.active(active));assertEquals("保留过去基于通用方法的合成结果",db.queryForObject("SELECT reply FROM conversation_tasks WHERE id=?",String.class,done.id()));assertTrue(db.queryForObject("SELECT EXISTS(SELECT 1 FROM readable_source_tasks WHERE id=?)",Boolean.class,done.id()));
  db.update("UPDATE general_experience_entries SET status='AVAILABLE' WHERE id=?",r.entryId());assertFalse(agents.active(active));assertThrows(IdentityException.class,()->finish(active,"迟到回复"));var fresh=working();assertNotNull(read(fresh,r,0));
 }
 @Test void sourceRemovalScrubsSearchOnlyTaskHistoryAndPrivateSelectionText(){
  seed();var r=publish(method());var done=working();search(done);assertEquals(0,db.queryForObject("SELECT read_bits FROM task_general_experience_reads WHERE task_id=?",Integer.class,done.id()));finish(done,"根据摘要生成的合成结果");
  var history=working(done.conversation());call(history,new TaskContextService.Request("history",null,null,null,null,null,null,null,null,null,null));finish(history,"基于旧结果的合成派生内容");
  var active=working();read(active,r,0);use(active,r,UUID.randomUUID(),"DIRECT");db.queryForList("SELECT scrub_lifecycle_object('TASK',?)",task);
  for(UUID target:List.of(done.id(),history.id(),active.id())){assertNull(db.queryForObject("SELECT reply FROM conversation_tasks WHERE id=?",String.class,target));assertFalse(db.queryForObject("SELECT EXISTS(SELECT 1 FROM readable_source_tasks WHERE id=?)",Boolean.class,target));assertEquals("{}",db.queryForObject("SELECT snapshot::text FROM conversation_attempts WHERE task_id=?",String.class,target));}
  assertFalse(agents.active(active));assertEquals("",db.queryForObject("SELECT conditions FROM task_general_experience_reviews WHERE task_id=?",String.class,active.id()));assertEquals("",db.queryForObject("SELECT adjustments FROM task_general_experience_reviews WHERE task_id=?",String.class,active.id()));
 }
 @Test void sourceAccessLossAndRegrantNeverRestoreConsumerTasks(){
  seed();var r=publish(method());var t=working();read(t,r,0);finish(t,"原来可读的合成结果");db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);assertNull(db.queryForObject("SELECT reply FROM conversation_tasks WHERE id=?",String.class,t.id()));db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES (?,?,?)",tenant,space,owner);assertFalse(db.queryForObject("SELECT task_general_experiences_readable(?)",Boolean.class,t.id()));
 }
 @Test void purgingConsumerTaskClearsItsReviewButNeverAffectsGeneralAssetOrSourceTenant(){
  seed();var r=publish(method());var t=working();read(t,r,0);use(t,r,UUID.randomUUID(),"ADAPTED");finish(t,"消费者私有回复");db.queryForList("SELECT scrub_lifecycle_object('TASK',?)",t.id());assertEquals("",db.queryForObject("SELECT conditions FROM task_general_experience_reviews WHERE task_id=?",String.class,t.id()));assertTrue(available(r.versionId()));assertEquals("private-reply",db.queryForObject("SELECT reply FROM conversation_tasks WHERE id=?",String.class,task));
 }
 @Test void actualInternalHttpRequiresLiveTokenAndReturnsNoStoreFixedVersion()throws Exception{
  seed();var r=publish(method());var t=working();var client=java.net.http.HttpClient.newHttpClient();var json=new tools.jackson.databind.json.JsonMapper();String uri="http://127.0.0.1:"+port+"/internal/v1/agent-access/"+t.id()+"/context";String body=json.writeValueAsString(request("general_experience_read",r,0,null,null,null,null));
  var wrong=client.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(uri)).header("Authorization","Bearer "+UUID.randomUUID()).header("Content-Type","application/json").POST(java.net.http.HttpRequest.BodyPublishers.ofString(body)).build(),java.net.http.HttpResponse.BodyHandlers.ofString());assertEquals(403,wrong.statusCode());
  var response=client.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(uri)).header("Authorization","Bearer "+t.token()).header("Content-Type","application/json").POST(java.net.http.HttpRequest.BodyPublishers.ofString(body)).build(),java.net.http.HttpResponse.BodyHandlers.ofString());assertEquals(200,response.statusCode(),response.body());assertTrue(response.headers().firstValue("cache-control").orElseThrow().contains("no-store"));assertEquals(r.versionId().toString(),json.readTree(response.body()).get("result").get("versionId").asString());
 }
 @Test void timedSourceExpiryAlsoFencesObjectLifecycleBeforeAWorkerCleansTheSource(){
  var source=seed();var r=publish(method());var t=working();read(t,r,0);finish(t,"尚未清理的历史结果");
  db.update("UPDATE object_lifecycle SET is_formal=false,policy_due=now()-interval '1 second' WHERE kind='EXPERIENCE_VERSION' AND object_id=?",source.versionId());
  assertFalse(db.queryForObject("SELECT object_is_active('TASK',?)",Boolean.class,t.id()));assertFalse(db.queryForObject("SELECT EXISTS(SELECT 1 FROM readable_source_tasks WHERE id=?)",Boolean.class,t.id()));
  generalization.discover();assertNull(db.queryForObject("SELECT reply FROM conversation_tasks WHERE id=?",String.class,t.id()));
 }
 @Test void aNewPublishedVersionCannotReplaceAnInFlightPinOrReviveItWhenRestored(){
  seed();var r=publish(method());var t=working();read(t,r,0);UUID version=UUID.randomUUID();
  db.update("INSERT INTO general_experience_versions(id,entry_id,number,method,content_fingerprint) SELECT ?,entry_id,2,method,content_fingerprint FROM general_experience_versions WHERE id=?",version,r.versionId());
  db.update("INSERT INTO general_experience_origins(version_id,source_version) SELECT ?,source_version FROM general_experience_origins WHERE version_id=?",version,r.versionId());
  db.update("UPDATE general_experience_entries SET published_version=? WHERE id=?",version,r.entryId());assertFalse(agents.active(t));
  assertEquals(r.versionId(),db.queryForObject("SELECT version_id FROM task_general_experience_reads WHERE task_id=?",UUID.class,t.id()));
  db.update("UPDATE general_experience_entries SET published_version=? WHERE id=?",r.versionId(),r.entryId());assertFalse(agents.active(t));
 }

 @Test void sourceWithdrawalPropagatesThroughASecondIndependentGeneralizationWithoutRecursiveLeaks(){
  seed();var first=publish(method());UUID originalSourceTask=task;var useTask=working();read(useTask,first,0);finish(useTask,"合成后续方法的执行观察");
  // Explicit synthetic live-classified database fixture for admission; no real-model quality claim.
  db.update("UPDATE conversation_tasks SET execution_class='live',engine_version='synthetic-fixture' WHERE id=?",useTask.id());
  db.update("UPDATE conversation_attempts a SET snapshot=to_jsonb(t) FROM conversation_tasks t WHERE a.task_id=t.id AND t.id=?",useTask.id());
  db.update("INSERT INTO conversation_tool_receipts(task_id,attempt_number,sequence,name,status) VALUES (?,1,1,'compare_dataset','succeeded')",useTask.id());
  tenant=clientTenant;owner=clientActor;space=clientSpace;task=useTask.id();seed();var second=publish(method());var last=working();read(last,second,0);finish(last,"跨两次提炼的派生回复");
  db.queryForList("SELECT scrub_lifecycle_object('TASK',?)",originalSourceTask);
  assertFalse(available(first.versionId()));assertFalse(available(second.versionId()));assertNull(db.queryForObject("SELECT reply FROM conversation_tasks WHERE id=?",String.class,last.id()));
 }

 @Test void stopAlsoFencesInheritedRuntimeContextWhileLeavingHumanHistoryReadable(){
  seed();var r=publish(method());var done=working();read(done,r,0);finish(done,"可供人查看的历史回复");
  var inherited=working(done.conversation());call(inherited,new TaskContextService.Request("history",null,null,null,null,null,null,null,null,null,null));
  var secondDone=working();read(secondDone,r,0);finish(secondDone,"另一个私人会话的合成历史");
  db.update("UPDATE general_experience_entries SET status='STOPPED' WHERE id=?",r.entryId());assertFalse(agents.active(inherited));assertTrue(db.queryForObject("SELECT EXISTS(SELECT 1 FROM readable_source_tasks WHERE id=?)",Boolean.class,done.id()));
  var fresh=working(secondDone.conversation());denied(409,()->call(fresh,new TaskContextService.Request("history",null,null,null,null,null,null,null,null,null,null)));assertEquals(0,db.queryForObject("SELECT count(*) FROM task_context_reads WHERE task_id=?",Integer.class,fresh.id()));assertTrue(agents.active(fresh));
  db.update("UPDATE general_experience_entries SET status='AVAILABLE' WHERE id=?",r.entryId());assertFalse(agents.active(inherited));
 }


 @Autowired TenantGeneralExperienceUsage usage;
 @Autowired org.springframework.transaction.PlatformTransactionManager transactionManager;
 TenantGeneralExperienceUsage.Receipt localUse(GeneralExperienceAdmissionService.Receipt r,int revision,boolean enabled){
  db.update("UPDATE tenant_memberships SET role='TENANT_ADMIN' WHERE tenant_id=? AND account_id=?",clientTenant,clientActor);
  return usage.change(clientActor,clientTenant,r.entryId(),new TenantGeneralExperienceUsage.Change(UUID.randomUUID(),r.versionId(),revision,enabled));
 }
 @Test void localStopAffectsOnlyThisEnterpriseIncludingInheritedTaskHistory(){
  seed();var r=publish(method());var done=working();read(done,r,0);finish(done,"历史合成结果");
  var inherited=working(done.conversation());call(inherited,new TaskContextService.Request("history",null,null,null,null,null,null,null,null,null,null));
  conversations.submit(owner,tenant,null,space,UUID.randomUUID(),"另一个企业的合成任务","AGENT");var other=conversations.claim();assertNotNull(other);assertEquals(tenant,other.tenant());read(other,r,0);
  localUse(r,0,false);assertTrue(agents.active(other));assertNotNull(read(other,r,0));finish(other,"另一个企业仍可使用");assertFalse(agents.active(inherited));assertTrue(available(r.versionId()));assertTrue(db.queryForObject("SELECT EXISTS(SELECT 1 FROM readable_source_tasks WHERE id=?)",Boolean.class,done.id()));
  assertFalse(db.queryForObject("SELECT tenant_general_experience_enabled(?,?)",Boolean.class,clientTenant,r.entryId()));assertTrue(db.queryForObject("SELECT tenant_general_experience_enabled(?,?)",Boolean.class,tenant,r.entryId()));
  var fresh=working();assertEquals(0,search(fresh).get("items").size());denied(404,()->read(fresh,r,0));
  localUse(r,1,true);assertFalse(agents.active(inherited));assertEquals(1,search(fresh).get("items").size());assertNotNull(read(fresh,r,0));
 }
 @Test void localStopUsesSharedTaskFenceEvenBeforeUsageRowExists()throws Exception{
  seed();var r=publish(method());var job=working();read(job,r,0);
  db.update("UPDATE tenant_memberships SET role='TENANT_ADMIN' WHERE tenant_id=? AND account_id=?",clientTenant,clientActor);
  var locked=new CountDownLatch(1);var release=new CountDownLatch(1);var started=new CountDownLatch(1);
  try(var pool=Executors.newFixedThreadPool(2)){
   var reader=pool.submit(()->new org.springframework.transaction.support.TransactionTemplate(transactionManager).execute(status->{guard.requireCurrent(job.id());locked.countDown();try{assertTrue(release.await(10,TimeUnit.SECONDS));}catch(InterruptedException e){throw new RuntimeException(e);}return true;}));
   assertTrue(locked.await(10,TimeUnit.SECONDS));
   var writer=pool.submit(()->{started.countDown();return usage.change(clientActor,clientTenant,r.entryId(),new TenantGeneralExperienceUsage.Change(UUID.randomUUID(),r.versionId(),0,false));});
   assertTrue(started.await(10,TimeUnit.SECONDS));try{assertThrows(TimeoutException.class,()->writer.get(200,TimeUnit.MILLISECONDS));}finally{release.countDown();}
   assertTrue(reader.get(10,TimeUnit.SECONDS));assertFalse(writer.get(10,TimeUnit.SECONDS).enabled());
  }finally{release.countDown();}
  assertFalse(agents.active(job));localUse(r,1,true);assertFalse(agents.active(job));
 }
}
