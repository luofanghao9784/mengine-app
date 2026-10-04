package com.dreamcore.workspace;
import com.dreamcore.workspace.profile.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** Explicit HTTP + actual Harness integration; uses only a synthetic model. */
class CompanyAnalysisHarnessIT extends CompanyAnalysisFixture {
 @Test void automaticQueueRunsHarnessAndSavesGroundedCompanyInformation() throws Exception {
  var root=java.nio.file.Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();
  assertTrue(java.nio.file.Files.exists(root.resolve("engine/dist/runtime/company-analysis.js")));
  String token="synthetic-company-012345678901234567890";
  var engine=new ProcessBuilder("node",root.resolve("engine/tests/fixtures/company-analysis-server.mjs").toString(),token).redirectError(ProcessBuilder.Redirect.INHERIT).start();
  try(var pool=Executors.newSingleThreadExecutor();var lines=new java.io.BufferedReader(new java.io.InputStreamReader(engine.getInputStream()))){
   String endpoint=pool.submit(lines::readLine).get(5,TimeUnit.SECONDS);assertNotNull(endpoint);
   var runtime=new CompanyAnalysisRuntime(endpoint,token,"verification");var job=claim();
   var worker=new CompanyAnalysisWorker(queue,inference,runtime,false);
   try{worker.execute(job);}finally{worker.stop();}
   assertEquals("SUCCEEDED",state(),()->db.queryForMap("SELECT state,error_code,model_calls FROM company_analysis_attempts WHERE run_id=?",job.id()).toString());
   var tag=information.get(admin,tenant).groups().stream().filter(g->g.field()==CompanyInformationService.Field.INDUSTRY).findFirst().orElseThrow().tags().getFirst();
   assertEquals("体育教育",tag.label());
   assertEquals(3,db.queryForObject("SELECT model_calls FROM company_analysis_attempts WHERE run_id=?",Integer.class,job.id()));
   assertEquals(30L,db.queryForObject("SELECT input_tokens FROM company_analysis_attempts WHERE run_id=?",Long.class,job.id()));
   assertEquals(6L,db.queryForObject("SELECT output_tokens FROM company_analysis_attempts WHERE run_id=?",Long.class,job.id()));
   assertEquals("本企业从事体育教育。",inference.evidence(admin,tenant,tag.id(),tag.revision()).getFirst().quote());
   var recovered=runtime.recover(job.id(),job.lease(),runtime.preflight().engineVersion());
   assertEquals("COMPLETE",recovered.outcome());assertEquals(3,recovered.modelCalls());
   queue.complete(recovered);assertEquals(1,information.get(admin,tenant).groups().stream().filter(g->g.field()==CompanyInformationService.Field.INDUSTRY).findFirst().orElseThrow().tags().size());
   // A later source is discovered and dispatched automatically, with existing AI tags in context.
   var next=source(space);var automatic=new CompanyAnalysisWorker(queue,inference,runtime,true);
   try{
    automatic.tick();long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
    while(System.nanoTime()<until&&db.queryForObject("SELECT count(*) FROM company_analysis_items WHERE chunk_id=? AND state='SUCCEEDED'",Integer.class,next)==0)Thread.sleep(25);
    assertEquals("SUCCEEDED",db.queryForObject("SELECT state FROM company_analysis_items WHERE chunk_id=?",String.class,next));
    assertEquals(2,db.queryForObject("SELECT count(*) FROM company_analysis_attempts WHERE tenant_id=? AND state='RETURNED'",Integer.class,tenant));
   }finally{automatic.stop();}
  } finally {engine.destroy();if(!engine.waitFor(3,TimeUnit.SECONDS))engine.destroyForcibly();}
 }
}
