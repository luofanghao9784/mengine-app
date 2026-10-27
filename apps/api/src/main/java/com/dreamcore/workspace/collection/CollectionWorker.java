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
    private final com.dreamcore.workspace.scheduling.IdleGate idle=new com.dreamcore.workspace.scheduling.IdleGate();
    private final ExecutorService executor=Executors.newVirtualThreadPerTaskExecutor();private final Semaphore capacity;
    public CollectionWorker(CollectionService service,CollectionAdapter adapter,@Value("${dreamcore.collection.enabled:true}") boolean enabled,
        @Value("${dreamcore.collection.concurrency:2}") int concurrency){this.service=service;this.adapter=adapter;this.enabled=enabled;capacity=new Semaphore(Math.max(1,Math.min(16,concurrency)));}
    @Scheduled(fixedDelayString="${dreamcore.collection.poll-ms:3000}",initialDelayString="${dreamcore.collection.initial-delay-ms:10000}")
    public void tick(){
        if(!enabled||!adapter.available())return;
        long now=System.currentTimeMillis();
        if(idle.resting(now))return;
        if(service.candidates().isEmpty()){idle.rest(now);return;}
        idle.work();
        runOnce();
    }
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
        try{
            var result=adapter.collect(claim.request(),()->service.active(claim));
            for(int attempt=0;;attempt++) {
                try { service.complete(claim,result,Instant.now()); break; }
                catch(RuntimeException failed) {
                    // complete is transactional: retry only after its transaction rolled back.
                    // Keep the same lease and adapter result; do not re-read or regenerate source data.
                    if(attempt>=2 || !transactionConflict(failed))throw failed;
                    Thread.sleep(100L*(attempt+1));
                }
            }
        }
        catch(Exception e){
            // Diagnostic types only: never log exception messages, SQL, credentials or source rows.
            String sqlState="";
            for(Throwable t=e;t!=null;t=t.getCause()) if(t instanceof java.sql.SQLException sql) {
                String code=sql.getSQLState();if(code!=null&&code.matches("[A-Z0-9]{5}"))sqlState=code;
            }
            org.slf4j.LoggerFactory.getLogger(getClass()).warn("Collection failed: run={} exception={} sqlState={}",claim.runId(),e.getClass().getSimpleName(),sqlState);
            service.fail(claim,e instanceof TimeoutException?"COLLECTION_TIMEOUT":"COLLECTION_ADAPTER_FAILED",Instant.now());
        }
    }
    private boolean transactionConflict(Throwable failure) {
        for(Throwable cause=failure;cause!=null;cause=cause.getCause())
            if(cause instanceof java.sql.SQLException sql && java.util.Set.of("40P01","40001").contains(sql.getSQLState()))return true;
        return false;
    }
    @PreDestroy public void stop(){executor.shutdownNow();}
}
