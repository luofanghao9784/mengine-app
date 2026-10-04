package com.dreamcore.workspace.identity;
import java.util.UUID;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
public class PlatformDataOperationsController {
 private final PlatformDataOperationsService service;
 public PlatformDataOperationsController(PlatformDataOperationsService service){this.service=service;}
 @ModelAttribute public void noStore(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");}
 @GetMapping("/api/platform-admin/v1/data-operations") public PlatformDataOperationsService.Overview list(Authentication auth,@RequestParam(defaultValue="CONNECTIONS") String kind,@RequestParam(defaultValue="") String query,@RequestParam(defaultValue="ALL") String state,@RequestParam(defaultValue="0") int offset){return service.list(IdentityController.actor(auth),kind,query,state,offset);}
 @GetMapping("/api/platform-admin/v1/tenants/{tenant}/data-operations") public PlatformDataOperationsService.Detail detail(Authentication auth,@PathVariable UUID tenant,@RequestParam(defaultValue="CONNECTIONS") String kind,@RequestParam(defaultValue="ALL") String state,@RequestParam(defaultValue="0") int offset){return service.detail(IdentityController.actor(auth),tenant,kind,state,offset);}
}
