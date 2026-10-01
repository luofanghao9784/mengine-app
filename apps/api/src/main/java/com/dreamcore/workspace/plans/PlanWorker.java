package com.dreamcore.workspace.plans;
import org.springframework.boot.autoconfigure.condition.*;
import org.springframework.scheduling.annotation.*;
import org.springframework.stereotype.Component;
/** Durable scheduling continues independently of browser sessions and model availability. */
@Component @EnableScheduling
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnProperty(name="dreamcore.plans.enabled",havingValue="true",matchIfMissing=true)
public class PlanWorker {
 private final PlanService plans;
 public PlanWorker(PlanService plans){this.plans=plans;}
 @Scheduled(fixedDelayString="${dreamcore.plans.poll-ms:5000}",initialDelayString="${dreamcore.plans.initial-delay-ms:5000}")
 public void tick(){for(var id:plans.candidates())try{plans.tick(id);}catch(Exception ignored){/* Transaction rolls back; next tick rechecks durable trigger and current authority. */}}
}
