package com.dreamcore.workspace.briefing;
import org.springframework.boot.autoconfigure.condition.*;
import org.springframework.scheduling.annotation.*;
import org.springframework.stereotype.Component;
@Component @EnableScheduling
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnProperty(name="dreamcore.briefing.enabled",havingValue="true",matchIfMissing=true)
public class BriefingGenerationWorker {
    private static final org.slf4j.Logger log=org.slf4j.LoggerFactory.getLogger(BriefingGenerationWorker.class);
    private final BriefingGenerationService service;
    private final com.dreamcore.workspace.scheduling.IdleGate idle=new com.dreamcore.workspace.scheduling.IdleGate();
    public BriefingGenerationWorker(BriefingGenerationService service){this.service=service;}
    @Scheduled(fixedDelayString="${dreamcore.briefing.poll-ms:5000}",initialDelayString="${dreamcore.briefing.initial-delay-ms:10000}")
    public void tick(){
        long now=System.currentTimeMillis();
        if(idle.resting(now))return;
        var due=service.dueDaily();
        for(var id:due)try{service.dispatchDaily(id);}
        catch(Exception e){log.warn("Daily briefing deferred policy={} cause={}",id,e.getClass().getSimpleName());}
        service.discover();
        var pending=service.candidates();
        if(due.isEmpty()&&pending.isEmpty()){idle.rest(now);return;}
        idle.work();
        // Breadth first: another enterprise gets a turn before this policy gets its next slot.
        for(int slot=0;slot<5&&!pending.isEmpty();slot++){
            var progressed=new java.util.ArrayList<java.util.UUID>();
            for(var id:pending)try{if(service.advance(id))progressed.add(id);}
            catch(Exception e){log.warn("Briefing generation deferred policy={} cause={}",id,e.getClass().getSimpleName());}
            pending=progressed;
        }
    }
}
