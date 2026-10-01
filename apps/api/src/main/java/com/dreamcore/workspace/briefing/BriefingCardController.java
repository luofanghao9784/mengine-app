package com.dreamcore.workspace.briefing;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController @RequestMapping("/api/v1/tenants/{tenant}/briefing/cards")
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class BriefingCardController {
    public record Move(@NotNull UUID requestId,@NotNull @Min(0) Integer expectedRevision,@NotNull UUID cardId,@NotNull UUID anchorId,@NotNull String direction) {}
    private final BriefingCardService service;
    public BriefingCardController(BriefingCardService service){this.service=service;}
    @ModelAttribute public void privateResponse(HttpServletResponse r){r.setHeader("Cache-Control","private, no-store");r.setHeader("X-Content-Type-Options","nosniff");}
    @GetMapping("/{card}/preference") public BriefingService.Preference get(Authentication a,@PathVariable UUID tenant,@PathVariable UUID card){return service.get(UUID.fromString(a.getName()),tenant,card);}
    @PostMapping("/{card}/preference") public BriefingService.Preference update(Authentication a,@PathVariable UUID tenant,@PathVariable UUID card,@Valid @RequestBody BriefingController.Update b){return service.update(UUID.fromString(a.getName()),tenant,card,b.requestId(),b.expectedRevision(),b.pinned(),b.hidden(),b.size());}
    @PostMapping("/layout") public BriefingCardService.Move move(Authentication a,@PathVariable UUID tenant,@Valid @RequestBody Move b){return service.move(UUID.fromString(a.getName()),tenant,b.requestId(),b.expectedRevision(),b.cardId(),b.anchorId(),b.direction());}
}
