package com.dreamcore.workspace.briefing;

import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/tenants/{tenant}/briefing")
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class BriefingController {
    public record Update(@NotNull UUID requestId,@NotNull @Min(0) Integer expectedRevision,@NotNull Boolean pinned,@NotNull Boolean hidden,@NotNull String size) {}
    private final BriefingService service;
    public BriefingController(BriefingService service){this.service=service;}
    @ModelAttribute public void privateResponse(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");response.setHeader("X-Content-Type-Options","nosniff");}
    @GetMapping public BriefingService.Page list(Authentication auth,@PathVariable UUID tenant,@RequestParam(required=false) UUID workspaceId,@RequestParam(defaultValue="LATEST") String view,@RequestParam(required=false) String date,@RequestParam(defaultValue="Asia/Shanghai") String zone,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="20") int limit) {
        return service.list(UUID.fromString(auth.getName()),tenant,workspaceId,view,date,zone,offset,limit);
    }
    @PostMapping("/{conversation}") public BriefingService.Preference update(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID conversation,@Valid @RequestBody Update body) {
        return service.update(UUID.fromString(auth.getName()),tenant,conversation,body.requestId(),body.expectedRevision(),body.pinned(),body.hidden(),body.size());
    }
    @GetMapping("/{conversation}/preference") public BriefingService.Preference preference(Authentication auth,@PathVariable UUID tenant,@PathVariable UUID conversation) {
        return service.readPreference(UUID.fromString(auth.getName()),tenant,conversation);
    }
}
