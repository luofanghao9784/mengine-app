package com.dreamcore.workspace;
import com.dreamcore.workspace.experience.ExperienceGeneralizationRuntime;
import com.sun.net.httpserver.HttpServer;
import java.net.*;import java.util.*;import java.util.concurrent.*;import java.util.concurrent.atomic.*;import java.nio.file.*;
import org.junit.jupiter.api.*;import static org.junit.jupiter.api.Assertions.*;
import tools.jackson.databind.json.JsonMapper;

class ExperienceGeneralizationRuntimeTest {
 final JsonMapper json=new JsonMapper();HttpServer server;String base;final String token="synthetic-generalization-runtime-012345678901234567890";
 final AtomicReference<String> response=new AtomicReference<>();final AtomicInteger code=new AtomicInteger(200),posts=new AtomicInteger();
 ExperienceGeneralizationRuntime runtime;ExperienceGeneralizationRuntime.Job job;
 static ExperienceGeneralizationRuntime.Method method(){return new ExperienceGeneralizationRuntime.Method("比较前先核对覆盖范围","保留覆盖口径和计算限制",List.of("核对两个期间的覆盖范围，不一致时停止计算增长率"),List.of("两个期间的数值比较"),List.of("不能证明全部场景的业务效果"),List.of("数据比较"),"OBSERVED_EXECUTION");}
 static ExperienceGeneralizationRuntime.Job job(){return new ExperienceGeneralizationRuntime.Job(UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),new ExperienceGeneralizationRuntime.Method("private-original-sentinel","合成客户甲的固定经验",method().steps(),method().applicable(),method().excluded(),method().tags(),method().basis()),List.of("private-original-sentinel","合成客户甲"));}
 @BeforeEach void start()throws Exception{job=job();server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);server.createContext("/internal/v1/experience-generalization",exchange->{
  if(exchange.getRequestMethod().equals("POST"))posts.incrementAndGet();String body=exchange.getRequestURI().getPath().endsWith("/runtime")?"{\"contractVersion\":\"1.0\",\"engineVersion\":\"synthetic-v1\",\"configured\":true,\"executionClass\":\"verification\"}":response.get();
  var bytes=body.getBytes(java.nio.charset.StandardCharsets.UTF_8);exchange.sendResponseHeaders(code.get(),bytes.length);exchange.getResponseBody().write(bytes);exchange.close();
 });server.start();base="http://127.0.0.1:"+server.getAddress().getPort();runtime=new ExperienceGeneralizationRuntime(base,token,"verification");response.set(json.writeValueAsString(receipt()));}
 @AfterEach void stop(){server.stop(0);}
 Map<String,String> checks(Set<String> keys){var result=new HashMap<String,String>();keys.forEach(k->result.put(k,"PASS"));return result;}
 Map<String,Object> receipt(){
  var result=new LinkedHashMap<String,Object>();result.put("contractVersion","1.0");result.put("engineVersion","synthetic-v1");result.put("executionClass","verification");result.put("runId",job.id());result.put("lease",job.lease());result.put("source",job.source());result.put("admitted",false);result.put("outcome","QUALIFIED");result.put("code",null);result.put("method",json.readValue(json.writeValueAsString(method()),Map.class));result.put("privacy",checks(ExperienceGeneralizationRuntime.PRIVACY));result.put("quality",checks(ExperienceGeneralizationRuntime.QUALITY));result.put("stages",List.of(stage("CLEAN"),stage("PRIVACY"),stage("QUALITY")));return result;
 }
 Map<String,Object> stage(String name){var s=new LinkedHashMap<String,Object>();s.put("stage",name);s.put("modelName","synthetic");s.put("modelCalls",1);s.put("inputTokens",null);s.put("outputTokens",null);return s;}
 void reject(Map<String,Object> r){response.set(json.writeValueAsString(r));var ex=assertThrows(ExperienceGeneralizationRuntime.Failure.class,()->runtime.recover(job,"synthetic-v1"));assertEquals("GENERALIZATION_RESULT_UNKNOWN",ex.code);assertTrue(ex.sent);}
 @Test void wrongIdentityRuntimeOrPrematureAdmissionCannotBeAccepted(){for(String field:List.of("source","lease","runId","engineVersion","executionClass","admitted")){var r=receipt();r.put(field,field.equals("admitted")?true:field.equals("engineVersion")?"wrong":field.equals("executionClass")?"live":UUID.randomUUID());reject(r);}}
 @SuppressWarnings("unchecked") @Test void everyPrivacyAndQualityCheckMustExplicitlyPass(){
  for(String part:List.of("privacy","quality"))for(String key:((Map<String,String>)receipt().get(part)).keySet())for(String verdict:List.of("UNKNOWN","FAIL")){var r=receipt();((Map<String,String>)r.get(part)).put(key,verdict);reject(r);}
  var r=receipt();r.put("privacy",null);reject(r);r=receipt();r.put("quality",Map.of());reject(r);
 }
 @SuppressWarnings("unchecked") @Test void privateTextReferencesAndInflatedEvidenceAreFencedAgain(){
  for(String secret:List.of("合成客户甲","合成\u200b客户甲","user@example.test","https://private.test")){var r=receipt();((Map<String,Object>)r.get("method")).put("title",secret);reject(r);}
  for(String extra:List.of("original","quote","tenant","evidence","source")){var r=receipt();((Map<String,Object>)r.get("method")).put(extra,"private");reject(r);r=receipt();r.put(extra,"private");reject(r);}
  var r=receipt();((Map<String,Object>)r.get("method")).put("basis","FEEDBACK_CORRECTION");reject(r);
 }
 @Test void missingOrReorderedStagesAndUnknownUsageAreNotInvented(){
  var r=receipt();r.put("stages",List.of(stage("CLEAN"),stage("QUALITY")));reject(r);
  r=receipt();var privacy=stage("PRIVACY");privacy.put("inputTokens",10);r.put("stages",List.of(stage("CLEAN"),privacy,stage("QUALITY")));reject(r);
  r=receipt();privacy=stage("PRIVACY");privacy.put("modelCalls",0);r.put("stages",List.of(stage("CLEAN"),privacy,stage("QUALITY")));reject(r);
  response.set(json.writeValueAsString(receipt()));assertNull(runtime.recover(job,"synthetic-v1").stages().getFirst().inputTokens());
 }
 @Test void unqualifiedReceiptsNeverCarryContentAndSkipIsNotReview(){
  var r=receipt();r.put("outcome","REJECTED");r.put("code","QUALITY_NOT_ESTABLISHED");reject(r);r.put("method",null);reject(r);
  r.put("quality",new HashMap<>(checks(ExperienceGeneralizationRuntime.QUALITY)));((Map<String,String>)r.get("quality")).put("reusable","UNKNOWN");response.set(json.writeValueAsString(r));assertEquals("REJECTED",runtime.recover(job,"synthetic-v1").outcome());
  r=receipt();r.put("outcome","SKIPPED");r.put("code","REQUIRES_PRIVATE_CONTEXT");r.put("method",null);r.put("privacy",null);r.put("quality",null);r.put("stages",List.of(stage("CLEAN")));response.set(json.writeValueAsString(r));assertEquals("SKIPPED",runtime.recover(job,"synthetic-v1").outcome());
 }
 @Test void unknownAndPendingRecoveriesNeverRedispatch(){code.set(202);assertNull(runtime.recover(job,"synthetic-v1"));code.set(404);assertThrows(ExperienceGeneralizationRuntime.Failure.class,()->runtime.recover(job,"synthetic-v1"));assertEquals(0,posts.get());}
 @Test void unavailableSourceModeOrUnsafeEndpointStopsBeforeDispatch(){
  assertFalse(new ExperienceGeneralizationRuntime(base,token,"off").configured());assertThrows(ExperienceGeneralizationRuntime.Failure.class,()->new ExperienceGeneralizationRuntime(base,token,"off").preflight());
  for(String endpoint:List.of("file:///tmp/engine","https://user:password@example.test","https://example.test/path","https://example.test?query"))assertThrows(IllegalArgumentException.class,()->new ExperienceGeneralizationRuntime(endpoint,token,"verification"));
  var ex=assertThrows(ExperienceGeneralizationRuntime.Failure.class,()->runtime.execute(job,runtime.preflight(),()->false));assertFalse(ex.sent);assertEquals("GENERALIZATION_SOURCE_CHANGED",ex.code);assertEquals(0,posts.get());
 }
 @Test void realHttpAndThreeHarnessSessionsReturnOnlyCleanedResultAndRecoverWithoutReplay()throws Exception{
  Path root=Path.of(System.getProperty("user.dir")).toAbsolutePath();while(root!=null&&!Files.exists(root.resolve("engine/tests/fixtures/experience-generalization-server.mjs")))root=root.getParent();assertNotNull(root);
  var engine=new ProcessBuilder("node",root.resolve("engine/tests/fixtures/experience-generalization-server.mjs").toString(),token).redirectError(ProcessBuilder.Redirect.INHERIT).start();
  try(var pool=Executors.newSingleThreadExecutor();var lines=new java.io.BufferedReader(new java.io.InputStreamReader(engine.getInputStream()))){
   String endpoint=pool.submit(lines::readLine).get(5,TimeUnit.SECONDS);assertNotNull(endpoint);var real=new ExperienceGeneralizationRuntime(endpoint,token,"verification");var d=real.preflight();var result=real.execute(job,d,()->true);
   assertEquals("QUALIFIED",result.outcome());assertEquals(false,result.admitted());assertEquals("verification",result.executionClass());assertEquals(method(),result.method());assertEquals(7,result.stages().stream().mapToInt(ExperienceGeneralizationRuntime.Stage::modelCalls).sum());assertEquals(70L,result.stages().stream().mapToLong(ExperienceGeneralizationRuntime.Stage::inputTokens).sum());assertEquals(result,real.recover(job,d.engineVersion()));
   assertFalse(json.writeValueAsString(result).contains("private-original-sentinel"));assertFalse(json.writeValueAsString(result).contains("合成客户甲"));
   var mismatch=new ExperienceGeneralizationRuntime(endpoint,token,"live");assertEquals("GENERALIZATION_ENGINE_INCOMPATIBLE",assertThrows(ExperienceGeneralizationRuntime.Failure.class,mismatch::preflight).code);
  }finally{engine.destroy();if(!engine.waitFor(3,TimeUnit.SECONDS))engine.destroyForcibly();}
 }
 @Test void malformedFixedInputIsRejectedBeforeAnyModelRequest(){
  var original=new ExperienceGeneralizationRuntime.Method(method().title(),method().summary(),method().steps(),method().applicable(),method().excluded(),method().tags(),null);
  var invalid=new ExperienceGeneralizationRuntime.Job(job.id(),job.lease(),job.tenant(),job.source(),original,List.of());
  var ex=assertThrows(ExperienceGeneralizationRuntime.Failure.class,()->runtime.execute(invalid,runtime.preflight(),()->true));assertFalse(ex.sent);assertEquals("INVALID_GENERALIZATION_REQUEST",ex.code);assertEquals(0,posts.get());
 }
}
