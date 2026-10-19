package com.dreamcore.workspace;
import com.dreamcore.workspace.experience.ExperienceAnalysisRuntime;
import com.sun.net.httpserver.HttpServer;
import java.net.*;import java.util.*;import java.util.concurrent.atomic.*;
import org.junit.jupiter.api.*;import static org.junit.jupiter.api.Assertions.*;
import tools.jackson.databind.json.JsonMapper;

class ExperienceAnalysisRuntimeTest {
 final JsonMapper json=new JsonMapper();HttpServer server;String base;final String token="synthetic-experience-runtime-012345678901234567890";
 final AtomicReference<String> response=new AtomicReference<>();final AtomicInteger code=new AtomicInteger(200),posts=new AtomicInteger();
 ExperienceAnalysisRuntime runtime;ExperienceAnalysisRuntime.Job job;
 @BeforeEach void start()throws Exception{job=ExperienceAnalysisHarnessIT.job();server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);server.createContext("/internal/v1/experience",exchange->{
  if(exchange.getRequestMethod().equals("POST"))posts.incrementAndGet();String body=exchange.getRequestURI().getPath().endsWith("/runtime")?"{\"contractVersion\":\"1.0\",\"engineVersion\":\"synthetic-v1\",\"configured\":true,\"executionClass\":\"verification\"}":response.get();
  var bytes=body.getBytes(java.nio.charset.StandardCharsets.UTF_8);exchange.sendResponseHeaders(code.get(),bytes.length);exchange.getResponseBody().write(bytes);exchange.close();
 });server.start();base="http://127.0.0.1:"+server.getAddress().getPort();runtime=new ExperienceAnalysisRuntime(base,token,"verification");response.set(json.writeValueAsString(receipt()));}
 @AfterEach void stop(){server.stop(0);}
 Map<String,Object> receipt(){
  var evidence=List.of(Map.of("inputId",ExperienceAnalysisHarnessIT.id(6),"quote","两期覆盖范围不一致，未计算不可靠的增长率"));
  var candidate=new LinkedHashMap<String,Object>();candidate.put("targetVersionId",null);candidate.put("title","合成方法");candidate.put("summary","先比较覆盖范围");candidate.put("steps",List.of("检查覆盖范围"));candidate.put("applicable",List.of("固定期间"));candidate.put("excluded",List.of("缺少口径"));candidate.put("tags",List.of("比较"));candidate.put("evidence",evidence);
  var review=Map.of("checks",Map.of("grounded","PASS","reusable","PASS","bounded","PASS","privacySafe","PASS","novel","PASS"),"basis","OBSERVED_EXECUTION","evidence",evidence);
  var result=new LinkedHashMap<String,Object>();result.put("contractVersion","1.0");result.put("engineVersion","synthetic-v1");result.put("executionClass","verification");result.put("runId",job.id());result.put("lease",job.lease());result.put("source",job.source());result.put("admitted",false);result.put("outcome","QUALIFIED");result.put("code",null);result.put("candidate",candidate);result.put("review",review);result.put("stages",List.of(stage("EXTRACT"),stage("VERIFY")));return result;
 }
 Map<String,Object> stage(String name){var s=new LinkedHashMap<String,Object>();s.put("stage",name);s.put("modelName","synthetic");s.put("modelCalls",1);s.put("inputTokens",null);s.put("outputTokens",null);return s;}
 void reject(Map<String,Object> r){response.set(json.writeValueAsString(r));var ex=assertThrows(ExperienceAnalysisRuntime.Failure.class,()->runtime.recover(job,"synthetic-v1"));assertEquals("EXPERIENCE_RESULT_UNKNOWN",ex.code);assertTrue(ex.sent);}
 @Test void wrongSourceLeaseRuntimeOrPrematureAdmissionCannotBeAccepted(){for(String field:List.of("source","lease","runId","engineVersion","executionClass","admitted")){var r=receipt();r.put(field,field.equals("admitted")?true:field.endsWith("Version")?"wrong":field.equals("executionClass")?"live":UUID.randomUUID());reject(r);}}
 @Test void partialChecksOrUnreliableEvidenceCannotQualify(){
  for(String quality:List.of("UNKNOWN","FAIL")){var r=receipt();r.put("review",Map.of("checks",Map.of("grounded","PASS","reusable","PASS","bounded","PASS","privacySafe",quality,"novel","PASS"),"basis","OBSERVED_EXECUTION","evidence",List.of(Map.of("inputId",ExperienceAnalysisHarnessIT.id(6),"quote","两期覆盖范围不一致"))));reject(r);}
  var r=receipt();r.put("review",Map.of("checks",Map.of("grounded","PASS","reusable","PASS","bounded","PASS","privacySafe","PASS","novel","PASS"),"basis","REPORTED_ONLY","evidence",List.of(Map.of("inputId",ExperienceAnalysisHarnessIT.id(6),"quote","两期覆盖范围不一致"))));reject(r);
 }
 @SuppressWarnings("unchecked") @Test void fabricatedQuotesAndPrivateCandidateTextAreFencedAgainByPlatform(){
  for(String title:List.of("合成客户甲","合成\u200b客户甲","user@example.com")){var r=receipt();((Map<String,Object>)r.get("candidate")).put("title",title);reject(r);}
  var r=receipt();((Map<String,Object>)r.get("candidate")).put("evidence",List.of(Map.of("inputId",ExperienceAnalysisHarnessIT.id(6),"quote","无此原文")));reject(r);
 }
 @Test void missingReviewerAndHalfKnownUsageAreNotValidReceipts(){
  var r=receipt();r.put("stages",List.of(stage("EXTRACT")));reject(r);
  r=receipt();var second=stage("VERIFY");second.put("inputTokens",10);r.put("stages",List.of(stage("EXTRACT"),second));reject(r);
  r=receipt();second=stage("VERIFY");second.put("modelCalls",0);r.put("stages",List.of(stage("EXTRACT"),second));reject(r);
 }
 @Test void pendingAndUnknownRecoveriesDoNotSendAnotherPost(){
  code.set(202);assertNull(runtime.recover(job,"synthetic-v1"));code.set(404);assertThrows(ExperienceAnalysisRuntime.Failure.class,()->runtime.recover(job,"synthetic-v1"));assertEquals(0,posts.get());
 }
 @Test void modelOffAndUnsafeEndpointsFailBeforeDispatch(){
  assertFalse(new ExperienceAnalysisRuntime(base,token,"off").configured());assertThrows(ExperienceAnalysisRuntime.Failure.class,()->new ExperienceAnalysisRuntime(base,token,"off").preflight());
  for(String path:List.of("file:///tmp/engine","https://user:password@example.test","https://example.test/path","https://example.test?query"))assertThrows(IllegalArgumentException.class,()->new ExperienceAnalysisRuntime(path,token,"verification"));assertEquals(0,posts.get());
 }
 ExperienceAnalysisRuntime.Job platformJob(){
  var i=job.inputs();
  return ExperienceAnalysisRuntime.Job.platform(job.id(),job.lease(),job.source(),List.of(
   new ExperienceAnalysisRuntime.Input(i.get(0).id(),"SOURCE_EXCERPT",i.get(0).text(),true),
   new ExperienceAnalysisRuntime.Input(i.get(1).id(),"FEEDBACK",i.get(1).text(),true)),List.of(
   new ExperienceAnalysisRuntime.Existing(ExperienceAnalysisHarnessIT.id(8),"固定通用方法","清洗后方法",List.of("检查覆盖范围"),List.of("期间比较"),List.of("范围未知"))),List.of());
 }
 @SuppressWarnings("unchecked") Map<String,Object> platformReceipt(){
  var r=receipt();r.put("scope","PLATFORM");((Map<String,Object>)r.get("candidate")).put("targetVersionId",ExperienceAnalysisHarnessIT.id(8));
  r.put("review",Map.of("checks",Map.of("grounded","PASS","reusable","PASS","bounded","PASS","privacySafe","PASS","novel","PASS"),"basis","FEEDBACK_CORRECTION","evidence",List.of(
   Map.of("inputId",job.inputs().get(0).id(),"quote",job.inputs().get(0).text()),
   Map.of("inputId",job.inputs().get(1).id(),"quote",job.inputs().get(1).text()))));return r;
 }
 @Test void explicitPlatformJobCarriesNoTenantAndKeepsLegacyTenantWireShape(){
  var legacy=json.readTree(json.writeValueAsString(job));assertFalse(legacy.has("scope"));assertEquals(job.tenant().toString(),legacy.path("tenant").asString());
  job=platformJob();var wire=json.readTree(json.writeValueAsString(job));assertTrue(wire.path("tenant").isNull());assertEquals("PLATFORM",wire.path("scope").asString());
  response.set(json.writeValueAsString(platformReceipt()));var result=runtime.execute(job,runtime.preflight(),()->true);
  assertEquals("QUALIFIED",result.outcome());assertEquals("FEEDBACK_CORRECTION",result.review().basis());assertEquals(result,runtime.validateReceipt(result,job,"synthetic-v1"));assertEquals(1,posts.get());
  var borrowed=new ExperienceAnalysisRuntime.Job(job.id(),job.lease(),UUID.randomUUID(),job.source(),job.inputs(),job.existing(),job.protectedValues());
  assertThrows(ExperienceAnalysisRuntime.Failure.class,()->runtime.recover(borrowed,"synthetic-v1"));
  var missing=platformReceipt();missing.remove("scope");reject(missing);missing.put("scope",null);reject(missing);
 }
 @Test void nullOrBorrowedTenantAndTaskInputsNeverReachPlatformEngine(){
  var p=platformJob();
  for(var invalid:List.of(
   new ExperienceAnalysisRuntime.Job(p.id(),p.lease(),null,p.source(),p.inputs(),p.existing(),p.protectedValues()),
   new ExperienceAnalysisRuntime.Job(p.id(),p.lease(),UUID.randomUUID(),p.source(),p.inputs(),p.existing(),p.protectedValues(),"PLATFORM"),
   ExperienceAnalysisRuntime.Job.platform(p.id(),p.lease(),p.source(),job.inputs(),p.existing(),p.protectedValues()),
   ExperienceAnalysisRuntime.Job.platform(p.id(),p.lease(),p.source(),p.inputs(),List.of(),p.protectedValues()),
   ExperienceAnalysisRuntime.Job.platform(p.id(),p.lease(),p.source(),List.of(p.inputs().get(1)),p.existing(),p.protectedValues()))) {
   var ex=assertThrows(ExperienceAnalysisRuntime.Failure.class,()->runtime.execute(invalid,runtime.preflight(),()->true));assertEquals("INVALID_EXPERIENCE_REQUEST",ex.code);assertFalse(ex.sent);
  }
  assertEquals(0,posts.get());
 }
 @SuppressWarnings("unchecked") @Test void platformCorrectionMustTargetFixedVersionAndCannotClaimObservedExecution(){
  job=platformJob();
  for(UUID target:Arrays.asList(null,UUID.randomUUID())){var r=platformReceipt();((Map<String,Object>)r.get("candidate")).put("targetVersionId",target);reject(r);}
  var r=platformReceipt();var review=new HashMap<>((Map<String,Object>)r.get("review"));review.put("basis","OBSERVED_EXECUTION");r.put("review",review);reject(r);
 }

 @Test void failureStageAcceptsOnlyClosedDiagnosticCodesAndLegacyReceiptsStillWork(){
  var r=receipt();r.put("outcome","FAILED");r.put("code","EXPERIENCE_ANALYSIS_FAILED");r.put("candidate",null);r.put("review",null);
  var stage=stage("EXTRACT");stage.put("diagnostic","UNADVERTISED_TOOL");r.put("stages",List.of(stage));
  response.set(json.writeValueAsString(r));var accepted=runtime.recover(job,"synthetic-v1");assertEquals("UNADVERTISED_TOOL",accepted.stages().getFirst().diagnostic());
  stage.put("diagnostic","private provider output");reject(r);
  stage.remove("diagnostic");response.set(json.writeValueAsString(r));assertNull(runtime.recover(job,"synthetic-v1").stages().getFirst().diagnostic());
 }

}
