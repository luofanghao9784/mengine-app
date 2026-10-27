package com.dreamcore.workspace.conversation;
import org.springframework.boot.autoconfigure.condition.*;
import org.springframework.scheduling.annotation.*;
import org.springframework.stereotype.Component;
@Component @EnableScheduling
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnProperty(name="dreamcore.native.schedules-enabled",havingValue="true",matchIfMissing=true)
@ConditionalOnExpression("'${dreamcore.native.web-url:}' != ''")
public class NativeScheduleWorker {
 private static final org.slf4j.Logger LOG=org.slf4j.LoggerFactory.getLogger(NativeScheduleWorker.class);
 private final NativeSchedules schedules;public NativeScheduleWorker(NativeSchedules s){schedules=s;}
 @Scheduled(fixedDelayString="${dreamcore.native.schedules-poll-ms:5000}",initialDelayString="${dreamcore.native.schedules-initial-delay-ms:5000}")
 public void tick(){
  java.util.List<java.util.UUID> ids;
  try{ids=schedules.candidates();}catch(Exception e){LOG.warn("Native schedule scan failed: reason={}",reason(e));return;}
  for(var id:ids)try{schedules.tick(id);}catch(Exception e){LOG.warn("Native schedule tick failed: scheduleId={} reason={}",id,reason(e));}
 }
 // Never log exception messages/stack traces: upstream errors may contain prompts or credentials.
 static String reason(Exception e){return e instanceof com.dreamcore.workspace.identity.IdentityException i
   && java.util.Set.of("NATIVE_SCHEDULE_RULES_UNAVAILABLE","NATIVE_SCHEDULE_RULE_INVALID","ACCESS_DENIED").contains(i.code)?i.code:e.getClass().getSimpleName();}
}
