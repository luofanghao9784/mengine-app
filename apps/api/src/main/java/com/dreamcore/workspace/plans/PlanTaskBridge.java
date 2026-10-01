package com.dreamcore.workspace.plans;
import com.dreamcore.workspace.conversation.ConversationService;
import java.util.*;
import org.springframework.stereotype.Component;
/** Uses the common task lifecycle, never a parallel model executor. Caller holds tenant then plan locks. */
@Component public class PlanTaskBridge {
 private final ConversationService tasks;
 public PlanTaskBridge(ConversationService tasks){this.tasks=tasks;}
 static String prompt(PlanService.Configuration c){return c.behavior().equals("SOURCE_LOOKUP")?c.query():"持续目标："+c.goal()+"\n委托用途与边界："+c.purpose()+"\n本次检查要求："+c.query();}
 public ConversationService.Detail submit(UUID actor,UUID tenant,UUID space,UUID key,PlanService.Configuration configuration){
  return tasks.submit(actor,tenant,null,space,key,prompt(configuration),"ANALYZE".equals(configuration.behavior())?"AGENT":"SOURCE_LOOKUP",null,List.of());
 }
 public void interrupt(UUID tenant,List<UUID> ids,String reason){tasks.interruptTasks(tenant,ids,reason);}
}
