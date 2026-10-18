package com.dreamcore.workspace;

import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.experience.*;
import com.dreamcore.workspace.profile.*;
import java.nio.file.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;

/** Build engine first. This explicitly exercises HTTP callbacks + PostgreSQL + the real Harness with a synthetic model. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=verification","dreamcore.tasks.initial-delay-ms=3600000"})
class TaskContextHarnessIT {
 @Autowired ConversationService conversations;@Autowired AgentTaskService agents;@Autowired ProfileService profiles;@Autowired ExperienceService experiences;@Autowired JdbcTemplate db;@LocalServerPort int port;
 @Test void actualHarnessChoosesReferencesRecordsExactMethodAndPreservesUnknownBusinessOutcome() throws Exception {
  UUID tenant=UUID.randomUUID(),owner=UUID.randomUUID(),space=UUID.randomUUID();db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,'not-a-login')",owner,owner+"@example.test","合成上下文 Harness");db.update("INSERT INTO tenants(id,name) VALUES (?,'合成上下文企业')",tenant);db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,owner);db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'合成私人空间','PERSONAL')",space,tenant,owner);
  profiles.create(owner,tenant,ProfileService.Scope.PERSONAL,owner,"format",ProfileService.Kind.PREFERENCE,new ProfileService.Content("简明中文","合成明确偏好",ProfileService.Status.ACTIVE,null),UUID.randomUUID());
  var method=experiences.create(owner,tenant,space,UUID.randomUUID(),new ExperienceService.Content("METHOD","预算分析","合成预算参考","先核对数据口径，再形成草稿",List.of("budget"),"具备口径与数据","缺少关键输入","授权读取","合成方法，业务效果未验证","INDEPENDENT_COPY"),List.of());experiences.publish(owner,tenant,space,method.id(),UUID.randomUUID(),method.revision(),method.version().id(),true);
  // Engine discovery now admits only automatically checked methods. This is fixture
  // qualification, not a production approval or a test of the automatic evaluator.
  assertTrue(experiences.engineList(owner,tenant,space,"预算",0,3).items().isEmpty());
  db.update("UPDATE experience_versions SET origin='AUTOMATIC',evaluation='AUTOMATIC_CHECKED' WHERE id=?",method.version().id());
  Path root=Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();assertTrue(Files.exists(root.resolve("engine/dist/runtime/task-context.js")));String token="synthetic-context-012345678901234567890123";
  Process engine=new ProcessBuilder("node",root.resolve("engine/tests/fixtures/task-context-server.mjs").toString(),"http://127.0.0.1:"+port,token).redirectError(ProcessBuilder.Redirect.INHERIT).start();
  try(var pool=Executors.newSingleThreadExecutor();var lines=new BufferedReader(new InputStreamReader(engine.getInputStream()))){String endpoint=pool.submit(lines::readLine).get(5,TimeUnit.SECONDS);assertNotNull(endpoint);var runtime=new EngineTaskRuntime(endpoint,token,"verification",false);conversations.submit(owner,tenant,null,space,UUID.randomUUID(),"只写当前草稿，不发送；合成预算口径和输入已具备","AGENT");var task=conversations.claim();var result=runtime.executeAgent(task.id(),task.token(),task.prompt(),()->agents.active(task));assertEquals("COMPLETE",result.outcome());assertEquals(5,result.modelCalls());assertEquals(4,result.tools().size());assertTrue(result.tools().stream().allMatch(t->t.name().equals("task_context")&&t.status().equals("succeeded")));agents.finish(task,result);
   assertEquals("SUCCEEDED",conversations.detail(owner,tenant,task.conversation(),0,20).tasks().getFirst().status());assertEquals(2,db.queryForObject("SELECT count(*) FROM task_context_reads WHERE task_id=?",Integer.class,task.id()));assertEquals(method.version().id(),db.queryForObject("SELECT version_id FROM experience_uses WHERE task_id=?",UUID.class,task.id()));assertEquals(1,db.queryForObject("SELECT count(*) FROM task_context_reviews WHERE task_id=? AND use_id IS NOT NULL",Integer.class,task.id()));assertEquals(0,db.queryForObject("SELECT count(*) FROM experience_feedback f JOIN experience_uses u ON u.id=f.use_id WHERE u.task_id=?",Integer.class,task.id()));assertEquals(4,db.queryForObject("SELECT count(*) FROM conversation_tool_receipts WHERE task_id=? AND status='succeeded'",Integer.class,task.id()));assertEquals(5,db.queryForObject("SELECT count(*) FROM agent_model_requests WHERE task_id=? AND outcome='RETURNED'",Integer.class,task.id()));
  }finally{engine.destroy();if(!engine.waitFor(3,TimeUnit.SECONDS))engine.destroyForcibly();db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);}
 }
}
