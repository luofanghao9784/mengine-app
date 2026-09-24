package com.dreamcore.workspace.activity;

import jakarta.servlet.http.HttpServletResponse;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/activity")
public class ActivityController {
    private final ActivityService service;
    public ActivityController(ActivityService service) { this.service=service; }
    @GetMapping
    public ActivityService.Page list(Authentication auth, HttpServletResponse response, @PathVariable UUID tenant,
            @RequestParam(required=false) UUID workspace, @RequestParam(required=false) String cursor,
            @RequestParam(defaultValue="20") int limit) {
        response.setHeader("Cache-Control","private, no-store");
        response.setHeader("X-Content-Type-Options","nosniff");
        return service.list(UUID.fromString(auth.getName()),tenant,workspace,cursor,limit);
    }
}
