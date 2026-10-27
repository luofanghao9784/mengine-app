package com.dreamcore.workspace.conversation;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController @ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class NativeSchedulesController {
 private final NativeSchedules schedules;public NativeSchedulesController(NativeSchedules s){schedules=s;}
 public record Create(UUID requestId,NativeSchedules.Config configuration){} public record Action(String state){}
 @GetMapping("/api/v1/tenants/{tenant}/native-conversations/{session}/schedules") public Object list(Authentication a,@PathVariable UUID tenant,@PathVariable UUID session){return schedules.list(UUID.fromString(a.getName()),tenant,session);}
 @PostMapping("/api/v1/tenants/{tenant}/native-conversations/{session}/schedules") public Object create(Authentication a,@PathVariable UUID tenant,@PathVariable UUID session,@RequestBody Create c){return schedules.create(UUID.fromString(a.getName()),tenant,session,c.requestId(),c.configuration());}
 @PatchMapping("/api/v1/tenants/{tenant}/native-conversations/{session}/schedules/{id}") public Object action(Authentication a,@PathVariable UUID tenant,@PathVariable UUID session,@PathVariable UUID id,@RequestBody Action c){return schedules.action(UUID.fromString(a.getName()),tenant,session,id,c.state());}
 @PutMapping("/api/v1/tenants/{tenant}/native-conversations/{session}/schedules/{id}") public Object edit(Authentication a,@PathVariable UUID tenant,@PathVariable UUID session,@PathVariable UUID id,@RequestBody NativeSchedules.Config c){return schedules.edit(UUID.fromString(a.getName()),tenant,session,id,c);}
 @GetMapping("/api/v1/tenants/{tenant}/native-conversations/{session}/schedules/{id}/runs") public Object runs(Authentication a,@PathVariable UUID tenant,@PathVariable UUID session,@PathVariable UUID id){return schedules.runs(UUID.fromString(a.getName()),tenant,session,id);}
 @PostMapping("/api/v1/tenants/{tenant}/native-conversations/{session}/schedules/migrate/{plan}") public Object migrate(Authentication a,@PathVariable UUID tenant,@PathVariable UUID session,@PathVariable UUID plan){return schedules.migrate(UUID.fromString(a.getName()),tenant,session,plan);}
}
