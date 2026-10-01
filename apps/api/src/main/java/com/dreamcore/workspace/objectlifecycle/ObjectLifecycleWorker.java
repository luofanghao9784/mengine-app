package com.dreamcore.workspace.objectlifecycle;
import org.springframework.boot.autoconfigure.condition.*;
import org.springframework.scheduling.annotation.*;
import org.springframework.stereotype.Component;
@Component @EnableScheduling @ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnProperty(name="dreamcore.object-lifecycle.enabled",havingValue="true",matchIfMissing=true)
public class ObjectLifecycleWorker {
 private final ObjectLifecycleService service;private final ObjectCleanupService cleanup;
 public ObjectLifecycleWorker(ObjectLifecycleService service,ObjectCleanupService cleanup){this.service=service;this.cleanup=cleanup;}
 @Scheduled(fixedDelayString="${dreamcore.object-lifecycle.poll-ms:30000}",initialDelayString="${dreamcore.object-lifecycle.initial-delay-ms:30000}")
 public void tick(){try{service.bindPolicies();service.enqueueDue();}catch(Exception ignored){return;}for(var id:cleanup.pending())try{cleanup.clean(id);}catch(Exception e){cleanup.fail(id);}}
}
