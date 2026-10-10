package com.dreamcore.workspace.profile;
import com.dreamcore.workspace.identity.IdentityException;
import jakarta.annotation.PreDestroy;
import java.util.*;import java.util.concurrent.*;
import org.springframework.beans.factory.annotation.Value;import org.springframework.stereotype.Component;import org.springframework.scheduling.annotation.*;

@Component
@EnableScheduling
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
public class CompanyAnalysisWorker {
 private final CompanyAnalysisQueue queue;private final CompanyInferenceService inference;private final CompanyAnalysisRuntime runtime;private final boolean enabled;
 private final ExecutorService pool=Executors.newVirtualThreadPerTaskExecutor();private final Semaphore capacity=new Semaphore(2);private final Set<UUID> local=ConcurrentHashMap.newKeySet();
 public CompanyAnalysisWorker(CompanyAnalysisQueue queue,CompanyInferenceService inference,CompanyAnalysisRuntime runtime,@Value("${dreamcore.company-analysis.enabled:false}") boolean enabled){this.queue=queue;this.inference=inference;this.runtime=runtime;this.enabled=enabled;}
 @Scheduled(fixedDelayString="${dreamcore.company-analysis.poll-ms:3000}",initialDelayString="${dreamcore.company-analysis.initial-delay-ms:30000}")
 public void tick(){if(enabled&&runtime.configured())runOnce();}
 public void runOnce(){
  for(var recovery:queue.recoveries())if(!local.contains(recovery.id()))recover(recovery);
  queue.discover();
  for(UUID tenant:queue.tenants()){
   if(!capacity.tryAcquire())break;
   CompanyInferenceService.Job job;
   try{job=queue.claim(tenant);}catch(Exception unavailable){capacity.release();continue;}
   if(job==null){capacity.release();continue;}
   local.add(job.id());
   try{pool.submit(()->{try{execute(job);}finally{local.remove(job.id());capacity.release();}});}
   catch(RejectedExecutionException stopped){local.remove(job.id());capacity.release();queue.fail(job.id(),"COMPANY_WORKER_STOPPED",false,null);}
  }
 }
 public void execute(CompanyInferenceService.Job job){
  boolean sent=false;
  try{
   var descriptor=runtime.preflight();queue.dispatched(job,descriptor);sent=true;
   accept(runtime.execute(job,descriptor,()->inference.active(job.id(),job.lease())));
  }catch(CompanyAnalysisRuntime.Failure failure){
   if(failure.code.equals("COMPANY_RESULT_UNKNOWN")&&failure.sent)queue.uncertain(job.id());
   else queue.fail(job.id(),failure.code,failure.sent,null);
  }catch(Exception failure){
   if(sent)queue.uncertain(job.id());
   else queue.fail(job.id(),failure instanceof IdentityException?"COMPANY_SOURCE_CHANGED":"COMPANY_DISPATCH_FAILED",false,null);
  }
 }
 public void accept(CompanyAnalysisRuntime.Result result){
  if(!result.outcome().equals("COMPLETE")){queue.fail(result.runId(),result.outcome().equals("CANCELLED")?"COMPANY_SOURCE_CHANGED":"COMPANY_ANALYSIS_FAILED",true,result);return;}
  try{queue.complete(result);}
  catch(IdentityException changed){queue.fail(result.runId(),changed.status==422||changed.status==400?"COMPANY_EVIDENCE_INVALID":"COMPANY_SOURCE_CHANGED",true,result);}
 }
 public void recover(CompanyAnalysisQueue.Recovery r){
  if(r.state().equals("CLAIMED")){queue.fail(r.id(),"COMPANY_WORKER_STOPPED",false,null);return;}
  if(r.recoveryExpired()){queue.fail(r.id(),"COMPANY_RESULT_UNKNOWN",true,null);return;}
  try{
   var result=runtime.recover(r.id(),r.lease(),r.engineVersion());
   if(result==null){if(r.expired())runtime.cancel(r.id(),r.lease());return;}
   if(r.expired())queue.fail(r.id(),"COMPANY_LEASE_EXPIRED",true,result);
   else accept(result);
  }catch(CompanyAnalysisRuntime.Failure unavailable){/* Retry receipt lookup on the next tick; never resend the model request. */}
 }
 @PreDestroy public void stop(){pool.shutdownNow();}
}
