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
    private final com.dreamcore.workspace.support.SupportAccess support;private final KnowledgeService service;private final DocumentParser parser;
    private final com.dreamcore.workspace.scheduling.IdleGate idle=new com.dreamcore.workspace.scheduling.IdleGate();
    public KnowledgeWorker(KnowledgeService service,DocumentParser parser,com.dreamcore.workspace.support.SupportAccess support) {this.support=support;this.service=service;this.parser=parser;}
    @Scheduled(fixedDelayString="${dreamcore.knowledge.poll-ms:1000}",initialDelayString="${dreamcore.knowledge.initial-delay-ms:1000}")
    public void tick() {
        long now=System.currentTimeMillis();
        if(idle.resting(now))return;
        KnowledgeService.Job job;
        try {job=service.claim();} catch(Exception error) {return;}
        if(job==null){idle.rest(now);return;}
        idle.work();
        try {com.dreamcore.workspace.support.SupportContext.set(support.forObject(job.actor(),job.tenant(),"knowledge_runs",job.id()));var input=service.input(job);if(input!=null) service.finish(job,parser.parse(input.filename(),input.bytes()));}
        catch(IdentityException error) {service.abandon(job,error.status==401 || error.status==403 || error.status==404);}
        catch(Exception error) {service.abandon(job,false);}
        finally {com.dreamcore.workspace.support.SupportContext.set(null);}
    }
}
