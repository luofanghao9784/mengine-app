package com.dreamcore.workspace.retention;
import org.springframework.boot.autoconfigure.condition.*;
import org.springframework.scheduling.annotation.*;
import org.springframework.stereotype.Component;
@Component @EnableScheduling
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnProperty(name="dreamcore.operation-retention.enabled",havingValue="true",matchIfMissing=true)
public class OperationRetentionWorker {
 private final OperationRetentionService service;
 public OperationRetentionWorker(OperationRetentionService service){this.service=service;}
 @Scheduled(fixedDelayString="${dreamcore.operation-retention.poll-ms:30000}",initialDelayString="${dreamcore.operation-retention.initial-delay-ms:30000}")
 public void tick(){for(long id:service.due())try{service.clean(id);}catch(Exception e){service.failed(id);}}
}
