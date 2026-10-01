package com.dreamcore.workspace.retention;
import java.util.UUID;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
@RestController @ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class OperationRetentionController {
 private final OperationRetentionService service;
 public OperationRetentionController(OperationRetentionService service){this.service=service;}
 @ModelAttribute public void headers(HttpServletResponse r){r.setHeader("Cache-Control","private, no-store");}
 @GetMapping("/api/v1/tenants/{tenant}/retention/operation-cleanup")
 public OperationRetentionService.Status tenant(Authentication a,@PathVariable UUID tenant){return service.tenant(UUID.fromString(a.getName()),tenant);}
 @GetMapping("/api/platform-admin/v1/operation-cleanup")
 public OperationRetentionService.Status platform(Authentication a){return service.platform(UUID.fromString(a.getName()));}
}
