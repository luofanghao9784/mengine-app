package com.dreamcore.workspace.conversation;
import com.dreamcore.workspace.identity.IdentityException;
import org.springframework.boot.autoconfigure.condition.*;
import org.springframework.scheduling.annotation.*;
import org.springframework.stereotype.Component;
@Component @EnableScheduling
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnProperty(name="dreamcore.tasks.enabled",havingValue="true")
public class ConversationWorker {
    private final ConversationService service;private final TaskRuntime runtime;private final AgentTaskService agents;
    public ConversationWorker(ConversationService service,TaskRuntime runtime,AgentTaskService agents){this.service=service;this.runtime=runtime;this.agents=agents;}
    @Scheduled(fixedDelayString="${dreamcore.tasks.poll-ms:500}",initialDelayString="${dreamcore.tasks.initial-delay-ms:1000}")
    public void tick(){ConversationService.Job job;try{job=service.claim();}catch(Exception error){return;}if(job==null)return;
        try{if("AGENT".equals(job.mode()))agents.finish(job,runtime.executeAgent(job.id(),job.token(),job.prompt(),()->agents.active(job)));
            else{var sources=service.sources(job);if(sources!=null)service.finish(job,runtime.execute(job.id(),job.token(),sources));}}
        catch(IdentityException error){service.fail(job,SetSupport.denied(error)?"TASK_SOURCE_UNAVAILABLE":error.code);}
        catch(Exception error){service.fail(job,"TASK_RUNTIME_UNAVAILABLE");}
    }
    private static class SetSupport {static boolean denied(IdentityException e){return e.status==401 || e.status==403 || e.status==404;}}
}
