package com.dreamcore.workspace;
import com.dreamcore.workspace.experience.ExperienceAnalysisRuntime;
import java.util.*;import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** Real HTTP and two actual Harness sessions, with synthetic model output only. */
class ExperienceAnalysisHarnessIT {
 static UUID id(int n){return UUID.fromString("00000000-0000-4000-8000-"+String.format("%012d",n));}
 static ExperienceAnalysisRuntime.Job job(){return new ExperienceAnalysisRuntime.Job(UUID.randomUUID(),UUID.randomUUID(),id(3),id(4),List.of(
  new ExperienceAnalysisRuntime.Input(id(5),"TASK_INPUT","比较两个期间的数据，口径不一致时需标明限制。",true),
  new ExperienceAnalysisRuntime.Input(id(6),"EXECUTION_RECORD","计算工具返回：两期覆盖范围不一致，未计算不可靠的增长率。",true)),List.of(),List.of("合成客户甲"));}
 @Test void fixedSourcesRunBothStagesAndRecoverWithoutClaimingAdmission()throws Exception{
  var root=java.nio.file.Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();assertTrue(java.nio.file.Files.exists(root.resolve("engine/dist/runtime/experience-analysis.js")));
  String token="synthetic-experience-012345678901234567890";
  var engine=new ProcessBuilder("node",root.resolve("engine/tests/fixtures/experience-analysis-server.mjs").toString(),token).redirectError(ProcessBuilder.Redirect.INHERIT).start();
  try(var pool=Executors.newSingleThreadExecutor();var lines=new java.io.BufferedReader(new java.io.InputStreamReader(engine.getInputStream()))){
   String endpoint=pool.submit(lines::readLine).get(5,TimeUnit.SECONDS);assertNotNull(endpoint);var runtime=new ExperienceAnalysisRuntime(endpoint,token,"verification");var descriptor=runtime.preflight();var job=job();
   var result=runtime.execute(job,descriptor,()->true);assertEquals("QUALIFIED",result.outcome());assertEquals(false,result.admitted());assertEquals("verification",result.executionClass());
   assertEquals(2,result.stages().size());assertEquals(9,result.stages().stream().mapToInt(ExperienceAnalysisRuntime.Stage::modelCalls).sum());assertEquals(90L,result.stages().stream().mapToLong(ExperienceAnalysisRuntime.Stage::inputTokens).sum());
   assertEquals("比较前先核对覆盖范围",result.candidate().title());assertEquals(result,runtime.recover(job,descriptor.engineVersion()));
   // A verification process can never masquerade as a configured live evaluator.
   var mismatch=new ExperienceAnalysisRuntime(endpoint,token,"live");assertEquals("EXPERIENCE_ENGINE_INCOMPATIBLE",assertThrows(ExperienceAnalysisRuntime.Failure.class,mismatch::preflight).code);
   var inactive=job();var failure=assertThrows(ExperienceAnalysisRuntime.Failure.class,()->runtime.execute(inactive,descriptor,()->false));assertFalse(failure.sent);assertEquals("EXPERIENCE_SOURCE_CHANGED",failure.code);
   assertThrows(ExperienceAnalysisRuntime.Failure.class,()->runtime.recover(inactive,descriptor.engineVersion()));
  }finally{engine.destroy();if(!engine.waitFor(3,TimeUnit.SECONDS))engine.destroyForcibly();}
 }
}
