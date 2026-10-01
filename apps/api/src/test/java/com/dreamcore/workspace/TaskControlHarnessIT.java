package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
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
/** Explicit opt-in integration test: build engine before running -Dtest=TaskControlHarnessIT. Uses no model service. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=verification","dreamcore.tasks.initial-delay-ms=3600000"})
class TaskControlHarnessIT {
 @Autowired ConversationService conversations;@Autowired AgentTaskService agents;@Autowired JdbcTemplate db;@LocalServerPort int port;
 @Test void realHttpCallbacksAndHarnessWaitThenResumeUseSeparateDurableAttempts() throws Exception {
  UUID tenant=UUID.randomUUID(),owner=UUID.randomUUID(),space=UUID.randomUUID();db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",owner,owner+"@example.test","合成 Harness 测试","not-a-login");db.update("INSERT INTO tenants(id,name) VALUES (?,'合成 Harness 企业')",tenant);db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,owner);db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'合成私人空间','PERSONAL')",space,tenant,owner);
  Path root=Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();assertTrue(Files.exists(root.resolve("engine/dist/server.js")),"Run npm run build --prefix engine first");String token="synthetic-control-012345678901234567890123";
  Process engine=new ProcessBuilder("node",root.resolve("engine/tests/fixtures/task-control-server.mjs").toString(),"http://127.0.0.1:"+port,token).redirectError(ProcessBuilder.Redirect.INHERIT).start();
  try(var pool=Executors.newSingleThreadExecutor();var lines=new BufferedReader(new InputStreamReader(engine.getInputStream()))){String endpoint=pool.submit(lines::readLine).get(5,TimeUnit.SECONDS);assertNotNull(endpoint);var runtime=new EngineTaskRuntime(endpoint,token,"verification",false);var detail=conversations.submit(owner,tenant,null,space,UUID.randomUUID(),"分析合成内容","AGENT");var first=conversations.claim();var firstResult=runtime.executeAgent(first.id(),first.token(),first.prompt(),()->agents.active(first));assertEquals("WAITING_INPUT",firstResult.outcome());agents.finish(first,firstResult);assertEquals("WAITING_INPUT",conversations.detail(owner,tenant,detail.conversation().id(),0,20).tasks().getFirst().status());
   conversations.action(owner,tenant,first.conversation(),first.id(),UUID.randomUUID(),2,"RESUME","补充到周五");var second=conversations.claim();var secondResult=runtime.executeAgent(second.id(),second.token(),second.prompt(),()->agents.active(second));assertEquals("COMPLETE",secondResult.outcome());agents.finish(second,secondResult);var history=conversations.attempts(owner,tenant,first.conversation(),first.id(),0,10);assertEquals(List.of("SUCCEEDED","WAITING_INPUT"),history.items().stream().map(ConversationService.Attempt::status).toList());assertEquals(2,db.queryForObject("SELECT count(*) FROM conversation_attempts WHERE task_id=? AND execution_policy='SCOPED_PRIVATE_V2'",Integer.class,first.id()));assertEquals(3,db.queryForObject("SELECT count(*) FROM agent_model_requests WHERE task_id=? AND outcome='RETURNED'",Integer.class,first.id()));assertEquals("succeeded",db.queryForObject("SELECT status FROM conversation_tool_receipts WHERE task_id=?",String.class,first.id()));
  }finally{engine.destroy();if(!engine.waitFor(3,TimeUnit.SECONDS))engine.destroyForcibly();db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);}
 }
}
