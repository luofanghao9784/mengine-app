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
 @Autowired com.dreamcore.workspace.audience.WorkAudienceService workAudience;
 @Autowired JdbcTemplate db;@Autowired MaterialService materials;@Autowired KnowledgeService knowledge;
 @Autowired ConversationService conversations;@Autowired AgentTaskService agents;@Autowired BriefingContentService contents;
 @Autowired BriefingGenerationService generation;@Autowired BriefingCardService cards;@Autowired BriefingService feed;@Autowired RecommendationService recommendations;
 @Autowired AgentUsageLedger usage;
 @Test void roleChangeRemovesOldAutomaticCardsFromFeedAndUnreadRecommendations(){
  db.update("INSERT INTO tenant_governance(tenant_id,owner_id) VALUES (?,?)",tenant,actor);
  upload("marker 合成岗位画报来源。",true);manual();UUID p=policy();generation.tick(p);var j=conversations.claim();deliver(j,"合成岗位推荐，核对本人应处理的工作。");generation.tick(p);
  assertTrue(feed.list(actor,tenant,null,"LATEST",null,"Asia/Shanghai",0,20,true).items().stream().anyMatch(c->c.taskId().equals(j.id())));assertTrue(recommendations.hasUnreadBriefing(actor,tenant));
  workAudience.save(actor,tenant,actor,new com.dreamcore.workspace.audience.WorkAudienceService.Change(UUID.randomUUID(),0,"服务部","美容师","核对预约",List.of("SERVICE")));
  assertTrue(feed.list(actor,tenant,null,"LATEST",null,"Asia/Shanghai",0,20,true).items().isEmpty());assertFalse(recommendations.hasUnreadBriefing(actor,tenant));
  // Role relevance changes the feed, not private historical ownership or stored evidence.
  assertEquals("SUCCEEDED",conversations.taskDetail(actor,tenant,j.conversation(),j.id()).tasks().getFirst().status());
 }
 @Test void defaultGenerationRotatesReadyAuthorizedSpacesAndReplaysTheSameSelection(){
  upload("marker 财务合成资料",true);UUID finance=space,operations=UUID.randomUUID();
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'运营','SHARED')",operations,tenant,actor);
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",tenant,operations,actor);
  space=operations;upload("marker 运营合成资料",true);space=finance;
  UUID request=UUID.randomUUID();var selected=generation.generateSelection(actor,tenant,request,null,2,List.of("INSIGHT"));
  assertEquals(Set.of(finance,operations),new HashSet<>(selected.stream().map(BriefingGenerationService.Batch::workspaceId).toList()));
  assertEquals(selected,generation.generateSelection(actor,tenant,request,null,2,List.of("INSIGHT")));
  var explicit=generation.generateSelection(actor,tenant,UUID.randomUUID(),finance,2,List.of("INSIGHT"));
  assertTrue(explicit.stream().allMatch(b->finance.equals(b.workspaceId())));
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",operations,actor);
  assertEquals(finance,generation.generate(actor,tenant,UUID.randomUUID(),null,"INSIGHT").workspaceId());
  assertThrows(IdentityException.class,()->generation.generate(actor,tenant,UUID.randomUUID(),operations,"INSIGHT"));
 }
 @Test void defaultGenerationSkipsUnreadySpacesEvenWhenTheyHaveNeverGenerated(){
  upload("marker 已就绪财务资料",true);UUID ready=space,pending=UUID.randomUUID();
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'待解析空间','SHARED')",pending,tenant,actor);
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",tenant,pending,actor);
  space=pending;upload("marker 待解析资料",false);space=ready;
  generation.generateSelection(actor,tenant,UUID.randomUUID(),ready,1,List.of("INSIGHT"));
  assertEquals(ready,generation.generate(actor,tenant,UUID.randomUUID(),null,"INSIGHT").workspaceId());
 }
 @Test void navigationBriefingSignalUsesUnreadAuthorizedCardVersions(){
  upload("marker 合成画报导航资料。",true);
  assertFalse(recommendations.hasUnreadBriefing(actor,tenant));
  var b=manual();generation.tick(policy());var j=conversations.claim();assertNotNull(j);
  deliver(j,"合成资料支持这份新画报，仅用于通知状态验证。");generation.tick(policy());
  assertTrue(recommendations.hasUnreadBriefing(actor,tenant));
  assertFalse(recommendations.hasUnreadBriefing(reader,tenant));
  assertFalse(conversations.hasUnreadOrAttention(actor,tenant));
  var card=recommendations.list(actor,tenant,null,0,20,null,true).items().getFirst().content();
  recommendations.opened(actor,tenant,new RecommendationService.Target(card.kind(),card.id(),card.versionKey()));
  assertFalse(recommendations.hasUnreadBriefing(actor,tenant));
  db.update("UPDATE conversation_tasks SET revision=revision+1 WHERE id=?",j.id());
  assertTrue(recommendations.hasUnreadBriefing(actor,tenant));
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,actor);
  assertFalse(recommendations.hasUnreadBriefing(actor,tenant));
  assertThrows(IdentityException.class,()->recommendations.hasUnreadBriefing(actor,UUID.randomUUID()));
 }
 @Autowired com.dreamcore.workspace.identity.PlatformAdminService platform;
 UUID tenant,actor,reader,space;
 @BeforeEach void setup(){tenant=UUID.randomUUID();actor=UUID.randomUUID();reader=UUID.randomUUID();space=UUID.randomUUID();
  db.update("INSERT INTO tenants(id,name) VALUES (?,'合成画报生成验收')",tenant);
  for(UUID id:List.of(actor,reader)){db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成用户','unused')",id,id+"@example.test");db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,id);}
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'合成共享空间','SHARED')",space,tenant,actor);
  for(UUID id:List.of(actor,reader))db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",tenant,space,id);
 }
 @Test void manualOnlyDeploymentDoesNotDispatchLegacyAutomaticBatchUntilUserRequestsIt(){
  var manualOnly=new BriefingGenerationService(db,conversations,contents,identities,access,departure,new AgentSettings("verification",true,false),new com.dreamcore.workspace.plans.PlanClock(),true,"",0,6);
  org.springframework.test.util.ReflectionTestUtils.setField(manualOnly,"workAudience",workAudience);
  org.springframework.test.util.ReflectionTestUtils.setField(manualOnly,"automaticEnabled",false);
  upload("marker 合成手动画报资料。",true);UUID p=policy(),batch=UUID.randomUUID();
  db.update("INSERT INTO briefing_generation_batches(id,tenant_id,owner_id,workspace_id,policy_id,policy_epoch,trigger_kind,business_type,status) SELECT ?,tenant_id,owner_id,workspace_id,id,epoch,'INITIALIZATION','INSIGHT','WAITING_CAPABILITY' FROM briefing_generation_policies WHERE id=?",batch,p);
  assertFalse(manualOnly.candidates().contains(p));manualOnly.tick(p);
  assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_tasks WHERE tenant_id=?",Integer.class,tenant));
  var explicit=manualOnly.generate(actor,tenant,UUID.randomUUID(),space,"INSIGHT");assertEquals(batch,explicit.id());
  assertTrue(manualOnly.candidates().contains(p));manualOnly.tick(p);
  assertNotNull(manualOnly.get(actor,tenant,batch).taskId());
  assertEquals(1,db.queryForObject("SELECT count(*) FROM conversation_tasks WHERE tenant_id=?",Integer.class,tenant));
 }
 @AfterEach void cleanup(){db.update("UPDATE briefing_generation_policies SET enabled=false WHERE tenant_id=?",tenant);db.update("UPDATE briefing_generation_batches SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING','WAITING_DATA','WAITING_RESOURCE','WAITING_CAPABILITY')",tenant);db.update("DELETE FROM platform_roles WHERE account_id IN (SELECT account_id FROM platform_accounts WHERE login_name LIKE '%@service-platform.test')");db.update("DELETE FROM tenant_service_changes WHERE actor_id IN (SELECT account_id FROM platform_accounts WHERE login_name LIKE '%@service-platform.test')");db.update("DELETE FROM platform_accounts WHERE login_name LIKE '%@service-platform.test'");db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);db.update("UPDATE knowledge_runs SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);}
 MaterialService.UploadReceipt upload(String text,boolean ready){
  return upload("evidence.txt",text,ready);
 }
 MaterialService.UploadReceipt upload(String filename,String text,boolean ready){
  var f=materials.uploadReceipt(actor,tenant,space,null,null,null,UUID.randomUUID(),new MockMultipartFile("file",filename,"application/octet-stream",text.getBytes(StandardCharsets.UTF_8)));
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
 UUID serviceOperator(){
  UUID id=UUID.randomUUID();db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成平台','unused')",id,id+"@service-platform.test");
  db.update("INSERT INTO platform_accounts(account_id,login_name,password_hash) VALUES (?,?,'unused')",id,id+"@service-platform.test");
  db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",id);return id;
 }
 @Test void servicePauseFencesRunningAttemptAndResumeOnlyUsesNewSourceEvents(){
  UUID operator=serviceOperator();
  upload("marker 暂停前资料。",true);UUID policy=policy();generation.tick(policy);var before=generation.state(actor,tenant).batches().getFirst();
  var job=conversations.claim();assertEquals(before.taskId(),job.id());
  platform.status(operator,tenant,UUID.randomUUID(),0,"SUSPENDED","内部运行核对","企业维护暂停");
  assertEquals("RESULT_UNKNOWN",db.queryForObject("SELECT status FROM conversation_tasks WHERE id=?",String.class,job.id()));
  assertTrue(db.queryForObject("SELECT reconciliation_required FROM conversation_tasks WHERE id=?",Boolean.class,job.id()));
  assertEquals("RESULT_UNKNOWN",db.queryForObject("SELECT status FROM conversation_attempts WHERE task_id=?",String.class,job.id()));
  assertThrows(IdentityException.class,()->agents.check(job.id(),job.token()));
  generation.tick(policy);assertEquals(1,db.queryForObject("SELECT count(*) FROM briefing_generation_batches WHERE policy_id=?",Integer.class,policy));
  assertTrue(db.queryForObject("SELECT enabled FROM briefing_generation_policies WHERE id=?",Boolean.class,policy));
  platform.status(operator,tenant,UUID.randomUUID(),1,"ACTIVE","完成运行核对","服务已恢复");
  assertThrows(IdentityException.class,()->agents.check(job.id(),job.token()));
  generation.tick(policy);assertEquals(1,generation.state(actor,tenant).batches().size());
  upload("marker 恢复后的新资料。",true);generation.tick(policy);
  assertEquals(2,generation.state(actor,tenant).batches().size());
  assertEquals("RESULT_UNKNOWN",db.queryForObject("SELECT status FROM conversation_tasks WHERE id=?",String.class,job.id()));
 }
 @Test void servicePausePreservesCompletedDeliveryAndIndependentlyDisabledPolicies(){
  UUID operator=serviceOperator();
  upload("marker 已完成交付资料。",true);UUID policy=policy();generation.tick(policy);var batch=generation.state(actor,tenant).batches().getFirst();
  var job=conversations.claim();deliver(job,"暂停前已经完成的合成来源分析。");
  var readerPolicy=db.queryForObject("SELECT id FROM briefing_generation_policies WHERE tenant_id=? AND owner_id=?",UUID.class,tenant,reader);
  db.update("UPDATE briefing_generation_policies SET enabled=false WHERE id=?",readerPolicy);
  platform.status(operator,tenant,UUID.randomUUID(),0,"SUSPENDED","内部核对已交付结果","服务暂停");
  assertEquals("SUCCEEDED",db.queryForObject("SELECT status FROM briefing_generation_batches WHERE id=?",String.class,batch.id()));
  platform.status(operator,tenant,UUID.randomUUID(),1,"ACTIVE","完成核对","服务恢复");
  assertFalse(db.queryForObject("SELECT enabled FROM briefing_generation_policies WHERE id=?",Boolean.class,readerPolicy));
  assertEquals("SUCCEEDED",generation.get(actor,tenant,batch.id()).status());
 }
 BriefingContentService.Request content(String title,String type){return new BriefingContentService.Request(null,title,"合成资料支持这一条独立且完整的分析结论。",List.of("这是有合成来源支持的第一段完整分析。","这是用于验证交付和历史保留的第二段分析。"),type);}
 void record(ConversationService.Job j,int sequence,String name,String status){agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(sequence,name,status));}
 AgentResult terminal(ConversationService.Job j,List<AgentResult.Tool> tools){
  agents.openUsage(j.id(),j.token());agents.startUsage(j.id(),j.token(),new AgentUsageLedger.Start(1,2048));usage.finish(j.id(),j.token(),new AgentUsageLedger.Receipt(1,"RETURNED",100L,50L));
  var sources=db.queryForList("SELECT chunk_id FROM conversation_agent_grants WHERE task_id=? AND attempt_id=?",UUID.class,j.id(),j.token());
  return new AgentResult("1.5","0.15.4",j.id(),j.token(),"AGENT","verification","synthetic","合成系统交付确认。",sources,tools,List.of(),1,new AgentResult.Usage(100,50),List.of(),List.of(),List.of(),"COMPLETE",null);
 }
 @Test void correctedNativeDeliveryKeepsFailedReceiptAndFinishesOnlyWithVerifiedArtifact(){
  upload("marker 合成参数恢复证据。",true);var b=manual();UUID p=policy();generation.tick(p);var j=conversations.claim();agents.search(j.id(),j.token(),"marker");
  agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.6",List.of("deliver_briefing")));
  record(j,1,"deliver_briefing","STARTED");
  assertThrows(IdentityException.class,()->agents.deliverBriefing(j.id(),j.token(),new BriefingContentService.Request(null,"合成参数恢复画报","合成资料支持完整的分析结论。",null,"INSIGHT")));
  record(j,1,"deliver_briefing","failed");record(j,2,"deliver_briefing","STARTED");
  assertEquals("PREPARED",agents.deliverBriefing(j.id(),j.token(),content("合成参数恢复画报","INSIGHT")).get("status"));record(j,2,"deliver_briefing","succeeded");
  agents.finish(j,terminal(j,List.of(new AgentResult.Tool("bad","deliver_briefing","failed"),new AgentResult.Tool("corrected","deliver_briefing","succeeded"))));generation.tick(p);
  assertEquals("SUCCEEDED",generation.get(actor,tenant,b.id()).status());assertEquals(1,feed.list(actor,tenant,space,"LATEST",null,"Asia/Shanghai",0,20,true).items().size());
  assertEquals(List.of("failed","succeeded"),db.queryForList("SELECT status FROM conversation_tool_receipts WHERE task_id=? ORDER BY sequence",String.class,j.id()));
 }
 @Test void nativeStatusOnlyReturnsAuditedNoNewContentWithoutAnArtifact(){
  upload("marker 合成无新主题证据。",true);var b=manual();UUID p=policy();generation.tick(p);var j=conversations.claim();
  agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.6",List.of("deliver_briefing")));record(j,1,"deliver_briefing","STARTED");
  assertEquals("BRIEFING_SOURCES_REQUIRED",assertThrows(IdentityException.class,()->agents.deliverBriefing(j.id(),j.token(),content("暂无新内容","INFO"))).code);
  agents.search(j.id(),j.token(),"marker");var receipt=agents.deliverBriefing(j.id(),j.token(),content("暂无新内容","INFO"));
  assertEquals("NO_NEW_CONTENT",receipt.get("status"));assertEquals("NO_USEFUL_CONTENT",receipt.get("reason"));record(j,1,"deliver_briefing","succeeded");
  agents.finish(j,terminal(j,List.of(new AgentResult.Tool("none","deliver_briefing","succeeded"))));generation.tick(p);
  assertEquals("NO_NEW_CONTENT",generation.get(actor,tenant,b.id()).status());assertTrue(feed.list(actor,tenant,space,"LATEST",null,"Asia/Shanghai",0,20,true).items().isEmpty());
  assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_artifacts WHERE task_id=?",Integer.class,j.id()));
  assertEquals(1,db.queryForObject("SELECT count(*) FROM identity_audit WHERE target_id=? AND action='TASK_BRIEFING_SKIPPED' AND outcome='SUCCESS'",Integer.class,j.token()));
 }
 @Test void nativeAutoCannotPublishAnInfoCard(){
  upload("marker 合成默认类型证据。",true);generation.generate(actor,tenant,UUID.randomUUID(),space,null);generation.tick(policy());var j=conversations.claim();agents.search(j.id(),j.token(),"marker");
  agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.6",List.of("deliver_briefing")));record(j,1,"deliver_briefing","STARTED");
  assertEquals("BRIEFING_TYPE_MISMATCH",assertThrows(IdentityException.class,()->agents.deliverBriefing(j.id(),j.token(),content("合成资讯类型画报","INFO"))).code);
 }
 @Test void ordinaryStatusOnlyIsRejectedAndDeliveryFailureCannotBecomeComplete(){
  upload("marker 合成普通会话证据。",true);conversations.submit(actor,tenant,null,space,UUID.randomUUID(),"合成普通会话画报","AGENT");var j=conversations.claim();agents.search(j.id(),j.token(),"marker");
  agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.6",List.of("deliver_briefing")));record(j,1,"deliver_briefing","STARTED");
  assertEquals("BRIEFING_STATUS_ONLY",assertThrows(IdentityException.class,()->agents.deliverBriefing(j.id(),j.token(),content("暂无新内容","INSIGHT"))).code);record(j,1,"deliver_briefing","failed");
  record(j,2,"deliver_briefing","STARTED");agents.deliverBriefing(j.id(),j.token(),content("合成普通会话画报","INSIGHT"));record(j,2,"deliver_briefing","succeeded");
  assertEquals("TASK_RUNTIME_INCOMPATIBLE",assertThrows(IdentityException.class,()->agents.finish(j,terminal(j,List.of(new AgentResult.Tool("bad","deliver_briefing","failed"),new AgentResult.Tool("ok","deliver_briefing","succeeded"))))).code);
 }
 @Test void nativeRecoveryCannotConcealFailedRetrievalOrUnverifiedDelivery(){
  for(boolean forged:List.of(false,true)){
   upload("marker 合成失败边界 "+forged,true);manual();generation.tick(policy());var j=conversations.claim();agents.search(j.id(),j.token(),"marker");
   agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.6",List.of("deliver_briefing","search_sources")));
   String failed=forged?"deliver_briefing":"search_sources";record(j,1,failed,"STARTED");record(j,1,failed,"failed");record(j,2,"deliver_briefing","STARTED");
   if(!forged)agents.deliverBriefing(j.id(),j.token(),content("合成未完成检索画报","INSIGHT"));record(j,2,"deliver_briefing","succeeded");
   assertEquals("TASK_RUNTIME_INCOMPATIBLE",assertThrows(IdentityException.class,()->agents.finish(j,terminal(j,List.of(new AgentResult.Tool("bad",failed,"failed"),new AgentResult.Tool("last","deliver_briefing","succeeded"))))).code);
   db.update("UPDATE conversation_tasks SET status='FAILED',lease_token=NULL,lease_until=NULL WHERE id=?",j.id());generation.tick(policy());
  }
 }
 @Test void tenBackgroundDeliveriesDoNotCreateUserConversationsAndRemainReadable(){
  upload("marker 后台内容生成合成证据。",true);UUID p=policy();
  var many=new BriefingGenerationService(db,conversations,contents,identities,access,departure,new AgentSettings("verification",true,false),new com.dreamcore.workspace.plans.PlanClock(),true,"",0,24);
  org.springframework.test.util.ReflectionTestUtils.setField(many,"workAudience",workAudience);
  for(int i=0;i<10;i++){
   var b=many.generate(actor,tenant,UUID.randomUUID(),space,"INSIGHT");many.tick(p);var job=conversations.claim();
   assertEquals("BRIEFING_GENERATION",db.queryForObject("SELECT purpose FROM conversations WHERE id=?",String.class,job.conversation()));
   assertEquals("SYSTEM_BRIEFING",db.queryForObject("SELECT origin FROM conversation_tasks WHERE id=?",String.class,job.id()));
   deliver(job,"第"+i+"个具有独立价值的合成洞察依据保留。");many.tick(p);
   assertEquals("SUCCEEDED",many.get(actor,tenant,b.id()).status());
   assertTrue(conversations.list(actor,tenant,0,50).items().isEmpty());
   assertTrue(conversations.detail(actor,tenant,job.conversation(),0,20).tasks().isEmpty());
   assertEquals(job.id(),conversations.taskDetail(actor,tenant,job.conversation(),job.id()).tasks().getFirst().id());
   assertEquals(409,assertThrows(IdentityException.class,()->conversations.submitClient(actor,tenant,job.conversation(),space,UUID.randomUUID(),"不能把后台记录当用户对话","AGENT",null,List.of(),null)).status);
  }
  assertEquals(10,feed.list(actor,tenant,space,"LATEST",null,"Asia/Shanghai",0,20,true).items().size());
  assertEquals(10,recommendations.list(actor,tenant,space,0,20,null,true).items().size());
  assertTrue(recommendations.list(actor,tenant,space,0,20,null,false).items().isEmpty());
 }
 @Test void cardOpeningIsReadOnlyAndFirstSendIsIdempotentAndSourceBound(){
  upload("marker 私人讨论合成依据。",true);var b=manual();UUID p=policy();generation.tick(p);var job=conversations.claim();deliver(job,"后台画报与用户讨论分别保留有据内容。");generation.tick(p);
  var source=conversations.taskDetail(actor,tenant,job.conversation(),job.id()).tasks().getFirst();
  for(int i=0;i<3;i++)assertNull(agents.discussion(actor,tenant,job.conversation(),job.id(),source.revision(),source.attempt()).conversationId());
  assertEquals(1,db.queryForObject("SELECT count(*) FROM conversations WHERE tenant_id=?",Integer.class,tenant));
  var ref=agents.discussion(actor,tenant,job.conversation(),job.id(),source.revision(),source.attempt()).briefingContext();
  UUID key=UUID.randomUUID();var first=agents.sendDiscussion(actor,tenant,null,ref,space,key,"解释这个发现","AGENT",null,List.of(),null);
  var retry=agents.sendDiscussion(actor,tenant,null,ref,space,key,"解释这个发现","AGENT",null,List.of(),null);
  assertEquals(first.conversation().id(),retry.conversation().id());assertEquals(1,retry.tasks().size());
  assertEquals(1,conversations.list(actor,tenant,0,50).items().size());
  assertEquals(first.conversation().id(),agents.discussion(actor,tenant,job.conversation(),job.id(),source.revision(),source.attempt()).conversationId());
  assertEquals(ref,first.briefingContext());assertEquals("解释这个发现",first.tasks().getFirst().prompt());
  // Fresh reads retain their origin independently of the browser URL.
  assertTrue(conversations.detail(actor,tenant,first.conversation().id(),0,20).conversation().briefingDiscussion());
  assertTrue(conversations.list(actor,tenant,0,50).items().getFirst().briefingDiscussion());
  var ordinary=conversations.submitClient(actor,tenant,null,space,UUID.randomUUID(),"普通合成会话","AGENT",null,List.of(),null);
  assertFalse(ordinary.conversation().briefingDiscussion());
  assertFalse(conversations.list(actor,tenant,0,50).items().stream().filter(c->c.id().equals(ordinary.conversation().id())).findFirst().orElseThrow().briefingDiscussion());
  assertThrows(IdentityException.class,()->agents.sendDiscussion(reader,tenant,null,ref,space,UUID.randomUUID(),"越权追问","AGENT",null,List.of(),null));
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,actor);
  assertThrows(IdentityException.class,()->conversations.detail(actor,tenant,first.conversation().id(),0,20));
  assertThrows(IdentityException.class,()->agents.sendDiscussion(actor,tenant,null,ref,space,UUID.randomUUID(),"撤权后不得发送","AGENT",null,List.of(),null));
 }
 @Test void invalidFirstSendRollsBackThreadAndOwnedAttachmentDraftCanBeReused(){
  upload("marker 首次发送事务合成依据。",true);manual();UUID p=policy();generation.tick(p);var job=conversations.claim();deliver(job,"没有发送成功时不会留下新的讨论记录。");generation.tick(p);
  var task=conversations.taskDetail(actor,tenant,job.conversation(),job.id()).tasks().getFirst();
  var ref=agents.discussion(actor,tenant,job.conversation(),job.id(),task.revision(),task.attempt()).briefingContext();
  assertThrows(IdentityException.class,()->agents.sendDiscussion(actor,tenant,null,ref,space,UUID.randomUUID(),"","AGENT",null,List.of(),null));
  assertEquals(0,db.queryForObject("SELECT count(*) FROM briefing_discussions WHERE owner_id=?",Integer.class,actor));
  assertEquals(1,db.queryForObject("SELECT count(*) FROM conversations WHERE tenant_id=?",Integer.class,tenant));
  var draft=conversations.draft(actor,tenant,space,UUID.randomUUID());assertTrue(conversations.list(actor,tenant,0,50).items().isEmpty());
  var other=conversations.draft(reader,tenant,space,UUID.randomUUID());
  assertThrows(IdentityException.class,()->agents.sendDiscussion(actor,tenant,other.id(),ref,space,UUID.randomUUID(),"不能绑定他人草稿","AGENT",null,List.of(),null));
  var sent=agents.sendDiscussion(actor,tenant,draft.id(),ref,space,UUID.randomUUID(),"带附件草稿追问","AGENT",null,List.of(),null);
  assertEquals(draft.id(),sent.conversation().id());assertEquals(1,conversations.list(actor,tenant,0,50).items().size());
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
 @Test void autoBatchKeepsCurrentWorkbookAsContextForUnseenDocuments(){
  var table=upload("current.xlsx","marker 合成表格来源。",true);UUID p=policy();generation.tick(p);complete(conversations.claim());generation.tick(p);
  var docs=new ArrayList<UUID>();for(int i=0;i<4;i++)docs.add(upload("guide-"+i+".md","marker 合成字段说明 "+i,true).acceptedVersion().id());
  generation.generate(actor,tenant,UUID.randomUUID(),space,null);generation.tick(p);var j=conversations.claim();
  var selected=db.queryForList("SELECT version_id FROM conversation_originals WHERE task_id=?",UUID.class,j.id());
  assertEquals(3,selected.size());assertTrue(selected.contains(table.acceptedVersion().id()));
  assertEquals(2,selected.stream().filter(docs::contains).count());
  complete(j);generation.tick(p);generation.tick(p);j=conversations.claim();
  selected=db.queryForList("SELECT version_id FROM conversation_originals WHERE task_id=?",UUID.class,j.id());
  assertEquals(3,selected.size());assertTrue(selected.contains(table.acceptedVersion().id()));
  assertEquals(2,selected.stream().filter(docs::contains).count());
 }
 @Test void explicitInsightDoesNotReplaceSelectedDocumentsWithAnOldWorkbook(){
  upload("current.xlsx","marker 合成旧表格。",true);UUID p=policy();generation.tick(p);complete(conversations.claim());generation.tick(p);
  var docs=new ArrayList<UUID>();for(int i=0;i<3;i++)docs.add(upload("guide-"+i+".md","marker 合成字段说明。",true).acceptedVersion().id());
  manual();generation.tick(p);var j=conversations.claim();
  assertEquals(new HashSet<>(docs),new HashSet<>(db.queryForList("SELECT version_id FROM conversation_originals WHERE task_id=?",UUID.class,j.id())));
 }
 @Test void briefingOverviewCoversEverySelectedVersionAndLeavesRoomForTargetedEvidence(){
  var versions=new ArrayList<UUID>();
  for(int i=0;i<3;i++){
   var f=upload("source-"+i+".md","synthetic",false);versions.add(f.acceptedVersion().id());var parse=knowledge.claim();
   var chunks=new ArrayList<DocumentParser.Fragment>();for(int n=0;n<12;n++)chunks.add(new DocumentParser.Fragment("L"+n,"marker source="+i+" ordinal="+n,"TEXT"));
   knowledge.finish(parse,new DocumentParser.Result("synthetic","READY",List.of(),chunks));
  }
  manual();generation.tick(policy());var j=conversations.claim();var overview=agents.searchResult(j.id(),j.token(),"");
  assertEquals(6,overview.items().size());assertTrue(overview.hasMore());
  assertEquals(3,overview.items().stream().map(AgentTaskService.Input::filename).distinct().count());
  assertTrue(overview.items().stream().allMatch(x->x.content().matches(".*ordinal=[01]$")));
  var targeted=agents.search(j.id(),j.token(),"source=0 ordinal=9");assertEquals(1,targeted.size());assertTrue(targeted.getFirst().content().endsWith("ordinal=9"));
  assertEquals(7,db.queryForObject("SELECT count(*) FROM conversation_agent_grants WHERE task_id=?",Integer.class,j.id()));
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,actor);
  assertThrows(IdentityException.class,()->agents.search(j.id(),j.token(),"source=0 ordinal=10"));
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
 @Test void infoRejectsWithoutAConfiguredEnterpriseSource(){assertEquals("BRIEFING_INFO_UNAVAILABLE",assertThrows(IdentityException.class,()->generation.generate(actor,tenant,UUID.randomUUID(),space,"INFO")).code);assertEquals(0,generation.state(actor,tenant).quota().reserved());assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_tasks WHERE tenant_id=?",Integer.class,tenant));}
 @Test void readAndRefreshNeverSubmitTasks(){generation.state(actor,tenant);recommendations.list(actor,tenant,space,0,20,null,true);assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_tasks WHERE tenant_id=?",Integer.class,tenant));}
 @Test void unavailableInfoDoesNotBlockDataInitialization(){
  assertThrows(IdentityException.class,()->generation.generate(actor,tenant,UUID.randomUUID(),space,"INFO"));
  upload("marker 与资讯独立的经营资料。",true);UUID p=policy();generation.tick(p);
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
  UUID newsSource=UUID.randomUUID();db.update("INSERT INTO news_sources(id,name,url,format,enabled,changed_by) VALUES(?,'合成固定资讯源','https://news.example.org/updates','PAGE',true,?) ON CONFLICT(url) DO NOTHING",newsSource,actor);
  newsSource=db.queryForObject("SELECT id FROM news_sources WHERE url='https://news.example.org/updates'",UUID.class);db.update("INSERT INTO tenant_news_sources(tenant_id,source_id,enabled,changed_by) VALUES(?,?,true,?)",tenant,newsSource,actor);
  var f=upload("marker 本企业经营青少年舞蹈教育，本项目关注课程安全。",true);
  var clock=new com.dreamcore.workspace.plans.PlanClock();
  var news=new BriefingGenerationService(db,conversations,contents,identities,access,departure,new AgentSettings("verification",true,false),clock,true,"https://news.example.org/updates",0,6);
  org.springframework.test.util.ReflectionTestUtils.setField(news,"workAudience",workAudience);
   var b=news.generate(actor,tenant,UUID.randomUUID(),space,"INFO");news.tick(policy());b=news.get(actor,tenant,b.id());assertEquals("RUNNING",b.status());
   var t=db.queryForMap("SELECT prompt,public_query FROM conversation_tasks WHERE id=?",b.taskId());
   assertEquals("https://news.example.org/updates",t.get("public_query"));assertTrue(t.get("prompt").toString().contains("引擎已预取获权企业"));assertTrue(t.get("prompt").toString().contains("没有相关资讯"));
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
  org.springframework.test.util.ReflectionTestUtils.setField(news,"workAudience",workAudience);
  UUID p=policy();news.tick(p);complete(conversations.claim());news.tick(p);news.tick(p);
  assertEquals(1,news.state(actor,tenant).batches().size(),"News must wait until 09:00 Asia/Shanghai");
  time.set(scheduled);news.tick(p);
  assertTrue(news.state(actor,tenant).batches().stream().anyMatch(b->"INFO".equals(b.businessType())));complete(conversations.claim());news.tick(p);news.tick(p);
  assertEquals(scheduled,db.queryForObject("SELECT scheduled_for FROM briefing_generation_batches WHERE policy_id=? AND business_type='INFO'",java.sql.Timestamp.class,p).toInstant());
  assertEquals(2,news.state(actor,tenant).batches().size());
  time.set(time.get().plusSeconds(3*86400));news.tick(p);assertTrue(news.state(actor,tenant).batches().stream().anyMatch(b->"SCHEDULE".equals(b.trigger())&&"INFO".equals(b.businessType())));
  assertEquals(3,news.state(actor,tenant).batches().size());assertEquals(0,db.queryForObject("SELECT count(*) FROM ongoing_plans WHERE tenant_id=?",Integer.class,tenant));
 }
 @Test void onlySuccessfulCardsConsumeQuotaAndInFlightWorkReservesIt(){
  upload("marker 额度按成功画报计次。",true);
  var batch=manual();generation.tick(policy());var job=conversations.claim();
  assertEquals(0,generation.state(actor,tenant).quota().used());
  assertEquals(1,generation.state(actor,tenant).quota().reserved());
  db.update("UPDATE conversation_tasks SET status='FAILED',error_code='TASK_LIMIT',lease_token=NULL,lease_until=NULL WHERE id=?",job.id());
  assertEquals(0,generation.state(actor,tenant).quota().used());assertEquals(0,generation.state(actor,tenant).quota().reserved());generation.tick(policy());
  var next=manual();generation.tick(policy());complete(conversations.claim());generation.tick(policy());
  assertEquals("NO_NEW_CONTENT",generation.get(actor,tenant,next.id()).status());assertEquals(0,generation.state(actor,tenant).quota().used());
  var cancel=manual();generation.tick(policy());var cancelled=conversations.claim();db.update("UPDATE conversation_tasks SET status='CANCELLED',lease_token=NULL,lease_until=NULL WHERE id=?",cancelled.id());generation.tick(policy());
  assertEquals(0,generation.state(actor,tenant).quota().used());
  var success=manual();generation.tick(policy());deliver(conversations.claim(),"有实际内容的合成画报成功交付后，才应计入额度。");
  assertEquals(1,generation.state(actor,tenant).quota().used(),"count before batch reconciliation prevents oversubscription");assertEquals(0,generation.state(actor,tenant).quota().reserved());
  generation.tick(policy());assertEquals("SUCCEEDED",generation.get(actor,tenant,success.id()).status());assertEquals(1,generation.state(actor,tenant).quota().used());
 }

 @Test @org.springframework.transaction.annotation.Transactional
 void dailyBudgetWaitsAndResumesNextDayWithoutCreatingAnotherTask(){
  upload("marker 额度验证。",true);
  var time=new java.util.concurrent.atomic.AtomicReference<>(java.time.Instant.now().plusSeconds(86400));
  var clock=new com.dreamcore.workspace.plans.PlanClock(){@Override public java.time.Instant now(){return time.get();}};
  var limited=new BriefingGenerationService(db,conversations,contents,identities,access,departure,new AgentSettings("verification",true,false),clock,true,"",0,1);
  org.springframework.test.util.ReflectionTestUtils.setField(limited,"workAudience",workAudience);
  UUID p=policy();limited.generate(actor,tenant,UUID.randomUUID(),space,"INSIGHT");limited.tick(p);deliver(conversations.claim(),"合成成功出卡后应占用每日额度。");limited.tick(p);
  var more=limited.generate(actor,tenant,UUID.randomUUID(),space,"INSIGHT");limited.tick(p);assertEquals("DAILY_RUN_LIMIT",limited.get(actor,tenant,more.id()).reason());assertNull(limited.get(actor,tenant,more.id()).taskId());
  time.set(time.get().plusSeconds(86400));limited.tick(p);assertEquals("RUNNING",limited.get(actor,tenant,more.id()).status());
 }

 @Test @org.springframework.transaction.annotation.Transactional
 void administrativeResetRestoresOnlyThisOwnersCurrentDayBudgetAndPreservesHistory(){
  upload("marker 重置额度。",true);
  var time=new java.util.concurrent.atomic.AtomicReference<>(java.time.Instant.now().plusSeconds(86400));
  var clock=new com.dreamcore.workspace.plans.PlanClock(){@Override public java.time.Instant now(){return time.get();}};
  var limited=new BriefingGenerationService(db,conversations,contents,identities,access,departure,new AgentSettings("verification",true,false),clock,true,"",0,1);
  org.springframework.test.util.ReflectionTestUtils.setField(limited,"workAudience",workAudience);
  UUID p=policy();limited.generate(actor,tenant,UUID.randomUUID(),space,"INSIGHT");limited.tick(p);deliver(conversations.claim(),"合成重置后成功出卡，保留真实历史计次。");limited.tick(p);
  var more=limited.generate(actor,tenant,UUID.randomUUID(),space,"INSIGHT");limited.tick(p);
  assertEquals("DAILY_RUN_LIMIT",limited.get(actor,tenant,more.id()).reason());
  db.update("INSERT INTO briefing_quota_resets(id,tenant_id,owner_id,reset_at,reason) VALUES (?,?,?,?,?)",UUID.randomUUID(),tenant,reader,java.sql.Timestamp.from(time.get().plusSeconds(1)),"合成其他账号重置");
  db.update("INSERT INTO briefing_quota_resets(id,tenant_id,owner_id,reset_at,reason) VALUES (?,?,?,?,?)",UUID.randomUUID(),tenant,actor,java.sql.Timestamp.from(time.get().minusSeconds(86400)),"合成昨日重置");
  time.set(time.get().plusSeconds(2));limited.tick(p);
  assertEquals("DAILY_RUN_LIMIT",limited.get(actor,tenant,more.id()).reason());
  assertNull(limited.get(actor,tenant,more.id()).taskId());
  db.update("INSERT INTO briefing_quota_resets(id,tenant_id,owner_id,reset_at,reason) VALUES (?,?,?,?,?)",UUID.randomUUID(),tenant,actor,java.sql.Timestamp.from(time.get()),"合成当前账号重置");
  time.set(time.get().plusSeconds(1));limited.tick(p);
  assertEquals("RUNNING",limited.get(actor,tenant,more.id()).status());
  assertEquals(2,db.queryForObject("SELECT count(*) FROM briefing_generation_batches WHERE tenant_id=? AND owner_id=? AND task_id IS NOT NULL",Integer.class,tenant,actor));
  deliver(conversations.claim(),"合成重置后的另一张不同卡片应重新计次。");limited.tick(p);
  var again=limited.generate(actor,tenant,UUID.randomUUID(),space,"INSIGHT");limited.tick(p);
  assertEquals("DAILY_RUN_LIMIT",limited.get(actor,tenant,again.id()).reason(),"reset restores the configured budget rather than disabling the limit");
 }

 @Test void backgroundMigrationPreservesMixedUserHistoryCardsAndMisleadingTitles() throws Exception {
  String schema="background_migration_"+UUID.randomUUID().toString().replace("-","");
  UUID system=UUID.randomUUID(),mixed=UUID.randomUUID(),user=UUID.randomUUID(),systemTask=UUID.randomUUID(),mixedSystem=UUID.randomUUID(),mixedUser=UUID.randomUUID(),userTask=UUID.randomUUID(),policy=UUID.randomUUID(),artifact=UUID.randomUUID();
  try{
   org.flywaydb.core.Flyway.configure().dataSource(db.getDataSource()).schemas(schema).defaultSchema(schema).target("50").load().migrate();
   try(var connection=db.getDataSource().getConnection()){
    connection.setAutoCommit(false);try(var statement=connection.createStatement()){statement.execute("SET LOCAL search_path TO "+schema+",public");}
    var isolated=new JdbcTemplate(new org.springframework.jdbc.datasource.SingleConnectionDataSource(connection,true));
    isolated.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,'migration@example.test','合成迁移用户','unused')",actor);
    isolated.update("INSERT INTO tenants(id,name) VALUES (?,'合成后台迁移')",tenant);
    isolated.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,actor);
    isolated.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'个人空间','PERSONAL')",space,tenant,actor);
    for(UUID c:List.of(system,mixed,user))isolated.update("INSERT INTO conversations(id,tenant_id,workspace_id,owner_id,title) VALUES (?,?,?,?,'系统智能画报生成。用户也可能使用这个标题')",c,tenant,space,actor);
    for(var pair:List.of(List.of(systemTask,system),List.of(mixedSystem,mixed),List.of(mixedUser,mixed),List.of(userTask,user)))isolated.update("INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,status,reply,execution_class,finished_at) VALUES (?,?,?,?,?,?,'AGENT','SUCCEEDED','原始回复应完整保留','verification',now())",pair.get(0),tenant,space,pair.get(1),actor,pair.get(0).equals(mixedUser)?"用户已追问这张画报":"系统智能画报生成。原提示内容");
    isolated.update("INSERT INTO briefing_generation_policies(id,tenant_id,owner_id,workspace_id) VALUES (?,?,?,?)",policy,tenant,actor,space);
    for(UUID task:List.of(systemTask,mixedSystem))isolated.update("INSERT INTO briefing_generation_batches(id,tenant_id,owner_id,workspace_id,policy_id,policy_epoch,trigger_kind,status,task_id) VALUES (?,?,?,?,?,1,'GENERATE_MORE','NO_NEW_CONTENT',?)",UUID.randomUUID(),tenant,actor,space,policy,task);
    isolated.update("INSERT INTO briefing_card_preferences(task_id,tenant_id,workspace_id,owner_id,pinned,size) VALUES (?,?,?,?,true,'WIDE')",systemTask,tenant,space,actor);
    isolated.update("INSERT INTO conversation_artifacts(id,tenant_id,workspace_id,task_id,filename,sha256,content) VALUES (?,?,?,?,'briefing.json',?,?::bytea)",artifact,tenant,space,systemTask,"a".repeat(64),"原卡片内容".getBytes(StandardCharsets.UTF_8));connection.commit();
   }
   // Exercise this client migration in the synthetic legacy schema. Admin migrations assume the deployed public schema.
   try(var connection=db.getDataSource().getConnection()){
    connection.setAutoCommit(false);try(var statement=connection.createStatement()){
     statement.execute("SET LOCAL search_path TO "+schema+",public");
     statement.execute(new org.springframework.core.io.ClassPathResource("db/migration/V83__background_briefing_conversations.sql").getContentAsString(StandardCharsets.UTF_8));
    }connection.commit();
   }
   assertEquals("BRIEFING_GENERATION",db.queryForObject("SELECT purpose FROM "+schema+".conversations WHERE id=?",String.class,system));
   assertEquals("BUSINESS",db.queryForObject("SELECT purpose FROM "+schema+".conversations WHERE id=?",String.class,mixed));
   assertEquals("用户已追问这张画报",db.queryForObject("SELECT title FROM "+schema+".conversations WHERE id=?",String.class,mixed));
   assertEquals("BUSINESS",db.queryForObject("SELECT purpose FROM "+schema+".conversations WHERE id=?",String.class,user));
   assertEquals("USER",db.queryForObject("SELECT origin FROM "+schema+".conversation_tasks WHERE id=?",String.class,userTask));
   assertEquals(2,db.queryForObject("SELECT count(*) FROM "+schema+".conversation_tasks WHERE origin='SYSTEM_BRIEFING'",Integer.class));
   assertEquals(4,db.queryForObject("SELECT count(*) FROM "+schema+".conversation_tasks WHERE reply='原始回复应完整保留'",Integer.class));
   assertEquals("原卡片内容",new String(db.queryForObject("SELECT content FROM "+schema+".conversation_artifacts WHERE id=?",byte[].class,artifact),StandardCharsets.UTF_8));
   assertTrue(db.queryForObject("SELECT pinned AND size='WIDE' FROM "+schema+".briefing_card_preferences WHERE task_id=?",Boolean.class,systemTask));
  }finally{db.execute("DROP SCHEMA IF EXISTS "+schema+" CASCADE");}
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
   org.flywaydb.core.Flyway.configure().dataSource(db.getDataSource()).schemas(schema).defaultSchema(schema).target("47").load().migrate();
   assertEquals(List.of(latest),db.queryForList("SELECT task_id FROM "+schema+".briefing_card_preferences WHERE pinned AND size='WIDE'",UUID.class));
   assertEquals(1,db.queryForObject("SELECT count(*) FROM "+schema+".briefing_preferences",Integer.class));
  }finally{db.execute("DROP SCHEMA IF EXISTS "+schema+" CASCADE");}
 }

 @Test void topicSelectionIsAnImmutableProposalBoundToTheAuthorizedBriefingTask(){
  upload("marker 合成选题依据。",true);manual();generation.tick(policy());var j=conversations.claim();assertNotNull(j);
  var request=new AgentTaskService.TopicSelection(List.of(new AgentTaskService.TopicCandidate("合成业务问题","获权资料及必要计算",false,"区别于近期主题","INSIGHT")),0);
  assertEquals(true,agents.selectTopic(j.id(),j.token(),request).get("proposalOnly"));agents.selectTopic(j.id(),j.token(),request);
  assertEquals(1,db.queryForObject("SELECT count(*) FROM briefing_topic_selections WHERE task_id=?",Integer.class,j.id()));
  var changed=new AgentTaskService.TopicSelection(List.of(new AgentTaskService.TopicCandidate("另一问题","依据",false,"区别","INSIGHT")),0);
  assertEquals(409,assertThrows(IdentityException.class,()->agents.selectTopic(j.id(),j.token(),changed)).status);
  assertEquals(403,assertThrows(IdentityException.class,()->agents.selectTopic(j.id(),UUID.randomUUID(),request)).status);
  assertEquals(true,agents.check(j.id(),j.token()).get("topicSelectionRecorded"));
 }
 @Test void requestedSuggestionRejectsDataTopicBeforeRecordingAndAcceptsSuggestion(){
  upload("marker 合成建议依据。",true);generation.generate(actor,tenant,UUID.randomUUID(),space,"SUGGESTION");generation.tick(policy());var j=conversations.claim();assertNotNull(j);
  assertEquals("SUGGESTION",agents.check(j.id(),j.token()).get("briefingRequestedType"));
  var wrong=new AgentTaskService.TopicSelection(List.of(new AgentTaskService.TopicCandidate("合成数据问题","需要计算",true,"新问题","DATA")),0);
  assertEquals(422,assertThrows(IdentityException.class,()->agents.selectTopic(j.id(),j.token(),wrong)).status);
  assertEquals(0,db.queryForObject("SELECT count(*) FROM briefing_topic_selections WHERE task_id=?",Integer.class,j.id()));
  var valid=new AgentTaskService.TopicSelection(List.of(new AgentTaskService.TopicCandidate("合成建议问题","已有获权依据",false,"可执行措施","SUGGESTION")),0);
  assertEquals(true,agents.selectTopic(j.id(),j.token(),valid).get("recorded"));
 }

 @Test void automaticEightCardsDoNotConsumeManualQuotaAndCannotBlockManualDispatch(){
  UUID p=null;
  for(int i=0;i<8;i++){
   upload("marker 自动额度独立验证版本 "+i,true);if(p==null)p=policy();generation.tick(p);
   var j=conversations.claim();assertNotNull(j);deliver(j,"自动独立额度的第"+i+"张不同合成分析卡片。");generation.tick(p);
  }
  assertEquals(8,generation.state(actor,tenant).automaticQuota().used());assertEquals(8,generation.state(actor,tenant).automaticQuota().limit());
  assertEquals(0,generation.state(actor,tenant).quota().used());assertEquals(6,generation.state(actor,tenant).quota().remaining());
  upload("marker 自动额度第九版",true);generation.tick(p);
  assertTrue(generation.state(actor,tenant).batches().stream().anyMatch(b->"AUTOMATIC_DAILY_LIMIT".equals(b.reason())&&b.taskId()==null));
  var b=manual();assertEquals(1,generation.state(actor,tenant).quota().reserved());generation.tick(p);
  var j=conversations.claim();assertNotNull(j);assertEquals(b.taskId()==null?generation.get(actor,tenant,b.id()).taskId():b.taskId(),j.id());
  deliver(j,"自动额度用完仍可正常交付手动生成的合成分析卡片。");generation.tick(p);
  assertEquals(1,generation.state(actor,tenant).quota().used());assertEquals(8,generation.state(actor,tenant).automaticQuota().used());
 }
 @Test void sixManualCardsLeaveAutomaticBudgetAvailable(){
  upload("marker 手动额度先用完验证",true);UUID p=policy();
  for(int i=0;i<6;i++){manual();generation.tick(p);deliver(conversations.claim(),"第"+i+"次手动生成的不同合成分析卡片。");generation.tick(p);}
  assertEquals(0,generation.state(actor,tenant).quota().remaining());assertEquals(8,generation.state(actor,tenant).automaticQuota().remaining());
  upload("marker 新资料触发独立自动额度",true);generation.tick(p);var j=conversations.claim();assertNotNull(j);
  deliver(j,"手动额度用完后仍可自动交付的新合成分析卡片。");generation.tick(p);
  assertEquals(6,generation.state(actor,tenant).quota().used());assertEquals(1,generation.state(actor,tenant).automaticQuota().used());
 }

 @Test void automaticFailureReleasesOnlyAutomaticReservation(){
  upload("marker 自动失败不扣额度验证",true);UUID p=policy();generation.tick(p);var j=conversations.claim();assertNotNull(j);
  assertEquals(1,generation.state(actor,tenant).automaticQuota().reserved());assertEquals(0,generation.state(actor,tenant).quota().reserved());
  db.update("UPDATE conversation_tasks SET status='FAILED',error_code='TASK_LIMIT',lease_token=NULL,lease_until=NULL WHERE id=?",j.id());generation.tick(p);
  assertEquals(0,generation.state(actor,tenant).automaticQuota().used());assertEquals(0,generation.state(actor,tenant).automaticQuota().reserved());assertEquals(8,generation.state(actor,tenant).automaticQuota().remaining());
 }

 @Test void scopedAutomaticRunDoesNotEnableOtherOwnersAndStillUsesAutomaticQuota(){
  upload("marker 限定账号自动执行验证",true);UUID p=policy();
  var once=new BriefingGenerationService(db,conversations,contents,identities,access,departure,new AgentSettings("verification",true,false),new com.dreamcore.workspace.plans.PlanClock(),true,"",0,6);
  org.springframework.test.util.ReflectionTestUtils.setField(once,"workAudience",workAudience);
  org.springframework.test.util.ReflectionTestUtils.setField(once,"automaticEnabled",false);
  assertFalse(once.candidates().contains(p));
  org.springframework.test.util.ReflectionTestUtils.setField(once,"onceTenant",tenant.toString());
  org.springframework.test.util.ReflectionTestUtils.setField(once,"onceOwner",reader.toString());
  assertFalse(once.candidates().contains(p));once.tick(p);assertNull(conversations.claim());
  org.springframework.test.util.ReflectionTestUtils.setField(once,"onceOwner",actor.toString());
  assertTrue(once.candidates().contains(p));once.tick(p);var j=conversations.claim();assertNotNull(j);deliver(j,"限定账号的一次自动运行合成卡片，仍应占用自动额度。");once.tick(p);
  assertEquals(1,once.state(actor,tenant).automaticQuota().used());assertEquals(0,once.state(actor,tenant).quota().used());
 }

 @Test void boundedEmptyNewsSearchFinishesWithoutChargingOrHidingOtherPartialFailures(){
  for(int searchCount:List.of(1,2,3)){
   upload("marker 合成资讯空搜索证明。",true);var b=manual();UUID p=policy();generation.tick(p);var j=conversations.claim();
   db.update("UPDATE briefing_generation_batches SET business_type='INFO' WHERE id=?",b.id());
   db.update("INSERT INTO briefing_news_search_scope(task_id,tenant_id,provider,scope) VALUES(?,?,'bing-rss','{}')",j.id(),tenant);
   for(int i=1;i<=searchCount;i++){
    db.update("INSERT INTO briefing_news_search_queries(task_id,topic_id,query) VALUES(?,?,?)",j.id(),"TOPIC"+i,"synthetic topic "+i);
    db.update("INSERT INTO conversation_tool_receipts(task_id,attempt_number,sequence,name,status) VALUES(?,1,?,'public_search','succeeded')",j.id(),i);
   }
   db.update("INSERT INTO conversation_tool_receipts(task_id,attempt_number,sequence,name,status) VALUES(?,1,4,'task_control','succeeded')",j.id());
   db.update("UPDATE conversation_tasks SET status='PARTIAL',web_sources='[]',lease_token=NULL,lease_until=NULL WHERE id=?",j.id());generation.tick(p);
   assertEquals(searchCount>=2?"NO_NEW_CONTENT":"FAILED",generation.get(actor,tenant,b.id()).status());
   assertEquals(0,generation.state(actor,tenant).quota().used());
  }
 }

 @Test void samePolicyDispatchesFiveAndSixthWaitsWithoutOverspending(){
  upload("marker 合成并行资料。",true);UUID p=policy();
  var batches=generation.generateSelection(actor,tenant,UUID.randomUUID(),space,6,List.of("INSIGHT"));
  for(int i=0;i<6;i++)generation.tick(p);
  assertEquals(5,db.queryForObject("SELECT count(*) FROM briefing_generation_batches WHERE policy_id=? AND task_id IS NOT NULL",Integer.class,p));
  assertEquals(1,db.queryForObject("SELECT count(*) FROM briefing_generation_batches WHERE policy_id=? AND task_id IS NULL AND status='WAITING_RESOURCE'",Integer.class,p));
  var first=conversations.claim();assertNotNull(first);deliver(first,"并行第一张合成画报保存成功后才计入次数。");generation.tick(p);
  assertEquals(6,db.queryForObject("SELECT count(*) FROM briefing_generation_batches WHERE policy_id=? AND task_id IS NOT NULL",Integer.class,p));
  assertEquals(1,generation.state(actor,tenant).quota().used());
 }
}
