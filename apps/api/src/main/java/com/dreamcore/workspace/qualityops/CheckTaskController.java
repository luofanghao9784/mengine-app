package com.dreamcore.workspace.qualityops;

import com.dreamcore.workspace.capability.registry.CapabilityCatalogPort;
import com.dreamcore.workspace.capability.registry.CapabilityCatalogPort.EnterpriseFunction;
import com.dreamcore.workspace.identity.IdentityService;
import jakarta.servlet.http.HttpServletRequest;
import java.security.Principal;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

@RestController
public class CheckTaskController {
    private final CapabilityCatalogPort catalog;
    private final IdentityService identities;
    private final CheckTaskService tasks;

    public CheckTaskController(CapabilityCatalogPort catalog, IdentityService identities, CheckTaskService tasks) {
        this.catalog = catalog;
        this.identities = identities;
        this.tasks = tasks;
    }

    @PostMapping(path = "/api/tenant-admin/v1/quality-ops/check-tasks", consumes = "application/json")
    public ResponseEntity<?> createCheckTask(Principal principal, HttpServletRequest request, @RequestBody JsonNode body) {
        if (!request.getParameterMap().isEmpty() || !body.isObject()
                || !Set.of("materialText", "title").containsAll(body.propertyNames())
                || !body.has("materialText") || !body.get("materialText").isString()
                || (body.has("title") && !body.get("title").isString())) {
            return invalid();
        }
        String material = body.get("materialText").asString().strip();
        String title = body.has("title") ? body.get("title").asString().strip() : "";
        if (material.isEmpty() || material.codePointCount(0, material.length()) > 20000
                || title.codePointCount(0, title.length()) > 200) return invalid();

        UUID actor = UUID.fromString(principal.getName());
        // Match OpenedCapabilitiesController: ACTIVE membership must resolve exactly one ACTIVE enterprise.
        var memberships = identities.me(actor).memberships();
        if (memberships.size() != 1 || !"ACTIVE".equals(memberships.getFirst().service().status())) {
            return error(404, "OPENED_CAPABILITIES_UNAVAILABLE", "暂时不能查看已开通功能");
        }
        UUID tenant = memberships.getFirst().tenantId();
        var task = tasks.create(tenant, actor, title.isEmpty() ? null : title, material,
                () -> catalog.listOpenedCapabilities(tenant).contains(EnterpriseFunction.QUALITY_CHECK));
        return ResponseEntity.status(201).header("Cache-Control", "no-store").body(task);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<?> invalid() { return error(400, "INVALID_REQUEST", "内容不符合要求"); }

    @ExceptionHandler(CheckTaskService.CapabilityNotOpened.class)
    ResponseEntity<?> notOpened() {
        return error(403, "CAPABILITY_NOT_OPENED", "贵企业还没开通「质量检查」，请联系平台管理员开通");
    }

    @ExceptionHandler(CheckTaskService.Unavailable.class)
    ResponseEntity<?> unavailable() {
        return error(503, "QUALITY_CHECK_UNAVAILABLE", "质量检查暂时不可用，请稍后再试");
    }

    private ResponseEntity<?> error(int status, String code, String message) {
        return ResponseEntity.status(status).header("Cache-Control", "no-store")
                .body(Map.of("contractVersion", "1.0", "code", code, "message", message, "retryable", status >= 500));
    }
}
