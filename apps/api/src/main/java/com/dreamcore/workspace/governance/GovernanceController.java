package com.dreamcore.workspace.governance;

import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/governance")
public class GovernanceController {
    public record Change(@NotNull UUID requestId,@NotNull @Min(0) Long expectedVersion) {}
    public record RoleChange(@NotNull UUID requestId,@NotNull @Min(0) Long expectedVersion,@NotNull String role) {}
    public record Grant(@NotNull UUID requestId,@NotNull @Min(0) Long expectedVersion,@NotNull UUID accountId,UUID workspaceId,@NotNull GovernanceAccess.Capability capability,@NotNull Boolean enabled) {}
    public record Offer(@NotNull UUID requestId,@NotNull @Min(0) Long expectedVersion,@NotNull UUID accountId,String previousOwnerRole) {}
    public record RecoveryRequest(@NotNull UUID requestId,@NotNull String reason) {}
    private final GovernanceService service;
    public GovernanceController(GovernanceService service){this.service=service;}
    private UUID actor(Authentication auth){return UUID.fromString(auth.getName());}
    @ModelAttribute public void headers(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");}
    @GetMapping public GovernanceService.Snapshot get(Authentication auth,@PathVariable UUID tenant){return service.snapshot(actor(auth),tenant);}
    @PostMapping("/accept-initial-responsibility") public GovernanceService.Snapshot accept(Authentication auth,@PathVariable UUID tenant,@Valid @RequestBody Change body){return service.acceptInitial(actor(auth),tenant,body.requestId(),body.expectedVersion());}
    @PostMapping("/members/{account}/role") public GovernanceService.Role role(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID account,@Valid @RequestBody RoleChange body){return service.appoint(actor(auth),tenant,account,body.requestId(),body.expectedVersion(),body.role());}
    @GetMapping("/capabilities") public java.util.List<GovernanceService.AssignedCapability> grants(Authentication auth,@PathVariable UUID tenant,@RequestParam UUID accountId){return service.assigned(actor(auth),tenant,accountId);}
    @PostMapping("/capabilities") public GovernanceService.Snapshot grant(Authentication auth,@PathVariable UUID tenant,@Valid @RequestBody Grant body){return service.capability(actor(auth),tenant,body.accountId(),body.workspaceId(),body.capability(),body.enabled(),body.requestId(),body.expectedVersion());}
    @PostMapping("/handover") public GovernanceService.Snapshot offer(Authentication auth,@PathVariable UUID tenant,@Valid @RequestBody Offer body){return service.offer(actor(auth),tenant,body.accountId(),body.requestId(),body.expectedVersion(),body.previousOwnerRole()==null?"TENANT_ADMIN":body.previousOwnerRole());}
    @PostMapping("/handover/{id}/accept") public GovernanceService.Snapshot acceptHandover(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@Valid @RequestBody Change body){return service.acceptHandover(actor(auth),tenant,id,body.requestId(),body.expectedVersion());}
    @PostMapping("/handover/{id}/reject") public GovernanceService.Snapshot rejectHandover(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@Valid @RequestBody Change body){return service.closeHandover(actor(auth),tenant,id,body.requestId(),body.expectedVersion(),true);}
    @PostMapping("/handover/{id}/cancel") public GovernanceService.Snapshot cancelHandover(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id,@Valid @RequestBody Change body){return service.closeHandover(actor(auth),tenant,id,body.requestId(),body.expectedVersion(),false);}
    @PostMapping("/recovery-requests") public GovernanceService.Recovery recovery(Authentication auth,@PathVariable UUID tenant,@Valid @RequestBody RecoveryRequest body){return service.recovery(actor(auth),tenant,body.requestId(),body.reason());}
    @GetMapping("/recovery-requests/{id}") public GovernanceService.Recovery recovery(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id){return service.recoveryRecord(actor(auth),tenant,id);}
}
