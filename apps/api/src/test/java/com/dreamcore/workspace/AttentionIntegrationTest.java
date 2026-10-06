package com.dreamcore.workspace;
import com.dreamcore.workspace.attention.AttentionService;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.source.SourceService;
import com.dreamcore.workspace.material.MaterialService;
import java.time.LocalDate;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import static org.junit.jupiter.api.Assertions.*;
@SpringBootTest(properties={"dreamcore.tasks.enabled=false","dreamcore.knowledge.enabled=false","dreamcore.lifecycle.enabled=false"})
class AttentionIntegrationTest {
 @Autowired com.dreamcore.workspace.plans.PlanService plans;
 @Autowired AttentionService attention;@Autowired JdbcTemplate db;@Autowired SourceService sources;@Autowired MaterialService materials;
 @Autowired com.dreamcore.workspace.conversation.ConversationService conversations;
 @Test void navigationConversationSignalIsPersonalAndClearsAfterHandlingOrTrash(){
  assertFalse(conversations.hasUnreadOrAttention(owner,tenant));
  UUID t=task(owner,personal,"WAITING_INPUT");
  assertTrue(conversations.hasUnreadOrAttention(owner,tenant));
  assertFalse(conversations.hasUnreadOrAttention(reader,tenant));
  assertFalse(conversations.hasUnreadOrAttention(admin,tenant));
  db.update("UPDATE conversation_tasks SET status='RUNNING' WHERE id=?",t);
  assertFalse(conversations.hasUnreadOrAttention(owner,tenant));
  db.update("UPDATE conversation_tasks SET status='SUCCEEDED',reply='合成回复' WHERE id=?",t);
  db.update("UPDATE conversations SET reply_revision=1,latest_reply_task_id=? WHERE id=(SELECT conversation_id FROM conversation_tasks WHERE id=?)",t,t);
  assertTrue(conversations.hasUnreadOrAttention(owner,tenant));
  db.update("UPDATE conversations SET read_reply_revision=1 WHERE latest_reply_task_id=?",t);
  assertFalse(conversations.hasUnreadOrAttention(owner,tenant));
  db.update("UPDATE conversation_tasks SET status='RESULT_UNKNOWN' WHERE id=?",t);
  assertTrue(conversations.hasUnreadOrAttention(owner,tenant));
  db.update("UPDATE conversations SET trashed_at=now() WHERE latest_reply_task_id=?",t);
  assertFalse(conversations.hasUnreadOrAttention(owner,tenant));
  assertThrows(IdentityException.class,()->conversations.hasUnreadOrAttention(owner,UUID.randomUUID()));
 }
 UUID tenant,owner,reader,admin,personal,shared;
 @BeforeEach void setup(){tenant=UUID.randomUUID();owner=UUID.randomUUID();reader=UUID.randomUUID();admin=UUID.randomUUID();personal=UUID.randomUUID();shared=UUID.randomUUID();db.update("INSERT INTO tenants(id,name) VALUES (?,'合成待办企业')",tenant);for(UUID u:List.of(owner,reader,admin)){db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,'unused')",u,u+"@attention.test","合成成员");db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,u,u.equals(admin)?"TENANT_ADMIN":"MEMBER");}db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'个人','PERSONAL'),(?,?,?,'共享','SHARED')",personal,tenant,owner,shared,tenant,admin);db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true),(?,?,?,false)",tenant,shared,owner,tenant,shared,reader);}
 @AfterEach void cleanup(){db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);db.update("UPDATE ongoing_plans SET status='STOPPED' WHERE tenant_id=?",tenant);}
 UUID task(UUID user,UUID space,String status){UUID id=UUID.randomUUID(),c=UUID.randomUUID();db.update("INSERT INTO conversations(id,tenant_id,workspace_id,owner_id,title) VALUES (?,?,?,?,'合成任务')",c,tenant,space,user);db.update("INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,execution_class,status,attempt) VALUES (?,?,?,?,?,'synthetic','AGENT','verification',?,1)",id,tenant,space,c,user,status);return id;}
 SourceService.Source source(UUID workspace,UUID responsible){LocalDate d=LocalDate.of(2026,9,1);return sources.create(owner,tenant,workspace,UUID.randomUUID(),new SourceService.Settings("需要九月资料","",responsible,24,d,d.plusDays(29),"ACTIVE"));}
 @Test void onlyActualHumanActionsAppearAndPaginationPreservesCount(){for(String state:List.of("RUNNING","WAITING_CAPABILITY","QUEUED","CANCELLED","SUCCEEDED","PAUSED"))task(owner,personal,state);for(int i=0;i<8;i++)task(owner,personal,"WAITING_INPUT");UUID unknown=task(owner,personal,"RESULT_UNKNOWN");task(owner,personal,"PARTIAL");var p=attention.list(owner,tenant,false,0,6);assertEquals(10,p.total());assertEquals(6,p.items().size());assertEquals(unknown,p.items().getFirst().id());assertTrue(p.hasMore());var q=attention.list(owner,tenant,false,6,6);assertEquals(4,q.items().size());assertFalse(q.hasMore());assertEquals(10,new HashSet<>(java.util.stream.Stream.concat(p.items().stream(),q.items().stream()).map(AttentionService.Item::id).toList()).size());assertEquals(10,attention.list(owner,tenant,false,500,6).total());}
 @Test void ownershipAndMaintenanceAreDistinctAndRoleNeverRevealsPrivateWork(){task(owner,shared,"WAITING_INPUT");task(owner,personal,"RESULT_UNKNOWN");source(shared,reader);assertEquals(1,attention.list(reader,tenant,false,0,50).total());assertEquals("SOURCE",attention.list(reader,tenant,false,0,50).items().getFirst().kind());assertEquals(2,attention.list(owner,tenant,false,0,50).total());assertEquals(1,attention.list(owner,tenant,true,0,50).total());assertEquals(0,attention.list(reader,tenant,true,0,50).total());assertEquals(0,attention.list(admin,tenant,true,0,50).total());assertEquals(0,attention.list(admin,tenant,false,0,50).total());}
 @Test void originalSourceCompletionAndWithdrawalUpdateBothProjections(){var s=source(shared,owner);assertEquals(1,attention.list(owner,tenant,false,0,50).total());var file=materials.upload(owner,tenant,shared,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","september.txt","text/plain","synthetic data".getBytes()));UUID v=materials.detail(owner,tenant,shared,file.id(),0,20).versions().getFirst().id();var submission=sources.submit(owner,tenant,shared,s.id(),UUID.randomUUID(),s.expectedFrom(),s.expectedThrough(),"本周期已交",List.of(v));assertEquals(0,attention.list(owner,tenant,false,0,50).total());assertEquals(0,attention.list(owner,tenant,true,0,50).total());db.update("UPDATE business_source_submissions SET status='WITHDRAWN' WHERE id=?",submission.id());assertEquals(1,attention.list(owner,tenant,false,0,50).total());assertEquals(1,attention.list(owner,tenant,true,0,50).total());}
 @Test void unrelatedHistoricSubmissionDoesNotPostponeCurrentDueDate(){var s=source(shared,owner);db.update("UPDATE business_sources SET due_anchor_at=now()-interval '2 days' WHERE id=?",s.id());var file=materials.upload(owner,tenant,shared,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","old.txt","text/plain","old synthetic data".getBytes()));UUID v=materials.detail(owner,tenant,shared,file.id(),0,20).versions().getFirst().id();sources.submit(owner,tenant,shared,s.id(),UUID.randomUUID(),LocalDate.of(2025,1,1),LocalDate.of(2025,1,31),"历史补交",List.of(v));var item=attention.list(owner,tenant,false,0,50).items().getFirst();assertEquals("OVERDUE",item.state());assertEquals(sources.get(owner,tenant,shared,s.id()).dueAt(),item.dueAt());}
 @Test void revocationImmediatelyRemovesTitlesAndCountsAndReadDoesNotMutate(){UUID id=task(owner,shared,"WAITING_INPUT");source(shared,owner);var before=db.queryForMap("SELECT status,revision FROM conversation_tasks WHERE id=?",id);for(int i=0;i<3;i++)assertEquals(2,attention.list(owner,tenant,false,0,50).total());assertEquals(before,db.queryForMap("SELECT status,revision FROM conversation_tasks WHERE id=?",id));db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",shared,owner);assertEquals(0,attention.list(owner,tenant,false,0,50).total());assertTrue(attention.list(owner,tenant,true,0,50).items().isEmpty());db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,owner);assertThrows(IdentityException.class,()->attention.list(owner,tenant,false,0,50));}
 @Test void planProjectionRequiresHumanActionAndFollowsRealPlanPause(){
  var c=new com.dreamcore.workspace.plans.PlanService.Configuration(personal,"核对持续资料","仅本人查看资料缺口","数据","ANALYZE",true,null,"Asia/Shanghai",60,4,10,java.time.Instant.now().plusSeconds(86400),true);
  var p=plans.create(owner,tenant,UUID.randomUUID(),c);p=plans.action(owner,tenant,p.id(),UUID.randomUUID(),p.revision(),"ENABLE",true);plans.tick(p.id());
  var found=attention.list(owner,tenant,false,0,50);assertEquals(1,found.total());assertEquals("PLAN",found.items().getFirst().kind());assertEquals("MISSING_DATA",found.items().getFirst().state());
  assertEquals(0,attention.list(admin,tenant,false,0,50).total());assertEquals(0,attention.list(owner,tenant,true,0,50).total());
  p=plans.get(owner,tenant,p.id());plans.action(owner,tenant,p.id(),UUID.randomUUID(),p.revision(),"PAUSE",true);assertEquals(0,attention.list(owner,tenant,false,0,50).total());
 }

}
