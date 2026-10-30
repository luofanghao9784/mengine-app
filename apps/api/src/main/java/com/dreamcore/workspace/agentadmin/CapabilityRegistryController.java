package com.dreamcore.workspace.agentadmin;

import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/** CT-034 C 档：仅挂登记入口；未持久化，不返回保存成功。 */
@RestController
public class CapabilityRegistryController {
    static final String PATH = "/api/agent-admin/v1/capabilities";

    @PostMapping(PATH)
    public ResponseEntity<RegistryError> registerCapability(@RequestBody JsonNode request) {
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
        return ResponseEntity.status(HttpStatus.NOT_IMPLEMENTED)
                .header("Cache-Control", "no-store")
                .body(new RegistryError("1.0", "CAPABILITY_REGISTRATION_NOT_IMPLEMENTED",
                        "登记保存还在开通中，请稍后再试", false));
    }

    private ResponseEntity<RegistryError> invalid(String message) {
        return ResponseEntity.badRequest().header("Cache-Control", "no-store")
                .body(new RegistryError("1.0", "INVALID_REQUEST", message, false));
    }

    record RegistryError(String contractVersion, String code, String message, boolean retryable) {}
}
