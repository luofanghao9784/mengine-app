package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;

@SpringBootTest(properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=verification","dreamcore.tasks.initial-delay-ms=3600000"})
class ConversationTitleIntegrationTest {
 @Autowired ConversationTitles titles;@Autowired ConversationService conversations;@Autowired JdbcTemplate db;@Autowired PasswordEncoder passwords;
 UUID tenant,actor,other,space,conversation;
 @BeforeEach void setup(){tenant=UUID.randomUUID();actor=UUID.randomUUID();other=UUID.randomUUID();space=UUID.randomUUID();
  db.update("INSERT INTO tenants(id,name) VALUES (?,'合成标题企业')",tenant);
  for(UUID id:List.of(actor,other)){db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成用户',?)",id,id+"@example.test",passwords.encode("synthetic-title-password"));db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,id);}
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'个人','PERSONAL')",space,tenant,actor);
 }
 @AfterEach void cleanup(){db.update("UPDATE conversation_titles SET state='FAILED' WHERE tenant_id=? AND state IN ('QUEUED','RUNNING')",tenant);db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);}
 void send(String prompt){var result=conversations.submitClient(actor,tenant,conversation,space,UUID.randomUUID(),prompt,"AGENT",null,List.of(),"AUTHORIZED_LIBRARY");conversation=result.conversation().id();}
 ConversationTitles.Job queued(){titles.request(actor,tenant,conversation);var job=titles.claim();assertNotNull(job);return job;}
 EngineTaskRuntime.TitleResult result(ConversationTitles.Job job,String title){return new EngineTaskRuntime.TitleResult("1.0",job.conversation(),job.request(),title,"synthetic",100L,12L);}
 String title(){return conversations.detail(actor,tenant,conversation,0,20).conversation().title();}
 @Test void firstMeaningfulPromptIsGeneratedOnceWithoutChangingBusinessStateOrSort(){
  send("你好啊！");titles.request(actor,tenant,conversation);assertNull(titles.claim());
  db.update("UPDATE conversation_tasks SET status='SUCCEEDED' WHERE conversation_id=?",conversation);
  send("请分析合成企业的五店两期收款数据并给出经营建议");var before=conversations.detail(actor,tenant,conversation,0,20);var job=queued();
  assertEquals("请分析合成企业的五店两期收款数据并给出经营建议",job.prompt());
  titles.finish(job,result(job,"合成企业五店收款分析"));assertEquals("合成企业五店收款分析",title());
  var after=conversations.detail(actor,tenant,conversation,0,20);assertEquals(before.conversation().updatedAt(),after.conversation().updatedAt());assertEquals(before.tasks(),after.tasks());
  assertTrue(conversations.events(actor,tenant,conversation,before.cursor()).items().stream().anyMatch(e->e.kind().equals("TITLE_UPDATED")));
  titles.request(actor,tenant,conversation);assertNull(titles.claim());titles.finish(job,result(job,"迟到标题"));assertEquals("合成企业五店收款分析",title());
 }
 @Test void failuresKeepFallbackAndDoNotReplayModelRequests(){send("分析合成收款");var job=queued();titles.finish(job,result(job,"会话标题"));assertEquals("分析合成收款",title());titles.request(actor,tenant,conversation);assertNull(titles.claim());}
 @Test void onlyOwnerAndCurrentTenantCanScheduleAndRevocationBlocksWriteback(){send("分析合成收款");assertThrows(IdentityException.class,()->titles.request(other,tenant,conversation));assertThrows(IdentityException.class,()->titles.request(actor,UUID.randomUUID(),conversation));var job=queued();db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,actor);assertFalse(titles.active(job));titles.finish(job,result(job,"不应写入"));assertEquals("分析合成收款",db.queryForObject("SELECT title FROM conversations WHERE id=?",String.class,conversation));}
 @Test void newerTitleWinsAndUnknownExecutionIsNotRebilled(){send("分析合成收款");var job=queued();db.update("UPDATE conversations SET title='人工标题' WHERE id=?",conversation);titles.finish(job,result(job,"模型标题"));assertEquals("人工标题",title());}
 @Test void expiredJobIsTerminalAndKeepsFallback(){send("分析合成收款");var job=queued();db.update("UPDATE conversation_titles SET started_at=now()-interval '70 seconds' WHERE request_id=?",job.request());assertNull(titles.claim());titles.finish(job,result(job,"迟到标题"));assertEquals("分析合成收款",title());assertEquals("UNKNOWN",db.queryForObject("SELECT state FROM conversation_titles WHERE request_id=?",String.class,job.request()));}
 @Test void backgroundAndDiscussionNamesAreNotRegenerated(){send("分析合成收款");db.update("UPDATE conversations SET purpose='BRIEFING_GENERATION' WHERE id=?",conversation);titles.request(actor,tenant,conversation);assertNull(titles.claim());}
}
