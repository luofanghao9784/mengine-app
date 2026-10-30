package com.dreamcore.workspace.agentadmin;

import java.util.Set;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/** CT-040：会话和 CSRF 由现有第四端安全链先行核验。 */
@RestController
public class CapabilityTenantGrantController {
    private static final Set<String> FUNCTIONS = Set.of("document-parse", "table-compare", "quality-check",
            "semantic-annotation", "repair-suggestion");
    private final CapabilityTenantGrantStore store;

    public CapabilityTenantGrantController(CapabilityTenantGrantStore store) { this.store = store; }

    @PostMapping("/api/agent-admin/v1/tenants/{tenantId}/grants")
    public ResponseEntity<?> createCapabilityTenantGrant(@PathVariable String tenantId, @RequestBody JsonNode request) {
        if (!request.isObject()) return invalid();
        if (!Set.of("capabilityId", "enterpriseFunction").containsAll(request.propertyNames())) {
            return error(400, "INVALID_REQUEST", "有无法识别的字段，请检查后再提交");
        }
        if (!request.has("capabilityId") || !request.get("capabilityId").isTextual()
                || request.get("capabilityId").asString().isBlank()
                || !request.has("enterpriseFunction") || !request.get("enterpriseFunction").isTextual()
                || !FUNCTIONS.contains(request.get("enterpriseFunction").asString())) return invalid();
        UUID tenant;
        try {
            tenant = UUID.fromString(tenantId);
            if (!tenant.toString().equalsIgnoreCase(tenantId)) return invalid();
        } catch (IllegalArgumentException ex) { return invalid(); }
        var result = store.grant(tenant, request.get("capabilityId").asString(), request.get("enterpriseFunction").asString());
        if (result.row() == null) return error(result.status(), result.code(), result.message());
        return ResponseEntity.status(result.status()).header("Cache-Control", "no-store").body(result.row());
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<?> invalid() { return error(400, "INVALID_REQUEST", "请按要求填写开通内容"); }

    private ResponseEntity<GrantError> error(int status, String code, String message) {
        return ResponseEntity.status(status).header("Cache-Control", "no-store")
                .body(new GrantError("1.0", code, message, false));
    }

    record GrantError(String contractVersion, String code, String message, boolean retryable) {}
}
