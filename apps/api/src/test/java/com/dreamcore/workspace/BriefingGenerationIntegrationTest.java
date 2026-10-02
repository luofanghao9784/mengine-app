package com.dreamcore.workspace;

import com.dreamcore.workspace.briefing.*;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.knowledge.*;
import com.dreamcore.workspace.material.*;
import com.dreamcore.workspace.recommendation.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=verification","dreamcore.knowledge.enabled=true","dreamcore.briefing.merge-seconds=0","dreamcore.tasks.public-web-enabled=true"})
class BriefingGenerationIntegrationTest {
 @Autowired JdbcTemplate db;@Autowired MaterialService materials;@Autowired KnowledgeService knowledge;
 @Autowired ConversationService conversations;@Autowired AgentTaskService agents;@Autowired BriefingContentService contents;
 @Autowired BriefingGenerationService generation;@Autowired BriefingCardService cards;@Autowired BriefingService feed;@Autowired RecommendationService recommendations;
 @Autowired AgentUsageLedger usage;
 UUID tenant,actor,reader,space;
 @BeforeEach void setup(){tenant=UUID.randomUUID();actor=UUID.randomUUID();reader=UUID.randomUUID();space=UUID.randomUUID();
  db.update("INSERT INTO tenants(id,name) VALUES (?,'合成画报生成验收')",tenant);
  for(UUID id:List.of(actor,reader)){db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成用户','unused')",id,id+"@example.test");db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,id);}
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'合成共享空间','SHARED')",space,tenant,actor);
  for(UUID id:List.of(actor,reader))db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",tenant,space,id);
 }
 @AfterEach void cleanup(){db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);db.update("UPDATE knowledge_runs SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);}
 MaterialService.UploadReceipt upload(String text,boolean ready){
  var f=materials.uploadReceipt(actor,tenant,space,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","evidence.txt","text/plain",text.getBytes(StandardCharsets.UTF_8)));
  if(ready){var j=knowledge.claim();assertEquals(f.acceptedVersion().id(),j.version());knowledge.finish(j,new DocumentParser.Result("synthetic","READY",List.of(),List.of(new DocumentParser.Fragment("L1",text,"TEXT"))));}return f;
 }
 UUID policy(){for(int i=0;i<50;i++){generation.discover();var found=generation.state(actor,tenant).policies();if(!found.isEmpty())return found.getFirst().id();}throw new AssertionError("bounded discovery did not reach fixture");}
 BriefingGenerationService.Batch manual(){return generation.generate(actor,tenant,UUID.randomUUID(),space,"INSIGHT");}
 void complete(ConversationService.Job j){db.update("UPDATE conversation_tasks SET status='SUCCEEDED',reply='合成完成结果，仅用于验证真实服务。',finished_at=now(),engine_version='synthetic',lease_token=NULL,lease_until=NULL WHERE id=?",j.id());}
 Map<String,Object> deliver(ConversationService.Job j,String summary){
  var sources=agents.search(j.id(),j.token(),"marker");agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.6",List.of("deliver_briefing")));
  agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,"deliver_briefing","STARTED"));
  var receipt=agents.deliverBriefing(j.id(),j.token(),new BriefingContentService.Request(null,"合成证据洞察画报",summary,List.of("这是有合成来源支持的第一段完整分析。","这是用于验证交付和历史保留的第二段分析。"),"INSIGHT"));
  agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,"deliver_briefing","succeeded"));
  agents.openUsage(j.id(),j.token());agents.startUsage(j.id(),j.token(),new AgentUsageLedger.Start(1,2048));usage.finish(j.id(),j.token(),new AgentUsageLedger.Receipt(1,"RETURNED",100L,50L));
  agents.finish(j,new AgentResult("1.5","0.15.4",j.id(),j.token(),"AGENT","verification","synthetic","合成系统交付确认。",sources.stream().map(AgentTaskService.Input::id).toList(),List.of(new AgentResult.Tool("delivery","deliver_briefing","succeeded")),List.of(),1,new AgentResult.Usage(100,50),List.of(),List.of(),List.of(),"COMPLETE",null));return receipt;
 }
 @Test void initializationNeedsNoConversationOrPersonalPlanAndIsDurable(){
  upload("marker 经营事实仅用于合成验收。",true);UUID policy=policy();generation.tick(policy);
  var b=generation.state(actor,tenant).batches().getFirst();assertEquals("INITIALIZATION",b.trigger());assertEquals("RUNNING",b.status());assertNotNull(b.taskId());
  assertEquals(0,db.queryForObject("SELECT count(*) FROM ongoing_plans WHERE tenant_id=?",Integer.class,tenant));
  generation.discover();generation.tick(policy);assertEquals(1,generation.state(actor,tenant).batches().size());
  var j=conversations.claim();assertEquals(b.taskId(),j.id());deliver(j,"第一份有合成来源支持的新经营洞察。");generation.tick(policy);
  assertEquals("SUCCEEDED",generation.get(actor,tenant,b.id()).status());generation.tick(policy);assertTrue(generation.state(actor,tenant).batches().stream().anyMatch(x->"SUGGESTION".equals(x.businessType())));
 }
 @Test void missingDataWaitsAndLaterReadyDataContinuesWithoutNewRequest(){
  var b=manual();UUID p=policy();generation.tick(p);assertEquals("WAITING_DATA",generation.get(actor,tenant,b.id()).status());
  var f=upload("marker 资料稍后到达。",false);generation.tick(p);assertEquals("MATERIALS_NOT_READY",generation.get(actor,tenant,b.id()).reason());
  var j=knowledge.claim();assertEquals(f.acceptedVersion().id(),j.version());knowledge.finish(j,new DocumentParser.Result("synthetic","READY",List.of(),List.of(new DocumentParser.Fragment("L1","marker 资料就绪。","TEXT"))));
  generation.tick(p);assertEquals("RUNNING",generation.get(actor,tenant,b.id()).status());
 }
 @Test void repeatedAndConcurrentClicksShareBatchAndMismatchedRequestConflicts() throws Exception {
  upload("marker 合成来源。",true);UUID key=UUID.randomUUID();var first=generation.generate(actor,tenant,key,space,"INSIGHT");
  assertEquals(first.id(),generation.generate(actor,tenant,key,space,"INSIGHT").id());
  assertThrows(IdentityException.class,()->generation.generate(actor,tenant,key,space,"DATA"));
  try(var pool=Executors.newFixedThreadPool(2)){
   var a=pool.submit(this::manual);var b=pool.submit(this::manual);assertEquals(first.id(),a.get().id());assertEquals(first.id(),b.get().id());
  }
  assertEquals(1,generation.state(actor,tenant).batches().size());
 }
 @Test void inFlightNewSourceIsNotConsumedByEarlierSnapshot(){
  var v1=upload("marker 初始版本来源。",true);var b=manual();UUID p=policy();generation.tick(p);var j=conversations.claim();
  var v2=upload("marker 后到的新增来源。",true);deliver(j,"处理初始资料版本所得到的合成洞察。");generation.tick(p);generation.tick(p);
  var next=generation.state(actor,tenant).batches().stream().filter(v->!v.id().equals(b.id())).findFirst().orElseThrow();assertEquals("DATA_READY",next.trigger());
  assertEquals(1,db.queryForObject("SELECT count(*) FROM conversation_originals WHERE task_id=? AND version_id=?",Integer.class,j.id(),v1.acceptedVersion().id()));
  assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_originals WHERE task_id=? AND version_id=?",Integer.class,j.id(),v2.acceptedVersion().id()));
 }
 @Test void batchConsumptionDoesNotLoseSourcesBeyondTheBoundedSelection(){
  for(int i=0;i<4;i++)upload("marker source "+i,true);UUID p=policy();generation.tick(p);var j=conversations.claim();
  assertEquals(3,db.queryForObject("SELECT count(*) FROM conversation_originals WHERE task_id=?",Integer.class,j.id()));
  deliver(j,"首批固定资料的合成证据已完成分析。");generation.tick(p);generation.tick(p);
  var next=generation.state(actor,tenant).batches().getFirst();assertEquals("RUNNING",next.status());
  assertEquals(1,db.queryForObject("SELECT count(*) FROM conversation_originals WHERE task_id=?",Integer.class,next.taskId()));
 }
 @Test void explicitRecoveryUnblocksRemainingSourcesAfterAutomaticFailure(){
  for(int i=0;i<4;i++)upload("marker recovery source "+i,true);UUID p=policy();generation.tick(p);
  var first=generation.state(actor,tenant).batches().getFirst();
  db.update("UPDATE conversation_tasks SET status='FAILED',error_code='TASK_LIMIT' WHERE id=?",first.taskId());
  generation.tick(p);generation.tick(p);assertEquals(1,generation.state(actor,tenant).batches().size());
  var retry=generation.generate(actor,tenant,UUID.randomUUID(),space,null);generation.tick(p);complete(conversations.claim());generation.tick(p);
  assertEquals("NO_NEW_CONTENT",generation.get(actor,tenant,retry.id()).status());generation.tick(p);
  var next=generation.state(actor,tenant).batches().getFirst();assertEquals("DATA_READY",next.trigger());assertEquals("RUNNING",next.status());
  assertEquals(1,db.queryForObject("SELECT count(*) FROM conversation_originals WHERE task_id=?",Integer.class,next.taskId()));
 }
 @Test void missingNewsSourceIsVisibleWithoutCreatingAManualNewsRequest(){
  upload("marker 合成背景资料。",true);UUID p=policy();generation.tick(p);complete(conversations.claim());generation.tick(p);generation.tick(p);
  assertEquals("NEWS_SOURCE_UNAVAILABLE",generation.state(actor,tenant).policies().getFirst().reason());
 }
 @Test void sameConversationRetainsIndependentCardsPreferencesAndReading(){
  upload("marker 保留历史依据。",true);
  var first=conversations.submit(actor,tenant,null,space,UUID.randomUUID(),"合成第一次画报分析","AGENT");var j=conversations.claim();deliver(j,"第一次生成的分析内容应该被长期保留。");
  var old=contents.find(j.id(),1);cards.update(actor,tenant,j.id(),UUID.randomUUID(),0,true,false,"WIDE");
  conversations.submit(actor,tenant,first.conversation().id(),space,UUID.randomUUID(),"合成另一独立角度画报","AGENT");var second=conversations.claim();deliver(second,"第二个独立分析角度的内容新增成为卡片。");
  var result=feed.list(actor,tenant,space,"LATEST",null,"Asia/Shanghai",0,20,true);assertEquals(2,result.items().size());assertEquals(2,result.items().stream().map(BriefingService.Card::cardId).distinct().count());
  assertTrue(cards.get(actor,tenant,j.id()).pinned());assertEquals("WIDE",cards.get(actor,tenant,j.id()).size());assertFalse(cards.get(actor,tenant,second.id()).pinned());assertEquals(old,contents.find(j.id(),1));
  assertEquals(2,recommendations.list(actor,tenant,space,0,20,null,true).items().size());
  assertThrows(IdentityException.class,()->cards.get(reader,tenant,j.id()));
 }
 @Test void identicalContentIsNotPublishedAgainEvenWithNewTask(){
  upload("marker 相同来源。",true);
  var b=manual();UUID p=policy();generation.tick(p);deliver(conversations.claim(),"这是不应该重复发布的同一条有据结论。");generation.tick(p);
  var next=manual();generation.tick(p);var receipt=deliver(conversations.claim(),"这是不应该重复发布的同一条有据结论。");generation.tick(p);
  assertEquals("NO_NEW_CONTENT",receipt.get("status"));assertEquals("NO_NEW_CONTENT",generation.get(actor,tenant,next.id()).status());assertEquals(1,feed.list(actor,tenant,space,"LATEST",null,"Asia/Shanghai",0,20,true).items().size());
  manual();generation.tick(p);var forged=conversations.claim();agents.openExecution(forged.id(),forged.token(),new AgentTaskService.ExecutionOpen("1.6",List.of("deliver_briefing")));
  agents.toolReceipt(forged.id(),forged.token(),new AgentTaskService.ToolReceipt(1,"deliver_briefing","STARTED"));agents.toolReceipt(forged.id(),forged.token(),new AgentTaskService.ToolReceipt(1,"deliver_briefing","succeeded"));
  var result=new AgentResult("1.5","0.15.4",forged.id(),forged.token(),"AGENT","verification","synthetic","没有新内容不能只凭引擎自述。",List.of(),List.of(new AgentResult.Tool("forged","deliver_briefing","succeeded")),List.of(),1,null,List.of(),List.of(),List.of(),"COMPLETE",null);
  assertEquals("TASK_RUNTIME_INCOMPATIBLE",assertThrows(IdentityException.class,()->agents.finish(forged,result)).code);
 }
 @Test void revocationAndRegrantFenceAnInFlightTask(){
  upload("marker 权限测试。",true);var b=manual();UUID p=policy();generation.tick(p);var j=conversations.claim();
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,actor);
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES(?,?,?,true)",tenant,space,actor);
  assertThrows(IdentityException.class,()->agents.search(j.id(),j.token(),"marker"));generation.tick(p);assertEquals("AUTHORITY_REVOKED",generation.get(actor,tenant,b.id()).status());
 }
 @Test void taskFailureIsVisibleAndDoesNotPretendToDeliver(){
  upload("marker 失败测试。",true);var b=manual();UUID p=policy();generation.tick(p);
  db.update("UPDATE conversation_tasks SET status='FAILED',error_code='TASK_LIMIT' WHERE id=?",generation.get(actor,tenant,b.id()).taskId());generation.tick(p);
  var result=generation.get(actor,tenant,b.id());assertEquals("FAILED",result.status());assertEquals("TASK_LIMIT",result.reason());assertTrue(result.cardIds().isEmpty());
 }
 @Test @org.springframework.transaction.annotation.Transactional
 void firstReleaseMigrationResumesPausedPoliciesWithoutReplayingWork() throws Exception {
  UUID p=policy();
  db.update("UPDATE briefing_generation_policies SET enabled=false,revision=7,epoch=9,data_key='known-source',context_key='known-context',info_day=current_date WHERE id=?",p);
  var before=db.queryForMap("SELECT * FROM briefing_generation_policies WHERE id=?",p);
  var alreadyEnabled=db.queryForMap("SELECT * FROM briefing_generation_policies WHERE tenant_id=? AND owner_id=?",tenant,reader);
  long tasksBefore=db.queryForObject("SELECT count(*) FROM conversation_tasks",Long.class);
  long batchesBefore=db.queryForObject("SELECT count(*) FROM briefing_generation_batches",Long.class);
  String migration=new org.springframework.core.io.ClassPathResource("db/migration/V48__resume_briefing_generation.sql").getContentAsString(StandardCharsets.UTF_8);
  db.execute(migration);
  var after=db.queryForMap("SELECT * FROM briefing_generation_policies WHERE id=?",p);
  before.put("enabled",true);before.put("revision",8);assertEquals(before,after);
  assertEquals(alreadyEnabled,db.queryForMap("SELECT * FROM briefing_generation_policies WHERE tenant_id=? AND owner_id=?",tenant,reader));
  assertEquals(0,db.queryForObject("SELECT count(*) FROM briefing_generation_policies WHERE NOT enabled",Integer.class));
  db.execute(migration);assertEquals(after,db.queryForMap("SELECT * FROM briefing_generation_policies WHERE id=?",p));
  assertEquals(tasksBefore,db.queryForObject("SELECT count(*) FROM conversation_tasks",Long.class));
  assertEquals(batchesBefore,db.queryForObject("SELECT count(*) FROM briefing_generation_batches",Long.class));
 }
 @Test void policyPauseIsSeparateFromManualGenerationAndCancellation(){
  upload("marker 暂停测试。",true);UUID p=policy();var policy=generation.state(actor,tenant).policies().getFirst();generation.configure(actor,tenant,space,policy.revision(),false);generation.tick(p);assertTrue(generation.state(actor,tenant).batches().isEmpty());
  var manual=manual();generation.tick(p);assertEquals("RUNNING",generation.get(actor,tenant,manual.id()).status());generation.cancel(actor,tenant,manual.id());assertEquals("CANCELLED",generation.get(actor,tenant,manual.id()).status());
  assertThrows(IdentityException.class,()->generation.get(reader,tenant,manual.id()));
 }
 @Test void infoWaitsForARealConfiguredSource(){var b=generation.generate(actor,tenant,UUID.randomUUID(),space,"INFO");generation.tick(policy());assertEquals("NEWS_SOURCE_UNAVAILABLE",generation.get(actor,tenant,b.id()).reason());assertNull(generation.get(actor,tenant,b.id()).taskId());}
 @Test void readAndRefreshNeverSubmitTasks(){generation.state(actor,tenant);recommendations.list(actor,tenant,space,0,20,null,true);assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_tasks WHERE tenant_id=?",Integer.class,tenant));}
 @Test void unavailableInfoDoesNotBlockDataInitialization(){
  var info=generation.generate(actor,tenant,UUID.randomUUID(),space,"INFO");UUID p=policy();generation.tick(p);
  upload("marker 与资讯独立的经营资料。",true);generation.tick(p);
  assertEquals("WAITING_DATA",generation.get(actor,tenant,info.id()).status());
  assertTrue(generation.state(actor,tenant).batches().stream().anyMatch(b->b.taskId()!=null&&b.businessType()==null));
 }
 @Test void readingSnapshotSurvivesNewCardsAndStillChecksAuthority(){
  upload("marker 分页来源。",true);
  for(int i=0;i<2;i++){conversations.submit(actor,tenant,null,space,UUID.randomUUID(),"测试分页画报","AGENT");deliver(conversations.claim(),"不同序号的合成分页结论编号"+i+"有其独立内容。");}
  var first=recommendations.list(actor,tenant,space,0,1,null,true);
  conversations.submit(actor,tenant,null,space,UUID.randomUUID(),"追加新的分页画报","AGENT");deliver(conversations.claim(),"这是分页途中新增且应在下次刷新显示的合成结论。");
  var second=recommendations.list(actor,tenant,space,1,1,first.snapshot(),true);
  assertNotEquals(first.items().getFirst().content().id(),second.items().getFirst().content().id());assertFalse(second.hasMore());
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,actor);
  assertThrows(IdentityException.class,()->recommendations.list(actor,tenant,space,1,1,first.snapshot(),true));
 }
 @Test void cardLayoutMovesOnlyTheSelectedDelivery(){
  upload("marker 布局来源。",true);var ids=new ArrayList<UUID>();
  for(int i=0;i<2;i++){conversations.submit(actor,tenant,null,space,UUID.randomUUID(),"测试卡片布局","AGENT");var j=conversations.claim();deliver(j,"布局卡片编号"+i+"使用独立的合成分析内容。");ids.add(j.id());cards.update(actor,tenant,j.id(),UUID.randomUUID(),0,true,false,"STANDARD");}
  int revision=db.queryForObject("SELECT revision FROM briefing_layouts WHERE tenant_id=? AND owner_id=?",Integer.class,tenant,actor);UUID key=UUID.randomUUID();
  var moved=cards.move(actor,tenant,key,revision,ids.get(1),ids.get(0),"BEFORE");assertEquals(moved,cards.move(actor,tenant,key,revision,ids.get(1),ids.get(0),"BEFORE"));
  assertEquals(ids.get(1),feed.list(actor,tenant,space,"FOCUSED",null,"Asia/Shanghai",0,20,true).items().getFirst().cardId());
 }

 @Autowired com.dreamcore.workspace.identity.IdentityService identities;
 @Autowired com.dreamcore.workspace.material.MaterialAccess access;
 @Autowired com.dreamcore.workspace.departure.DepartureAccess departure;
 @Autowired com.dreamcore.workspace.context.TaskContextService context;
 @Test @org.springframework.transaction.annotation.Transactional
 void contextualInfoUsesFixedPublicSourceAndAuthorizedPrivateEvidence(){
  var f=upload("marker 本企业经营青少年舞蹈教育，本项目关注课程安全。",true);
  var clock=new com.dreamcore.workspace.plans.PlanClock();
  var news=new BriefingGenerationService(db,conversations,contents,identities,access,departure,new AgentSettings("verification",true,false),clock,true,"https://news.example.org/updates",0,6);
   var b=news.generate(actor,tenant,UUID.randomUUID(),space,"INFO");news.tick(policy());b=news.get(actor,tenant,b.id());assertEquals("RUNNING",b.status());
   var t=db.queryForMap("SELECT prompt,public_query FROM conversation_tasks WHERE id=?",b.taskId());
   assertEquals("https://news.example.org/updates",t.get("public_query"));assertTrue(t.get("prompt").toString().contains("企业主营业务"));assertTrue(t.get("prompt").toString().contains("没有相关资讯"));
   assertEquals(f.acceptedVersion().id(),db.queryForObject("SELECT version_id FROM conversation_originals WHERE task_id=?",UUID.class,b.taskId()));
   var j=conversations.claim();agents.search(j.id(),j.token(),"marker");
   assertThrows(IdentityException.class,()->contents.create(j,new BriefingContentService.Request(null,"资讯缺少公开来源","仅有内部资料不得冒充外部资讯已经核实。",List.of("这段合成说明用于检查资讯的真实来源要求。","缺少公开网页读取回执就不能成功创建资讯。"),"INFO")));
 }
 @Test void goalUpdatesTriggerSuggestionsAndPrivateProfilesRemainScoped(){
  upload("marker 主营业务和目标证据。",true);UUID p=policy();generation.tick(p);var first=conversations.claim();complete(first);generation.tick(p);
  UUID profile=UUID.randomUUID();db.update("INSERT INTO profile_entries(id,tenant_id,scope,workspace_id,entry_key,kind,created_by) VALUES (?,?,'WORKSPACE',?,'经营目标','GOAL',?)",profile,tenant,space,actor);
  db.update("INSERT INTO profile_versions(id,tenant_id,entry_id,revision,value,provenance,status,changed_by) VALUES (?,?,?,1,'提升课程续费服务质量','合成目标','ACTIVE',?)",UUID.randomUUID(),tenant,profile,actor);
  generation.tick(p);var b=generation.state(actor,tenant).batches().getFirst();assertEquals("CONTEXT_CHANGED",b.trigger());assertEquals("SUGGESTION",b.businessType());
  var job=conversations.claim();assertTrue(context.context(job.id(),job.token(),new com.dreamcore.workspace.context.TaskContextService.Request("profiles","WORKSPACE","",0,null,null,null,null,null,null,null)).toString().contains("提升课程续费服务质量"));
  db.update("UPDATE profile_entries SET revision=2 WHERE id=?",profile);
  assertThrows(IdentityException.class,()->agents.check(job.id(),job.token()));
 }
 @Test void datePaginationUsesStableServerTimeWhileNewCardsArrive(){
  upload("marker 分页固定时间。",true);
  for(int i=0;i<2;i++){conversations.submit(actor,tenant,null,space,UUID.randomUUID(),"合成分页任务","AGENT");deliver(conversations.claim(),"时间分页中第"+i+"个不同结论保留原有顺序。");}
  var page=feed.list(actor,tenant,space,"LATEST",null,"Asia/Shanghai",0,1,true);
  conversations.submit(actor,tenant,null,space,UUID.randomUUID(),"合成分页新增任务","AGENT");deliver(conversations.claim(),"后台新增内容不应使用户翻页发生重复内容。");
  var next=feed.list(actor,tenant,space,"LATEST",null,"Asia/Shanghai",1,1,true,null,page.asOf());assertFalse(next.hasMore());assertNotEquals(page.items().getFirst().cardId(),next.items().getFirst().cardId());
 }
 @Test void legacyCardContentIsDeduplicatedBeforeAnyNewKeyExists(){
  upload("marker 历史卡片。",true);conversations.submit(actor,tenant,null,space,UUID.randomUUID(),"旧卡片","AGENT");deliver(conversations.claim(),"来自旧版本卡片的同一结论仍然应该避免重复。");
  db.update("DELETE FROM briefing_content_keys WHERE tenant_id=?",tenant);
  var b=manual();generation.tick(policy());assertEquals("NO_NEW_CONTENT",deliver(conversations.claim(),"来自旧版本卡片的同一结论仍然应该避免重复。").get("status"));
 }

 @Test @org.springframework.transaction.annotation.Transactional
 void dailyNewsScheduleCoalescesMissedDaysWithoutPersonalPlans(){
  upload("marker 企业上下文和项目证据。",true);
  var zone=java.time.ZoneId.of("Asia/Shanghai");
  var scheduled=java.time.LocalDate.now(zone).plusDays(1).atTime(9,0).atZone(zone).toInstant();
  var time=new java.util.concurrent.atomic.AtomicReference<>(scheduled.minusSeconds(60));
  var clock=new com.dreamcore.workspace.plans.PlanClock(){@Override public java.time.Instant now(){return time.get();}};
  var news=new BriefingGenerationService(db,conversations,contents,identities,access,departure,new AgentSettings("verification",true,false),clock,true,"https://news.example.org/updates",0,6);
  UUID p=policy();news.tick(p);complete(conversations.claim());news.tick(p);news.tick(p);
  assertEquals(1,news.state(actor,tenant).batches().size(),"News must wait until 09:00 Asia/Shanghai");
  time.set(scheduled);news.tick(p);
  assertTrue(news.state(actor,tenant).batches().stream().anyMatch(b->"INFO".equals(b.businessType())));complete(conversations.claim());news.tick(p);news.tick(p);
  assertEquals(scheduled,db.queryForObject("SELECT scheduled_for FROM briefing_generation_batches WHERE policy_id=? AND business_type='INFO'",java.sql.Timestamp.class,p).toInstant());
  assertEquals(2,news.state(actor,tenant).batches().size());
  time.set(time.get().plusSeconds(3*86400));news.tick(p);assertTrue(news.state(actor,tenant).batches().stream().anyMatch(b->"SCHEDULE".equals(b.trigger())&&"INFO".equals(b.businessType())));
  assertEquals(3,news.state(actor,tenant).batches().size());assertEquals(0,db.queryForObject("SELECT count(*) FROM ongoing_plans WHERE tenant_id=?",Integer.class,tenant));
 }
 @Test @org.springframework.transaction.annotation.Transactional
 void dailyBudgetWaitsAndResumesNextDayWithoutCreatingAnotherTask(){
  upload("marker 额度验证。",true);
  var time=new java.util.concurrent.atomic.AtomicReference<>(java.time.Instant.now().plusSeconds(86400));
  var clock=new com.dreamcore.workspace.plans.PlanClock(){@Override public java.time.Instant now(){return time.get();}};
  var limited=new BriefingGenerationService(db,conversations,contents,identities,access,departure,new AgentSettings("verification",true,false),clock,true,"",0,1);
  UUID p=policy();limited.tick(p);complete(conversations.claim());limited.tick(p);
  var more=limited.generate(actor,tenant,UUID.randomUUID(),space,"INSIGHT");limited.tick(p);assertEquals("DAILY_RUN_LIMIT",limited.get(actor,tenant,more.id()).reason());assertNull(limited.get(actor,tenant,more.id()).taskId());
  time.set(time.get().plusSeconds(86400));limited.tick(p);assertEquals("RUNNING",limited.get(actor,tenant,more.id()).status());
 }

 @Test void migrationCopiesLegacyPreferencesToOnlyTheirLatestDelivery() throws Exception {
  String schema="briefing_migration_"+UUID.randomUUID().toString().replace("-","");UUID c=UUID.randomUUID(),older=UUID.randomUUID(),latest=UUID.randomUUID();
  try{
   org.flywaydb.core.Flyway.configure().dataSource(db.getDataSource()).schemas(schema).defaultSchema(schema).target("46").load().migrate();
   try(var connection=db.getDataSource().getConnection()){
    connection.setAutoCommit(false);try(var statement=connection.createStatement()){statement.execute("SET LOCAL search_path TO "+schema+",public");}
    var isolated=new JdbcTemplate(new org.springframework.jdbc.datasource.SingleConnectionDataSource(connection,true));
    isolated.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,'legacy@example.test','合成旧用户','unused')",actor);
    isolated.update("INSERT INTO tenants(id,name) VALUES (?,'合成迁移')",tenant);
    isolated.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,actor);
    isolated.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'旧个人空间','PERSONAL')",space,tenant,actor);
    isolated.update("INSERT INTO conversations(id,tenant_id,workspace_id,owner_id,title) VALUES (?,?,?,?,'同一旧会话')",c,tenant,space,actor);
    for(UUID task:List.of(older,latest)){
     isolated.update("INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,status,attempt,reply,execution_class,finished_at) VALUES (?,?,?,?,?,'合成旧分析','AGENT','SUCCEEDED',1,'完成','verification',now()-(? * interval '1 day'))",task,tenant,space,c,actor,task.equals(older)?1:0);
     UUID artifact=UUID.randomUUID();isolated.update("INSERT INTO conversation_artifacts(id,tenant_id,workspace_id,task_id,filename,sha256,content,attempt_number) VALUES (?,?,?,?,'briefing.json',?,?::bytea,1)",artifact,tenant,space,task,"a".repeat(64),"{}".getBytes(StandardCharsets.UTF_8));
     isolated.update("INSERT INTO identity_audit(actor_id,tenant_id,action,target_id,outcome) VALUES (?,?,'TASK_BRIEFING_CREATED',?,'SUCCESS')",actor,tenant,artifact);
     isolated.update("INSERT INTO conversation_attempts(task_id,attempt_number,attempt_id,input,status,provenance) VALUES (?,1,?,'合成旧任务','SUCCEEDED','RECORDED')",task,UUID.randomUUID());
     isolated.update("INSERT INTO conversation_tool_receipts(task_id,attempt_number,sequence,name,status) VALUES (?,1,1,'deliver_briefing','succeeded')",task);
    }
    isolated.update("INSERT INTO briefing_preferences(tenant_id,workspace_id,conversation_id,owner_id,pinned,hidden,size) VALUES (?,?,?,?,true,false,'WIDE')",tenant,space,c,actor);connection.commit();
   }
   org.flywaydb.core.Flyway.configure().dataSource(db.getDataSource()).schemas(schema).defaultSchema(schema).load().migrate();
   assertEquals(List.of(latest),db.queryForList("SELECT task_id FROM "+schema+".briefing_card_preferences WHERE pinned AND size='WIDE'",UUID.class));
   assertEquals(1,db.queryForObject("SELECT count(*) FROM "+schema+".briefing_preferences",Integer.class));
  }finally{db.execute("DROP SCHEMA IF EXISTS "+schema+" CASCADE");}
 }

}
