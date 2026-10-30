package com.dreamcore.workspace.agentadmin;

import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/** CT-034-A：通过会话与 CSRF 门禁后登记平台目录。 */
@RestController
public class CapabilityRegistryController {
    static final String PATH = "/api/agent-admin/v1/capabilities";

    private final CapabilityRegistryStore store;

    public CapabilityRegistryController(CapabilityRegistryStore store) {
        this.store = store;
    }

    @PostMapping(PATH)
    public ResponseEntity<?> registerCapability(@RequestBody JsonNode request) {
        if (!request.isObject()) return invalid("请按要求填写登记内容");
        if (!Set.of("capabilityId", "name", "kind", "enterpriseFunction").containsAll(request.propertyNames())) {
            return invalid("有无法识别的字段，请检查后再提交");
        }
        if (!request.has("capabilityId") || !request.get("capabilityId").isTextual()
                || !request.has("name") || !request.get("name").isTextual()
                || (request.has("kind") && (!request.get("kind").isTextual()
                    || !"quality_check".equals(request.get("kind").asString())))
                || (request.has("enterpriseFunction") && (!request.get("enterpriseFunction").isTextual()
                    || !Set.of("document-parse", "table-compare", "quality-check", "semantic-annotation", "repair-suggestion")
                        .contains(request.get("enterpriseFunction").asString())))) {
            return invalid("请按要求填写登记内容");
        }
        if (request.get("capabilityId").asString().trim().isEmpty()
                || request.get("name").asString().trim().isEmpty()) {
            return invalid("请按要求填写登记内容");
        }
        boolean inserted = store.insert(request.get("capabilityId").asString(), request.get("name").asString(),
                request.has("kind") ? request.get("kind").asString() : null,
                request.has("enterpriseFunction") ? request.get("enterpriseFunction").asString() : null);
        if (!inserted) {
            return ResponseEntity.status(HttpStatus.CONFLICT).header("Cache-Control", "no-store")
                    .body(new RegistryError("1.0", "CAPABILITY_ALREADY_REGISTERED",
                            "已经登记过了，请勿重复提交", false));
        }
        return ResponseEntity.status(HttpStatus.CREATED).header("Cache-Control", "no-store").body(request);
    }

    private ResponseEntity<RegistryError> invalid(String message) {
        return ResponseEntity.badRequest().header("Cache-Control", "no-store")
                .body(new RegistryError("1.0", "INVALID_REQUEST", message, false));
    }

    record RegistryError(String contractVersion, String code, String message, boolean retryable) {}
}
