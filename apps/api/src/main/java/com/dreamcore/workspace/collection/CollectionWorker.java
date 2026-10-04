package com.dreamcore.workspace.collection;
import jakarta.annotation.PreDestroy;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
@Component
@org.springframework.scheduling.annotation.EnableScheduling
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
public class CollectionWorker {
    private final CollectionService service;private final CollectionAdapter adapter;private final boolean enabled;
    private final ExecutorService executor=Executors.newVirtualThreadPerTaskExecutor();private final Semaphore capacity;
    public CollectionWorker(CollectionService service,CollectionAdapter adapter,@Value("${dreamcore.collection.enabled:true}") boolean enabled,
        @Value("${dreamcore.collection.concurrency:2}") int concurrency){this.service=service;this.adapter=adapter;this.enabled=enabled;capacity=new Semaphore(Math.max(1,Math.min(16,concurrency)));}
    @Scheduled(fixedDelayString="${dreamcore.collection.poll-ms:3000}",initialDelayString="${dreamcore.collection.initial-delay-ms:10000}")
    public void tick(){if(enabled&&adapter.available())runOnce();}
    public void runOnce(){
        for(var candidate:service.candidates()){
            UUID tenant=(UUID)candidate.get("tenant_id"),connection=(UUID)candidate.get("id");
            try {
                service.schedule(tenant,connection,Instant.now());
                if(!capacity.tryAcquire())break;
                CollectionService.Claim claim;
                try{claim=service.claim(tenant,connection,Instant.now());}catch(Exception e){capacity.release();continue;}
                if(claim==null){capacity.release();continue;}
                try{executor.submit(()->{try{execute(claim);}finally{capacity.release();}});}catch(RejectedExecutionException e){capacity.release();service.fail(claim,"COLLECTION_ADAPTER_FAILED",Instant.now());}
            } catch(Exception ignored){/* No adapter output, secrets or business payload in operational logs. Next poll rechecks durable state. */}
        }
    }
    public void execute(CollectionService.Claim claim){
        try{service.complete(claim,adapter.collect(claim.request(),()->service.active(claim)),Instant.now());}
        catch(Exception e){service.fail(claim,e instanceof TimeoutException?"COLLECTION_TIMEOUT":"COLLECTION_ADAPTER_FAILED",Instant.now());}
    }
    @PreDestroy public void stop(){executor.shutdownNow();}
}
