package com.dreamcore.workspace.departure;
import jakarta.servlet.http.HttpServletResponse;import java.util.UUID;import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;import org.springframework.security.core.Authentication;import org.springframework.web.bind.annotation.*;
@RestController @ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class DepartureStatusController {
 private final DepartureStatusService service;public DepartureStatusController(DepartureStatusService service){this.service=service;}
 @ModelAttribute public void headers(HttpServletResponse r){r.setHeader("Cache-Control","private, no-store");}
 @GetMapping("/api/v1/tenants/{tenant}/departures/business-status")public DepartureStatusService.Status member(Authentication actor,@PathVariable UUID tenant){return service.get(UUID.fromString(actor.getName()),tenant,false);}
 @GetMapping("/api/platform-admin/v1/tenants/{tenant}/departure-status")public DepartureStatusService.Status platform(Authentication actor,@PathVariable UUID tenant){return service.get(UUID.fromString(actor.getName()),tenant,true);}
}
