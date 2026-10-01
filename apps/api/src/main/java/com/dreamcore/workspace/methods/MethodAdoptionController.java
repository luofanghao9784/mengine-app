package com.dreamcore.workspace.methods;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController @ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/methods")
public class MethodAdoptionController {
 public record Adopt(@NotNull UUID requestId,UUID workspaceId,@Min(0) int expectedRevision,@NotNull String action,UUID versionId,boolean limitationsAccepted){}
 private final MethodService service;public MethodAdoptionController(MethodService service){this.service=service;}
 private UUID actor(Authentication auth){return UUID.fromString(auth.getName());}
 @ModelAttribute public void cache(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");}
 @GetMapping public MethodService.Families list(Authentication auth,@PathVariable UUID tenant,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit){return service.list(actor(auth),tenant,offset,limit);}
 @GetMapping("/selection") public MethodService.Selection selection(Authentication auth,@PathVariable UUID tenant,@RequestParam(required=false) UUID workspace){return service.selection(actor(auth),tenant,workspace);}
 @PostMapping("/selection") public MethodService.Selection adopt(Authentication auth,@PathVariable UUID tenant,@Valid @RequestBody Adopt b){return service.adopt(actor(auth),tenant,b.workspaceId(),b.requestId(),b.expectedRevision(),b.action(),b.versionId(),b.limitationsAccepted());}
}
