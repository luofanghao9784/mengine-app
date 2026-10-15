package com.dreamcore.workspace.identity;
import java.util.UUID;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
public class EngineTelemetryController {
 private final EngineTelemetryService service; private final EngineAttentionService attention; private final EngineRetryService retries;
 public EngineTelemetryController(EngineTelemetryService service,EngineAttentionService attention,EngineRetryService retries){this.service=service;this.attention=attention;this.retries=retries;}
 @PostMapping("/api/platform-admin/v1/engine-telemetry/attention/retry")
 public EngineRetryService.Receipt retry(Authentication auth,HttpServletResponse response,@RequestBody EngineRetryService.Request body){response.setHeader("Cache-Control","private, no-store");return retries.retry(IdentityController.actor(auth),body);}
 @GetMapping("/api/platform-admin/v1/engine-telemetry/attention")
 public EngineAttentionService.Page attention(Authentication auth,HttpServletResponse response,@RequestParam(required=false) UUID tenant,@RequestParam(defaultValue="ALL") String state,@RequestParam(defaultValue="0") int offset){response.setHeader("Cache-Control","private, no-store");return attention.read(IdentityController.actor(auth),tenant,state,offset);}
 @GetMapping("/api/platform-admin/v1/engine-telemetry")
 public EngineTelemetryService.Snapshot platform(Authentication auth,HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");return service.read(IdentityController.actor(auth),null,true);}
 @GetMapping("/api/platform-admin/v1/engine-telemetry/tenants")
 public EngineTelemetryService.TenantDistribution tenants(Authentication auth,HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");return service.tenants(IdentityController.actor(auth));}
 @GetMapping("/api/tenant-admin/v1/tenants/{tenant}/engine-telemetry")
 public EngineTelemetryService.Snapshot tenant(Authentication auth,HttpServletResponse response,@PathVariable UUID tenant){response.setHeader("Cache-Control","private, no-store");return service.read(IdentityController.actor(auth),tenant,false);}
}
