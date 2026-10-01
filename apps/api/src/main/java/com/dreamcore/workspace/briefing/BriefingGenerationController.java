package com.dreamcore.workspace.briefing;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController @RequestMapping("/api/v1/tenants/{tenant}/briefing/generation")
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class BriefingGenerationController {
    public record Generate(@NotNull UUID requestId,UUID workspaceId,String businessType) {}
    public record Policy(@NotNull UUID workspaceId,@NotNull @Min(1) Integer expectedRevision,@NotNull Boolean enabled) {}
    private final BriefingGenerationService service;
    public BriefingGenerationController(BriefingGenerationService service){this.service=service;}
    @ModelAttribute public void headers(HttpServletResponse r){r.setHeader("Cache-Control","private, no-store");r.setHeader("X-Content-Type-Options","nosniff");}
    @GetMapping public BriefingGenerationService.State state(Authentication a,@PathVariable UUID tenant){return service.state(UUID.fromString(a.getName()),tenant);}
    @PostMapping public BriefingGenerationService.Batch generate(Authentication a,@PathVariable UUID tenant,@Valid @RequestBody Generate b){return service.generate(UUID.fromString(a.getName()),tenant,b.requestId(),b.workspaceId(),b.businessType());}
    @GetMapping("/{id}") public BriefingGenerationService.Batch get(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id){return service.get(UUID.fromString(a.getName()),tenant,id);}
    @PostMapping("/{id}/cancel") public BriefingGenerationService.Batch cancel(Authentication a,@PathVariable UUID tenant,@PathVariable UUID id){return service.cancel(UUID.fromString(a.getName()),tenant,id);}
    @PostMapping("/policy") public BriefingGenerationService.Policy policy(Authentication a,@PathVariable UUID tenant,@Valid @RequestBody Policy b){return service.configure(UUID.fromString(a.getName()),tenant,b.workspaceId(),b.expectedRevision(),b.enabled());}
}
