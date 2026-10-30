package com.dreamcore.workspace.qualityops;

import com.dreamcore.workspace.capability.registry.CapabilityCatalogPort;
import com.dreamcore.workspace.identity.IdentityService;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.security.Principal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OpenedCapabilitiesController {
    private final IdentityService identities;
    private final CapabilityCatalogPort catalog;

    public OpenedCapabilitiesController(IdentityService identities, CapabilityCatalogPort catalog) {
        this.identities = identities;
        this.catalog = catalog;
    }

    public record OpenedCapability(String enterpriseFunction, String displayName) {}
    public record OpenedCapabilityList(List<OpenedCapability> items) {}

    @GetMapping({"/api/tenant-admin/v1/opened-capabilities", "/api/tenant-admin/v1/opened-capabilities/**"})
    public ResponseEntity<?> listOpenedCapabilities(Principal principal, HttpServletRequest request) throws IOException {
        // This read accepts no request fields, including any caller-supplied tenant selector.
        if (!request.getRequestURI().equals(request.getContextPath() + "/api/tenant-admin/v1/opened-capabilities")
                || !request.getParameterMap().isEmpty() || request.getInputStream().read() != -1) {
            return error(400, "INVALID_REQUEST", "有无法识别的字段，请检查后再提交");
        }
        // me() returns ACTIVE memberships only. Do not select among multiple enterprises.
        var memberships = identities.me(UUID.fromString(principal.getName())).memberships();
        // 【待补-会话】No current-enterprise session binding exists; never guess or accept a cookie selector.
        if (memberships.size() != 1 || !"ACTIVE".equals(memberships.getFirst().service().status())) {
            return error(404, "OPENED_CAPABILITIES_UNAVAILABLE", "暂时不能查看已开通功能");
        }
        var items = catalog.listOpenedCapabilities(memberships.getFirst().tenantId()).stream().distinct()
                .map(f -> new OpenedCapability(f.code(), f.displayName())).toList();
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(new OpenedCapabilityList(items));
    }

    private ResponseEntity<?> error(int status, String code, String message) {
        return ResponseEntity.status(status).header("Cache-Control", "no-store")
                .body(Map.of("contractVersion", "1.0", "code", code, "message", message, "retryable", false));
    }
}
