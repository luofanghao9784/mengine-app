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
    public BriefingGenerationWorker(BriefingGenerationService service){this.service=service;}
    @Scheduled(fixedDelayString="${dreamcore.briefing.poll-ms:5000}",initialDelayString="${dreamcore.briefing.initial-delay-ms:10000}")
    public void tick(){for(var due:service.dueDaily())try{service.dispatchDaily(due);}catch(Exception e){log.warn("Daily briefing deferred policy={} cause={}",due,e.getClass().getSimpleName());}service.discover();for(var id:service.candidates())try{for(int slot=0;slot<5;slot++)service.tick(id);}catch(Exception e){log.warn("Briefing generation deferred policy={} cause={}",id,e.getClass().getSimpleName());}}
}
