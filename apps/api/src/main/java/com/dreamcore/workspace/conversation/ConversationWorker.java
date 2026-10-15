package com.dreamcore.workspace.conversation;
import com.dreamcore.workspace.identity.IdentityException;
import org.springframework.boot.autoconfigure.condition.*;
import org.springframework.scheduling.annotation.*;
import org.springframework.stereotype.Component;
@Component @EnableScheduling
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnProperty(name="dreamcore.tasks.enabled",havingValue="true")
public class ConversationWorker {
    private final java.util.concurrent.ExecutorService executor=java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor();
    private final java.util.concurrent.Semaphore slots;
    private final int concurrency;
    private volatile boolean stopping;
    @org.springframework.beans.factory.annotation.Autowired private AgentReceiptRecovery receiptRecovery;
    @jakarta.annotation.PreDestroy public void stop(){stopping=true;executor.shutdownNow();}
    private final ConversationService service;private final TaskRuntime runtime;private final AgentTaskService agents;
    public ConversationWorker(ConversationService service,TaskRuntime runtime,AgentTaskService agents,
        @org.springframework.beans.factory.annotation.Value("${dreamcore.tasks.concurrency:20}") int concurrency){
        if(concurrency<1 || concurrency>20)throw new IllegalArgumentException("Task concurrency must be between 1 and 20");
        this.service=service;this.runtime=runtime;this.agents=agents;this.concurrency=concurrency;this.slots=new java.util.concurrent.Semaphore(concurrency);
    }
    @Scheduled(fixedDelayString="${dreamcore.tasks.poll-ms:500}",initialDelayString="${dreamcore.tasks.initial-delay-ms:1000}")
    public void tick(){
        if(stopping)return;
        try{if(receiptRecovery!=null)receiptRecovery.recover();}catch(Exception unavailable){return;}
        for(int i=0;i<concurrency && slots.tryAcquire();i++){
            ConversationService.Job job;
            try{job=service.claim();}catch(Exception error){slots.release();return;}
            if(job==null){slots.release();return;}
            try{executor.execute(()->{try{execute(job);}finally{slots.release();}});}
            catch(java.util.concurrent.RejectedExecutionException error){slots.release();service.fail(job,"TASK_RUNTIME_UNAVAILABLE");return;}
        }
    }
    private void execute(ConversationService.Job job){
        try{if("AGENT".equals(job.mode()))agents.finish(job,runtime.executeAgent(job.id(),job.token(),job.prompt(),()->agents.active(job)));
            else{var sources=service.sources(job);if(sources!=null)service.finish(job,runtime.execute(job.id(),job.token(),sources));}}
        catch(IdentityException error){if(!stopping)service.fail(job,SetSupport.denied(error)?"TASK_SOURCE_UNAVAILABLE":error.code);}
        catch(Exception error){if(!stopping)service.fail(job,"TASK_RUNTIME_UNAVAILABLE");}
    }
    private static class SetSupport {static boolean denied(IdentityException e){return e.status==401 || e.status==403 || e.status==404;}}
}
