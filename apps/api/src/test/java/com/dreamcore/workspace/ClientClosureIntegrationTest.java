package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.knowledge.*;
import com.dreamcore.workspace.material.*;
import com.dreamcore.workspace.document.*;
import com.dreamcore.workspace.taskwork.*;
import com.dreamcore.workspace.recommendation.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import static org.junit.jupiter.api.Assertions.*;
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=verification","dreamcore.tasks.initial-delay-ms=3600000","dreamcore.knowledge.enabled=true","dreamcore.knowledge.initial-delay-ms=3600000"})
class ClientClosureIntegrationTest {
 @Autowired JdbcTemplate db;@Autowired MaterialService materials;@Autowired KnowledgeService knowledge;@Autowired ConversationAttachments attachments;@Autowired ConversationService conversations;@Autowired AgentTaskService agents;
 UUID tenant,actor,reader,personal,shared;
 @BeforeEach void setup(){tenant=UUID.randomUUID();actor=UUID.randomUUID();reader=UUID.randomUUID();personal=UUID.randomUUID();shared=UUID.randomUUID();
  db.update("INSERT INTO tenants(id,name) VALUES (?,'合成客户端输入')",tenant);
  for(UUID id:List.of(actor,reader)){db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成用户','unused')",id,id+"@example.test");db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,id);}
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'个人','PERSONAL'),(?,?,?,'共享','SHARED')",personal,tenant,actor,shared,tenant,actor);
  for(UUID id:List.of(actor,reader))db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",tenant,shared,id);
 }
 @AfterEach void cleanup(){db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);db.update("UPDATE knowledge_runs SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);}
 MockMultipartFile file(String content){return new MockMultipartFile("file","input.txt","text/plain",content.getBytes(StandardCharsets.UTF_8));}
 MaterialService.UploadReceipt upload(UUID space,String text){var f=materials.uploadReceipt(actor,tenant,space,null,null,null,UUID.randomUUID(),file(text));parse(f.acceptedVersion().id(),text);return f;}
 void parse(UUID version,String text){var j=knowledge.claim();assertEquals(version,j.version());knowledge.finish(j,new DocumentParser.Result("synthetic","READY",List.of(),List.of(new DocumentParser.Fragment("L1",text,"TEXT"))));}
 ConversationService.Job task(UUID conversation,List<TaskOriginals.Selection> selected,String scope){var d=conversations.submitClient(actor,tenant,conversation,personal,UUID.randomUUID(),"检索合成标记","AGENT",null,selected,scope);var j=conversations.claim();assertEquals(d.tasks().getLast().id(),j.id());return j;}

 @Autowired DocumentService documents;@Autowired DocumentPublicationService publications;@Autowired BriefingContentService briefings;@Autowired RecommendationService recommendations;@Autowired ConversationPlanCommands commands;
 ConversationService.Job taskWith(String prompt){var d=conversations.submitClient(actor,tenant,null,personal,UUID.randomUUID(),prompt,"AGENT",null,List.of(),"AUTHORIZED_LIBRARY");var j=conversations.claim();assertEquals(d.tasks().getLast().id(),j.id());return j;}
 void complete(ConversationService.Job j){db.update("UPDATE conversation_tasks SET status='SUCCEEDED',reply='合成结果正文，支持保存、搜索与共享。',finished_at=now(),engine_version='synthetic',lease_token=NULL,lease_until=NULL WHERE id=?",j.id());}
 @Test void generatedTypesFilterBeforePaginationAndTextNeedsSources(){
  upload(personal,"marker 合成业务资料。");
  for(String type:List.of("INFO","INSIGHT","SUGGESTION","RESULT")){
   var j=taskWith("请根据 marker 生成画报。");agents.search(j.id(),j.token(),"marker");agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.6",List.of("deliver_briefing")));
   agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,"deliver_briefing","STARTED"));
   var result=agents.deliverBriefing(j.id(),j.token(),new BriefingContentService.Request(null,"合成业务主题画报","合成资料已完成整理，本段只用于流程验证。",List.of("这是依据合成资料编写的第一段分析。","这是依据合成资料编写的第二段分析。"),type));assertEquals("PREPARED",result.get("status"));
   agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,"deliver_briefing","succeeded"));complete(j);
   var page=recommendations.list(actor,tenant,null,0,1,null,true,type,false,false);assertEquals(1,page.items().size());assertEquals(type,page.items().getFirst().briefing().content().businessType());assertFalse(page.hasMore());
  }
  assertEquals(4,recommendations.list(actor,tenant,null,0,20,null,true,null,false,false).items().size());
  assertTrue(recommendations.list(reader,tenant,null,0,20,null,true,null,false,false).items().isEmpty());
 }
 @Test void savedResultIsSearchableInUnifiedLibraryAndPublicationFollowIsPrivate(){
  var j=taskWith("合成资料保存测试");complete(j);var draft=documents.create(actor,tenant,j.conversation(),j.id(),null,UUID.randomUUID());
  var found=materials.list(actor,tenant,personal,null,"结果正文",0,1);assertEquals(1,found.items().size());assertEquals("DRAFT",found.items().getFirst().kind());assertEquals(draft.document().id(),found.items().getFirst().id());
  var publication=publications.publish(actor,tenant,draft.document().id(),draft.version().number(),UUID.randomUUID(),shared,null,null,null,"docx",true);
  UUID material=publication.materialId(),request=UUID.randomUUID();assertTrue(recommendations.followPublication(reader,tenant,material,request,0,true).pinned());assertTrue(recommendations.followPublication(reader,tenant,material,request,0,true).pinned());assertFalse(recommendations.publicationPreference(actor,tenant,material).pinned());
  assertEquals(1,recommendations.list(reader,tenant,null,0,20,null,true,"RESULT",true,true).items().size());
  recommendations.configure(reader,tenant,UUID.randomUUID(),0,false);
  assertEquals(1,recommendations.list(reader,tenant,null,0,20,null,true,"RESULT",true,true).items().size());
  assertTrue(recommendations.list(reader,tenant,null,0,20,null,true,"RESULT",false,false).items().isEmpty());
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",shared,reader);assertTrue(recommendations.list(reader,tenant,null,0,20,null,true,null,true,true).items().isEmpty());assertThrows(IdentityException.class,()->recommendations.publicationPreference(reader,tenant,material));
 }
 @Test void naturalPlanIsRealIdempotentAndCannotUseQuotedOrIncompleteDelegation(){
  String prompt="本月每天09:00根据个人资料整理销售简报给我。";var j=taskWith(prompt);agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.6",List.of("manage_plan")));agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,"manage_plan","STARTED"));
  var request=new ConversationPlanCommands.Request("create",null,null,personal,"销售简报","根据当前资料整理销售简报。","09:00",false,prompt);
  var result=(Map<?,?>)commands.invoke(j.id(),j.token(),request);assertEquals(true,result.get("saved"));var receipt=(ConversationPlanCommands.Receipt)result.get("receipt");assertEquals("ACTIVE",receipt.plan().status());
  assertEquals(result,commands.invoke(j.id(),j.token(),request));assertEquals(1,commands.receipts(actor,tenant,j.id()).size());assertThrows(IdentityException.class,()->commands.receipts(reader,tenant,j.id()));
  var incomplete=taskWith("每天09:00根据个人资料整理销售简报给我。");agents.openExecution(incomplete.id(),incomplete.token(),new AgentTaskService.ExecutionOpen("1.6",List.of("manage_plan")));
  agents.toolReceipt(incomplete.id(),incomplete.token(),new AgentTaskService.ToolReceipt(1,"manage_plan","STARTED"));
  var rejected=(Map<?,?>)commands.invoke(incomplete.id(),incomplete.token(),new ConversationPlanCommands.Request("create",null,null,personal,"销售简报","整理销售简报。","09:00",false,"每天09:00根据个人资料整理销售简报给我。"));assertEquals(false,rejected.get("saved"));assertEquals("END_DATE_REQUIRED",rejected.get("reason"));
 }

 ConversationPlanCommands.Receipt command(String prompt,String action,com.dreamcore.workspace.plans.PlanService.Plan plan,String time){
  var j=taskWith(prompt);agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.6",List.of("manage_plan")));agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,"manage_plan","STARTED"));
  var result=(Map<?,?>)commands.invoke(j.id(),j.token(),new ConversationPlanCommands.Request(action,plan==null?null:plan.id(),plan==null?null:plan.revision(),personal,"销售简报","整理销售简报。",time,false,prompt));assertEquals(true,result.get("saved"),result.toString());
  // Commands are sequential; release the synthetic execution before the next one (five active tasks per account).
  int revision=db.queryForObject("SELECT revision FROM conversation_tasks WHERE id=?",Integer.class,j.id());
  conversations.action(actor,tenant,j.conversation(),j.id(),UUID.randomUUID(),revision,"CANCEL");
  return (ConversationPlanCommands.Receipt)result.get("receipt");
 }
 @Test void planTimeUpdateMutePauseAndResumePersistDistinctStates(){
  var p=command("未来3天每天晚上九点根据个人资料整理销售简报。","create",null,"21:00").plan();
  p=command("把销售简报改到晚上八点。","update",p,"20:00").plan();assertEquals("20:00",p.configuration().dailyTime());assertEquals("ACTIVE",p.status());
  p=command("关闭提醒销售简报。","mute",p,null).plan();assertFalse(p.configuration().notificationsEnabled());assertEquals("ACTIVE",p.status());
  p=command("暂停销售简报。","pause",p,null).plan();assertEquals("PAUSED",p.status());
  p=command("把销售简报改到晚上七点。","update",p,"19:00").plan();assertEquals("PAUSED",p.status());assertEquals("19:00",p.configuration().dailyTime());
  p=command("恢复销售简报。","resume",p,null).plan();assertEquals("ACTIVE",p.status());assertFalse(p.configuration().notificationsEnabled());
  p=command("停止销售简报。","stop",p,null).plan();assertEquals("STOPPED",p.status());
 }
 @Test void quotedInstructionsAndWrongMeridiemCannotAuthorizePlan(){
  for(String prompt:List.of("例如：本月每天09:00根据个人资料整理销售简报。","本月每天晚上九点根据个人资料整理销售简报。")){
   var j=taskWith(prompt);agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.6",List.of("manage_plan")));agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,"manage_plan","STARTED"));
   var result=(Map<?,?>)commands.invoke(j.id(),j.token(),new ConversationPlanCommands.Request("create",null,null,personal,"销售简报","整理销售简报。","09:00",false,prompt));assertEquals(false,result.get("saved"));
  }
  assertEquals(0,db.queryForObject("SELECT count(*) FROM ongoing_plans WHERE tenant_id=?",Integer.class,tenant));
 }
}
