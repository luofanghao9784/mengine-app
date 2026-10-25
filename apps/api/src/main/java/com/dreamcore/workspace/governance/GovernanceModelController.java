package com.dreamcore.workspace.governance;

import jakarta.servlet.http.HttpServletResponse;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@ConditionalOnWebApplication(type = Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/governance-jobs")
public class GovernanceModelController {
   private final GovernanceModelService service;

   @ModelAttribute
   public void headers(HttpServletResponse response) {
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
   }

   public GovernanceModelController(GovernanceModelService service) {
      this.service = service;
   }

   @GetMapping
   public Object list(Authentication a, @PathVariable UUID tenant) {
      return this.service.list(UUID.fromString(a.getName()), tenant);
   }

   @GetMapping("/{id}")
   public Object detail(Authentication a, @PathVariable UUID tenant, @PathVariable UUID id) {
      return this.service.detail(UUID.fromString(a.getName()), tenant, id);
   }

   @PostMapping
   public Object start(Authentication a, @PathVariable UUID tenant, @RequestBody GovernanceModelService.Start b) {
      return this.service.start(UUID.fromString(a.getName()), tenant, b);
   }

   @PostMapping("/execute")
   public Object execute(Authentication a, @PathVariable UUID tenant, @RequestBody GovernanceModelService.Execute b) {
      return this.service.execute(UUID.fromString(a.getName()), tenant, b);
   }

   @PostMapping("/{id}/retry")
   public Object retry(Authentication a, @PathVariable UUID tenant, @PathVariable UUID id, @RequestBody GovernanceModelService.Refresh b) {
      return this.service.retry(UUID.fromString(a.getName()), tenant, id, b);
   }

   @PostMapping("/{id}/refresh")
   public Object refresh(Authentication a, @PathVariable UUID tenant, @PathVariable UUID id, @RequestBody GovernanceModelService.Refresh b) {
      return this.service.refresh(UUID.fromString(a.getName()), tenant, id, b);
   }

   @PostMapping("/{id}/response")
   public Object answer(Authentication a, @PathVariable UUID tenant, @PathVariable UUID id, @RequestBody GovernanceModelService.Answer b) {
      return this.service.answer(UUID.fromString(a.getName()), tenant, id, b);
   }

   @PostMapping("/{id}/publish")
   public Object publish(Authentication a, @PathVariable UUID tenant, @PathVariable UUID id, @RequestBody GovernanceModelService.Publish b) {
      return this.service.publish(UUID.fromString(a.getName()), tenant, id, b);
   }
}
