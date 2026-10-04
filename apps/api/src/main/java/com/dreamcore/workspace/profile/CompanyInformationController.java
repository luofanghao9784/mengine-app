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
 public CompanyInformationController(CompanyInformationService service){this.service=service;}
 @ModelAttribute public void headers(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");}
 @GetMapping public CompanyInformationService.Page get(Authentication auth,@PathVariable UUID tenant){return service.get(UUID.fromString(auth.getName()),tenant);}
 @PostMapping public CompanyInformationService.Receipt change(Authentication auth,@PathVariable UUID tenant,@RequestBody CompanyInformationService.Change body){return service.change(UUID.fromString(auth.getName()),tenant,body);}
}
