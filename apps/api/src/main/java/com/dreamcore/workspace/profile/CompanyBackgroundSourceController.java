package com.dreamcore.workspace.profile;

import java.util.UUID;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/company-information/source")
public class CompanyBackgroundSourceController {
    private final CompanyBackgroundSourceService service;
    public CompanyBackgroundSourceController(CompanyBackgroundSourceService service) { this.service=service; }
    @ModelAttribute public void headers(HttpServletResponse response) { response.setHeader("Cache-Control","private, no-store"); }
    @GetMapping public CompanyBackgroundSourceService.Source get(Authentication auth,@PathVariable UUID tenant) {
        return service.get(UUID.fromString(auth.getName()),tenant);
    }
    @GetMapping("/entries/{entry}") public CompanyBackgroundSourceService.Entry entry(Authentication auth,
        @PathVariable UUID tenant,@PathVariable UUID entry,@RequestParam(required=false) Integer expectedRevision) {
        return service.entry(UUID.fromString(auth.getName()),tenant,entry,expectedRevision);
    }
}
