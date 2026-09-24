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
    public record Status(@NotNull UUID requestId, @NotNull @Min(0) Long expectedVersion, @NotNull String status) {}
    public record InitialAdmin(@NotNull UUID requestId, @NotNull @Min(0) Long expectedVersion, @NotNull @Size(max=254) String email) {}
    private final PlatformAdminService service;
    private final IdentityService identities;
    public PlatformAdminController(PlatformAdminService service, IdentityService identities) { this.service=service; this.identities=identities; }
    @GetMapping("/tenants")
    public List<IdentityService.Tenant> tenants(Authentication auth, @RequestParam(defaultValue="") String q,
            @RequestParam(defaultValue="") String status, @RequestParam(defaultValue="0") int offset, @RequestParam(defaultValue="50") int limit) {
        return service.tenants(IdentityController.actor(auth),q,status,offset,limit);
    }
    @PostMapping("/tenants") @ResponseStatus(org.springframework.http.HttpStatus.CREATED)
    public IdentityService.TenantCreated create(Authentication auth, @Valid @RequestBody IdentityController.CreateTenant body) {
        return identities.createTenant(IdentityController.actor(auth),body.requestId(),body.name(),body.adminEmail());
    }
    @GetMapping("/overview")
    public PlatformAdminService.Overview overview(Authentication auth) { return service.overview(IdentityController.actor(auth)); }
    @GetMapping("/tenants/{tenant}")
    public PlatformAdminService.Detail detail(Authentication auth, @PathVariable UUID tenant) { return service.detail(IdentityController.actor(auth),tenant); }
    @PostMapping("/tenants/{tenant}/status")
    public PlatformAdminService.Detail status(Authentication auth, @PathVariable UUID tenant, @Valid @RequestBody Status body) {
        return service.status(IdentityController.actor(auth),tenant,body.requestId(),body.expectedVersion(),body.status());
    }
    @PostMapping("/tenants/{tenant}/initial-admin-invitation")
    public PlatformAdminService.Detail initial(Authentication auth, @PathVariable UUID tenant, @Valid @RequestBody InitialAdmin body) {
        return service.replaceInitialInvitation(IdentityController.actor(auth),tenant,body.requestId(),body.expectedVersion(),body.email());
    }
    @GetMapping("/tenants/{tenant}/records")
    public List<PlatformAdminService.AuditEntry> records(Authentication auth, @PathVariable UUID tenant,
            @RequestParam(defaultValue="0") int offset, @RequestParam(defaultValue="50") int limit) {
        return service.records(IdentityController.actor(auth),tenant,offset,limit);
    }
}
