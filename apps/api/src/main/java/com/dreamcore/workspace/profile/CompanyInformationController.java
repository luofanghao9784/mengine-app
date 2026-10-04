package com.dreamcore.workspace.profile;
import java.util.UUID;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/company-information")
public class CompanyInformationController {
 private final CompanyInformationService service;
 private final CompanyInferenceService inference;
 public CompanyInformationController(CompanyInformationService service,CompanyInferenceService inference){this.service=service;this.inference=inference;}
 @ModelAttribute public void headers(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");}
 @GetMapping public CompanyInformationService.Page get(Authentication auth,@PathVariable UUID tenant){return service.get(UUID.fromString(auth.getName()),tenant);}
 @PostMapping public CompanyInformationService.Receipt change(Authentication auth,@PathVariable UUID tenant,@RequestBody CompanyInformationService.Change body){return service.change(UUID.fromString(auth.getName()),tenant,body);}
 @GetMapping("/suggestions") public java.util.List<CompanyInferenceService.Suggestion> suggestions(Authentication auth,@PathVariable UUID tenant){return inference.suggestions(UUID.fromString(auth.getName()),tenant);}
 @GetMapping("/tags/{tag}/evidence") public java.util.List<CompanyInferenceService.Source> evidence(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID tag,@RequestParam int revision){return inference.evidence(UUID.fromString(auth.getName()),tenant,tag,revision);}
 @PostMapping("/suggestions/{suggestion}") public CompanyInferenceService.Receipt decide(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID suggestion,@RequestBody CompanyInferenceService.Decision body){return inference.decide(UUID.fromString(auth.getName()),tenant,suggestion,body);}
}
