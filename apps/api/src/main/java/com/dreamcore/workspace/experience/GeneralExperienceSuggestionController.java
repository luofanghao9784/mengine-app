package com.dreamcore.workspace.experience;
import jakarta.servlet.http.HttpServletResponse;import java.util.UUID;
import org.springframework.security.core.Authentication;import org.springframework.web.bind.annotation.*;
@RestController
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/general-experiences/{entry}/suggestions")
public class GeneralExperienceSuggestionController {
 private final GeneralExperienceSuggestionService suggestions;private final ExperienceAnalysisRuntime runtime;private final boolean enabled;
 public GeneralExperienceSuggestionController(GeneralExperienceSuggestionService suggestions,ExperienceAnalysisRuntime runtime,@org.springframework.beans.factory.annotation.Value("${dreamcore.experience-analysis.enabled:false}") boolean enabled){this.suggestions=suggestions;this.runtime=runtime;this.enabled=enabled;}
 @ModelAttribute public void headers(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");}
 @GetMapping public GeneralExperienceSuggestionService.Page list(Authentication a,@PathVariable UUID tenant,@PathVariable UUID entry,@RequestParam UUID version){return suggestions.list(UUID.fromString(a.getName()),tenant,entry,version,enabled&&runtime.configured());}
 @PostMapping public GeneralExperienceSuggestionService.Suggestion submit(Authentication a,@PathVariable UUID tenant,@PathVariable UUID entry,@RequestBody GeneralExperienceSuggestionService.Change change){return suggestions.submit(UUID.fromString(a.getName()),tenant,entry,change);}
}
