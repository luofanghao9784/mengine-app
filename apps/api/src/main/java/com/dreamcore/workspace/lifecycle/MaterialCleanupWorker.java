package com.dreamcore.workspace.lifecycle;
import org.springframework.boot.autoconfigure.condition.*;
import org.springframework.scheduling.annotation.*;
import org.springframework.stereotype.Component;
@Component @EnableScheduling
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnProperty(name="dreamcore.lifecycle.enabled",havingValue="true",matchIfMissing=true)
public class MaterialCleanupWorker {
    private final MaterialLifecycleService lifecycle;private final MaterialCleanupService cleanup;
    public MaterialCleanupWorker(MaterialLifecycleService lifecycle,MaterialCleanupService cleanup){this.lifecycle=lifecycle;this.cleanup=cleanup;}
    @Scheduled(fixedDelayString="${dreamcore.lifecycle.poll-ms:30000}",initialDelayString="${dreamcore.lifecycle.initial-delay-ms:30000}")
    public void tick(){
        try{lifecycle.enqueueDue();}catch(Exception ignored){/* No state is claimed complete; recheck due policy on next tick. */}
        MaterialCleanupService.Job job;try{job=cleanup.claim();}catch(Exception e){return;}if(job==null)return;
        try{for(var object:cleanup.pending(job)){cleanup.remove(object);cleanup.removed(job,object);}cleanup.finish(job);}
        catch(Exception e){cleanup.fail(job);}
    }
}
