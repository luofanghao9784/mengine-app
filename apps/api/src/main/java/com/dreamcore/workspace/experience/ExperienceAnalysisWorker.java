package com.dreamcore.workspace.experience;
import com.dreamcore.workspace.identity.IdentityException;
import jakarta.annotation.PreDestroy;
import java.util.*;import java.util.concurrent.*;
import org.springframework.beans.factory.annotation.Value;import org.springframework.stereotype.Component;import org.springframework.scheduling.annotation.*;

@Component
@EnableScheduling
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
public class ExperienceAnalysisWorker {
 private final ExperienceAnalysisQueue queue;private final ExperienceAnalysisRuntime runtime;private final boolean enabled;
 private final ExecutorService pool=Executors.newVirtualThreadPerTaskExecutor();private final Semaphore capacity=new Semaphore(2);private final Set<UUID> local=ConcurrentHashMap.newKeySet();
 public ExperienceAnalysisWorker(ExperienceAnalysisQueue queue,ExperienceAnalysisRuntime runtime,@Value("${dreamcore.experience-analysis.enabled:false}") boolean enabled){this.queue=queue;this.runtime=runtime;this.enabled=enabled;}
 @Scheduled(fixedDelayString="${dreamcore.experience-analysis.poll-ms:30000}",initialDelayString="${dreamcore.experience-analysis.initial-delay-ms:30000}")
 public void tick(){if(enabled&&runtime.configured())runOnce();}
 public void runOnce(){
  for(var recovery:queue.recoveries())if(!local.contains(recovery.id()))recover(recovery);
  queue.discover();
  for(UUID tenant:queue.tenants()){
   if(!capacity.tryAcquire())break;
   ExperienceAnalysisRuntime.Job job;
   try{job=queue.claim(tenant);}catch(Exception unavailable){capacity.release();continue;}
   if(job==null){capacity.release();continue;}
   local.add(job.id());
   try{pool.submit(()->{try{execute(job);}finally{local.remove(job.id());capacity.release();}});}
   catch(RejectedExecutionException stopped){local.remove(job.id());capacity.release();queue.fail(job.id(),"EXPERIENCE_WORKER_STOPPED",false,null);}
  }
 }
 public void execute(ExperienceAnalysisRuntime.Job job){
  boolean sent=false;
  try{
   var descriptor=runtime.preflight();queue.dispatched(job,descriptor);sent=true;
   accept(runtime.execute(job,descriptor,()->queue.active(job.id(),job.lease())));
  }catch(ExperienceAnalysisRuntime.Failure failure){
   if(failure.code.equals("EXPERIENCE_RESULT_UNKNOWN")&&failure.sent)queue.uncertain(job.id());
   else queue.fail(job.id(),failure.code,failure.sent,null);
  }catch(Exception failure){
   if(sent)queue.uncertain(job.id());
   else queue.fail(job.id(),failure instanceof IdentityException?"EXPERIENCE_SOURCE_CHANGED":"EXPERIENCE_DISPATCH_FAILED",false,null);
  }
 }
 public void accept(ExperienceAnalysisRuntime.Result result){
  if(!Set.of("QUALIFIED","SKIPPED","REJECTED").contains(result.outcome())){queue.fail(result.runId(),result.outcome().equals("CANCELLED")?"EXPERIENCE_SOURCE_CHANGED":"EXPERIENCE_ANALYSIS_FAILED",true,result);return;}
  try{queue.complete(result);}
  catch(IdentityException changed){queue.fail(result.runId(),changed.code.equals("EXPERIENCE_VERIFICATION_ONLY")?changed.code:changed.status==422||changed.status==400?"EXPERIENCE_EVIDENCE_INVALID":"EXPERIENCE_SOURCE_CHANGED",true,result);}
 }
 public void recover(ExperienceAnalysisQueue.Recovery r){
  if(r.state().equals("CLAIMED")){queue.fail(r.id(),"EXPERIENCE_WORKER_STOPPED",false,null);return;}
  if(r.recoveryExpired()){queue.fail(r.id(),"EXPERIENCE_RESULT_UNKNOWN",true,null);return;}
  try{
   var result=runtime.recover(queue.restore(r.id()),r.engineVersion());
   if(result==null){if(r.expired())runtime.cancel(r.id(),r.lease());return;}
   if(r.expired())queue.fail(r.id(),"EXPERIENCE_LEASE_EXPIRED",true,result);
   else accept(result);
  }catch(IdentityException sourceChanged){runtime.cancel(r.id(),r.lease());queue.fail(r.id(),"EXPERIENCE_SOURCE_CHANGED",true,null);}
  catch(ExperienceAnalysisRuntime.Failure unavailable){/* Retry receipt lookup on the next tick; never resend the model request. */}
 }
 @PreDestroy public void stop(){pool.shutdownNow();}
}
