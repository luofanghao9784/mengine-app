package com.dreamcore.workspace.taskwork;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class TaskWorkController {
 public record Undo(UUID requestId) {}
 private final TaskWorkService service;private final ConversationPlanCommands commands;public TaskWorkController(TaskWorkService service,ConversationPlanCommands commands){this.service=service;this.commands=commands;}
 private UUID token(String header){try{if(header==null||!header.startsWith("Bearer "))throw new IllegalArgumentException();return UUID.fromString(header.substring(7));}catch(Exception e){throw new IdentityException(403,"TASK_ACCESS_DENIED");}}
 private ResponseEntity<?> response(Object body){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);}
 @PostMapping("/internal/v1/agent-access/{task}/plan") public ResponseEntity<?> plan(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth,@RequestBody TaskWorkService.Request body){return response(service.plan(task,token(auth),body));}
 @PostMapping("/internal/v1/agent-access/{task}/preference") public ResponseEntity<?> preference(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth,@RequestBody TaskWorkService.Request body){return response(service.preference(task,token(auth),body));}
 @GetMapping("/api/v1/tenants/{tenant}/tasks/{task}/work-receipts") public ResponseEntity<?> receipts(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID task,@RequestParam(defaultValue="0") int offset){return response(service.receipts(UUID.fromString(auth.getName()),tenant,task,offset));}
 @PostMapping("/api/v1/tenants/{tenant}/tasks/{task}/work-receipts/{receipt}/undo") public ResponseEntity<?> undo(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID task,@PathVariable UUID receipt,@RequestBody Undo body){if(body==null||body.requestId()==null)throw IdentityException.invalid();return response(service.undo(UUID.fromString(auth.getName()),tenant,task,receipt,body.requestId()));}
 @PostMapping("/internal/v1/agent-access/{task}/manage-plan") public ResponseEntity<?> manage(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth,@RequestBody ConversationPlanCommands.Request body){return response(commands.invoke(task,token(auth),body));}
 @GetMapping("/api/v1/tenants/{tenant}/tasks/{task}/plan-receipts") public ResponseEntity<?> planReceipts(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID task){return response(commands.receipts(UUID.fromString(auth.getName()),tenant,task));}
}
