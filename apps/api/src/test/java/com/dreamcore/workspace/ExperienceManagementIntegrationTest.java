package com.dreamcore.workspace;
import com.dreamcore.workspace.experience.*;import com.dreamcore.workspace.identity.IdentityException;import com.dreamcore.workspace.feedback.FeedbackService;
import java.util.*;import java.util.concurrent.*;
import org.junit.jupiter.api.*;import org.springframework.beans.factory.annotation.Autowired;import org.springframework.boot.test.context.SpringBootTest;import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;import static org.mockito.Mockito.*;import static org.mockito.ArgumentMatchers.*;import static com.dreamcore.workspace.experience.ExperienceAnalysisRuntime.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=false","dreamcore.experience-intake.enabled=false","dreamcore.experience-analysis.enabled=false"})
class ExperienceManagementIntegrationTest {
 @org.springframework.boot.test.web.server.LocalServerPort int port;
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

 UUID manager(boolean shared){UUID a=UUID.randomUUID();db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'manager',?)",a,a+"@management.test",passwords.encode("synthetic-management-password"));db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'TENANT_ADMIN')",tenant,a);if(shared)db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES (?,?,?)",tenant,space,a);return a;}
 @Test void administratorDoesNotGainPrivateMethodOrSourceTextButCanObserveSharedScopeCounts(){
  var receipt=admission.admit(returned("先核验工具状态",null).id());UUID admin=manager(true);
  assertEquals(0,management.contents(admin,tenant,null,"","AVAILABLE",0).items().size());var view=management.processing(admin,tenant,null,"ALL",0,false);assertEquals(1,view.counts().get("ADMITTED"));assertFalse(view.enabled());assertNull(view.items().getFirst().entryId());assertNull(view.items().getFirst().versionId());assertNotEquals(task,view.items().getFirst().id());String data=new tools.jackson.databind.json.JsonMapper().writeValueAsString(view);for(String secret:List.of("private-prompt","private-reply","private-title",owner.toString(),task.toString(),receipt.entryId().toString(),"candidate","review","evidence"))assertFalse(data.contains(secret),secret);
  grant();assertEquals(1,management.contents(owner,tenant,space,"核验","AVAILABLE",0).items().size());assertEquals(receipt.entryId(),management.processing(owner,tenant,space,"ALL",0,true).items().getFirst().entryId());
 }
 @Test void membershipAndExplicitMaintenanceStillBoundTheScope(){
  UUID admin=manager(false);assertTrue(management.processing(admin,tenant,null,"ALL",0,true).items().isEmpty());assertThrows(IdentityException.class,()->management.processing(admin,tenant,space,"ALL",0,true));
  assertThrows(IdentityException.class,()->management.contents(owner,tenant,null,"","AVAILABLE",0));grant();assertEquals(1,management.contents(owner,tenant,null,"","AVAILABLE",0).scopes().size());db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);assertThrows(IdentityException.class,()->management.contents(owner,tenant,null,"","AVAILABLE",0));
 }
 @Test void personalSpacesNeverBecomeManagementScopes(){
  UUID admin=manager(true),personal=UUID.randomUUID();db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'private-space','PERSONAL')",personal,tenant,admin);assertEquals(1,management.contents(admin,tenant,null,"","AVAILABLE",0).scopes().size());assertThrows(IdentityException.class,()->management.processing(admin,tenant,personal,"ALL",0,true));
 }
 @Test void filtersDistinguishQualityFromTechnicalFailureAndHideUnknownProviderText(){
  grant();var j=claim();queue.dispatched(j,descriptor());queue.fail(j.id(),"private-provider-error",true,null);var retry=management.processing(owner,tenant,null,"RETRYING",0,true);assertEquals(1,retry.items().size());assertEquals("TECHNICAL_FAILURE",retry.items().getFirst().reason());assertEquals(0,retry.counts().get("NOT_ADMITTED"));
  db.update("UPDATE experience_analysis_items SET next_attempt_at=now()+interval '1 day' WHERE source_id=?",j.source());nextTask();var second=claim();queue.dispatched(second,descriptor());queue.complete(result(second,"REJECTED"));var rejected=management.processing(owner,tenant,null,"NOT_ADMITTED",0,true);assertEquals(1,rejected.items().size());assertEquals("QUALITY_NOT_ESTABLISHED",rejected.items().getFirst().reason());assertEquals(1,rejected.counts().get("RETRYING"));
 }
 @Test void defaultListExcludesStoppedAndUnqualifiedVersions(){
  grant();var receipt=admission.admit(returned("先核验工具状态",null).id());var entry=entry(receipt);experiences.withdraw(owner,tenant,space,entry.id(),UUID.randomUUID(),entry.revision());assertTrue(management.contents(owner,tenant,null,"","AVAILABLE",0).items().isEmpty());assertEquals(1,management.contents(owner,tenant,null,"核验","STOPPED",0).items().size());
  db.queryForList("SELECT scrub_lifecycle_object('TASK',?)",task);assertTrue(management.contents(owner,tenant,null,"","STOPPED",0).items().isEmpty());var row=management.processing(owner,tenant,null,"UNAVAILABLE",0,true).items().getFirst();assertNull(row.entryId());
 }
 @Test void paginationAndCountsAreBeforeFiltersAndDoNotIncludeOtherTenants(){
  grant();for(int i=0;i<23;i++){queue.discover();nextTask();}queue.discover();var first=management.processing(owner,tenant,null,"ALL",0,true);assertEquals(24,first.counts().get("WAITING"));assertEquals(20,first.items().size());assertTrue(first.hasMore());var next=management.processing(owner,tenant,null,"ALL",20,true);assertEquals(4,next.items().size());assertFalse(next.hasMore());assertFalse(first.items().stream().anyMatch(a->next.items().stream().anyMatch(b->a.id().equals(b.id()))));
  UUID other=UUID.randomUUID();db.update("INSERT INTO tenants(id,name) VALUES (?,'other')",other);assertThrows(IdentityException.class,()->management.processing(owner,other,null,"ALL",0,true));
 }
 @Test void httpRequiresCustomerSessionAndReturnsPrivateNoStoreWithoutRawBody()throws Exception{
  UUID admin=manager(true);queue.discover();var http=java.net.http.HttpClient.newBuilder().cookieHandler(new java.net.CookieManager(null,java.net.CookiePolicy.ACCEPT_ALL)).build();var json=new tools.jackson.databind.json.JsonMapper();String base="http://127.0.0.1:"+port,path="/api/v1/tenants/"+tenant+"/experience-library";
  assertEquals(401,http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(base+path)).GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());var csrf=json.readTree(http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(base+"/api/v1/auth/csrf")).GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString()).body());
  assertEquals(200,http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(base+"/api/v1/auth/login")).header(csrf.get("headerName").asString(),csrf.get("token").asString()).header("Content-Type","application/json").POST(java.net.http.HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("email",admin+"@management.test","password","synthetic-management-password")))).build(),java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
  for(String suffix:List.of("","/processing")){var response=http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(base+path+suffix)).GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString());assertEquals(200,response.statusCode(),response.body());assertTrue(response.headers().firstValue("cache-control").orElseThrow().contains("no-store"));assertFalse(response.body().contains("private-"));}
  assertEquals(401,http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(base+"/api/platform-admin/v1/overview")).GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
 }

 @Test void historyContainsOnlyReadablePublishedVersionsAndNeverCandidates(){
  grant();var receipt=admission.admit(returned("先核验工具状态",null).id());nextTask();var newer=admission.admit(returned("更新的方法",receipt.versionId()).id());var original=entry(receipt);var candidate=experiences.create(owner,tenant,space,UUID.randomUUID(),original.version().content(),original.version().evidence());assertThrows(IdentityException.class,()->management.history(owner,tenant,space,candidate.id(),0));var history=management.history(owner,tenant,space,receipt.entryId(),0);assertEquals(2,history.items().size());assertTrue(history.items().getFirst().current());assertFalse(history.items().getLast().current());assertEquals(newer.versionId(),history.items().getFirst().id());UUID admin=manager(true);assertThrows(IdentityException.class,()->management.history(admin,tenant,space,receipt.entryId(),0));
  db.queryForList("SELECT scrub_lifecycle_object('EXPERIENCE_VERSION',?)",newer.versionId());var surviving=management.history(owner,tenant,space,receipt.entryId(),0);assertEquals(1,surviving.items().size());assertEquals(receipt.versionId(),surviving.items().getFirst().id());
 }

 @Test void stoppedListUsesTheLastPublishedVersionEvenWhenAnUnpublishedDraftExists(){
  grant();var c=new ExperienceService.Content("METHOD","已发布的方法","摘要","核对步骤",List.of("核对"),"条件","限制","","历史人工内容","INDEPENDENT_COPY");var e=experiences.create(owner,tenant,space,UUID.randomUUID(),c,List.of());e=experiences.publish(owner,tenant,space,e.id(),UUID.randomUUID(),e.revision(),e.version().id(),true);UUID published=e.version().id();var draft=experiences.revise(owner,tenant,space,e.id(),UUID.randomUUID(),e.revision(),new ExperienceService.Content("METHOD","不可展示的草稿","摘要","草稿步骤",List.of("核对"),"条件","限制","","尚未发布","INDEPENDENT_COPY"),List.of());experiences.withdraw(owner,tenant,space,e.id(),UUID.randomUUID(),draft.revision());var stopped=management.contents(owner,tenant,null,"","STOPPED",0);assertEquals(1,stopped.items().size());assertEquals(published,stopped.items().getFirst().experience().versionId());assertEquals("已发布的方法",stopped.items().getFirst().experience().title());assertEquals(1,management.history(owner,tenant,space,e.id(),0).items().size());
 }
}
