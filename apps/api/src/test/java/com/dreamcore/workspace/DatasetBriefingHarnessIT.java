package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class DatasetBriefingHarnessIT extends DatasetCalculationFixture {
 @Test void actualHarnessComputesWholeDatasetAndDeliversPrivateChartWithVersionedSource() throws Exception {
  var root=java.nio.file.Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();
  String token="synthetic-dataset-briefing-012345678901234567890";
  var engine=new ProcessBuilder("node",root.resolve("engine/tests/fixtures/dataset-briefing-server.mjs").toString(),"http://127.0.0.1:"+port,token).redirectError(ProcessBuilder.Redirect.INHERIT).start();
  try(var pool=java.util.concurrent.Executors.newSingleThreadExecutor();var lines=new java.io.BufferedReader(new java.io.InputStreamReader(engine.getInputStream()))){
   String endpoint=pool.submit(lines::readLine).get(5,java.util.concurrent.TimeUnit.SECONDS);assertNotNull(endpoint);
   var job=task(null,"AUTHORIZED_LIBRARY");var runtime=new EngineTaskRuntime(endpoint,token,"verification",false);var result=runtime.executeAgent(job.id(),job.token(),job.prompt(),()->agents.active(job));
   assertEquals("COMPLETE",result.outcome());assertEquals(5,result.modelCalls());assertEquals(4,result.tools().size());assertTrue(result.tools().stream().allMatch(t->t.status().equals("succeeded")));agents.finish(job,result);
   var t=conversations.taskDetail(owner,tenant,job.conversation(),job.id()).tasks().getFirst();var card=agents.briefing(owner,tenant,job.conversation(),job.id(),t.revision(),1);
   assertEquals("1.20",card.content().chart().totals().current());assertEquals(snapshot,card.content().datasetSource().snapshotId());assertNull(card.content().datasetSource().coverageThrough());assertNull(card.content().source());assertEquals("briefing-dataset-v1",card.content().schemaVersion());
   assertEquals(4,db.queryForObject("SELECT count(*) FROM conversation_tool_receipts WHERE task_id=? AND status='succeeded'",Integer.class,job.id()));
   db.update("UPDATE dataset_snapshots SET scrubbed=true,data_rows='[]'::jsonb WHERE id=?",snapshot);assertEquals(0,db.queryForObject("SELECT coalesce(sum(octet_length(content)),0) FROM conversation_artifacts WHERE task_id=?",Integer.class,job.id()));denied(()->agents.briefing(owner,tenant,job.conversation(),job.id(),t.revision(),1));
  } finally {engine.destroy();if(!engine.waitFor(3,java.util.concurrent.TimeUnit.SECONDS))engine.destroyForcibly();}
 }
}
