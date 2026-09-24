package com.dreamcore.workspace.identity;

import java.util.UUID;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type = org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
public class OperationsController {
    private final OperationsService operations;
    public OperationsController(OperationsService operations) { this.operations=operations; }
    @GetMapping("/api/platform-admin/v1/operations")
    public OperationsService.Overview platform(Authentication auth, HttpServletResponse response,@RequestParam(defaultValue="7") int days) {
        response.setHeader("Cache-Control","private, no-store");
        return operations.platform(IdentityController.actor(auth),null,days);
    }
    @GetMapping("/api/platform-admin/v1/tenants/{tenant}/operations")
    public OperationsService.Overview platformTenant(Authentication auth, HttpServletResponse response,@PathVariable UUID tenant,@RequestParam(defaultValue="7") int days) {
        response.setHeader("Cache-Control","private, no-store");
        return operations.platform(IdentityController.actor(auth),tenant,days);
    }
    @GetMapping("/api/tenant-admin/v1/tenants/{tenant}/operations")
    public OperationsService.Overview tenant(Authentication auth, HttpServletResponse response,@PathVariable UUID tenant,@RequestParam(defaultValue="7") int days) {
        response.setHeader("Cache-Control","private, no-store");
        return operations.tenant(IdentityController.actor(auth),tenant,days);
    }
}
