package com.dreamcore.workspace.knowledge;
import java.util.UUID;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController @ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/governance-proposals")
public class GovernanceProposalController {
 private final GovernanceProposalService service;public GovernanceProposalController(GovernanceProposalService service){this.service=service;}
 @ModelAttribute public void headers(HttpServletResponse r){r.setHeader("Cache-Control","private, no-store");r.setHeader("X-Content-Type-Options","nosniff");}
 @GetMapping public GovernanceProposalService.Page list(Authentication a,@PathVariable UUID tenant,@RequestParam(defaultValue="PENDING") String status,@RequestParam(defaultValue="0") int offset){return service.list(UUID.fromString(a.getName()),tenant,status,offset);}
 @GetMapping("/prepare/{material}") public GovernanceProposalService.Preparation prepare(Authentication a,@PathVariable UUID tenant,@PathVariable UUID material){return service.prepare(UUID.fromString(a.getName()),tenant,material);}
 @GetMapping("/{id}") public GovernanceProposalService.Item detail(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id){return service.detail(UUID.fromString(a.getName()),tenant,id);}
 @PostMapping("/sources/{material}") public GovernanceProposalService.Item create(Authentication a,@PathVariable UUID tenant,@PathVariable UUID material,@RequestBody GovernanceProposalService.Create body){return service.create(UUID.fromString(a.getName()),tenant,material,body);}
 @PostMapping("/{id}/resolve") public GovernanceProposalService.Item resolve(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id,@RequestBody GovernanceProposalService.Resolve body){return service.resolve(UUID.fromString(a.getName()),tenant,id,body);}
}
