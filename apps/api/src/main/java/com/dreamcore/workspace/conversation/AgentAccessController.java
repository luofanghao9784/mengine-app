package com.dreamcore.workspace.conversation;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/internal/v1/agent-access/{task}")
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class AgentAccessController {
    public record Query(String query) {}
    public record Original(UUID versionId) {}
    private final AgentTaskService service;public AgentAccessController(AgentTaskService service){this.service=service;}
    private UUID attempt(String header){try{if(header==null || !header.startsWith("Bearer "))throw new IllegalArgumentException();return UUID.fromString(header.substring(7));}catch(Exception error){throw new IdentityException(403,"TASK_ACCESS_DENIED");}}
    @PostMapping("/check") public ResponseEntity<?> check(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.check(task,attempt(auth)));}
    @PostMapping("/search") public ResponseEntity<?> search(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth,@RequestBody Query body){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("items",service.search(task,attempt(auth),body.query())));}
    @PostMapping("/originals") public ResponseEntity<?> originals(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("items",service.originals(task,attempt(auth))));}
    @PostMapping("/read-original") public ResponseEntity<?> readOriginal(@PathVariable UUID task,@RequestHeader(value="Authorization",required=false) String auth,@RequestBody Original body){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.readOriginal(task,attempt(auth),body.versionId()));}
}
