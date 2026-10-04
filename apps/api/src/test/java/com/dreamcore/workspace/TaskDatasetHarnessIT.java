package com.dreamcore.workspace;
import com.dreamcore.workspace.context.*;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import java.net.*;
import java.net.http.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.JsonNode;
import static org.junit.jupiter.api.Assertions.*;
/** Explicit integration test: build the engine before invoking this class. */
class TaskDatasetHarnessIT extends TaskDatasetFixture {
 @Test void actualHarnessReadsDatasetOverHttpAndPersistsRealToolReceipts()throws Exception{
  var root=java.nio.file.Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();
  assertTrue(java.nio.file.Files.exists(root.resolve("engine/dist/runtime/task-context.js")));String secret="synthetic-dataset-012345678901234567890";
  var engine=new ProcessBuilder("node",root.resolve("engine/tests/fixtures/dataset-context-server.mjs").toString(),"http://127.0.0.1:"+port,secret).redirectError(ProcessBuilder.Redirect.INHERIT).start();
  try(var pool=java.util.concurrent.Executors.newSingleThreadExecutor();var lines=new java.io.BufferedReader(new java.io.InputStreamReader(engine.getInputStream()))){
   String endpoint=pool.submit(lines::readLine).get(5,java.util.concurrent.TimeUnit.SECONDS);assertNotNull(endpoint);
   var task=task(null,"AUTHORIZED_LIBRARY");var runtime=new EngineTaskRuntime(endpoint,secret,"verification",false);
   var result=runtime.executeAgent(task.id(),task.token(),task.prompt(),()->agents.active(task));assertEquals("COMPLETE",result.outcome());assertEquals(4,result.modelCalls());assertEquals(3,result.tools().size());assertTrue(result.tools().stream().allMatch(t->t.name().equals("task_context")&&t.status().equals("succeeded")));
   agents.finish(task,result);assertEquals(snapshot,db.queryForObject("SELECT snapshot_id FROM task_dataset_reads WHERE task_id=?",UUID.class,task.id()));
   assertEquals(3,db.queryForObject("SELECT count(*) FROM conversation_tool_receipts WHERE task_id=? AND status='succeeded'",Integer.class,task.id()));assertEquals(4,db.queryForObject("SELECT count(*) FROM agent_model_requests WHERE task_id=? AND outcome='RETURNED'",Integer.class,task.id()));
   assertEquals("SUCCEEDED",conversations.detail(owner,tenant,task.conversation(),0,20).tasks().getFirst().status());
  }finally{engine.destroy();if(!engine.waitFor(3,java.util.concurrent.TimeUnit.SECONDS))engine.destroyForcibly();}
 }
}
