package com.dreamcore.workspace.audience;
import java.util.UUID;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api/v1/tenants/{tenant}/work-roles")
public class WorkAudienceController {
 private final WorkAudienceService service;public WorkAudienceController(WorkAudienceService service){this.service=service;}
 @ModelAttribute public void headers(HttpServletResponse r){r.setHeader("Cache-Control","private, no-store");}
 @GetMapping public WorkAudienceService.Page list(Authentication a,@PathVariable UUID tenant){return service.list(UUID.fromString(a.getName()),tenant);}
 @GetMapping("/current") public WorkAudienceService.Context current(Authentication a,@PathVariable UUID tenant){return service.current(UUID.fromString(a.getName()),tenant);}
 @PostMapping("/{account}") public WorkAudienceService.Profile save(Authentication a,@PathVariable UUID tenant,@PathVariable UUID account,@RequestBody WorkAudienceService.Change c){return service.save(UUID.fromString(a.getName()),tenant,account,c);}
}
