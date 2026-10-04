package com.dreamcore.workspace.identity;
import java.util.UUID;import jakarta.servlet.http.HttpServletResponse;import org.springframework.security.core.Authentication;import org.springframework.web.bind.annotation.*;
@RestController
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
public class UsageController {
 private final UsageService service;public UsageController(UsageService service){this.service=service;}
 @ModelAttribute public void noStore(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");}
 @GetMapping("/api/platform-admin/v1/usage") public UsageService.Platform platform(Authentication auth,@RequestParam(defaultValue="THIS_MONTH") String period){return service.platform(IdentityController.actor(auth),null,period);}
 @GetMapping("/api/platform-admin/v1/tenants/{tenant}/usage") public UsageService.Platform platformTenant(Authentication auth,@PathVariable UUID tenant,@RequestParam(defaultValue="THIS_MONTH") String period){return service.platform(IdentityController.actor(auth),tenant,period);}
 @GetMapping("/api/tenant-admin/v1/tenants/{tenant}/usage") public UsageService.Overview tenant(Authentication auth,@PathVariable UUID tenant,@RequestParam(defaultValue="THIS_MONTH") String period){return service.tenant(IdentityController.actor(auth),tenant,period);}
}
