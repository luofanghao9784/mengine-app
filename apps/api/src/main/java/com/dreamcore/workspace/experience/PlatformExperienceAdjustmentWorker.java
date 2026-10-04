package com.dreamcore.workspace.experience;

import jakarta.annotation.PreDestroy;
import java.util.*;
import java.util.concurrent.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.scheduling.annotation.*;

@Component
@EnableScheduling
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
public class PlatformExperienceAdjustmentWorker {
 private final PlatformExperienceAdjustmentService queue;private final ExperienceAnalysisRuntime analysis;private final ExperienceGeneralizationRuntime general;private final boolean enabled;
 private final ExecutorService pool=Executors.newVirtualThreadPerTaskExecutor();private final Semaphore capacity=new Semaphore(2);private final Set<UUID> local=ConcurrentHashMap.newKeySet();
 public PlatformExperienceAdjustmentWorker(PlatformExperienceAdjustmentService queue,ExperienceAnalysisRuntime analysis,ExperienceGeneralizationRuntime general,@Value("${dreamcore.experience-generalization.enabled:false}") boolean enabled){this.queue=queue;this.analysis=analysis;this.general=general;this.enabled=enabled;}
 @Scheduled(fixedDelayString="${dreamcore.experience-generalization.poll-ms:30000}",initialDelayString="${dreamcore.experience-generalization.initial-delay-ms:30000}")
 public void tick(){if(enabled&&analysis.configured()&&general.configured())runOnce();}
 public void runOnce(){
  for(UUID id:queue.pendingPublications())try{queue.publish(id);}catch(RuntimeException changed){/* Next tick revalidates source and publication; never rerun model calls. */}
  for(var r:queue.recoveries())if(!local.contains(r.id()))recover(r);
  for(int n=0;n<2;n++){
   if(!capacity.tryAcquire())break;PlatformExperienceAdjustmentService.Work work;
   try{work=queue.claim();}catch(RuntimeException busy){capacity.release();continue;}
   if(work==null){capacity.release();break;}local.add(work.id());
   try{pool.submit(()->{try{execute(work);}finally{local.remove(work.id());capacity.release();}});}
   catch(RejectedExecutionException stopped){local.remove(work.id());capacity.release();queue.fail(work.id(),"GENERAL_ADJUSTMENT_WORKER_STOPPED",false);}
  }
 }
 public void execute(PlatformExperienceAdjustmentService.Work w){
  boolean sent=false;
  try{
   if(w.analysis()!=null){var d=analysis.preflight();queue.dispatched(w,d.engineVersion(),d.executionClass());sent=true;queue.complete(analysis.execute(w.analysis(),d,()->queue.active(w.id(),w.lease())));}
   else{var d=general.preflight();queue.dispatched(w,d.engineVersion(),d.executionClass());sent=true;queue.complete(general.execute(w.general(),d,()->queue.active(w.id(),w.lease())));}
  }catch(ExperienceAnalysisRuntime.Failure f){failed(w.id(),f.code,f.sent);}
   catch(ExperienceGeneralizationRuntime.Failure f){failed(w.id(),f.code,f.sent);}
   catch(RuntimeException failure){if(sent)queue.uncertain(w.id());else queue.fail(w.id(),"GENERAL_ADJUSTMENT_DISPATCH_FAILED",false);}
 }
 private void failed(UUID id,String code,boolean sent){if(sent&&code.endsWith("RESULT_UNKNOWN"))queue.uncertain(id);else queue.fail(id,code,sent);}
 public void recover(PlatformExperienceAdjustmentService.Recovery r){
  if(r.state().equals("CLAIMED")){queue.fail(r.id(),"GENERAL_ADJUSTMENT_WORKER_STOPPED",false);return;}
  if(r.recoveryExpired()){cancel(r);queue.fail(r.id(),"GENERAL_ADJUSTMENT_RESULT_UNKNOWN",true);return;}
  try{
   var w=queue.restore(r.id());
   if(w.analysis()!=null){var result=analysis.recover(w.analysis(),r.engineVersion());if(result!=null&&!r.expired()){queue.complete(result);return;}}
   else{var result=general.recover(w.general(),r.engineVersion());if(result!=null&&!r.expired()){queue.complete(result);return;}}
   if(r.expired())cancel(r);
  }catch(ExperienceAnalysisRuntime.Failure | ExperienceGeneralizationRuntime.Failure unknown){/* Only query the original receipt again; do not resend. */}
   catch(RuntimeException changed){cancel(r);queue.fail(r.id(),"GENERAL_ADJUSTMENT_SOURCE_CHANGED",true);}
 }
 private void cancel(PlatformExperienceAdjustmentService.Recovery r){if(r.phase().equals("EXTRACT"))analysis.cancel(r.id(),r.lease());else general.cancel(r.id(),r.lease());}
 @PreDestroy public void stop(){pool.shutdownNow();}
}
