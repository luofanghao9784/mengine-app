package com.dreamcore.workspace.experience;
import jakarta.servlet.http.HttpServletResponse;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/experience-library")
public class ExperienceManagementController {
 private final ExperienceManagementService service;private final ExperienceAnalysisRuntime runtime;private final boolean enabled;
 public ExperienceManagementController(ExperienceManagementService service,ExperienceAnalysisRuntime runtime,@org.springframework.beans.factory.annotation.Value("${dreamcore.experience-analysis.enabled:false}") boolean enabled){this.service=service;this.runtime=runtime;this.enabled=enabled;}
 @ModelAttribute public void headers(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");}
 @GetMapping public ExperienceManagementService.ContentPage contents(Authentication a,@PathVariable UUID tenant,@RequestParam(required=false) UUID workspace,@RequestParam(defaultValue="") String query,@RequestParam(defaultValue="AVAILABLE") String state,@RequestParam(defaultValue="0") int offset){return service.contents(UUID.fromString(a.getName()),tenant,workspace,query,state,offset);}
 @GetMapping("/{entry}/history") public ExperienceManagementService.History history(Authentication a,@PathVariable UUID tenant,@PathVariable UUID entry,@RequestParam UUID workspace,@RequestParam(defaultValue="0") int offset){return service.history(UUID.fromString(a.getName()),tenant,workspace,entry,offset);}
 @GetMapping("/processing") public ExperienceManagementService.ProcessingPage processing(Authentication a,@PathVariable UUID tenant,@RequestParam(required=false) UUID workspace,@RequestParam(defaultValue="ALL") String state,@RequestParam(defaultValue="0") int offset){return service.processing(UUID.fromString(a.getName()),tenant,workspace,state,offset,enabled&&runtime.configured());}
}
