package com.dreamcore.workspace.identity;
import java.util.UUID;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
public class EngineTelemetryController {
 private final EngineTelemetryService service;
 public EngineTelemetryController(EngineTelemetryService service){this.service=service;}
 @GetMapping("/api/platform-admin/v1/engine-telemetry")
 public EngineTelemetryService.Snapshot platform(Authentication auth,HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");return service.read(IdentityController.actor(auth),null,true);}
 @GetMapping("/api/platform-admin/v1/engine-telemetry/tenants")
 public EngineTelemetryService.TenantDistribution tenants(Authentication auth,HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");return service.tenants(IdentityController.actor(auth));}
 @GetMapping("/api/tenant-admin/v1/tenants/{tenant}/engine-telemetry")
 public EngineTelemetryService.Snapshot tenant(Authentication auth,HttpServletResponse response,@PathVariable UUID tenant){response.setHeader("Cache-Control","private, no-store");return service.read(IdentityController.actor(auth),tenant,false);}
}
