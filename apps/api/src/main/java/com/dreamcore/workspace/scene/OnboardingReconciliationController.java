package com.dreamcore.workspace.scene;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import jakarta.servlet.http.HttpServletResponse;
@RestController
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/onboarding-reconciliation")
public class OnboardingReconciliationController {
 private final OnboardingReconciliationService service;
 public OnboardingReconciliationController(OnboardingReconciliationService service){this.service=service;}
 @GetMapping public Object catalog(Authentication a,@PathVariable UUID tenant,HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");return service.catalog(UUID.fromString(a.getName()),tenant);}
 @PostMapping public Object execute(Authentication a,@PathVariable UUID tenant,@RequestBody OnboardingReconciliationService.Request request,HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");return service.execute(UUID.fromString(a.getName()),tenant,request);}
}
