package com.dreamcore.workspace.collection;

import jakarta.servlet.http.HttpServletResponse;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/tenants/{tenant}/database/governance-releases")
public class NativeGovernanceController {
   private final NativeGovernanceDeployment service;

   public NativeGovernanceController(NativeGovernanceDeployment service) {
      this.service = service;
   }

   @ModelAttribute
   public void headers(HttpServletResponse response) {
      response.setHeader("Cache-Control", "private, no-store");
   }

   @GetMapping
   public Object list(Authentication a, @PathVariable UUID tenant) {
      return this.service.list(UUID.fromString(a.getName()), tenant);
   }

   @GetMapping("/{id}")
   public Object read(Authentication a, @PathVariable UUID tenant, @PathVariable UUID id) {
      return this.service.read(UUID.fromString(a.getName()), tenant, id);
   }
}
