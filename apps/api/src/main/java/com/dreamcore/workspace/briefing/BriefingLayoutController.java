package com.dreamcore.workspace.briefing;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController @ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/tenants/{tenant}/briefing/layout")
public class BriefingLayoutController {
 public record Request(@NotNull UUID requestId,@NotNull @Min(0) Integer expectedRevision,@NotNull UUID conversationId,@NotNull UUID anchorId,@NotNull String direction) {}
 private final BriefingLayoutService service;
 public BriefingLayoutController(BriefingLayoutService service){this.service=service;}
 @ModelAttribute public void privateResponse(HttpServletResponse response){response.setHeader("Cache-Control","private, no-store");response.setHeader("X-Content-Type-Options","nosniff");}
 @GetMapping public BriefingLayoutService.Layout get(Authentication auth,@PathVariable UUID tenant){return service.get(UUID.fromString(auth.getName()),tenant);}
 @PostMapping public BriefingLayoutService.Move move(Authentication auth,@PathVariable UUID tenant,@Valid @RequestBody Request body){return service.move(UUID.fromString(auth.getName()),tenant,body.requestId(),body.expectedRevision(),body.conversationId(),body.anchorId(),body.direction());}
}
