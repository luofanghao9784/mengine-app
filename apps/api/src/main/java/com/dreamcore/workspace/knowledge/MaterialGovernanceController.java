package com.dreamcore.workspace.knowledge;
import java.util.UUID;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/material-governance")
public class MaterialGovernanceController {
 private final MaterialGovernanceService service;
 public MaterialGovernanceController(MaterialGovernanceService service){this.service=service;}
 @ModelAttribute public void headers(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");}
 @GetMapping public MaterialGovernanceService.Page list(Authentication auth,@PathVariable UUID tenant,@RequestParam(defaultValue="") String q,@RequestParam(defaultValue="all") String queue,@RequestParam(defaultValue="all") String rule,@RequestParam(defaultValue="priority") String sort,@RequestParam(defaultValue="0") int offset){return service.list(UUID.fromString(auth.getName()),tenant,q,queue,rule,sort,offset);}
 @GetMapping("/{material}") public MaterialGovernanceService.Item detail(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID material){return service.detail(UUID.fromString(auth.getName()),tenant,material);}
 @PostMapping("/{material}/check") public MaterialGovernanceService.Result check(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID material,@RequestBody MaterialGovernanceService.Change change){return service.change(UUID.fromString(auth.getName()),tenant,material,change,false);}
 @PostMapping("/{material}/redact") public MaterialGovernanceService.Result redact(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID material,@RequestBody MaterialGovernanceService.Change change){return service.change(UUID.fromString(auth.getName()),tenant,material,change,true);}
}
