package com.dreamcore.workspace.experience;

import jakarta.servlet.http.HttpServletResponse;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/platform-admin/v1/experience-library/{entry}/adjustments")
public class PlatformExperienceAdjustmentController {
 private final PlatformExperienceAdjustmentService service;private final ExperienceAnalysisRuntime analysis;private final ExperienceGeneralizationRuntime general;private final boolean enabled;
 public PlatformExperienceAdjustmentController(PlatformExperienceAdjustmentService service,ExperienceAnalysisRuntime analysis,ExperienceGeneralizationRuntime general,@Value("${dreamcore.experience-generalization.enabled:false}") boolean enabled){this.service=service;this.analysis=analysis;this.general=general;this.enabled=enabled;}
 @ModelAttribute public void headers(HttpServletResponse r){r.setHeader("Cache-Control","private, no-store");}
 @GetMapping public PlatformExperienceAdjustmentService.Page list(Authentication a,@PathVariable UUID entry,@RequestParam UUID version){return service.list(UUID.fromString(a.getName()),entry,version,enabled&&analysis.configured()&&general.configured());}
 @PostMapping public PlatformExperienceAdjustmentService.Adjustment submit(Authentication a,@PathVariable UUID entry,@RequestBody PlatformExperienceAdjustmentService.Change body){return service.submit(UUID.fromString(a.getName()),entry,body);}
}
