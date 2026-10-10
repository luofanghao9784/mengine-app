package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import static org.junit.jupiter.api.Assertions.*;
/** Optional cloud acceptance in an isolated test DB; never uses a production user's session. */
@EnabledIfEnvironmentVariable(named="LIVE_DATASET_FIXTURE",matches=".+")
class LiveDatasetAnalysisIntegrationTest extends DatasetCalculationFixture {
 @Override List<String> columns(){return List.of("amount_cents","method","status","paid_at");}
 @Override List<List<String>> rowsFor(String marker){try{return json.readValue(Files.readString(Path.of(System.getenv("LIVE_DATASET_FIXTURE"))),List.class);}catch(Exception e){throw new IllegalStateException("Fixture unavailable",e);}}
 @Test void realModelComputesWholeSnapshotAndDeliversVerifiedCard() throws Exception {
  var j=task(null,"AUTHORIZED_LIBRARY");
  var result=Files.createTempFile("dataset-live-result-",".json");var log=Files.createTempFile("dataset-live-log-",".txt");
  try {
   var p=new ProcessBuilder(System.getenv("LIVE_NODE_BIN"),System.getenv("LIVE_DATASET_SCRIPT"));
   p.environment().put("LIVE_TASK_URL","http://127.0.0.1:"+port+"/internal/v1/agent-access/"+j.id());
   p.environment().put("LIVE_TASK_TOKEN",j.token().toString());p.environment().put("LIVE_RESULT_PATH",result.toString());
   p.redirectErrorStream(true).redirectOutput(log.toFile());var process=p.start();
   if(!process.waitFor(75,java.util.concurrent.TimeUnit.SECONDS)){process.destroyForcibly();fail("Live verification timeout");}if(System.getenv("LIVE_DIAGNOSTIC_PATH")!=null)Files.copy(result,Path.of(System.getenv("LIVE_DIAGNOSTIC_PATH")),StandardCopyOption.REPLACE_EXISTING);assertEquals(0,process.exitValue(),Files.readString(log));
   var r=json.readTree(Files.readString(result));var outputs=r.path("tools");boolean computed=false,delivered=false;
   for(var t:outputs){if(t.path("name").asString().equals("compare_dataset")&&t.path("status").asString().equals("succeeded")){
    var c=t.path("output").path("calculation");assertEquals(rowsFor("old").size(),c.path("matchedRows").asInt());assertEquals(0,c.path("ignoredRows").asInt());assertEquals(System.getenv("LIVE_EXPECTED_TOTAL"),c.path("total").asString());computed=true;
   }if(t.path("name").asString().equals("deliver_briefing")&&t.path("status").asString().equals("succeeded"))delivered=true;}
   assertTrue(computed);assertTrue(delivered);
   var cards=db.queryForList("SELECT content FROM conversation_artifacts WHERE task_id=? AND filename LIKE 'briefing-%'",byte[].class,j.id());
   assertFalse(cards.isEmpty());assertTrue(cards.stream().anyMatch(b->new String(b,java.nio.charset.StandardCharsets.UTF_8).contains("\"unit\":\"分\"")));
  } finally {Files.deleteIfExists(result);Files.deleteIfExists(log);}
 }
}
