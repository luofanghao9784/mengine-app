package com.dreamcore.workspace.identity;
import java.util.UUID;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/tenant-admin/v1/tenants/{tenant}/workspaces/{id}/archive")
public class WorkspaceArchiveController {
 private final WorkspaceArchiveService service;
 public WorkspaceArchiveController(WorkspaceArchiveService service){this.service=service;}
 public record Action(@NotNull UUID requestId,@Min(0) long expectedRevision,boolean archived){}
 @GetMapping public WorkspaceArchiveService.State get(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id){return service.get(IdentityController.actor(a),tenant,id);}
 @PostMapping public WorkspaceArchiveService.State act(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id,@Valid @RequestBody Action b){return service.act(IdentityController.actor(a),tenant,id,b.requestId(),b.expectedRevision(),b.archived());}
}
