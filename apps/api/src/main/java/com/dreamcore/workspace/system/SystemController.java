package com.dreamcore.workspace.system;

import com.dreamcore.workspace.engine.EngineGateway;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestController
public class SystemController {
    public record Integrations(String harness, String weknora, String jev) {}
    public record SystemInfo(String contractVersion, String service, String stage, String dataSource,
                             EngineGateway.Capabilities engine, Integrations integrations) {}
    private final EngineGateway engine;

    public SystemController(EngineGateway engine) { this.engine = engine; }

    @GetMapping("/api/v1/system/info")
    public ResponseEntity<SystemInfo> info() {
        var capabilities=engine.capabilities();
        String harness="agent-verification".equals(capabilities.runtimeMode())?"verification":"agent-live".equals(capabilities.runtimeMode())?"configured":"not-configured";
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(new SystemInfo("1.0", "dreamcore-platform", "foundation", "live",
                        capabilities, new Integrations(harness, "not-configured", "not-configured")));
    }
}

@org.springframework.core.annotation.Order(-100)
@RestControllerAdvice(assignableTypes = SystemController.class)
class SystemErrors {
    record ErrorBody(String contractVersion, String code, String message, boolean retryable) {}

    @ExceptionHandler(EngineGateway.Unavailable.class)
    ResponseEntity<ErrorBody> unavailable() {
        return error(HttpStatus.SERVICE_UNAVAILABLE, "ENGINE_UNAVAILABLE", "引擎暂不可用，请稍后重试。", true);
    }

    @ExceptionHandler(EngineGateway.Incompatible.class)
    ResponseEntity<ErrorBody> incompatible() {
        return error(HttpStatus.BAD_GATEWAY, "ENGINE_INCOMPATIBLE", "引擎契约与平台不兼容。", false);
    }

    private ResponseEntity<ErrorBody> error(HttpStatus status, String code, String message, boolean retryable) {
        return ResponseEntity.status(status).header(HttpHeaders.CACHE_CONTROL, "no-store")
                .body(new ErrorBody("1.0", code, message, retryable));
    }
}
