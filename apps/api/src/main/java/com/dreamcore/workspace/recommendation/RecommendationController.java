package com.dreamcore.workspace.recommendation;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController @RequestMapping("/api/v1/tenants/{tenant}/recommendations")
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class RecommendationController {
 public record Configure(@NotNull UUID requestId,@NotNull @Min(0) Integer expectedRevision,@NotNull Boolean enabled){}
 private final RecommendationService service;public RecommendationController(RecommendationService service){this.service=service;}
 @ModelAttribute public void headers(HttpServletResponse r){r.setHeader("Cache-Control","private, no-store");r.setHeader("X-Content-Type-Options","nosniff");}
 @GetMapping public RecommendationService.Page list(Authentication a,@PathVariable UUID tenant,@RequestParam(required=false) UUID workspaceId,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit,@RequestParam(required=false) String snapshot,@RequestParam(defaultValue="false") boolean generatedOnly,@RequestParam(required=false) String businessType,@RequestParam(defaultValue="false") boolean publicationsOnly,@RequestParam(defaultValue="false") boolean focused){return service.list(UUID.fromString(a.getName()),tenant,workspaceId,offset,limit,snapshot,generatedOnly,businessType,publicationsOnly,focused);}
 @GetMapping("/settings") public RecommendationService.Settings settings(Authentication a,@PathVariable UUID tenant){return service.settings(UUID.fromString(a.getName()),tenant);}
 @PostMapping("/settings") public RecommendationService.Settings configure(Authentication a,@PathVariable UUID tenant,@Valid @RequestBody Configure b){return service.configure(UUID.fromString(a.getName()),tenant,b.requestId(),b.expectedRevision(),b.enabled());}
 @PostMapping("/opened") public RecommendationService.Opened opened(Authentication a,@PathVariable UUID tenant,@RequestBody RecommendationService.Target target){return service.opened(UUID.fromString(a.getName()),tenant,target);}
 public record Follow(@NotNull UUID requestId,@NotNull @Min(0) Integer expectedRevision,@NotNull Boolean pinned){}
 @GetMapping("/publications/{material}/preference") public Object preference(Authentication a,@PathVariable UUID tenant,@PathVariable UUID material){return service.publicationPreference(UUID.fromString(a.getName()),tenant,material);}
 @PostMapping("/publications/{material}/preference") public Object follow(Authentication a,@PathVariable UUID tenant,@PathVariable UUID material,@Valid @RequestBody Follow body){return service.followPublication(UUID.fromString(a.getName()),tenant,material,body.requestId(),body.expectedRevision(),body.pinned());}
}
