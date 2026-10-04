package com.dreamcore.workspace;
import com.dreamcore.workspace.experience.*;import com.dreamcore.workspace.identity.IdentityException;import com.dreamcore.workspace.feedback.FeedbackService;
import java.util.*;import java.util.concurrent.*;
import org.junit.jupiter.api.*;import org.springframework.beans.factory.annotation.Autowired;import org.springframework.boot.test.context.SpringBootTest;import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;import static org.mockito.Mockito.*;import static org.mockito.ArgumentMatchers.*;import static com.dreamcore.workspace.experience.ExperienceAnalysisRuntime.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=false","dreamcore.experience-intake.enabled=false","dreamcore.experience-analysis.enabled=false"})
class GeneralExperienceLibraryIntegrationTest {
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
 @Test void sameCleanMethodAcrossRealmsNeverContainsInternalProvenance(){
  var source=seed();var r=publish(method());grant();
  var platformDetail=library.detail(platform,null,r.entryId(),r.versionId());assertEquals(platformDetail,library.detail(owner,tenant,r.entryId(),r.versionId()));
  var json=new tools.jackson.databind.json.JsonMapper();String serialized=json.writeValueAsString(platformDetail);
  for(String secret:List.of(tenant.toString(),space.toString(),owner.toString(),source.versionId().toString(),task.toString(),"private-prompt","private-reply","actorId","sourceId","runId","tenantId","evidence"))assertFalse(serialized.contains(secret),secret);
  assertEquals(r.versionId(),library.contents(platform,null,method().title(),"AVAILABLE",0).items().getFirst().versionId());
  assertFalse(json.writeValueAsString(library.contents(platform,null,method().title(),"AVAILABLE",0)).contains("steps"));
 }
 @Test void customerNeedsManagementScopeAndCannotCallPlatformService(){
  seed();var r=publish(method());assertThrows(IdentityException.class,()->library.detail(owner,tenant,r.entryId(),r.versionId()));assertThrows(IdentityException.class,()->library.detail(owner,null,r.entryId(),r.versionId()));assertThrows(IdentityException.class,()->library.processing(owner,false));
  grant();assertNotNull(library.detail(owner,tenant,r.entryId(),r.versionId()));
  UUID otherTenant=UUID.randomUUID();assertThrows(IdentityException.class,()->library.contents(owner,otherTenant,"","AVAILABLE",0));
  db.update("DELETE FROM governance_capabilities WHERE tenant_id=? AND account_id=?",tenant,owner);assertThrows(IdentityException.class,()->library.detail(owner,tenant,r.entryId(),r.versionId()));
  UUID admin=UUID.randomUUID();db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?, ?,'合成管理员','unused')",admin,admin+"@admin.test");db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'TENANT_ADMIN')",tenant,admin);assertNotNull(library.detail(admin,tenant,r.entryId(),r.versionId()));
 }
 @Test void sourceRevocationRemovesBothRealmsAndRegrantDoesNotRestore(){
  seed();var r=publish(method());grant();db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);
  assertTrue(library.contents(platform,null,method().title(),"AVAILABLE",0).items().isEmpty());assertThrows(IdentityException.class,()->library.detail(platform,null,r.entryId(),r.versionId()));
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES (?,?,?)",tenant,space,owner);assertThrows(IdentityException.class,()->library.detail(owner,tenant,r.entryId(),r.versionId()));
 }
 @Test void stopRemainsPlatformReadableOnlyWhileSourceIsValid(){
  seed();var r=publish(method());grant();db.update("UPDATE general_experience_entries SET status='STOPPED' WHERE id=?",r.entryId());
  assertEquals("STOPPED",library.detail(platform,null,r.entryId(),r.versionId()).status());assertEquals(1,library.contents(platform,null,method().title(),"STOPPED",0).items().size());
  assertThrows(IdentityException.class,()->library.detail(owner,tenant,r.entryId(),r.versionId()));assertTrue(library.contents(owner,tenant,"","STOPPED",0).items().isEmpty());
  db.queryForList("SELECT scrub_lifecycle_object('TASK',?)",task);assertThrows(IdentityException.class,()->library.detail(platform,null,r.entryId(),r.versionId()));assertTrue(library.contents(platform,null,method().title(),"STOPPED",0).items().isEmpty());
 }
 @Test void exactVersionAndLiteralSearchNeverSubstituteOrTreatWildcardsAsAll(){
  seed();var r=publish(method());assertThrows(IdentityException.class,()->library.detail(platform,null,r.entryId(),UUID.randomUUID()));assertThrows(IdentityException.class,()->library.detail(platform,null,UUID.randomUUID(),r.versionId()));
  assertTrue(library.contents(platform,null,"%_'", "AVAILABLE",0).items().isEmpty());assertThrows(IdentityException.class,()->library.contents(platform,null,"","AVAILABLE",-1));assertThrows(IdentityException.class,()->library.contents(platform,null,"x".repeat(201),"AVAILABLE",0));
 }
 @Test void visibilityIsAppliedBeforePagingAndCountsAreProcessingNotAssets(){
  seed();var r=publish(method());var before=library.processing(platform,false);assertFalse(before.enabled());
  // Synthetic duplicate asset rows use the same valid source; pagination is independent of source totals.
  for(int n=0;n<22;n++){UUID e=UUID.randomUUID(),v=UUID.randomUUID();db.update("INSERT INTO general_experience_entries(id,status) VALUES (?,?)",e,n==0?"STOPPED":"AVAILABLE");db.update("INSERT INTO general_experience_versions(id,entry_id,number,method,content_fingerprint) SELECT ?,?,1,method,content_fingerprint FROM general_experience_versions WHERE id=?",v,e,r.versionId());db.update("INSERT INTO general_experience_origins(version_id,source_version) SELECT ?,source_version FROM general_experience_origins WHERE version_id=?",v,r.versionId());db.update("UPDATE general_experience_entries SET published_version=? WHERE id=?",v,e);}
  var first=library.contents(platform,null,method().title(),"AVAILABLE",0);var second=library.contents(platform,null,method().title(),"AVAILABLE",20);assertEquals(20,first.items().size());assertTrue(first.hasMore());assertEquals(2,second.items().size());assertFalse(second.hasMore());assertTrue(Collections.disjoint(first.items().stream().map(GeneralExperienceLibrary.Summary::id).toList(),second.items().stream().map(GeneralExperienceLibrary.Summary::id).toList()));
  var after=library.processing(platform,false);assertEquals(before.available()+21,after.available());assertEquals(before.stopped()+1,after.stopped());assertEquals(before.counts(),after.counts());
 }
 @Test void pendingCandidatesAndRawFailuresAreOnlyFiniteAggregates(){
  seed();var j=generalClaim();generalization.dispatched(j,generalDescriptor());generalization.complete(qualified(j,method()));
  assertTrue(library.contents(platform,null,method().title(),"AVAILABLE",0).items().isEmpty());
  db.update("UPDATE experience_generalization_sources SET error_code='private-provider-message' WHERE version_id=?",j.source());
  String observation=new tools.jackson.databind.json.JsonMapper().writeValueAsString(library.processing(platform,false));for(String secret:List.of("private",method().title(),tenant.toString(),j.id().toString(),j.source().toString(),"method","error_code"))assertFalse(observation.contains(secret));
 }
 final class Browser {
  final java.net.http.HttpClient http=java.net.http.HttpClient.newBuilder().cookieHandler(new java.net.CookieManager(null,java.net.CookiePolicy.ACCEPT_ALL)).build();
  final tools.jackson.databind.json.JsonMapper json=new tools.jackson.databind.json.JsonMapper();
  java.net.http.HttpResponse<String> get(String path)throws Exception{return http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://127.0.0.1:"+port+path)).GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString());}
  void login(String realm,Map<String,String> body)throws Exception{String path=realm.equals("platform")?"/api/platform-admin/v1/auth":"/api/v1/auth";var csrf=json.readTree(get(path+"/csrf").body());var response=http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://127.0.0.1:"+port+path+"/login")).header("Content-Type","application/json").header(csrf.get("headerName").asString(),csrf.get("token").asString()).POST(java.net.http.HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build(),java.net.http.HttpResponse.BodyHandlers.ofString());assertEquals(200,response.statusCode(),response.body());}
 }
 @Test void actualHttpSeparatesSessionsAndNeverCachesBodies()throws Exception{
  seed();var r=publish(method());grant();db.update("UPDATE accounts SET password_hash=? WHERE id=?",passwords.encode("synthetic-customer-123"),owner);
  String publicPath="/api/v1/tenants/"+tenant+"/general-experiences",platformPath="/api/platform-admin/v1/experience-library";
  var customer=new Browser();assertEquals(401,customer.get(publicPath).statusCode());customer.login("customer",Map.of("email",owner+"@dispatch.test","password","synthetic-customer-123"));assertEquals(401,customer.get(platformPath).statusCode());assertEquals(401,customer.get(platformPath+"/processing").statusCode());
  var admin=new Browser();admin.login("platform",Map.of("username",platform+"@platform.test","password","synthetic-platform-456"));assertEquals(401,admin.get(publicPath).statusCode());
  for(var response:List.of(customer.get(publicPath),customer.get(publicPath+"/"+r.entryId()+"?version="+r.versionId()),admin.get(platformPath),admin.get(platformPath+"/processing"),admin.get(platformPath+"/"+r.entryId()+"?version="+r.versionId()))){assertEquals(200,response.statusCode(),response.body());assertTrue(response.headers().firstValue("cache-control").orElseThrow().contains("no-store"));}
  assertEquals(400,admin.get(platformPath+"/"+r.entryId()).statusCode());
  db.queryForList("SELECT scrub_lifecycle_object('TASK',?)",task);assertEquals(404,admin.get(platformPath+"/"+r.entryId()+"?version="+r.versionId()).statusCode());assertEquals(404,customer.get(publicPath+"/"+r.entryId()+"?version="+r.versionId()).statusCode());
 }

 @Autowired TenantGeneralExperienceUsage usage;
 @Autowired com.dreamcore.workspace.identity.TenantAdminService adminRecords;
 UUID manager;
 void admin(){manager=UUID.randomUUID();db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成管理人员','unused')",manager,manager+"@usage.test");db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'TENANT_ADMIN')",tenant,manager);}
 @Test void tenantUsageIsLocalReversibleAndOptimisticallyIdempotent(){
  seed();var r=publish(method());grant();
  var initial=usage.state(owner,tenant,r.entryId(),r.versionId());assertTrue(initial.enabled());assertFalse(initial.canManage());assertEquals(0,initial.revision());
  var stop=new TenantGeneralExperienceUsage.Change(UUID.randomUUID(),r.versionId(),0,false);
  assertEquals(403,assertThrows(IdentityException.class,()->usage.change(owner,tenant,r.entryId(),stop)).status);
  admin();var receipt=usage.change(manager,tenant,r.entryId(),stop);assertEquals(receipt,usage.change(manager,tenant,r.entryId(),stop));assertEquals(1,receipt.revision());
  assertFalse(usage.state(owner,tenant,r.entryId(),r.versionId()).enabled());assertTrue(available(r.versionId()));
  assertTrue(library.contents(owner,tenant,method().title(),"AVAILABLE",0).items().isEmpty());assertEquals(1,library.contents(owner,tenant,method().title(),"STOPPED",0).items().size());
  assertNotNull(library.detail(owner,tenant,r.entryId(),r.versionId()));assertEquals(1,library.contents(platform,null,method().title(),"AVAILABLE",0).items().size());
  assertEquals(409,assertThrows(IdentityException.class,()->usage.change(manager,tenant,r.entryId(),new TenantGeneralExperienceUsage.Change(stop.requestId(),r.versionId(),0,true))).status);
  assertEquals(409,assertThrows(IdentityException.class,()->usage.change(manager,tenant,r.entryId(),new TenantGeneralExperienceUsage.Change(UUID.randomUUID(),r.versionId(),0,true))).status);
  var restored=usage.change(manager,tenant,r.entryId(),new TenantGeneralExperienceUsage.Change(UUID.randomUUID(),r.versionId(),1,true));assertEquals(2,restored.revision());
  assertEquals(receipt,usage.change(manager,tenant,r.entryId(),stop));assertTrue(usage.state(owner,tenant,r.entryId(),r.versionId()).enabled());
  assertEquals(2,db.queryForObject("SELECT count(*) FROM identity_audit WHERE tenant_id=? AND action LIKE 'GENERAL_EXPERIENCE_USE_%'",Integer.class,tenant));
  assertEquals(2,adminRecords.records(manager,tenant,0,20).stream().filter(x->x.action().startsWith("GENERAL_EXPERIENCE_USE_")).count());
 }
 @Test void withdrawnSourceAndStaleVersionCannotBeRestoredLocally(){
  seed();var r=publish(method());admin();var stop=new TenantGeneralExperienceUsage.Change(UUID.randomUUID(),r.versionId(),0,false);usage.change(manager,tenant,r.entryId(),stop);
  assertEquals(404,assertThrows(IdentityException.class,()->usage.change(manager,tenant,r.entryId(),new TenantGeneralExperienceUsage.Change(UUID.randomUUID(),UUID.randomUUID(),1,true))).status);
  db.queryForList("SELECT scrub_lifecycle_object('TASK',?)",task);
  assertEquals(404,assertThrows(IdentityException.class,()->usage.change(manager,tenant,r.entryId(),new TenantGeneralExperienceUsage.Change(UUID.randomUUID(),r.versionId(),1,true))).status);
  assertEquals(1,usage.change(manager,tenant,r.entryId(),stop).revision()); // only original receipt, no body or restored state
  assertEquals(404,assertThrows(IdentityException.class,()->usage.state(manager,tenant,r.entryId(),r.versionId())).status);
  db.update("UPDATE tenant_memberships SET role='MEMBER' WHERE tenant_id=? AND account_id=?",tenant,manager);
  assertEquals(403,assertThrows(IdentityException.class,()->usage.change(manager,tenant,r.entryId(),stop)).status);
 }
 @Test void customerMutationNeedsCustomerSessionAndCsrf()throws Exception{
  seed();var r=publish(method());admin();db.update("UPDATE accounts SET password_hash=? WHERE id=?",passwords.encode("synthetic-customer-123"),manager);
  String path="/api/v1/tenants/"+tenant+"/general-experiences/"+r.entryId()+"/usage";
  var customer=new Browser();customer.login("customer",Map.of("email",manager+"@usage.test","password","synthetic-customer-123"));
  var json=customer.json;var body=new TenantGeneralExperienceUsage.Change(UUID.randomUUID(),r.versionId(),0,false);
  var builder=java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://127.0.0.1:"+port+path)).header("Content-Type","application/json").POST(java.net.http.HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
  assertEquals(403,customer.http.send(builder.build(),java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
  var csrf=json.readTree(customer.get("/api/v1/auth/csrf").body());builder.header(csrf.get("headerName").asString(),csrf.get("token").asString());
  var response=customer.http.send(builder.build(),java.net.http.HttpResponse.BodyHandlers.ofString());assertEquals(200,response.statusCode(),response.body());assertTrue(response.headers().firstValue("cache-control").orElseThrow().contains("no-store"));
  assertEquals(response.body(),customer.http.send(builder.build(),java.net.http.HttpResponse.BodyHandlers.ofString()).body());
  assertEquals(200,customer.get(path+"?version="+r.versionId()).statusCode());
  var adminBrowser=new Browser();adminBrowser.login("platform",Map.of("username",platform+"@platform.test","password","synthetic-platform-456"));assertEquals(401,adminBrowser.get(path+"?version="+r.versionId()).statusCode());
 }

 @Autowired GeneralExperienceManagement management;
 @Autowired com.dreamcore.workspace.identity.PlatformRecordsService platformRecords;
 @Autowired org.springframework.transaction.PlatformTransactionManager transactionManager;
 GeneralExperienceManagement.Change globalChange(GeneralExperienceAdmissionService.Receipt r,int revision,String status,String reason){return new GeneralExperienceManagement.Change(UUID.randomUUID(),r.versionId(),revision,status,reason);}
 @Test void platformStopRestoreUsesFixedVersionAndPrivateReasonWithoutPublishingAnythingNew(){
  seed();var r=publish(method());grant();var initial=management.state(platform,r.entryId(),r.versionId());assertEquals(1,initial.revision());assertNull(initial.reason());
  var stop=globalChange(r,1,"STOPPED"," 合成适用边界需收敛 ");
  assertEquals(403,assertThrows(IdentityException.class,()->management.change(owner,r.entryId(),stop)).status);
  assertEquals(400,assertThrows(IdentityException.class,()->management.change(platform,r.entryId(),globalChange(r,1,"STOPPED"," "))).status);
  var receipt=management.change(platform,r.entryId(),stop);assertEquals(2,receipt.revision());assertEquals(receipt,management.change(platform,r.entryId(),stop));
  assertEquals("合成适用边界需收敛",management.state(platform,r.entryId(),r.versionId()).reason());assertFalse(available(r.versionId()));assertNotNull(library.detail(platform,null,r.entryId(),r.versionId()));assertTrue(library.contents(owner,tenant,method().title(),"AVAILABLE",0).items().isEmpty());
  assertEquals(409,assertThrows(IdentityException.class,()->management.change(platform,r.entryId(),new GeneralExperienceManagement.Change(stop.requestId(),r.versionId(),1,"STOPPED","另外原因"))).status);
  assertEquals(409,assertThrows(IdentityException.class,()->management.change(platform,r.entryId(),globalChange(r,1,"AVAILABLE","合成恢复"))).status);
  assertEquals(404,assertThrows(IdentityException.class,()->management.change(platform,r.entryId(),new GeneralExperienceManagement.Change(UUID.randomUUID(),UUID.randomUUID(),2,"AVAILABLE","合成恢复"))).status);
  var restored=management.change(platform,r.entryId(),globalChange(r,2,"AVAILABLE","合成补充验证完成"));assertEquals(3,restored.revision());assertTrue(available(r.versionId()));assertEquals(receipt,management.change(platform,r.entryId(),stop));assertEquals("AVAILABLE",management.state(platform,r.entryId(),r.versionId()).status());
  assertEquals(1,db.queryForObject("SELECT count(*) FROM general_experience_versions WHERE entry_id=?",Integer.class,r.entryId()));
  String publicBody=new tools.jackson.databind.json.JsonMapper().writeValueAsString(library.detail(owner,tenant,r.entryId(),r.versionId()));assertFalse(publicBody.contains("原因"));assertFalse(publicBody.contains("合成补充验证完成"));
  var events=platformRecords.list(platform,"EXPERIENCE","SUCCESS",0,100).stream().filter(e->platform.equals(e.actorId())).toList();assertEquals(2,events.size());assertTrue(events.stream().allMatch(e->e.targetName().equals(method().title()+" · v1")));assertTrue(events.stream().allMatch(e->e.tenantId()==null&&e.tenantName()==null&&e.publicReason()==null&&e.internalReason()!=null));
  String records=new tools.jackson.databind.json.JsonMapper().writeValueAsString(events);for(UUID secret:List.of(tenant,owner,space,task))assertFalse(records.contains(secret.toString()));
 }
 @Test void erasedSourceAllowsOnlyOriginalPlatformReceiptNotRestorationOrContent(){
  seed();var r=publish(method());var stop=globalChange(r,1,"STOPPED","合成停止");var receipt=management.change(platform,r.entryId(),stop);
  db.queryForList("SELECT scrub_lifecycle_object('TASK',?)",task);
  assertEquals(receipt,management.change(platform,r.entryId(),stop));assertEquals(404,assertThrows(IdentityException.class,()->management.state(platform,r.entryId(),r.versionId())).status);
  assertEquals(404,assertThrows(IdentityException.class,()->management.change(platform,r.entryId(),globalChange(r,3,"AVAILABLE","合成恢复请求"))).status);
  assertTrue(platformRecords.list(platform,"EXPERIENCE","SUCCESS",0,100).stream().filter(e->platform.equals(e.actorId())).allMatch(e->e.targetName().equals("已失效的通用经验")));
  assertEquals("WITHDRAWN",db.queryForObject("SELECT status FROM general_experience_entries WHERE id=?",String.class,r.entryId()));assertNull(db.queryForObject("SELECT method FROM general_experience_versions WHERE id=?",String.class,r.versionId()));
  db.update("DELETE FROM platform_roles WHERE account_id=?",platform);assertEquals(403,assertThrows(IdentityException.class,()->management.change(platform,r.entryId(),stop)).status);
 }
 @Test void concurrentPlatformChangesApplyExactlyOnceAndDoNotCreateTwoEvents()throws Exception{
  seed();var r=publish(method());var first=globalChange(r,1,"STOPPED","合成首次");var second=globalChange(r,1,"STOPPED","合成同时请求");var start=new CountDownLatch(1);
  try(var pool=Executors.newFixedThreadPool(2)){
   var futures=List.of(first,second).stream().map(c->pool.submit(()->{start.await();try{return management.change(platform,r.entryId(),c);}catch(IdentityException e){return e;}})).toList();start.countDown();
   var results=new ArrayList<Object>();for(var f:futures)results.add(f.get(10,TimeUnit.SECONDS));assertEquals(1,results.stream().filter(x->x instanceof GeneralExperienceManagement.Receipt).count());assertEquals(1,results.stream().filter(x->x instanceof IdentityException e && e.status==409).count());
  }
  assertEquals(1,db.queryForObject("SELECT count(*) FROM general_experience_management_events WHERE entry_id=?",Integer.class,r.entryId()));assertEquals(2,management.state(platform,r.entryId(),r.versionId()).revision());
 }
 @Test void platformRevocationWinsWhileAChangeWaitsOnStaffAuthorizationLock()throws Exception{
  seed();var r=publish(method());var change=globalChange(r,1,"STOPPED","合成等待中");var started=new CountDownLatch(1);
  try(var pool=Executors.newSingleThreadExecutor()){
   var future=new org.springframework.transaction.support.TransactionTemplate(transactionManager).execute(status->{
    db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended('platform-staff-management',0))");
    var pending=pool.submit(()->{started.countDown();try{return (Object)management.change(platform,r.entryId(),change);}catch(IdentityException e){return e;}});
    try{assertTrue(started.await(10,TimeUnit.SECONDS));assertThrows(TimeoutException.class,()->pending.get(200,TimeUnit.MILLISECONDS));}catch(InterruptedException e){throw new RuntimeException(e);}
    db.update("DELETE FROM platform_roles WHERE account_id=?",platform);return pending;
   });
   var result=future.get(10,TimeUnit.SECONDS);assertInstanceOf(IdentityException.class,result);assertEquals(403,((IdentityException)result).status);
  }
  assertTrue(available(r.versionId()));assertEquals(0,db.queryForObject("SELECT count(*) FROM general_experience_management_events WHERE entry_id=?",Integer.class,r.entryId()));
 }
 @Test void automaticallyRediscoveredSameMethodCannotBypassPlatformStop(){
  seed();var r=publish(method());management.change(platform,r.entryId(),globalChange(r,1,"STOPPED","合成停止复用"));
  nextTask();admission.admit(returned("另一项已核验企业方法",null).id());var j=generalClaim();generalization.dispatched(j,generalDescriptor());generalization.complete(qualified(j,method()));
  assertEquals("CONFLICT",generalAdmission.admit(j.id()).outcome());assertEquals("STOPPED",management.state(platform,r.entryId(),r.versionId()).status());assertEquals(1,library.contents(platform,null,method().title(),"STOPPED",0).items().size());
 }
 @Test void platformManagementHttpRequiresSeparateSessionCsrfAndNoStore()throws Exception{
  seed();var r=publish(method());grant();db.update("UPDATE accounts SET password_hash=? WHERE id=?",passwords.encode("synthetic-customer-123"),owner);
  String path="/api/platform-admin/v1/experience-library/"+r.entryId()+"/availability";
  var customer=new Browser();customer.login("customer",Map.of("email",owner+"@dispatch.test","password","synthetic-customer-123"));assertEquals(401,customer.get(path+"?version="+r.versionId()).statusCode());
  var adminBrowser=new Browser();adminBrowser.login("platform",Map.of("username",platform+"@platform.test","password","synthetic-platform-456"));
  var state=adminBrowser.get(path+"?version="+r.versionId());assertEquals(200,state.statusCode(),state.body());assertTrue(state.headers().firstValue("cache-control").orElseThrow().contains("no-store"));
  var change=globalChange(r,1,"STOPPED","合成 HTTP 操作原因");var builder=java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://127.0.0.1:"+port+path)).header("Content-Type","application/json").POST(java.net.http.HttpRequest.BodyPublishers.ofString(adminBrowser.json.writeValueAsString(change)));
  assertEquals(403,adminBrowser.http.send(builder.build(),java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
  var csrf=adminBrowser.json.readTree(adminBrowser.get("/api/platform-admin/v1/auth/csrf").body());builder.header(csrf.get("headerName").asString(),csrf.get("token").asString());
  var response=adminBrowser.http.send(builder.build(),java.net.http.HttpResponse.BodyHandlers.ofString());assertEquals(200,response.statusCode(),response.body());assertTrue(response.headers().firstValue("cache-control").orElseThrow().contains("no-store"));assertEquals(response.body(),adminBrowser.http.send(builder.build(),java.net.http.HttpResponse.BodyHandlers.ofString()).body());
  assertEquals(404,customer.get("/api/v1/tenants/"+tenant+"/general-experiences/"+r.entryId()+"?version="+r.versionId()).statusCode());
 }
}
