package com.dreamcore.workspace;

import com.dreamcore.workspace.experience.ExperienceService;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.material.MaterialService;
import java.net.*;
import java.net.http.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
class ExperienceIntegrationTest {
 @Autowired JdbcTemplate db; @Autowired ExperienceService service; @Autowired MaterialService materials; @Autowired PasswordEncoder passwords;
 @LocalServerPort int port; final JsonMapper json=new JsonMapper();
 UUID tenant,other,owner,reader,admin,alien,space,personal,material,version;
 final String password="synthetic-experience-password";
 String email(UUID id){return "experience-"+id+"@example.test";}
 @BeforeEach void fixture(){
  tenant=UUID.randomUUID();other=UUID.randomUUID();owner=UUID.randomUUID();reader=UUID.randomUUID();admin=UUID.randomUUID();alien=UUID.randomUUID();space=UUID.randomUUID();personal=UUID.randomUUID();
  for(UUID t:List.of(tenant,other))db.update("INSERT INTO tenants(id,name) VALUES (?,?)",t,"合成经验企业");
  for(UUID a:List.of(owner,reader,admin,alien))db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",a,email(a),"合成测试",passwords.encode(password));
  for(UUID a:List.of(owner,reader,admin))db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,a,a.equals(admin)?"TENANT_ADMIN":"MEMBER");
  db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'TENANT_ADMIN')",other,alien);
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'共享','SHARED'),(?,?,?,'私人','PERSONAL')",space,tenant,owner,personal,tenant,owner);
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true),(?,?,?,false)",tenant,space,owner,tenant,space,reader);
  grant(owner);
  var f=materials.upload(owner,tenant,personal,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","private.txt","text/plain","原件内容不可泄露".getBytes()));material=f.id();version=materials.detail(owner,tenant,personal,material,0,20).versions().getFirst().id();
 }
 void grant(UUID actor){db.update("INSERT INTO governance_capabilities(tenant_id,account_id,workspace_id,capability,granted_by) VALUES (?,?,?,'EXPERIENCE_MAINTAIN',?)",tenant,actor,space,owner);}
 ExperienceService.Content content(String mode){return new ExperienceService.Content("METHOD","周报核对方法","对照计划与实际","逐项比对日期并保留缺口。",List.of("进度","报告"),"具备获准计划和实际记录","不能据历史案例推断当前延期","当前日期和口径","人工编写的方法参考；未评测",mode);}
 ExperienceService.Entry create(String mode,boolean refs){return service.create(owner,tenant,space,UUID.randomUUID(),content(mode),refs?List.of(new ExperienceService.Evidence("MATERIAL_VERSION",version,personal)):List.of());}
 ExperienceService.Entry publish(ExperienceService.Entry e){return service.publish(owner,tenant,space,e.id(),UUID.randomUUID(),e.revision(),e.version().id(),true);}
 ExperienceService.UseInput usage(UUID v,String key,String decision,boolean adopted){return new ExperienceService.UseInput(v,null,key,decision,adopted,"本次资料口径已核对","按实际缺口调整");}
 @Test void emptyLibraryAndCandidateDoNotBecomeAvailableAndVersionsRemainImmutable(){
  assertTrue(service.list(reader,tenant,space,"","",false,0,20).items().isEmpty());
  var e=create("INDEPENDENT_COPY",false);assertTrue(service.list(reader,tenant,space,"","",false,0,20).items().isEmpty());
  assertThrows(IdentityException.class,()->service.get(reader,tenant,space,e.id(),e.version().id()));
  assertEquals("EXPERIENCE_COPY_CONFIRMATION_REQUIRED",assertThrows(IdentityException.class,()->service.publish(owner,tenant,space,e.id(),UUID.randomUUID(),1,e.version().id(),false)).code);
  var p=publish(e);assertEquals(1,service.list(reader,tenant,space,"周报核对","进度",false,0,20).items().size());assertEquals(1,service.list(reader,tenant,space,"核","",false,0,20).items().size());
  var revised=service.revise(owner,tenant,space,e.id(),UUID.randomUUID(),p.revision(),content("INDEPENDENT_COPY"),List.of());
  assertEquals(2,revised.version().number());assertEquals(e.version().id(),service.get(reader,tenant,space,e.id(),null).version().id());
  assertEquals(2,service.versions(owner,tenant,space,e.id(),0,20).items().size());
  assertEquals("EXPERIENCE_STATE_CHANGED",assertThrows(IdentityException.class,()->service.publish(owner,tenant,space,e.id(),UUID.randomUUID(),p.revision(),revised.version().id(),true)).code);
  var p2=publish(revised);assertEquals(2,service.get(reader,tenant,space,e.id(),null).version().number());
  service.withdraw(owner,tenant,space,e.id(),UUID.randomUUID(),p2.revision());
  assertTrue(service.list(reader,tenant,space,"","",false,0,20).items().isEmpty());
  assertEquals(1,service.get(reader,tenant,space,e.id(),e.version().id()).version().number());
 }
 @Test void managementRoleAndContentMaintenanceDoNotImplicitlyGrantExperienceMaintenance(){
  var e=create("INDEPENDENT_COPY",false);
  for(UUID a:List.of(admin,alien))assertThrows(IdentityException.class,()->service.get(a,tenant,space,e.id(),null));
  assertEquals(403,assertThrows(IdentityException.class,()->service.create(reader,tenant,space,UUID.randomUUID(),content("INDEPENDENT_COPY"),List.of())).status);
  db.update("DELETE FROM governance_capabilities WHERE account_id=?",owner);
  assertThrows(IdentityException.class,()->create("INDEPENDENT_COPY",false));
  // Personal work requires no shared maintenance appointment.
  assertTrue(service.create(owner,tenant,personal,UUID.randomUUID(),content("INDEPENDENT_COPY"),List.of()).canMaintain());
  assertThrows(IdentityException.class,()->service.list(admin,tenant,personal,"","",false,0,20));
 }
 @Test void sourceBoundPrivateEvidenceCannotLeakThroughSummaryHistoryOrBody(){
  var bound=publish(create("SOURCE_BOUND",true));
  assertTrue(service.list(reader,tenant,space,"","",false,0,20).items().isEmpty());
  assertThrows(IdentityException.class,()->service.get(reader,tenant,space,bound.id(),bound.version().id()));
  grant(reader);assertTrue(service.list(reader,tenant,space,"","",true,0,20).items().isEmpty());
  assertTrue(service.versions(reader,tenant,space,bound.id(),0,20).items().isEmpty());
  var independent=publish(create("INDEPENDENT_COPY",true));
  assertTrue(service.get(reader,tenant,space,independent.id(),independent.version().id()).version().evidence().isEmpty());
  assertEquals("MANUAL",independent.version().origin());assertEquals("NOT_EVALUATED",independent.version().evaluation());
 }
 @Test void recycleAndPhysicalScrubInvalidateBoundIndexButKeepIndependentCopy(){
  var bound=publish(create("SOURCE_BOUND",true));var copy=publish(create("INDEPENDENT_COPY",true));
  db.update("INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state) VALUES (?,?,'MATERIAL',?,'TRASHED')",tenant,personal,material);
  assertEquals(1,service.list(owner,tenant,space,"周报","",false,0,20).items().size());
  assertThrows(IdentityException.class,()->service.get(owner,tenant,space,bound.id(),bound.version().id()));
  assertThrows(IdentityException.class,()->service.recordUse(owner,tenant,space,bound.id(),UUID.randomUUID(),usage(bound.version().id(),"case-a","DIRECT",true)));
  db.queryForList("SELECT scrub_experience_material(?)",material);
  assertEquals("{}",db.queryForObject("SELECT content::text FROM experience_versions WHERE id=?",String.class,bound.version().id()));
  assertEquals("WITHDRAWN",db.queryForObject("SELECT status FROM experience_entries WHERE id=?",String.class,bound.id()));
  assertEquals(copy.version().content().body(),service.get(reader,tenant,space,copy.id(),null).version().content().body());
  db.update("UPDATE content_lifecycle SET state='ACTIVE' WHERE object_id=?",material);
  assertThrows(IdentityException.class,()->service.get(owner,tenant,space,bound.id(),bound.version().id()));
 }
 @Test void replayConcurrentCreateHasOneVersionAndDifferentBodyConflicts() throws Exception {
  UUID key=UUID.randomUUID();try(var pool=Executors.newFixedThreadPool(2)){
   var futures=pool.invokeAll(List.<Callable<ExperienceService.Entry>>of(()->service.create(owner,tenant,space,key,content("INDEPENDENT_COPY"),List.of()),()->service.create(owner,tenant,space,key,content("INDEPENDENT_COPY"),List.of())));
   var a=futures.get(0).get();assertEquals(a.id(),futures.get(1).get().id());assertEquals(1,db.queryForObject("SELECT count(*) FROM experience_versions WHERE entry_id=?",Integer.class,a.id()));
   assertEquals("IDEMPOTENCY_CONFLICT",assertThrows(IdentityException.class,()->service.create(owner,tenant,space,key,content("SOURCE_BOUND"),List.of(new ExperienceService.Evidence("MATERIAL_VERSION",version,personal)))).code);
   publish(a);service.revise(owner,tenant,space,a.id(),UUID.randomUUID(),2,content("INDEPENDENT_COPY"),List.of());
   assertEquals(1,service.create(owner,tenant,space,key,content("INDEPENDENT_COPY"),List.of()).version().number());
  }
 }
 @Test void applicabilityUseFeedbackAndWithdrawalAreSeparateAndPrivate(){
  var p=publish(create("INDEPENDENT_COPY",false));UUID key=UUID.randomUUID();var u=service.recordUse(reader,tenant,space,p.id(),key,usage(p.version().id(),"case-a","NOT_APPLICABLE",false));
  assertFalse(u.adopted());assertEquals(u,service.recordUse(reader,tenant,space,p.id(),key,usage(p.version().id(),"case-a","NOT_APPLICABLE",false)));
  assertTrue(service.uses(owner,tenant,space,p.id(),0,20).items().isEmpty());
  assertThrows(IdentityException.class,()->service.recordUse(reader,tenant,space,p.id(),UUID.randomUUID(),usage(p.version().id(),"bad","UNKNOWN",true)));
  assertEquals("EXPERIENCE_USE_EXISTS",assertThrows(IdentityException.class,()->service.recordUse(reader,tenant,space,p.id(),UUID.randomUUID(),usage(p.version().id(),"case-a","NOT_APPLICABLE",false))).code);
  UUID fk=UUID.randomUUID();var f=service.feedback(reader,tenant,space,p.id(),u.id(),fk,"CORRECTED","原方法不适用于本次口径，人工修正后完成。");
  assertEquals(f,service.feedback(reader,tenant,space,p.id(),u.id(),fk,"CORRECTED","原方法不适用于本次口径，人工修正后完成。"));
  assertEquals(1,service.feedbacks(reader,tenant,space,p.id(),u.id(),0,20).items().size());
  assertThrows(IdentityException.class,()->service.feedbacks(owner,tenant,space,p.id(),u.id(),0,20));
  service.withdraw(owner,tenant,space,p.id(),UUID.randomUUID(),p.revision());
  assertEquals(1,service.uses(reader,tenant,space,p.id(),0,20).items().size());
  assertEquals("EXPERIENCE_NOT_CURRENT",assertThrows(IdentityException.class,()->service.recordUse(reader,tenant,space,p.id(),UUID.randomUUID(),usage(p.version().id(),"new","DIRECT",true))).code);
  assertEquals(1,service.versions(owner,tenant,space,p.id(),0,20).items().size());
 }
 @Test void taskEvidenceNeverCopiesConversationAndTracksPrivateDependency(){
  UUID conv=UUID.randomUUID(),task=UUID.randomUUID();
  db.update("INSERT INTO conversations(id,tenant_id,workspace_id,owner_id,title) VALUES (?,?,?,?,'私人会话标题')",conv,tenant,personal,owner);
  db.update("INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,status) VALUES (?,?,?,?,?,'私人提示','SOURCE_LOOKUP','FAILED')",task,tenant,personal,conv,owner);
  db.update("INSERT INTO conversation_originals(tenant_id,workspace_id,task_id,material_id,version_id) VALUES (?,?,?,?,?)",tenant,personal,task,material,version);
  var e=service.create(owner,tenant,space,UUID.randomUUID(),content("SOURCE_BOUND"),List.of(new ExperienceService.Evidence("TASK",task,personal)));
  assertEquals(2,e.version().evidence().size());assertFalse(json.writeValueAsString(e).contains("私人提示"));
  publish(e);assertTrue(service.list(reader,tenant,space,"","",false,0,20).items().isEmpty());
  assertThrows(IdentityException.class,()->service.create(reader,tenant,personal,UUID.randomUUID(),content("SOURCE_BOUND"),List.of(new ExperienceService.Evidence("TASK",task,personal))));
 }
 @Test void indexedSearchAndPaginationWorkAtScale(){
  var first=publish(create("INDEPENDENT_COPY",false));String c=json.writeValueAsString(content("INDEPENDENT_COPY"));
  db.update("INSERT INTO experience_entries(id,tenant_id,workspace_id,created_by) SELECT gen_random_uuid(),?,?,? FROM generate_series(1,2000)",tenant,space,owner);
  db.update("INSERT INTO experience_versions(id,entry_id,number,content,access_mode,search_terms,tags,created_by) SELECT gen_random_uuid(),id,1,?::jsonb,'INDEPENDENT_COPY',ARRAY['common'],ARRAY['批量'],? FROM experience_entries e WHERE tenant_id=? AND NOT EXISTS(SELECT 1 FROM experience_versions v WHERE v.entry_id=e.id)",c,owner,tenant);
  db.update("UPDATE experience_entries e SET status='PUBLISHED',published_version=v.id FROM experience_versions v WHERE v.entry_id=e.id AND e.tenant_id=?",tenant);
  db.update("UPDATE experience_versions SET search_terms=ARRAY['uniquerareterm'] WHERE id=?",first.version().id());db.execute("ANALYZE experience_versions");
  var a=service.list(reader,tenant,space,"","",false,0,20);var b=service.list(reader,tenant,space,"","",false,20,20);assertTrue(a.hasMore());assertEquals(20,b.items().size());assertTrue(Collections.disjoint(a.items().stream().map(ExperienceService.Summary::id).toList(),b.items().stream().map(ExperienceService.Summary::id).toList()));
  assertEquals(1,service.list(reader,tenant,space,"uniquerareterm","",false,0,20).items().size());
  String plan=String.join("\n",db.queryForList("EXPLAIN SELECT id FROM experience_versions WHERE search_terms @> ARRAY['uniquerareterm']",String.class));assertTrue(plan.contains("experience_search"),plan);
 }
 @Test void sourceRevocationAndMaintenanceRevocationApplyToReplays(){
  UUID sourceSpace=UUID.randomUUID();db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'受限来源','SHARED')",sourceSpace,tenant,owner);
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",tenant,sourceSpace,owner);
  var file=materials.upload(owner,tenant,sourceSpace,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","source.txt","text/plain","private".getBytes()));
  UUID sv=materials.detail(owner,tenant,sourceSpace,file.id(),0,20).versions().getFirst().id();UUID key=UUID.randomUUID();var refs=List.of(new ExperienceService.Evidence("MATERIAL_VERSION",sv,sourceSpace));
  var e=service.create(owner,tenant,space,key,content("SOURCE_BOUND"),refs);publish(e);
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",sourceSpace,owner);
  assertTrue(service.list(owner,tenant,space,"","",false,0,20).items().isEmpty());
  assertThrows(IdentityException.class,()->service.get(owner,tenant,space,e.id(),e.version().id()));
  assertThrows(IdentityException.class,()->service.create(owner,tenant,space,key,content("SOURCE_BOUND"),refs));
  var copy=create("INDEPENDENT_COPY",false);UUID revise=UUID.randomUUID();var revised=service.revise(owner,tenant,space,copy.id(),revise,copy.revision(),content("INDEPENDENT_COPY"),List.of());
  db.update("DELETE FROM governance_capabilities WHERE account_id=?",owner);
  assertThrows(IdentityException.class,()->service.revise(owner,tenant,space,copy.id(),revise,copy.revision(),content("INDEPENDENT_COPY"),List.of()));
  assertEquals(2,revised.version().number());
 }
 @Test void malformedDraftAndForeignEvidenceFailBeforeAnyCandidateIsStored(){
  var c=content("INDEPENDENT_COPY");var invalid=new ExperienceService.Content(null,c.title(),c.summary(),c.body(),c.tags(),c.applicable(),c.excluded(),c.dependencies(),c.basis(),c.accessMode());
  assertEquals(400,assertThrows(IdentityException.class,()->service.create(owner,tenant,space,UUID.randomUUID(),invalid,List.of())).status);
  assertThrows(IdentityException.class,()->service.create(owner,tenant,space,UUID.randomUUID(),content("SOURCE_BOUND"),List.of(new ExperienceService.Evidence("MATERIAL_VERSION",UUID.randomUUID(),personal))));
  assertEquals(0,db.queryForObject("SELECT count(*) FROM experience_entries WHERE tenant_id=?",Integer.class,tenant));
 }
 @Test void taskReadGrantWithoutCitationRemainsASourceAndBlocksAfterRecycle(){
  UUID conversation=UUID.randomUUID(),task=UUID.randomUUID(),run=UUID.randomUUID(),chunk=UUID.randomUUID();
  db.update("INSERT INTO conversations(id,tenant_id,workspace_id,owner_id,title) VALUES (?,?,?,?,'来源追踪')",conversation,tenant,personal,owner);
  db.update("INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,status) VALUES (?,?,?,?,?,'合成请求','SOURCE_LOOKUP','FAILED')",task,tenant,personal,conversation,owner);
  db.update("INSERT INTO knowledge_runs(id,tenant_id,workspace_id,material_id,version_id,generation,requested_by,status) VALUES (?,?,?,?,?,1,?,'READY')",run,tenant,personal,material,version,owner);
  db.update("INSERT INTO knowledge_chunks(id,tenant_id,workspace_id,material_id,version_id,run_id,ordinal,locator,method,content) VALUES (?,?,?,?,?,?,0,'p1','TEXT','读过但未引用')",chunk,tenant,personal,material,version,run);
  db.update("INSERT INTO conversation_agent_grants(tenant_id,workspace_id,task_id,attempt_id,chunk_id) VALUES (?,?,?,?,?)",tenant,personal,task,UUID.randomUUID(),chunk);
  var e=service.create(owner,tenant,space,UUID.randomUUID(),content("SOURCE_BOUND"),List.of(new ExperienceService.Evidence("TASK",task,personal)));var published=publish(e);assertEquals(2,e.version().evidence().size());
  db.update("INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state) VALUES (?,?,'MATERIAL',?,'TRASHED')",tenant,personal,material);
  assertTrue(service.list(owner,tenant,space,"","",false,0,20).items().isEmpty());assertThrows(IdentityException.class,()->service.get(owner,tenant,space,e.id(),e.version().id()));assertTrue(service.versions(owner,tenant,space,e.id(),0,20).items().isEmpty());
  assertThrows(IdentityException.class,()->service.create(owner,tenant,space,UUID.randomUUID(),content("SOURCE_BOUND"),List.of(new ExperienceService.Evidence("TASK",task,personal))));
 }
 final class Client {
  final HttpClient http=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();
  HttpResponse<String> send(String method,String path,Object body,boolean csrf) throws Exception {var r=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).header("Content-Type","application/json");if(csrf){var t=json.readTree(send("GET","/api/v1/auth/csrf",null,false).body());r.header(t.get("headerName").asString(),t.get("token").asString());}return http.send(r.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build(),HttpResponse.BodyHandlers.ofString());}
 }
 @Test void realHttpRequiresSessionCsrfAndReturnsNoStore() throws Exception {
  Client client=new Client();String path="/api/v1/tenants/"+tenant+"/workspaces/"+space+"/experiences";assertEquals(401,client.send("GET",path,null,false).statusCode());
  assertEquals(200,client.send("POST","/api/v1/auth/login",Map.of("email",email(owner),"password",password),true).statusCode());
  var body=Map.of("requestId",UUID.randomUUID(),"content",content("INDEPENDENT_COPY"),"evidence",List.of());assertEquals(403,client.send("POST",path,body,false).statusCode());
  var response=client.send("POST",path,body,true);assertEquals(201,response.statusCode(),response.body());assertTrue(response.headers().firstValue("cache-control").orElse("").contains("no-store"));
  assertEquals(1,json.readTree(client.send("GET",path+"?maintenance=true",null,false).body()).get("items").size());
  var draft=json.readTree(response.body());UUID entry=UUID.fromString(draft.get("id").asString()),v=UUID.fromString(draft.get("version").get("id").asString());service.publish(owner,tenant,space,entry,UUID.randomUUID(),1,v,true);
  var conflict=client.send("POST",path+"/"+entry+"/publish",Map.of("requestId",UUID.randomUUID(),"expectedRevision",1,"versionId",v,"independentCopyConfirmed",true),true);assertEquals(409,conflict.statusCode());assertEquals("1.0",json.readTree(conflict.body()).get("contractVersion").asString());assertEquals("EXPERIENCE_STATE_CHANGED",json.readTree(conflict.body()).get("code").asString());
  String base="/api/v1/tenants/"+tenant+"/workspaces/"+personal;
  var notRestorable=client.send("POST",base+"/lifecycle/MATERIAL/"+material,Map.of("requestId",UUID.randomUUID(),"expectedRevision",0,"action","RESTORE"),true);assertEquals(409,notRestorable.statusCode());assertEquals("LIFECYCLE_NOT_RESTORABLE",json.readTree(notRestorable.body()).get("code").asString());
  for(String badPath:List.of(base+"/sources/not-a-uuid","/api/v1/tenants/"+tenant+"/attention?offset=-1")){var bad=client.send("GET",badPath,null,false);assertEquals(400,bad.statusCode());assertEquals("1.0",json.readTree(bad.body()).get("contractVersion").asString());assertEquals("INVALID_REQUEST",json.readTree(bad.body()).get("code").asString());}

 }
 @Test void independentMethodSurvivesButTaskBoundUseNotesFollowTaskSources(){
  UUID conversation=UUID.randomUUID(),task=UUID.randomUUID();db.update("INSERT INTO conversations(id,tenant_id,workspace_id,owner_id,title) VALUES (?,?,?,?,'合成任务')",conversation,tenant,personal,owner);db.update("INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,status) VALUES (?,?,?,?,?,'合成请求','SOURCE_LOOKUP','FAILED')",task,tenant,personal,conversation,owner);
  db.update("INSERT INTO conversation_originals(tenant_id,workspace_id,task_id,material_id,version_id) VALUES (?,?,?,?,?)",tenant,personal,task,material,version);
  var e=publish(create("INDEPENDENT_COPY",false));var use=service.recordUse(owner,tenant,space,e.id(),UUID.randomUUID(),new ExperienceService.UseInput(e.version().id(),task,"source-bound-usage","ADAPTED",true,"仅本任务实际资料条件","用户整理调整"));service.feedback(owner,tenant,space,e.id(),use.id(),UUID.randomUUID(),"UNKNOWN","含本任务资料的后续说明");assertEquals(1,service.uses(owner,tenant,space,e.id(),0,20).items().size());
  db.update("INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state) VALUES (?,?,'MATERIAL',?,'TRASHED')",tenant,personal,material);
  assertEquals(e.version().id(),service.get(owner,tenant,space,e.id(),null).version().id());assertTrue(service.uses(owner,tenant,space,e.id(),0,20).items().isEmpty());assertThrows(IdentityException.class,()->service.feedbacks(owner,tenant,space,e.id(),use.id(),0,20));
 }

}
