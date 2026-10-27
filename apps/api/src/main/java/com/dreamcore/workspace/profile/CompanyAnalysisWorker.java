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
 private final ExecutorService pool=Executors.newVirtualThreadPerTaskExecutor();private final Semaphore capacity=new Semaphore(2);private volatile boolean stopping;private final Set<UUID> local=ConcurrentHashMap.newKeySet();
 private long chunkWatermark;private long nextDiscover;
 public CompanyAnalysisWorker(CompanyAnalysisQueue queue,CompanyInferenceService inference,CompanyAnalysisRuntime runtime,@Value("${dreamcore.company-analysis.enabled:false}") boolean enabled){this.queue=queue;this.inference=inference;this.runtime=runtime;this.enabled=enabled;}
 @Scheduled(fixedDelayString="${dreamcore.company-analysis.poll-ms:3000}",initialDelayString="${dreamcore.company-analysis.initial-delay-ms:30000}")
 public void tick(){
  if(!enabled||!runtime.configured()||stopping)return;
  long now=System.currentTimeMillis();
  boolean actionable=queue.hasActionableWork();
  long mark=queue.knowledgeWatermark();
  boolean changed=mark>chunkWatermark;
  if(!actionable&&!changed&&now<nextDiscover)return;
  runOnce();
  chunkWatermark=mark;
  if(!actionable)nextDiscover=now+60_000L;
 }
 public synchronized void runOnce(){
  if(stopping)return;
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
 private static String diagnosticCode(String code){
  return code!=null&&Set.of("MODEL_CALL_LIMIT","TOOL_CALL_LIMIT","TIME_LIMIT","MODEL_OUTPUT_LIMIT","INVALID_MODEL_RESPONSE","MODEL_INCOMPLETE","INVALID_TOOL_ARGUMENTS","COMPANY_INPUT_INCOMPLETE","COMPANY_EVIDENCE_INVALID","SOURCE_NOT_GRANTED","PROFILE_NOT_GRANTED","TOOL_OUTPUT_LIMIT","TOOL_FAILED","RUNTIME_FAILED","MODEL_NOT_CONFIGURED","COMPANY_DELIVERY_MISSING","MODEL_RATE_LIMITED", "MODEL_PROVIDER_UNAVAILABLE", "MODEL_REQUEST_REJECTED", "MODEL_TIMEOUT", "MODEL_NETWORK_ERROR", "REMOTE_ACCESS_DENIED","REMOTE_UNAVAILABLE","INVALID_REMOTE_RESPONSE","REMOTE_OUTPUT_LIMIT","MODEL_INPUT_LIMIT","INVALID_MODEL_INPUT").contains(code)?code:"COMPANY_ANALYSIS_FAILED";
 }
 public void accept(CompanyAnalysisRuntime.Result result){
  if(!result.outcome().equals("COMPLETE")){queue.fail(result.runId(),result.outcome().equals("CANCELLED")?"COMPANY_SOURCE_CHANGED":diagnosticCode(result.code()),true,result);return;}
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
  }catch(CompanyAnalysisRuntime.Failure unavailable){
   // Only a verified missing receipt after lease expiry can release the slot early.
   // Network errors remain recoverable; neither path resends an uncertain model request.
   if(r.expired()&&unavailable.code.equals("COMPANY_RESULT_LOST"))queue.fail(r.id(),"COMPANY_RESULT_UNKNOWN",true,null);
  }
 }
 @PreDestroy public synchronized void stop(){
  stopping=true;pool.shutdown();
  try{if(!pool.awaitTermination(10,TimeUnit.SECONDS))pool.shutdownNow();}
  catch(InterruptedException interrupted){pool.shutdownNow();Thread.currentThread().interrupt();}
 }
}
