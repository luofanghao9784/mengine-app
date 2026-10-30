package com.dreamcore.workspace.agentadmin;

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
        return ResponseEntity.status(HttpStatus.NOT_IMPLEMENTED)
                .header("Cache-Control", "no-store")
                .body(new RegistryError("1.0", "CAPABILITY_REGISTRATION_NOT_IMPLEMENTED",
                        "登记保存还在开通中，请稍后再试", false));
    }

    record RegistryError(String contractVersion, String code, String message, boolean retryable) {}
}
