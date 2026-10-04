package com.dreamcore.workspace.experience;
import jakarta.servlet.http.HttpServletResponse;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
public class GeneralExperienceController {
 private final GeneralExperienceLibrary library;private final ExperienceGeneralizationRuntime runtime;private final boolean enabled;
 public GeneralExperienceController(GeneralExperienceLibrary library,ExperienceGeneralizationRuntime runtime,@org.springframework.beans.factory.annotation.Value("${dreamcore.experience-generalization.enabled:false}") boolean enabled){this.library=library;this.runtime=runtime;this.enabled=enabled;}
 @ModelAttribute public void headers(HttpServletResponse r){r.setHeader("Cache-Control","private, no-store");}
 @GetMapping({"/api/platform-admin/v1/experience-library","/api/v1/tenants/{tenant}/general-experiences"})
 public GeneralExperienceLibrary.Page contents(Authentication a,@PathVariable(required=false) UUID tenant,@RequestParam(defaultValue="") String query,@RequestParam(defaultValue="AVAILABLE") String state,@RequestParam(defaultValue="0") int offset){return library.contents(UUID.fromString(a.getName()),tenant,query,state,offset);}
 @GetMapping({"/api/platform-admin/v1/experience-library/{entry}","/api/v1/tenants/{tenant}/general-experiences/{entry}"})
 public GeneralExperienceLibrary.Detail detail(Authentication a,@PathVariable(required=false) UUID tenant,@PathVariable UUID entry,@RequestParam UUID version){return library.detail(UUID.fromString(a.getName()),tenant,entry,version);}
 @GetMapping("/api/platform-admin/v1/experience-library/processing")
 public GeneralExperienceLibrary.Processing processing(Authentication a){return library.processing(UUID.fromString(a.getName()),enabled&&runtime.configured());}
}
