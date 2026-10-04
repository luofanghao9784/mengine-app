package com.dreamcore.workspace.experience;
import jakarta.servlet.http.HttpServletResponse;import jakarta.validation.Valid;import jakarta.validation.constraints.NotNull;
import java.util.UUID;import org.springframework.web.bind.annotation.*;import org.springframework.security.core.Authentication;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/workspaces/{workspace}/experiences/{entry}/adjustments")
public class ExperienceAdjustmentController {
 public record Submit(@NotNull UUID requestId,@NotNull Integer expectedRevision,@NotNull UUID versionId,@NotNull ExperienceAdjustmentService.Proposal proposal) {}
 private final ExperienceAdjustmentService service;private final ExperienceAnalysisRuntime runtime;private final boolean enabled;
 public ExperienceAdjustmentController(ExperienceAdjustmentService service,ExperienceAnalysisRuntime runtime,@org.springframework.beans.factory.annotation.Value("${dreamcore.experience-analysis.enabled:false}") boolean enabled){this.service=service;this.runtime=runtime;this.enabled=enabled;}
 @ModelAttribute public void headers(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");}
 @PostMapping public ExperienceAdjustmentService.Adjustment submit(Authentication a,@PathVariable UUID tenant,@PathVariable UUID workspace,@PathVariable UUID entry,@Valid @RequestBody Submit b){return service.submit(UUID.fromString(a.getName()),tenant,workspace,entry,b.requestId(),b.expectedRevision(),b.versionId(),b.proposal());}
 @GetMapping public ExperienceAdjustmentService.Page list(Authentication a,@PathVariable UUID tenant,@PathVariable UUID workspace,@PathVariable UUID entry){return service.list(UUID.fromString(a.getName()),tenant,workspace,entry,enabled&&runtime.configured());}
}
