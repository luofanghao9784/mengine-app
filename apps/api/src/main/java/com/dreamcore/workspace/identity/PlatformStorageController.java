package com.dreamcore.workspace.identity;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
public class PlatformStorageController {
 private final PlatformStorageService service;
 public PlatformStorageController(PlatformStorageService service){this.service=service;}
 @GetMapping("/api/platform-admin/v1/storage-status") public PlatformStorageService.Status status(Authentication auth,HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");return service.status(IdentityController.actor(auth));}
}
