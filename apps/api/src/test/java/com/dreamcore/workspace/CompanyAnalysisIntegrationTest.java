package com.dreamcore.workspace;
import com.dreamcore.workspace.profile.*;import java.util.*;import org.junit.jupiter.api.*;import static org.junit.jupiter.api.Assertions.*;import static org.mockito.Mockito.*;

class CompanyAnalysisIntegrationTest extends CompanyAnalysisFixture {
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
}
