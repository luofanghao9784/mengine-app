package com.dreamcore.workspace;
import com.dreamcore.workspace.profile.*;import java.util.*;import org.junit.jupiter.api.*;import static org.junit.jupiter.api.Assertions.*;import static org.mockito.Mockito.*;

class CompanyAnalysisIntegrationTest extends CompanyAnalysisFixture {

 @org.springframework.beans.factory.annotation.Autowired com.dreamcore.workspace.engine.ExecutionReceipts receipts;
 @Test void durableReceiptsSurviveRuntimeReplacementAndNeverReacceptAnUncertainAttempt(){
  var job=claim();queue.dispatched(job,descriptor());
  var request=new com.dreamcore.workspace.engine.ExecutionReceipts.Claim("a".repeat(64),"synthetic-v1");
  assertEquals("NEW",receipts.claim("COMPANY",job.id(),job.lease(),request).get("state"));
  assertEquals("ACCEPTED",new com.dreamcore.workspace.engine.ExecutionReceipts(db).claim("COMPANY",job.id(),job.lease(),request).get("state"));
  assertThrows(com.dreamcore.workspace.identity.IdentityException.class,()->receipts.claim("COMPANY",job.id(),UUID.randomUUID(),request));
  assertThrows(com.dreamcore.workspace.identity.IdentityException.class,()->receipts.claim("COMPANY",job.id(),job.lease(),new com.dreamcore.workspace.engine.ExecutionReceipts.Claim("b".repeat(64),"synthetic-v1")));
  var mapper=new tools.jackson.databind.json.JsonMapper();var completed=result(job,"COMPLETE");
  var body=new com.dreamcore.workspace.engine.ExecutionReceipts.Finish("a".repeat(64),mapper.readValue(mapper.writeValueAsString(completed),Map.class));
  receipts.finish("COMPANY",job.id(),job.lease(),body);receipts.finish("COMPANY",job.id(),job.lease(),body);
  assertEquals("COMPLETED",receipts.claim("COMPANY",job.id(),job.lease(),request).get("state"));
  var runtime=new CompanyAnalysisRuntime("http://127.0.0.1:1","x".repeat(40),"verification");
  org.springframework.test.util.ReflectionTestUtils.setField(runtime,"receipts",new com.dreamcore.workspace.engine.ExecutionReceipts(db));
  assertEquals(completed,runtime.recover(job.id(),job.lease(),"synthetic-v1"));
  var altered=new HashMap<String,Object>(body.result());altered.put("modelName","changed");
  assertThrows(com.dreamcore.workspace.identity.IdentityException.class,()->receipts.finish("COMPANY",job.id(),job.lease(),new com.dreamcore.workspace.engine.ExecutionReceipts.Finish("a".repeat(64),altered)));
 }
 @Test void modelAuthorizationFailureStopsAutomaticRetryWithoutDiscardingSource(){
  var job=claim();queue.dispatched(job,descriptor());queue.fail(job.id(),"REMOTE_ACCESS_DENIED",true,null);
  assertEquals("FAILED",state());due();assertNull(queue.claim(tenant));
  assertTrue(db.queryForObject("SELECT count(*)>0 FROM company_analysis_items WHERE tenant_id=?",Boolean.class,tenant));
 }

 @org.springframework.beans.factory.annotation.Autowired com.dreamcore.workspace.identity.EngineRetryService retries;
 UUID operator(){
  UUID a=UUID.randomUUID();db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成总台','unused')",a,a+"@retry.test");
  db.update("INSERT INTO platform_accounts(account_id,login_name,password_hash) VALUES (?,?,'unused')",a,a+"@retry.test");db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",a);return a;
 }
 @Test void platformRetryRequeuesOnlyUnfinishedCompanyChunksAndKeepsOldAttempt(){
  UUID actor=operator();var job=claim();queue.dispatched(job,descriptor());queue.fail(job.id(),"COMPANY_RESULT_UNKNOWN",true,null);
  var req=new com.dreamcore.workspace.identity.EngineRetryService.Request(UUID.randomUUID(),tenant,"COMPANY",job.id(),"UNKNOWN",null);
  assertEquals("QUEUED",retries.retry(actor,req).state());assertEquals("UNKNOWN",db.queryForObject("SELECT state FROM company_analysis_attempts WHERE run_id=?",String.class,job.id()));
  var next=queue.claim(tenant);assertNotNull(next);assertNotEquals(job.id(),next.id());
  queue.complete(result(job,"COMPLETE"));assertEquals("RUNNING",state());
  assertEquals("QUEUED",retries.retry(actor,req).state());assertEquals(2,db.queryForObject("SELECT count(*) FROM company_analysis_attempts WHERE tenant_id=?",Integer.class,tenant));
 }
 @Test void historicalCompanyFailureWithSuccessfulSuccessorCannotSpendAgain(){
  UUID actor=operator();var job=claim();queue.dispatched(job,descriptor());queue.fail(job.id(),"COMPANY_ANALYSIS_FAILED",true,null);due();
  var next=queue.claim(tenant);queue.dispatched(next,descriptor());queue.complete(result(next,"COMPLETE"));
  var req=new com.dreamcore.workspace.identity.EngineRetryService.Request(UUID.randomUUID(),tenant,"COMPANY",job.id(),"FAILED",null);
  var ex=assertThrows(com.dreamcore.workspace.identity.IdentityException.class,()->retries.retry(actor,req));
  assertEquals("ENGINE_RETRY_ALREADY_PROCESSED",ex.code);assertEquals("SUCCEEDED",state());
 }
 @Test void twoConcurrentClaimsUseDisjointBatchesAndSlots() throws Exception {
  for(int i=0;i<10;i++)source(space);queue.discover();
  CompanyInferenceService.Job first,second;
  try(var pool=java.util.concurrent.Executors.newFixedThreadPool(2)){
   var a=pool.submit(()->queue.claim(tenant));var b=pool.submit(()->queue.claim(tenant));
   first=a.get(10,java.util.concurrent.TimeUnit.SECONDS);second=b.get(10,java.util.concurrent.TimeUnit.SECONDS);
  }
  assertNotNull(first);assertNotNull(second);assertEquals(1,first.inputs().size());assertEquals(1,second.inputs().size());
  assertTrue(first.inputs().stream().noneMatch(i->second.inputs().stream().anyMatch(j->i.chunkId().equals(j.chunkId()))));
  assertEquals(2,db.queryForObject("SELECT count(DISTINCT dispatch_slot) FROM company_analysis_attempts WHERE tenant_id=?",Integer.class,tenant));
  assertNull(queue.claim(tenant));queue.dispatched(first,descriptor());queue.dispatched(second,descriptor());
  queue.complete(result(first,"COMPLETE"));
  var next=queue.claim(tenant);assertNotNull(next);assertEquals(1,next.inputs().size());assertNull(queue.claim(tenant));
  queue.complete(result(second,"COMPLETE"));
  assertEquals(2,db.queryForObject("SELECT count(*) FROM company_analysis_items WHERE tenant_id=? AND state='SUCCEEDED'",Integer.class,tenant));
 }
 void extraPart(int ordinal,String text){db.update("INSERT INTO knowledge_chunks(id,tenant_id,workspace_id,material_id,version_id,run_id,ordinal,locator,method,content) SELECT ?,tenant_id,workspace_id,material_id,version_id,run_id,?,?,method,? FROM knowledge_chunks WHERE id=?",UUID.randomUUID(),ordinal,"第"+ordinal+"段",text,chunk);}
 @Test void readsWholeShortFileInOrderWhileOnlyPendingPartsChangeState(){
  for(int i=1;i<=20;i++)extraPart(i,"本企业第"+i+"段体育教育说明。");
  queue.discover();db.update("UPDATE company_analysis_items SET state='SUCCEEDED' WHERE chunk_id=?",chunk);
  var job=queue.claim(tenant);assertEquals(21,job.inputs().size());assertEquals(chunk,job.inputs().getFirst().chunkId());assertNull(queue.claim(tenant));
  assertEquals("SUCCEEDED",state());assertEquals(20,db.queryForObject("SELECT count(*) FROM company_analysis_items WHERE run_id=?",Integer.class,job.id()));
  queue.dispatched(job,descriptor());queue.complete(result(job,"COMPLETE"));queue.discover();assertNull(queue.claim(tenant));
 }
 @Test void splitsLongFileIntoBoundedOrderedWindowsWithoutDroppingPendingParts(){
  for(int i=1;i<=8;i++)extraPart(i,"体".repeat(2000));
  var first=claim();assertEquals(4,first.inputs().size());assertTrue(first.inputs().stream().mapToInt(i->i.text().length()).sum()<=8000);assertNull(queue.claim(tenant));
  queue.dispatched(first,descriptor());queue.complete(result(first,"COMPLETE"));
  var second=queue.claim(tenant);assertEquals(4,second.inputs().size());assertTrue(second.inputs().stream().noneMatch(i->first.inputs().stream().anyMatch(j->j.chunkId().equals(i.chunkId()))));
  queue.dispatched(second,descriptor());queue.complete(new CompanyAnalysisRuntime.Result("1.0","synthetic-v1",second.id(),second.lease(),"COMPLETE",null,List.of(),"synthetic",1,12L,3L));
  var last=queue.claim(tenant);assertEquals(1,last.inputs().size());
 }
 @Test void parallelResultCannotOverwriteAnUpdatedGroup(){
  for(int i=0;i<5;i++)source(space);var first=claim();var second=queue.claim(tenant);
  queue.dispatched(first,descriptor());queue.dispatched(second,descriptor());queue.complete(result(first,"COMPLETE"));
  var candidate=new CompanyInferenceService.Candidate(CompanyInformationService.Field.INDUSTRY,null,"体育培训","",List.of(new CompanyInferenceService.Evidence(second.inputs().getFirst().chunkId(),"体育教育")));
  queue.complete(new CompanyAnalysisRuntime.Result("1.0","synthetic-v1",second.id(),second.lease(),"COMPLETE",null,List.of(candidate),"synthetic",1,12L,3L));
  var tags=information.get(admin,tenant).groups().stream().filter(g->g.field()==CompanyInformationService.Field.INDUSTRY).findFirst().orElseThrow().tags();
  assertEquals(1,tags.size());assertEquals("体育教育",tags.getFirst().label());
  assertEquals(1,db.queryForObject("SELECT count(*) FROM company_information_suggestions WHERE run_id=? AND state='PENDING'",Integer.class,second.id()));
 }

 @Test void offlineRecoveryTerminalStateDoesNotRediscoverOrAcceptOldResult(){
  var job=claim();queue.dispatched(job,descriptor());
  db.update("UPDATE company_inference_runs SET state='CANCELLED',fenced=true,lease_until=now(),finished_at=now() WHERE id=?",job.id());
  db.update("UPDATE company_analysis_attempts SET state='CANCELLED',error_code='RECOVERY_QUARANTINE',finished_at=now() WHERE run_id=?",job.id());
  db.update("UPDATE company_analysis_items SET state='FAILED',error_code='RECOVERY_QUARANTINE' WHERE run_id=?",job.id());
  queue.discover();due();assertNull(queue.claim(tenant));
  assertTrue(queue.recoveries().stream().noneMatch(r->r.id().equals(job.id())));
  queue.complete(result(job,"COMPLETE"));
  assertEquals("FAILED",state());
  assertTrue(information.get(admin,tenant).groups().stream().allMatch(g->g.tags().isEmpty()));
  assertNull(db.queryForObject("SELECT model_calls FROM company_analysis_attempts WHERE run_id=?",Integer.class,job.id()));
 }
 @Test void discoveryIsIdempotentAndExcludesPrivateOrUnpublishedSources(){
  source(personal);UUID attachment=source(space);db.update("UPDATE materials SET in_library=false WHERE id=(SELECT material_id FROM knowledge_chunks WHERE id=?)",attachment);
  var job=claim();assertEquals(1,job.inputs().size());assertEquals(chunk,job.inputs().getFirst().chunkId());assertNull(queue.claim(tenant));queue.discover();assertEquals(1,db.queryForObject("SELECT count(*) FROM company_analysis_items WHERE tenant_id=?",Integer.class,tenant));
 }
 @Test void committedResultsAreIdempotentAndRetainRealUsageWithoutRescanning(){
  var job=claim();queue.dispatched(job,descriptor());assertEquals(descriptor().executionClass(),db.queryForObject("SELECT execution_class FROM company_analysis_attempts WHERE run_id=?",String.class,job.id()));var result=result(job,"COMPLETE");queue.complete(result);queue.complete(result);queue.discover();assertEquals("SUCCEEDED",state());assertNull(queue.claim(tenant));
  assertEquals(1,information.get(reader,tenant).groups().stream().filter(g->g.field()==CompanyInformationService.Field.INDUSTRY).findFirst().orElseThrow().tags().size());assertEquals(12L,db.queryForObject("SELECT input_tokens FROM company_analysis_attempts WHERE run_id=?",Long.class,job.id()));assertEquals("IDLE",queue.status(reader,tenant,true).state());
 }
 @Test void confirmedModelFailuresBackOffAndStopAfterThreeAttempts(){
  for(int n=1;n<=3;n++){var job=claim();assertNotNull(job);queue.dispatched(job,descriptor());queue.fail(job.id(),"COMPANY_ANALYSIS_FAILED",true,result(job,"FAILED"));assertEquals(n==3?"FAILED":"RETRY_WAIT",state());assertNull(queue.claim(tenant));due();}
  assertNull(queue.claim(tenant));assertEquals(3,db.queryForObject("SELECT count(*) FROM company_analysis_attempts WHERE tenant_id=?",Integer.class,tenant));assertEquals(3,db.queryForObject("SELECT sum(model_calls) FROM company_analysis_attempts WHERE tenant_id=?",Integer.class,tenant));assertEquals("ATTENTION",queue.status(admin,tenant,true).state());
 }
 @Test void unavailablePreflightDoesNotConsumeAModelAttemptOrInventUnknownCost(){
  var job=claim();queue.fail(job.id(),"COMPANY_ENGINE_UNAVAILABLE",false,null);assertEquals("RETRY_WAIT",state());assertEquals(0,db.queryForObject("SELECT attempts FROM company_analysis_items WHERE chunk_id=?",Integer.class,chunk));assertEquals(0,db.queryForObject("SELECT model_calls FROM company_analysis_attempts WHERE run_id=?",Integer.class,job.id()));assertEquals("DISABLED",queue.status(admin,tenant,false).state());
 }
 @Test void lostResultUsesLookupAndTransientLookupFailureNeverResendsTheModel(){
  var job=claim();queue.dispatched(job,descriptor());queue.uncertain(job.id());var runtime=mock(CompanyAnalysisRuntime.class);var worker=new CompanyAnalysisWorker(queue,inference,runtime,true);
  var recovery=new CompanyAnalysisQueue.Recovery(job.id(),job.lease(),"synthetic-v1","DISPATCHED",false,false);
  when(runtime.recover(job.id(),job.lease(),"synthetic-v1")).thenThrow(new CompanyAnalysisRuntime.Failure("COMPANY_RESULT_UNKNOWN",true)).thenReturn(result(job,"COMPLETE"));
  worker.recover(recovery);assertEquals("RUNNING",state());assertNull(queue.claim(tenant));worker.recover(recovery);assertEquals("SUCCEEDED",state());verify(runtime,times(2)).recover(job.id(),job.lease(),"synthetic-v1");verify(runtime,never()).execute(any(),any(),any());worker.stop();
 }
 @Test void expiredUnrecoverableExecutionIsUnknownAndNotAutomaticallyRepeated(){
  var job=claim();queue.dispatched(job,descriptor());var runtime=mock(CompanyAnalysisRuntime.class);var worker=new CompanyAnalysisWorker(queue,inference,runtime,true);worker.recover(new CompanyAnalysisQueue.Recovery(job.id(),job.lease(),"synthetic-v1","DISPATCHED",true,true));
  assertEquals("UNKNOWN",state());assertNull(db.queryForObject("SELECT model_calls FROM company_analysis_attempts WHERE run_id=?",Integer.class,job.id()));due();queue.discover();assertNull(queue.claim(tenant));worker.stop();
 }
 @Test void revocationRejectsOldResultsAndNewAuthorityRequiresANewRun(){
  var job=claim();queue.dispatched(job,descriptor());db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,reader);db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES (?,?,?)",tenant,space,reader);
  var worker=new CompanyAnalysisWorker(queue,inference,mock(CompanyAnalysisRuntime.class),true);worker.accept(result(job,"COMPLETE"));assertEquals("CANCELLED",state());assertTrue(information.get(admin,tenant).groups().stream().allMatch(g->g.tags().isEmpty()));queue.discover();due();var next=queue.claim(tenant);assertNotNull(next);assertNotEquals(job.id(),next.id());worker.stop();
 }
 @Test void crashBeforeDispatchIsSafelyRetryableAndDoesNotReportAProviderCall(){
  var job=claim();var worker=new CompanyAnalysisWorker(queue,inference,mock(CompanyAnalysisRuntime.class),true);worker.recover(new CompanyAnalysisQueue.Recovery(job.id(),job.lease(),null,"CLAIMED",true,false));assertEquals("RETRY_WAIT",state());assertEquals(0L,db.queryForObject("SELECT input_tokens FROM company_analysis_attempts WHERE run_id=?",Long.class,job.id()));worker.stop();
 }
 @Test void confirmedFailuresShrinkOrderedBatchesWithoutSkippingInputs(){
  for(int i=1;i<=8;i++)extraPart(i,"体".repeat(900));
  var first=claim();assertEquals(9,first.inputs().size());queue.dispatched(first,descriptor());
  queue.fail(first.id(),"MODEL_CALL_LIMIT",true,result(first,"FAILED"));due();
  var second=queue.claim(tenant);assertTrue(second.inputs().size()<first.inputs().size());
  assertTrue(second.inputs().stream().mapToInt(i->i.text().length()).sum()<=4000);
  assertEquals(chunk,second.inputs().getFirst().chunkId());queue.dispatched(second,descriptor());
  queue.fail(second.id(),"MODEL_CALL_LIMIT",true,result(second,"FAILED"));due();
  var third=queue.claim(tenant);assertTrue(third.inputs().stream().mapToInt(i->i.text().length()).sum()<=2000);
  queue.dispatched(third,descriptor());queue.complete(result(third,"COMPLETE"));
  assertNotNull(queue.claim(tenant));assertEquals(9,db.queryForObject("SELECT count(*) FROM company_analysis_items WHERE tenant_id=?",Integer.class,tenant));
 }
 @Test void providerDiagnosticSurvivesAndStoppedWorkerDoesNotClaimMore(){
  var job=claim();queue.dispatched(job,descriptor());var worker=new CompanyAnalysisWorker(queue,inference,mock(CompanyAnalysisRuntime.class),true);
  worker.accept(new CompanyAnalysisRuntime.Result("1.0","synthetic-v1",job.id(),job.lease(),"FAILED","REMOTE_UNAVAILABLE",List.of(),"synthetic",1,null,null));
  assertEquals("REMOTE_UNAVAILABLE",db.queryForObject("SELECT error_code FROM company_analysis_attempts WHERE run_id=?",String.class,job.id()));
  assertEquals("RETRY_WAIT",state());due();worker.stop();worker.runOnce();assertEquals("RETRY_WAIT",state());
  assertEquals(1,db.queryForObject("SELECT count(*) FROM company_analysis_attempts WHERE tenant_id=?",Integer.class,tenant));
 }
 @Test void workerPreservesOnlySafeDiagnosticCodes(){
  var job=claim();queue.dispatched(job,descriptor());var worker=new CompanyAnalysisWorker(queue,inference,mock(CompanyAnalysisRuntime.class),true);
  worker.accept(new CompanyAnalysisRuntime.Result("1.0","synthetic-v1",job.id(),job.lease(),"FAILED","MODEL_CALL_LIMIT",List.of(),"synthetic",8,12L,3L));
  assertEquals("MODEL_CALL_LIMIT",db.queryForObject("SELECT error_code FROM company_analysis_attempts WHERE run_id=?",String.class,job.id()));
  due();job=queue.claim(tenant);queue.dispatched(job,descriptor());
  worker.accept(new CompanyAnalysisRuntime.Result("1.0","synthetic-v1",job.id(),job.lease(),"FAILED","secret arbitrary payload",List.of(),"synthetic",1,12L,3L));
  assertEquals("COMPANY_ANALYSIS_FAILED",db.queryForObject("SELECT error_code FROM company_analysis_attempts WHERE run_id=?",String.class,job.id()));worker.stop();
 }

 @Test void confirmedLostReceiptReleasesOnlyExpiredLeaseAndNeverResends(){
  var job=claim();queue.dispatched(job,descriptor());var runtime=mock(CompanyAnalysisRuntime.class);
  when(runtime.recover(job.id(),job.lease(),"synthetic-v1")).thenThrow(new CompanyAnalysisRuntime.Failure("COMPANY_RESULT_LOST",true));
  var worker=new CompanyAnalysisWorker(queue,inference,runtime,true);
  worker.recover(new CompanyAnalysisQueue.Recovery(job.id(),job.lease(),"synthetic-v1","DISPATCHED",false,false));assertEquals("RUNNING",state());
  worker.recover(new CompanyAnalysisQueue.Recovery(job.id(),job.lease(),"synthetic-v1","DISPATCHED",true,false));assertEquals("UNKNOWN",state());
  due();queue.discover();assertNull(queue.claim(tenant));verify(runtime,never()).execute(any(),any(),any());worker.stop();
 }

}
