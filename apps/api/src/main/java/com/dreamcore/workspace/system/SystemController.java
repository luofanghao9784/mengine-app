package com.dreamcore.workspace.system;

import com.dreamcore.workspace.engine.EngineGateway;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

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
