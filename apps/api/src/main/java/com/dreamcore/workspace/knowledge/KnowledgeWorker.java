package com.dreamcore.workspace.knowledge;
import com.dreamcore.workspace.identity.IdentityException;
import org.springframework.boot.autoconfigure.condition.*;
import org.springframework.scheduling.annotation.*;
import org.springframework.stereotype.Component;
@Component
@EnableScheduling
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnProperty(name="dreamcore.knowledge.enabled",havingValue="true")
public class KnowledgeWorker {
    private final KnowledgeService service;private final DocumentParser parser;
    public KnowledgeWorker(KnowledgeService service,DocumentParser parser) {this.service=service;this.parser=parser;}
    @Scheduled(fixedDelayString="${dreamcore.knowledge.poll-ms:1000}",initialDelayString="${dreamcore.knowledge.initial-delay-ms:1000}")
    public void tick() {
        KnowledgeService.Job job;
        try {job=service.claim();} catch(Exception error) {return;}
        if(job==null) return;
        try {var input=service.input(job);if(input!=null) service.finish(job,parser.parse(input.filename(),input.bytes()));}
        catch(IdentityException error) {service.abandon(job,error.status==401 || error.status==403 || error.status==404);}
        catch(Exception error) {service.abandon(job,false);}
    }
}
