package com.dreamcore.workspace.conversation;
import org.springframework.boot.autoconfigure.condition.*;
import org.springframework.scheduling.annotation.*;
import org.springframework.stereotype.Component;
@Component @EnableScheduling
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnProperty(name="dreamcore.native.schedules-enabled",havingValue="true",matchIfMissing=true)
@ConditionalOnExpression("'${dreamcore.native.web-url:}' != ''")
public class NativeScheduleWorker {
 private final NativeSchedules schedules;public NativeScheduleWorker(NativeSchedules s){schedules=s;}
 @Scheduled(fixedDelayString="${dreamcore.native.schedules-poll-ms:5000}",initialDelayString="${dreamcore.native.schedules-initial-delay-ms:5000}")
 public void tick(){for(var id:schedules.candidates())try{schedules.tick(id);}catch(Exception ignored){/* Durable receipts retain ambiguous dispatches for inspection; never retry them. */}}
}
