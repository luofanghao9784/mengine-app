package com.dreamcore.workspace.knowledge;
import java.util.UUID;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/wiki-graphs")
public class WikiGraphController {
 private final WikiGraphService service;
 public WikiGraphController(WikiGraphService service){this.service=service;}
 @ModelAttribute public void headers(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");response.setHeader("X-Content-Type-Options","nosniff");}
 public record Automatic(UUID requestId) {}
 @PostMapping("/automatic") public WikiGraphService.Item automatic(Authentication auth,@PathVariable UUID tenant,@RequestBody Automatic body){return service.automatic(UUID.fromString(auth.getName()),tenant,body.requestId());}
 @GetMapping public WikiGraphService.Page list(Authentication auth,@PathVariable UUID tenant,@RequestParam(defaultValue="0") int offset){return service.list(UUID.fromString(auth.getName()),tenant,offset);}
 @GetMapping("/{id}") public WikiGraphService.Item detail(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID id){return service.detail(UUID.fromString(auth.getName()),tenant,id);}
 @PostMapping public WikiGraphService.Item start(Authentication auth,@PathVariable UUID tenant,@RequestBody WikiGraphService.Start body){return service.start(UUID.fromString(auth.getName()),tenant,body);}
}
