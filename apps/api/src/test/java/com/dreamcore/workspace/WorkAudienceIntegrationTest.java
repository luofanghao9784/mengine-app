package com.dreamcore.workspace;
import com.dreamcore.workspace.audience.*;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.context.*;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.profile.*;
import com.dreamcore.workspace.knowledge.*;
import com.dreamcore.workspace.material.*;
import com.dreamcore.workspace.briefing.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import static org.junit.jupiter.api.Assertions.*;
@SpringBootTest(properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=verification","dreamcore.tasks.initial-delay-ms=3600000","dreamcore.knowledge.enabled=true","dreamcore.knowledge.initial-delay-ms=3600000","dreamcore.briefing.merge-seconds=0"})
class WorkAudienceIntegrationTest {
 @Autowired WorkAudienceService roles;@Autowired JdbcTemplate db;@Autowired ConversationService conversations;@Autowired AgentTaskService agents;@Autowired TaskContextService contexts;@Autowired ProfileService profiles;@Autowired BriefingGenerationService generation;@Autowired MaterialService materials;@Autowired KnowledgeService knowledge;
 UUID tenant,owner,admin,worker,space;
 @BeforeEach void setup(){tenant=UUID.randomUUID();owner=UUID.randomUUID();admin=UUID.randomUUID();worker=UUID.randomUUID();space=UUID.randomUUID();db.update("INSERT INTO tenants(id,name) VALUES (?,'合成岗位宠物店')",tenant);for(UUID a:List.of(owner,admin,worker)){db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成员工','unused')",a,a+"@roles.test");db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,a,a.equals(admin)?"TENANT_ADMIN":"MEMBER");}db.update("INSERT INTO tenant_governance(tenant_id,owner_id) VALUES (?,?)",tenant,owner);db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'合成共享工作','SHARED')",space,tenant,owner);for(UUID a:List.of(owner,worker))db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",tenant,space,a);}
 @AfterEach void cleanup(){db.update("UPDATE briefing_generation_policies SET enabled=false WHERE tenant_id=?",tenant);db.update("UPDATE briefing_generation_batches SET status='CANCELLED' WHERE tenant_id=? AND status IN ('RUNNING','QUEUED')",tenant);db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);db.update("UPDATE knowledge_runs SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);}
 WorkAudienceService.Change change(UUID request,int rev,String title,List<String> focus){return new WorkAudienceService.Change(request,rev,"门店服务",title,"核对预约、准备洗护，异常情况找负责人确认",focus);}
 ConversationService.Job job(UUID actor){conversations.submit(actor,tenant,null,space,UUID.randomUUID(),"今天该留意什么","AGENT");return conversations.claim();}
 @Test void actualOwnerAdminAndWorkerHaveDifferentDefaultsAndNoInferredJob(){
  assertEquals("OWNER",roles.current(owner,tenant).role());assertTrue(roles.current(owner,tenant).focus().contains("OPERATIONS"));
  assertEquals("ADMIN",roles.current(admin,tenant).role());assertEquals(List.of("TEAM","COMPLIANCE"),roles.current(admin,tenant).focus());
  var c=roles.current(worker,tenant);assertEquals("MEMBER",c.role());assertTrue(c.jobTitle().isEmpty());assertTrue(c.focus().isEmpty());assertFalse(c.authority());
  assertEquals(1,roles.list(worker,tenant).members().size());assertEquals(worker,roles.list(worker,tenant).members().getFirst().accountId());assertEquals(3,roles.list(owner,tenant).members().size());
 }
 @Test void saveIsScopedAuditedIdempotentAndCannotBeUsedToPromoteOneself(){
  var request=UUID.randomUUID();var c=change(request,0,"美容师",List.of("SERVICE"));
  assertThrows(IdentityException.class,()->roles.save(worker,tenant,worker,c));
  assertEquals(1,roles.save(admin,tenant,worker,c).revision());assertEquals(1,roles.save(admin,tenant,worker,c).revision());
  assertEquals("MEMBER",roles.current(worker,tenant).role());assertEquals("美容师",roles.current(worker,tenant).jobTitle());assertEquals(List.of("SERVICE"),roles.current(worker,tenant).focus());
  assertThrows(IdentityException.class,()->roles.save(owner,tenant,worker,change(UUID.randomUUID(),0,"旧版本",List.of("TEAM"))));
  assertThrows(IdentityException.class,()->roles.save(owner,UUID.randomUUID(),worker,c));assertThrows(IdentityException.class,()->roles.current(UUID.randomUUID(),tenant));
  assertThrows(IdentityException.class,()->roles.save(owner,tenant,worker,change(UUID.randomUUID(),1,"角色",List.of("GRANT_ALL"))));
 }
 @Test void responsibilitiesCanSupplyTopicHintsWithoutASelectedFocus(){roles.save(owner,tenant,worker,change(UUID.randomUUID(),0,"美容师",List.of()));assertTrue(roles.current(worker,tenant).focus().contains("SERVICE"));assertEquals("MEMBER",roles.current(worker,tenant).role());}
 @Test void savingUnchangedDutiesDoesNotHideCardsOrFenceRunningWork(){
  roles.save(owner,tenant,worker,change(UUID.randomUUID(),0,"美容师",List.of("SERVICE")));var a=job(worker);agents.check(a.id(),a.token());String key=roles.key(worker,tenant);
  assertEquals(1,roles.save(owner,tenant,worker,change(UUID.randomUUID(),1,"美容师",List.of("SERVICE"))).revision());assertEquals(key,roles.key(worker,tenant));assertTrue((Boolean)agents.check(a.id(),a.token()).get("allowed"));
 }
 @Test void taskUsesRecipientAndChangingDutiesFencesAnInFlightAnswer(){
  var a=job(worker);var c=(WorkAudienceService.Context)agents.check(a.id(),a.token()).get("workAudience");assertEquals("MEMBER",c.role());assertEquals(1,db.queryForObject("SELECT count(*) FROM task_audience_snapshots WHERE task_id=?",Integer.class,a.id()));
  roles.save(owner,tenant,worker,change(UUID.randomUUID(),0,"美容师",List.of("SERVICE")));
  assertEquals("TASK_CONTEXT_CHANGED",assertThrows(IdentityException.class,()->agents.check(a.id(),a.token())).code);assertFalse(db.queryForObject("SELECT task_audience_current(?)",Boolean.class,a.id()));
  // A new task receives the new role; no other person's conversations are distributed.
  db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE id=?",a.id());var b=job(worker);assertEquals("美容师",((WorkAudienceService.Context)agents.check(b.id(),b.token()).get("workAudience")).jobTitle());assertThrows(IdentityException.class,()->conversations.detail(owner,tenant,b.conversation(),0,20));
 }
 @Test void actualMembershipChangeAlsoInvalidatesPinnedRole(){var a=job(worker);agents.check(a.id(),a.token());db.update("UPDATE tenant_memberships SET role='TENANT_ADMIN' WHERE tenant_id=? AND account_id=?",tenant,worker);assertFalse(db.queryForObject("SELECT task_audience_current(?)",Boolean.class,a.id()));assertThrows(IdentityException.class,()->agents.check(a.id(),a.token()));}
 @Test void enterpriseBackgroundIsAutomaticallyLoadedAndItsRevisionIsFenced(){
  var v=profiles.create(owner,tenant,ProfileService.Scope.TENANT,tenant,"business.background",ProfileService.Kind.FACT,new ProfileService.Content("合成宠物洗护门店","合成测试",ProfileService.Status.ACTIVE,null),UUID.randomUUID());
  // Company-managed entries use this namespace and cannot be created through the generic profile editor.
  db.update("UPDATE profile_entries SET entry_key='company.test-background' WHERE id=?",v.id());
  var a=job(worker);var r=contexts.context(a.id(),a.token(),new TaskContextService.Request("bootstrap",null,null,null,null,null,null,null,null,null,null));assertTrue(r.toString().contains("合成宠物洗护门店"));
  profiles.save(owner,tenant,v.id(),1,new ProfileService.Content("变更后的企业背景","合成修改",ProfileService.Status.ACTIVE,null),UUID.randomUUID());assertThrows(IdentityException.class,()->agents.check(a.id(),a.token()));
 }
 @Test void configuredFocusRanksActualAllowedSourcesButDoesNotOpenAdminSources(){
  roles.save(owner,tenant,worker,change(UUID.randomUUID(),0,"美容师",List.of("SERVICE")));
  var c=roles.current(worker,tenant);assertTrue(roles.sourceScore(c,"宠物美容预约操作")>roles.sourceScore(c,"财务收支报表"));
  assertThrows(IdentityException.class,()->conversations.submit(admin,tenant,null,space,UUID.randomUUID(),"查看服务资料","AGENT"));
  for(String name:List.of("美容预约操作.txt","财务收支.txt","人员排班.txt","营销活动.txt")){
   materials.upload(owner,tenant,space,null,null,null,UUID.randomUUID(),new MockMultipartFile("file",name,"text/plain",("合成测试 "+name).getBytes(java.nio.charset.StandardCharsets.UTF_8)));var parse=knowledge.claim();assertNotNull(parse);knowledge.finish(parse,new DocumentParser.Result("synthetic","READY",List.of(),List.of(new DocumentParser.Fragment("L1","合成测试服务内容","TEXT"))));
  }
  var batch=generation.generate(worker,tenant,UUID.randomUUID(),space,"INSIGHT");var policy=generation.state(worker,tenant).policies().stream().filter(p->p.workspaceId().equals(space)).findFirst().orElseThrow();generation.tick(policy.id());
  var detail=generation.get(worker,tenant,batch.id());assertNotNull(detail.taskId());assertEquals(roles.key(worker,tenant),db.queryForObject("SELECT audience_key FROM briefing_generation_batches WHERE id=?",String.class,batch.id()));
  String chosen=db.queryForObject("SELECT string_agg(v.filename,',') FROM conversation_originals o JOIN material_versions v ON v.id=o.version_id WHERE o.task_id=?",String.class,detail.taskId());assertTrue(chosen.contains("美容预约操作"));
  roles.save(owner,tenant,worker,change(UUID.randomUUID(),1,"财务",List.of("FINANCE")));assertFalse(db.queryForObject("SELECT task_audience_current(?)",Boolean.class,detail.taskId()));
 }
}
