package com.dreamcore.workspace;

import com.dreamcore.workspace.activity.ActivityService;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.document.DocumentService;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.knowledge.*;
import com.dreamcore.workspace.material.*;
import com.dreamcore.workspace.plans.*;
import com.dreamcore.workspace.recommendation.RecommendationService;
import com.dreamcore.workspace.departure.DepartureAccess;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import static org.junit.jupiter.api.Assertions.*;

/** Tests the old public business services against actual persisted departure facts. */
@SpringBootTest(properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=verification","dreamcore.tasks.initial-delay-ms=3600000","dreamcore.knowledge.enabled=true","dreamcore.knowledge.initial-delay-ms=3600000"})
class DepartureBoundaryIntegrationTest {
 @org.springframework.test.context.DynamicPropertySource
 static void isolateQueue(org.springframework.test.context.DynamicPropertyRegistry registry) {
  IsolatedTestDatabase.register(registry);
 }
 @Autowired JdbcTemplate db; @Autowired MaterialService materials; @Autowired KnowledgeService knowledge;
 @Autowired IdentityService identities; @Autowired ConversationService conversations; @Autowired AgentTaskService agents;
 @Autowired ActivityService activity; @Autowired DocumentService documents; @Autowired PlanService plans;
 @Autowired PlanAttentionService attention; @Autowired RecommendationService recommendations; @Autowired DepartureAccess departure;
 @Autowired TenantAdminService admin;
 UUID tenant,actor,other,personal,shared,excluded;
 @BeforeEach void setup(){
  tenant=UUID.randomUUID();actor=UUID.randomUUID();other=UUID.randomUUID();personal=UUID.randomUUID();shared=UUID.randomUUID();excluded=UUID.randomUUID();
  for(UUID u:List.of(actor,other))db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,'synthetic-unusable')",u,u+"@example.test","合成退出边界");
  db.update("INSERT INTO tenants(id,name) VALUES (?,'合成退出企业')",tenant);
  for(UUID u:List.of(actor,other))db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'TENANT_ADMIN')",tenant,u);
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'私人空间','PERSONAL')",personal,tenant,actor);
  for(UUID w:List.of(shared,excluded)){db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'合成共享空间','SHARED')",w,tenant,actor);for(UUID u:List.of(actor,other))db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",tenant,w,u);}
  db.update("INSERT INTO governance_capabilities(tenant_id,account_id,capability,granted_by) VALUES (?,?,'BULK_EXPORT',?)",tenant,actor,actor);
 }
 @AfterEach void stop(){db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN('QUEUED','RUNNING')",tenant);db.update("UPDATE knowledge_runs SET status='CANCELLED' WHERE tenant_id=? AND status IN('QUEUED','RUNNING')",tenant);}
 void denied(int status,Runnable action){assertEquals(status,assertThrows(IdentityException.class,action::run).status);}
 MaterialService.Entry file(UUID w){var f=materials.upload(actor,tenant,w,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","synthetic.txt","text/plain","departure-evidence".getBytes(java.nio.charset.StandardCharsets.UTF_8)));var j=knowledge.claim();assertNotNull(j);assertEquals(tenant,j.tenant());assertEquals(f.id(),j.material());knowledge.finish(j,new DocumentParser.Result("synthetic","READY",List.of(),List.of(new DocumentParser.Fragment("L1","departure-evidence","TEXT"))));return f;}
 UUID exit(){UUID id=UUID.randomUUID();db.update("INSERT INTO departure_executions(id,tenant_id,kind,state,requested_by,reason,policy_key,policy_revision,effective_at,deadline,prior_tenant_status) VALUES (?,?,'TENANT_EXIT','EXPORT_WINDOW',?,'合成退出','TENANT_EXIT_WINDOW',0,now(),now()+interval '2 hours','ACTIVE')",id,tenant,actor);db.update("INSERT INTO departure_export_grants(execution_id,tenant_id,account_id,workspace_id) VALUES (?,?,?,?)",id,tenant,actor,shared);return id;}
 @Test void allSpaceListsFilterBeforePaginationAndCoverageEvenBeforeExitWorkerRuns(){
  file(shared);file(excluded);file(personal);exit();
  var page=materials.list(actor,tenant,null,null,"",0,1);assertEquals(1,page.items().size());assertEquals(shared,page.items().getFirst().workspaceId());assertFalse(page.hasMore());
  var hits=knowledge.search(actor,tenant,null,"departure",0,1);assertEquals(1,hits.items().size());assertEquals(1,hits.coverage().totalVersions());assertFalse(hits.hasMore());
  assertEquals(1,activity.list(actor,tenant,null,null,1).items().size());assertNull(activity.list(actor,tenant,null,null,1).nextCursor());
  assertEquals(List.of(shared),identities.context(actor,tenant).workspaces().stream().map(IdentityService.Workspace::id).toList());
  assertTrue(materials.list(other,tenant,null,null,"",0,1).items().isEmpty());assertEquals(0,knowledge.search(other,tenant,null,"departure",0,1).coverage().totalVersions());
  assertTrue(identities.context(other,tenant).workspaces().isEmpty());
  denied(404,()->materials.list(actor,tenant,excluded,null,"",0,20));denied(404,()->materials.list(actor,tenant,personal,null,"",0,20));
 }
 @Test void currentSharedExportRightNeverReopensPrivateConversationsOrNewWork(){
  var sent=conversations.submit(actor,tenant,null,shared,UUID.randomUUID(),"合成旧任务","AGENT");var running=conversations.claim();assertNotNull(running);exit();
  denied(403,()->conversations.detail(actor,tenant,sent.conversation().id(),0,20));denied(403,()->conversations.list(actor,tenant,0,20));
  denied(403,()->documents.list(actor,tenant,0,20));denied(403,()->plans.list(actor,tenant,0,20));denied(403,()->attention.list(actor,tenant,0,20));denied(403,()->recommendations.list(actor,tenant,null,0,20,null));
  denied(409,()->conversations.submit(actor,tenant,null,shared,UUID.randomUUID(),"不应执行的新任务","AGENT"));
  denied(409,()->materials.createFolder(actor,tenant,shared,null,"不应创建",UUID.randomUUID()));
  assertFalse(agents.active(running));assertFalse(departure.allowsTask(running.id()));
  assertThrows(IdentityException.class,()->agents.finish(running,new AgentResult("1.4","0.11.0",running.id(),running.token(),"AGENT","verification","synthetic","迟到结果不得写入",List.of(),List.of(),List.of(),1,null,List.of(),List.of(),List.of())));
  assertNull(db.queryForObject("SELECT reply FROM conversation_tasks WHERE id=?",String.class,running.id()));
 }
 @Test void exitDeadlineAndRevocationAreEffectiveWithoutWaitingForCleanup(){
  var f=file(shared);UUID id=exit();UUID version=db.queryForObject("SELECT id FROM material_versions WHERE material_id=?",UUID.class,f.id());assertTrue(materials.download(actor,tenant,shared,f.id(),version).bytes().length>0);
  db.update("DELETE FROM governance_capabilities WHERE tenant_id=? AND account_id=? AND capability='BULK_EXPORT'",tenant,actor);denied(404,()->materials.download(actor,tenant,shared,f.id(),version));
  db.update("INSERT INTO governance_capabilities(tenant_id,account_id,capability,granted_by) VALUES (?,?,'BULK_EXPORT',?)",tenant,actor,actor);
  db.update("UPDATE departure_executions SET effective_at=now()-interval '2 days',deadline=now()-interval '1 day' WHERE id=?",id);
  denied(404,()->materials.download(actor,tenant,shared,f.id(),version));assertTrue(materials.list(actor,tenant,null,null,"",0,20).items().isEmpty());
  denied(409,()->identities.invite(actor,tenant,UUID.randomUUID(),"new-"+UUID.randomUUID()+"@example.test"));denied(409,()->admin.createSpace(actor,tenant,UUID.randomUUID(),"不应恢复业务",actor,""));
 }
 @Test void ordinaryMemberEnableCannotUndoFormalOffboarding(){
  UUID id=UUID.randomUUID();db.update("INSERT INTO departure_executions(id,tenant_id,kind,target_account_id,state,requested_by,reason,policy_key,policy_revision,effective_at,deadline,prior_tenant_status,prior_member_status) VALUES (?,?,'MEMBER_OFFBOARD',?,'ISOLATED',?,'合成离职','OFFBOARD_ISOLATION',0,now(),now()+interval '30 days','ACTIVE','ACTIVE')",id,tenant,other,actor);db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,other);
  long revision=db.queryForObject("SELECT management_version FROM tenant_memberships WHERE tenant_id=? AND account_id=?",Long.class,tenant,other);
  denied(409,()->admin.status(actor,tenant,other,UUID.randomUUID(),revision,"ACTIVE"));assertEquals("DISABLED",db.queryForObject("SELECT status FROM tenant_memberships WHERE tenant_id=? AND account_id=?",String.class,tenant,other));
 }
}
