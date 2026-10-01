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
@RequestMapping("/api/tenant-admin/v1/tenants/{tenant}")
public class TenantAdminController {
    public record Named(@NotNull UUID requestId, @NotNull @Size(max=100) String name) {}
    public record Rename(@NotNull UUID requestId, @NotNull @Min(0) Long expectedVersion, @NotNull @Size(max=100) String name) {}
    public record Status(@NotNull UUID requestId, @NotNull @Min(0) Long expectedVersion, @NotNull String status) {}
    public record EmergencyDisable(@NotNull UUID requestId, @NotNull @Min(0) Long expectedVersion, @NotNull String securityAction) {}
    public record Grant(@NotNull UUID requestId, @NotNull @Min(0) Long expectedVersion, @NotNull Boolean enabled) {}
    private final TenantAdminService service;
    public TenantAdminController(TenantAdminService service) { this.service=service; }
    @GetMapping("/overview")
    public TenantAdminService.Overview overview(Authentication auth, @PathVariable UUID tenant) { return service.overview(IdentityController.actor(auth),tenant); }
    @PostMapping("/settings")
    public TenantAdminService.Overview settings(Authentication auth, @PathVariable UUID tenant, @Valid @RequestBody Rename body) {
        return service.renameTenant(IdentityController.actor(auth),tenant,body.requestId(),body.expectedVersion(),body.name());
    }
    @GetMapping("/members")
    public List<TenantAdminService.Member> members(Authentication auth, @PathVariable UUID tenant, @RequestParam(defaultValue="") String q,
            @RequestParam(defaultValue="") String status, @RequestParam(defaultValue="0") int offset, @RequestParam(defaultValue="50") int limit) {
        return service.members(IdentityController.actor(auth),tenant,q,status,offset,limit);
    }
    @PostMapping("/members/{account}/status")
    public TenantAdminService.Member status(Authentication auth, @PathVariable UUID tenant, @PathVariable UUID account, @Valid @RequestBody Status body) {
        return service.status(IdentityController.actor(auth),tenant,account,body.requestId(),body.expectedVersion(),body.status());
    }
    @PostMapping("/members/{account}/emergency-disable")
    public TenantAdminService.EmergencyDisableReceipt emergencyDisable(Authentication auth, @PathVariable UUID tenant,
            @PathVariable UUID account, @Valid @RequestBody EmergencyDisable body) {
        return service.emergencyDisable(IdentityController.actor(auth),tenant,account,body.requestId(),body.expectedVersion(),body.securityAction());
    }
    @GetMapping("/workspaces")
    public List<TenantAdminService.SharedWorkspace> spaces(Authentication auth, @PathVariable UUID tenant, @RequestParam(defaultValue="") String q,
            @RequestParam(defaultValue="0") int offset, @RequestParam(defaultValue="50") int limit) {
        return service.spaces(IdentityController.actor(auth),tenant,q,offset,limit);
    }
    @PostMapping("/workspaces") @ResponseStatus(org.springframework.http.HttpStatus.CREATED)
    public TenantAdminService.SharedWorkspace create(Authentication auth, @PathVariable UUID tenant, @Valid @RequestBody Named body) {
        return service.createSpace(IdentityController.actor(auth),tenant,body.requestId(),body.name());
    }
    @GetMapping("/workspaces/{workspace}")
    public TenantAdminService.SharedWorkspace space(Authentication auth, @PathVariable UUID tenant, @PathVariable UUID workspace) {
        return service.spaceInfo(IdentityController.actor(auth),tenant,workspace);
    }
    @PostMapping("/workspaces/{workspace}/settings")
    public TenantAdminService.SharedWorkspace rename(Authentication auth, @PathVariable UUID tenant, @PathVariable UUID workspace, @Valid @RequestBody Rename body) {
        return service.renameSpace(IdentityController.actor(auth),tenant,workspace,body.requestId(),body.expectedVersion(),body.name());
    }
    @GetMapping("/workspaces/{workspace}/members")
    public List<TenantAdminService.Grant> grants(Authentication auth, @PathVariable UUID tenant, @PathVariable UUID workspace,
            @RequestParam(defaultValue="0") int offset, @RequestParam(defaultValue="50") int limit) {
        return service.grants(IdentityController.actor(auth),tenant,workspace,offset,limit);
    }
    @PostMapping("/workspaces/{workspace}/members/{account}")
    public TenantAdminService.SharedWorkspace grant(Authentication auth, @PathVariable UUID tenant, @PathVariable UUID workspace, @PathVariable UUID account,
            @Valid @RequestBody Grant body) {
        return service.grant(IdentityController.actor(auth),tenant,workspace,account,body.requestId(),body.expectedVersion(),body.enabled());
    }
    @PostMapping("/workspaces/{workspace}/members/{account}/maintenance")
    public TenantAdminService.SharedWorkspace maintenance(Authentication auth, @PathVariable UUID tenant, @PathVariable UUID workspace, @PathVariable UUID account,
            @Valid @RequestBody Grant body) {
        return service.maintenance(IdentityController.actor(auth),tenant,workspace,account,body.requestId(),body.expectedVersion(),body.enabled());
    }
    @GetMapping("/records")
    public List<TenantAdminService.AuditEntry> records(Authentication auth, @PathVariable UUID tenant,
            @RequestParam(defaultValue="0") int offset, @RequestParam(defaultValue="50") int limit) {
        return service.records(IdentityController.actor(auth),tenant,offset,limit);
    }
}
