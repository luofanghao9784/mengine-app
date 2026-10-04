package com.dreamcore.workspace;

import com.dreamcore.workspace.experience.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** Real internal HTTP and five actual Harness sessions, synthetic models only; never admission. */
class PlatformExperienceProcessingIntegrationTest {
 @Test void tenantFreeCorrectionPassesGroundingThenCleaningWithoutPublicationOrCrossScopeReplay()throws Exception {
  Path root=Path.of(System.getProperty("user.dir")).toAbsolutePath();while(root!=null&&!Files.exists(root.resolve("engine/tests/fixtures/experience-dispatch-server.mjs")))root=root.getParent();assertNotNull(root);
  String token="synthetic-platform-adjustment-012345678901234567890";
  var analysis=new ProcessBuilder("node",root.resolve("engine/tests/fixtures/experience-dispatch-server.mjs").toString(),token,"adjust").redirectError(ProcessBuilder.Redirect.INHERIT).start();
  Process cleaning=null;
  try(var pool=Executors.newSingleThreadExecutor();var input=new java.io.BufferedReader(new java.io.InputStreamReader(analysis.getInputStream()))) {
   String endpoint=pool.submit(input::readLine).get(5,TimeUnit.SECONDS);assertNotNull(endpoint);
   var runtime=new ExperienceAnalysisRuntime(endpoint,token,"verification");var descriptor=runtime.preflight();var fixedVersion=UUID.randomUUID();
   var job=ExperienceAnalysisRuntime.Job.platform(UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),List.of(
    new ExperienceAnalysisRuntime.Input(UUID.randomUUID(),"SOURCE_EXCERPT","工具回执只能证明执行状态，需要核对业务结果依据。",true),
    new ExperienceAnalysisRuntime.Input(UUID.randomUUID(),"FEEDBACK","增加限制：没有回执时不能推断执行成功。",true)),List.of(
    new ExperienceAnalysisRuntime.Existing(fixedVersion,"区分执行与结果","先检查回执",List.of("读取实际工具状态"),List.of("有工具回执"),List.of("无业务结果不能确认效果"))),List.of());
   var result=runtime.execute(job,descriptor,()->true);
   assertEquals("QUALIFIED",result.outcome());assertEquals(fixedVersion,result.candidate().targetVersionId());assertEquals("FEEDBACK_CORRECTION",result.review().basis());assertEquals("verification",result.executionClass());assertEquals(false,result.admitted());
   assertEquals("PLATFORM",result.scope());assertEquals(result,runtime.recover(job,descriptor.engineVersion()));
   assertEquals(result,runtime.validateReceipt(result,job,descriptor.engineVersion()));
   var borrowed=new ExperienceAnalysisRuntime.Job(job.id(),job.lease(),UUID.randomUUID(),job.source(),job.inputs(),job.existing(),job.protectedValues());
   assertEquals("EXPERIENCE_RESULT_UNKNOWN",assertThrows(ExperienceAnalysisRuntime.Failure.class,()->runtime.execute(borrowed,descriptor,()->true)).code);
   assertThrows(ExperienceAnalysisRuntime.Failure.class,()->runtime.recover(borrowed,descriptor.engineVersion()));
   cleaning=new ProcessBuilder("node",root.resolve("engine/tests/fixtures/experience-generalization-server.mjs").toString(),token,"FEEDBACK_CORRECTION").redirectError(ProcessBuilder.Redirect.INHERIT).start();
   try(var lines=new java.io.BufferedReader(new java.io.InputStreamReader(cleaning.getInputStream()))) {
    var generalizer=new ExperienceGeneralizationRuntime(pool.submit(lines::readLine).get(5,TimeUnit.SECONDS),token,"verification");var gd=generalizer.preflight();var c=result.candidate();
    var gjob=ExperienceGeneralizationRuntime.Job.platform(UUID.randomUUID(),UUID.randomUUID(),job.source(),new ExperienceGeneralizationRuntime.Method(c.title(),c.summary(),c.steps(),c.applicable(),c.excluded(),c.tags(),result.review().basis()),List.of());
    var cleaned=generalizer.execute(gjob,gd,()->true);assertEquals("QUALIFIED",cleaned.outcome());assertEquals("FEEDBACK_CORRECTION",cleaned.method().basis());assertEquals(false,cleaned.admitted());assertEquals("verification",cleaned.executionClass());
    assertEquals("PLATFORM",cleaned.scope());assertEquals(5,result.stages().size()+cleaned.stages().size());assertEquals(cleaned,generalizer.recover(gjob,gd.engineVersion()));
    assertEquals(cleaned,generalizer.validateReceipt(cleaned,gjob,gd.engineVersion(),"verification"));
   }
  } finally {
   for(Process p:new Process[]{analysis,cleaning})if(p!=null){p.destroy();if(!p.waitFor(3,TimeUnit.SECONDS))p.destroyForcibly();}
  }
 }
}
