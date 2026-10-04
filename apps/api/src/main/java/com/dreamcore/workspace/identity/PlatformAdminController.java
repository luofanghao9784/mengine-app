package com.dreamcore.workspace.identity;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type = org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/platform-admin/v1")
public class PlatformAdminController {
    public record Status(@NotNull UUID requestId, @NotNull @Min(0) Long expectedVersion, @NotNull String status, @NotNull @Size(min=1,max=1000) String internalReason, @NotNull @Size(min=1,max=1000) String publicReason) {}
    public record InitialAdmin(@NotNull UUID requestId, @NotNull @Min(0) Long expectedVersion, @Size(max=254) String email, @Size(max=40) String phone) {}
    private final PlatformAdminService service;
    private final IdentityService identities;
    private final com.dreamcore.workspace.governance.GovernanceService governance;
    public PlatformAdminController(PlatformAdminService service, IdentityService identities, com.dreamcore.workspace.governance.GovernanceService governance) { this.service=service; this.identities=identities;this.governance=governance; }
    @PostMapping("/tenants/{tenant}/governance-recovery-requests")
    public com.dreamcore.workspace.governance.GovernanceService.Recovery recovery(Authentication auth,@PathVariable UUID tenant,@Valid @RequestBody com.dreamcore.workspace.governance.GovernanceController.RecoveryRequest body) {
        return governance.platformRecovery(IdentityController.actor(auth),tenant,body.requestId(),body.reason());
    }
    @GetMapping("/tenants/{tenant}/governance-recovery-requests/{id}")
    public com.dreamcore.workspace.governance.GovernanceService.Recovery recovery(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id) {
        return governance.platformRecoveryRecord(IdentityController.actor(auth),tenant,id);
    }
    @GetMapping("/tenants")
    public List<PlatformAdminService.TenantSummary> tenants(Authentication auth, @RequestParam(defaultValue="") String q,
            @RequestParam(defaultValue="") String status, @RequestParam(defaultValue="0") int offset, @RequestParam(defaultValue="50") int limit) {
        return service.tenants(IdentityController.actor(auth),q,status,offset,limit);
    }
    @PostMapping("/tenants") @ResponseStatus(org.springframework.http.HttpStatus.CREATED)
    public IdentityService.TenantCreated create(Authentication auth, @Valid @RequestBody IdentityController.CreateTenant body) {
        return identities.createTenant(IdentityController.actor(auth),body.requestId(),body.name(),PhoneNumbers.contact(body.adminPhone(),body.adminEmail()),Boolean.TRUE.equals(body.designateAuthorizationOwner()));
    }
    @GetMapping("/overview")
    public PlatformAdminService.Overview overview(Authentication auth) { return service.overview(IdentityController.actor(auth)); }
    @GetMapping("/tenants/{tenant}")
    public PlatformAdminService.Detail detail(Authentication auth, @PathVariable UUID tenant) { return service.detail(IdentityController.actor(auth),tenant); }
    @PostMapping("/tenants/{tenant}/status")
    public PlatformAdminService.Detail status(Authentication auth, @PathVariable UUID tenant, @Valid @RequestBody Status body) {
        return service.status(IdentityController.actor(auth),tenant,body.requestId(),body.expectedVersion(),body.status(),body.internalReason(),body.publicReason());
    }
    @PostMapping("/tenants/{tenant}/initial-admin-invitation")
    public PlatformAdminService.Detail initial(Authentication auth, @PathVariable UUID tenant, @Valid @RequestBody InitialAdmin body) {
        return service.replaceInitialInvitation(IdentityController.actor(auth),tenant,body.requestId(),body.expectedVersion(),PhoneNumbers.contact(body.phone(),body.email()));
    }
    public record RevokeInitial(@NotNull UUID requestId, @NotNull @Min(0) Long expectedVersion) {}
    @PostMapping("/tenants/{tenant}/initial-admin-invitation/revoke")
    public PlatformAdminService.Detail revokeInitial(Authentication auth,@PathVariable UUID tenant,@Valid @RequestBody RevokeInitial body) {
        return service.revokeInitialInvitation(IdentityController.actor(auth),tenant,body.requestId(),body.expectedVersion());
    }
    @GetMapping("/tenants/{tenant}/records")
    public List<PlatformAdminService.AuditEntry> records(Authentication auth, @PathVariable UUID tenant,
            @RequestParam(defaultValue="0") int offset, @RequestParam(defaultValue="50") int limit) {
        return service.records(IdentityController.actor(auth),tenant,offset,limit);
    }
}
