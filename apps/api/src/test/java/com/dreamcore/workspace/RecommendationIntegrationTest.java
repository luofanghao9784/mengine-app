package com.dreamcore.workspace;
import com.dreamcore.workspace.recommendation.*;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.document.*;
import com.dreamcore.workspace.feedback.*;
import com.dreamcore.workspace.identity.*;
import java.util.*;
import java.time.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;
@SpringBootTest(properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=verification","dreamcore.tasks.initial-delay-ms=3600000","dreamcore.knowledge.initial-delay-ms=3600000"})
class RecommendationIntegrationTest {
 @Autowired com.dreamcore.workspace.attention.AttentionService attention;@Autowired com.dreamcore.workspace.briefing.BriefingService briefings;@Autowired RecommendationService recommendations;@Autowired ConversationService conversations;@Autowired AgentTaskService agents;@Autowired DocumentService documents;@Autowired DocumentPublicationService publications;@Autowired FeedbackService feedback;@Autowired JdbcTemplate db;
 UUID tenant,owner,reader,admin,personal,shared;
 @BeforeEach void setup(){tenant=UUID.randomUUID();owner=UUID.randomUUID();reader=UUID.randomUUID();admin=UUID.randomUUID();personal=UUID.randomUUID();shared=UUID.randomUUID();db.update("INSERT INTO tenants(id,name) VALUES (?,'合成推荐企业')",tenant);for(UUID u:List.of(owner,reader,admin)){db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,'unused')",u,u+"@recommendation.test","合成成员");db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,u,u.equals(admin)?"TENANT_ADMIN":"MEMBER");}db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'本人任务','PERSONAL'),(?,?,?,'企业发布','SHARED')",personal,tenant,owner,shared,tenant,admin);db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true),(?,?,?,false)",tenant,shared,owner,tenant,shared,reader);}
 @AfterEach void cleanup(){db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);}
 ConversationService.Detail result(String title){var d=conversations.submit(owner,tenant,null,personal,UUID.randomUUID(),title,"AGENT");var j=conversations.claim();assertNotNull(j);assertEquals(d.tasks().getFirst().id(),j.id());agents.finish(j,new AgentResult("1.4","0.12.0",j.id(),j.token(),"AGENT","verification","synthetic","合成正文，仅用于流程验证。必要限制必须保留。",List.of(),List.of(),List.of(),1,null,List.of(),List.of(),List.of()));return conversations.historical(owner,tenant,j.conversation(),j.id());}
 RecommendationService.Page list(UUID actor){return recommendations.list(actor,tenant,null,0,20,null);}
 RecommendationService.Target target(RecommendationService.Item item){var c=item.content();return new RecommendationService.Target(c.kind(),c.id(),c.versionKey());}
 DocumentPublicationService.Publication publish(ConversationService.Detail d){var document=documents.create(owner,tenant,d.conversation().id(),d.tasks().getFirst().id(),null,UUID.randomUUID());return publications.publish(owner,tenant,document.document().id(),1,UUID.randomUUID(),shared,null,null,null,"docx",true);}
 @Test void authorizedPoolContainsPrivateOwnerResultsAndIndependentSharedCopyOnly(){var d=result("私人提示不可给其他人");var published=publish(d);assertEquals(2,list(owner).rankedCount());var read=list(reader);assertEquals(1,read.rankedCount());assertEquals("PUBLICATION",read.items().getFirst().content().kind());assertNull(read.items().getFirst().content().conversationId());assertEquals(published.materialVersionId(),read.items().getFirst().content().id());assertEquals(0,list(admin).rankedCount());db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,owner);assertEquals(1,list(reader).rankedCount());assertEquals("NOT_ASSESSED",read.businessOutcome());}
 @Test void completePoolIsRankedBeforePaginationAndSnapshotsDetectCurrentChanges(){
  var first=result("旧但明确关注的成果");result("新成果");
  db.update("UPDATE conversation_tasks SET finished_at=now()-interval '40 days' WHERE id=?",first.tasks().getFirst().id());
  db.update("INSERT INTO briefing_preferences(tenant_id,workspace_id,conversation_id,owner_id,pinned,revision) VALUES (?,?,?,?,true,1)",tenant,personal,first.conversation().id(),owner);
  var a=recommendations.list(owner,tenant,null,0,1,null);
  assertEquals(first.tasks().getFirst().id(),a.items().getFirst().content().id());assertTrue(a.hasMore());
  var b=recommendations.list(owner,tenant,null,1,1,a.snapshot());
  assertFalse(b.hasMore());assertNotEquals(a.items().getFirst().content().id(),b.items().getFirst().content().id());
  recommendations.opened(owner,tenant,target(a.items().getFirst()));
  var refreshed=recommendations.list(owner,tenant,null,0,1,null);
  assertEquals(a.items().getFirst().content().id(),refreshed.items().getFirst().content().id());
  assertEquals(a.items().getFirst().score(),refreshed.items().getFirst().score());
  assertEquals(a.items().getFirst().method(),refreshed.items().getFirst().method());
  assertNotNull(refreshed.items().getFirst().content().openedAt());assertEquals(a.snapshot(),refreshed.snapshot());
  assertEquals(b.items().getFirst().content().id(),recommendations.list(owner,tenant,null,1,1,a.snapshot()).items().getFirst().content().id());
  db.update("UPDATE briefing_preferences SET pinned=false,revision=revision+1 WHERE conversation_id=?",first.conversation().id());
  assertEquals("RECOMMENDATION_SNAPSHOT_CHANGED",assertThrows(IdentityException.class,()->recommendations.list(owner,tenant,null,1,1,a.snapshot())).code);
 }
 @Test void openingMixedCandidatesKeepsTheirValueOrderAndExistingPagination(){
  var original=result("独立发布来源");publish(original);
  for(int i=0;i<4;i++)result("合成结果 "+i);
  var before=list(owner);assertEquals(6,before.items().size());
  assertTrue(before.items().stream().anyMatch(i->i.content().kind().equals("PUBLICATION")));
  var expectedIds=before.items().stream().map(i->i.content().id()).toList();
  var expectedScores=before.items().stream().map(RecommendationService.Item::score).toList();
  for(var item:before.items()){
   var observed=recommendations.opened(owner,tenant,target(item));
   assertEquals(observed,recommendations.opened(owner,tenant,target(item)));
   var refreshed=list(owner);
   assertEquals(expectedIds,refreshed.items().stream().map(i->i.content().id()).toList());
   assertEquals(expectedScores,refreshed.items().stream().map(RecommendationService.Item::score).toList());
   assertEquals(before.snapshot(),refreshed.snapshot());
  }
  var first=recommendations.list(owner,tenant,null,0,2,null);
  var second=recommendations.list(owner,tenant,null,2,2,before.snapshot());
  var third=recommendations.list(owner,tenant,null,4,2,before.snapshot());
  var actualIds=new ArrayList<UUID>();
  for(var page:List.of(first,second,third)){
   actualIds.addAll(page.items().stream().map(i->i.content().id()).toList());
   assertTrue(page.items().stream().allMatch(i->i.content().openedAt()!=null));
   assertEquals(6,page.eligibleTotal());assertEquals(6,page.rankedCount());
  }
  assertEquals(expectedIds,actualIds);assertTrue(first.hasMore());assertTrue(second.hasMore());assertFalse(third.hasMore());
  assertEquals(6,db.queryForObject("SELECT count(*) FROM delivery_observations WHERE tenant_id=? AND actor_id=?",Integer.class,tenant,owner));
  var task=before.items().stream().filter(i->i.content().kind().equals("TASK")).findFirst().orElseThrow();
  db.update("UPDATE conversation_tasks SET revision=revision+1 WHERE id=?",task.content().id());
  assertEquals("RECOMMENDATION_SNAPSHOT_CHANGED",assertThrows(IdentityException.class,()->recommendations.list(owner,tenant,null,2,2,before.snapshot())).code);
 }
 @Test void turningOffRecommendationDoesNotCancelTasksOrRemoveDirectAccessAndLostSettingsReceiptIsExact(){var d=result("明确交付");UUID key=UUID.randomUUID();var off=recommendations.configure(owner,tenant,key,0,false);assertEquals(1,off.revision());assertTrue(list(owner).items().isEmpty());assertEquals("SUCCEEDED",conversations.historical(owner,tenant,d.conversation().id(),d.tasks().getFirst().id()).tasks().getFirst().status());recommendations.configure(owner,tenant,UUID.randomUUID(),1,true);assertEquals(off,recommendations.configure(owner,tenant,key,0,false));assertTrue(recommendations.settings(owner,tenant).enabled());assertEquals(1,list(owner).items().size());}
 @Test void openingIsVersionSpecificIdempotentAndNotBusinessCompletion(){var d=result("打开明确版本");var item=list(owner).items().getFirst();var one=recommendations.opened(owner,tenant,target(item));var two=recommendations.opened(owner,tenant,target(item));assertEquals(one,two);assertEquals("USER_OPEN_ACTION",one.evidence());assertEquals("NOT_ASSESSED",one.businessOutcome());assertEquals(1,db.queryForObject("SELECT count(*) FROM delivery_observations WHERE tenant_id=?",Integer.class,tenant));assertThrows(IdentityException.class,()->recommendations.opened(reader,tenant,target(item)));db.update("UPDATE conversation_tasks SET revision=revision+1 WHERE id=?",d.tasks().getFirst().id());assertNull(list(owner).items().getFirst().content().openedAt());assertEquals("DELIVERY_VERSION_CHANGED",assertThrows(IdentityException.class,()->recommendations.opened(owner,tenant,target(item))).code);}
 @Test void withdrawalOfPublicationPermissionBlocksOldOpeningAndNamesImmediately(){var d=result("合法发布");var p=publish(d);var item=list(reader).items().getFirst();recommendations.opened(reader,tenant,target(item));db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",shared,reader);assertEquals(0,list(reader).eligibleTotal());assertThrows(IdentityException.class,()->recommendations.opened(reader,tenant,target(item)));assertEquals(1,db.queryForObject("SELECT count(*) FROM delivery_observations WHERE tenant_id=? AND actor_id=?",Integer.class,tenant,reader));assertEquals(p.materialVersionId(),item.content().id());}
 @Test void explicitPresentationPreferenceChangesLayoutWithoutRewritingContent(){var d=result("按本人明确偏好呈现");var t=d.tasks().getFirst();var f=feedback.create(owner,tenant,UUID.randomUUID(),new FeedbackService.Target("TASK",t.id(),t.revision(),t.attempt(),"task-v1",0),new FeedbackService.Assessment("PARTIAL",List.of(),""));feedback.followUp(owner,tenant,f.id(),UUID.randomUUID(),f.revision(),new FeedbackService.FollowUp("PREFERENCE",true,new FeedbackService.Preference("GENERAL","TABLE_FIRST",0),null,null));var item=list(owner).items().getFirst();assertEquals("TABLE_FIRST",item.presentation().style());assertEquals(1,item.presentation().profileRevision());assertEquals(t.reply(),item.content().excerpt());assertEquals(0,list(reader).items().size());}
 @Test void latestTaskPerConversationAndHiddenPreferencesAreAppliedBeforeCount(){var d=result("唯一主线");conversations.submit(owner,tenant,d.conversation().id(),null,UUID.randomUUID(),"后续同一会话","AGENT");var j=conversations.claim();agents.finish(j,new AgentResult("1.4","0.12.0",j.id(),j.token(),"AGENT","verification","synthetic","新版结果",List.of(),List.of(),List.of(),1,null,List.of(),List.of(),List.of()));assertEquals(1,list(owner).eligibleTotal());assertEquals(j.id(),list(owner).items().getFirst().content().id());db.update("INSERT INTO briefing_preferences(tenant_id,workspace_id,conversation_id,owner_id,hidden,revision) VALUES (?,?,?,?,true,1)",tenant,personal,d.conversation().id(),owner);assertEquals(0,list(owner).eligibleTotal());assertEquals(2,conversations.detail(owner,tenant,d.conversation().id(),0,20).tasks().size());}
 @Test void independentLaterResultDoesNotRevealTitleCopiedFromUnavailableFirstTask(){
  var first=result("已停用首任务的敏感标题");conversations.submit(owner,tenant,first.conversation().id(),null,UUID.randomUUID(),"新独立任务","AGENT");var j=conversations.claim();agents.finish(j,new AgentResult("1.4","0.12.0",j.id(),j.token(),"AGENT","verification","synthetic","新独立结果",List.of(),List.of(),List.of(),1,null,List.of(),List.of(),List.of()));
  db.update("UPDATE object_lifecycle SET state='TRASHED' WHERE kind='TASK' AND object_id=?",first.tasks().getFirst().id());
  assertEquals("会话内容暂不可用",list(owner).items().getFirst().content().title());assertEquals(j.id(),list(owner).items().getFirst().content().id());
  var page=briefings.list(owner,tenant,null,"LATEST",null,"Asia/Shanghai",0,20);assertEquals("会话内容暂不可用",page.items().getFirst().title());
  assertEquals("会话内容暂不可用",conversations.detail(owner,tenant,j.conversation(),0,20).conversation().title());
  conversations.submit(owner,tenant,j.conversation(),null,UUID.randomUUID(),"后续待补充任务","AGENT");db.update("UPDATE conversation_tasks SET status='WAITING_INPUT' WHERE conversation_id=? AND status='QUEUED'",j.conversation());assertEquals("会话内容暂不可用",attention.list(owner,tenant,false,0,20).items().getFirst().title());
 }
 @Test void feedbackIsBoundToIssuedPresentationAndDoesNotBecomeABasicBriefingRating(){
  result("呈现版本追踪");var initial=list(owner).items().getFirst();var again=list(owner).items().getFirst();assertEquals(initial.feedbackTarget(),again.feedbackTarget());assertEquals("recommendation-v1",initial.feedbackTarget().presentationVersion());
  UUID key=UUID.randomUUID();var rating=new FeedbackService.Assessment("USEFUL",List.of(),"");var saved=feedback.create(owner,tenant,key,initial.feedbackTarget(),rating);
  feedback.followUp(owner,tenant,saved.id(),UUID.randomUUID(),1,new FeedbackService.FollowUp("PREFERENCE",true,new FeedbackService.Preference("GENERAL","TABLE_FIRST",0),null,null));
  var updated=list(owner).items().getFirst();assertNotEquals(initial.feedbackTarget().presentationRevision(),updated.feedbackTarget().presentationRevision());assertEquals(saved,feedback.create(owner,tenant,key,initial.feedbackTarget(),rating));
  assertThrows(IdentityException.class,()->feedback.create(owner,tenant,UUID.randomUUID(),new FeedbackService.Target("BRIEFING",initial.content().id(),initial.content().taskRevision(),initial.content().attempt(),"recommendation-v1",Integer.MAX_VALUE),rating));
  assertEquals("DEFAULT",db.queryForObject("SELECT presentation->>'style' FROM recommendation_presentations WHERE id=?",String.class,initial.feedbackTarget().presentationRevision()));
  assertEquals("TABLE_FIRST",db.queryForObject("SELECT presentation->>'style' FROM recommendation_presentations WHERE id=?",String.class,updated.feedbackTarget().presentationRevision()));
 }
 @org.junit.jupiter.params.ParameterizedTest @org.junit.jupiter.params.provider.ValueSource(booleans={false,true}) void declaredPoolWindowDoesNotPretendToRankAllHistory(boolean enabled){if(enabled)db.update("INSERT INTO library_permission_rollouts VALUES (?,true)",tenant);for(int i=0;i<1001;i++){UUID c=UUID.randomUUID(),t=UUID.randomUUID();db.update("INSERT INTO conversations(id,tenant_id,workspace_id,owner_id,title) VALUES (?,?,?,?,'合成历史')",c,tenant,personal,owner);db.update("INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,status,attempt,revision,reply,execution_class,finished_at) VALUES (?,?,?,?,?,'合成','AGENT','SUCCEEDED',1,2,'合成正文','verification',now())",t,tenant,personal,c,owner);}var p=list(owner);assertEquals(1001,p.eligibleTotal());assertEquals(1000,p.rankedCount());assertTrue(p.poolLimited());assertTrue(p.hasMore());}
}
