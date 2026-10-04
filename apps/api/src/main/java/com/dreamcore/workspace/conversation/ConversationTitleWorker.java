package com.dreamcore.workspace.conversation;
import jakarta.annotation.PreDestroy;
import java.util.concurrent.*;
import org.springframework.boot.autoconfigure.condition.*;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnProperty(name="dreamcore.tasks.enabled",havingValue="true")
public class ConversationTitleWorker {
    private final ConversationTitles titles;private final EngineTaskRuntime runtime;
    private final ScheduledExecutorService executor=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"conversation-title");t.setDaemon(true);return t;});
    private final java.util.concurrent.atomic.AtomicBoolean busy=new java.util.concurrent.atomic.AtomicBoolean();
    public ConversationTitleWorker(ConversationTitles titles,EngineTaskRuntime runtime){this.titles=titles;this.runtime=runtime;}
    @Scheduled(fixedDelay=1000,initialDelayString="${dreamcore.tasks.initial-delay-ms:1000}")
    public void tick(){
        if(!busy.compareAndSet(false,true))return;
        executor.execute(()->{try{var job=titles.claim();if(job!=null){try{titles.finish(job,runtime.executeTitle(job,()->titles.active(job)));}catch(Exception error){titles.fail(job);}}}finally{busy.set(false);}});
    }
    @PreDestroy public void stop(){executor.shutdownNow();}
}
