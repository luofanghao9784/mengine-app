package com.dreamcore.workspace.context;

import com.dreamcore.workspace.identity.IdentityException;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/internal/v1/agent-access/{task}/context")
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class AgentContextController {
 private final TaskContextService service;
 public AgentContextController(TaskContextService service){this.service=service;}
 private UUID attempt(String header){try{if(header==null||!header.startsWith("Bearer "))throw new IllegalArgumentException();return UUID.fromString(header.substring(7));}catch(Exception e){throw new IdentityException(403,"TASK_ACCESS_DENIED");}}
 @PostMapping public ResponseEntity<?> context(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth,@RequestBody TaskContextService.Request request){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.context(task,attempt(auth),request));}
}
