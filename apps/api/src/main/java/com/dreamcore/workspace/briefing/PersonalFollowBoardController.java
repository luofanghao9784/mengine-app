package com.dreamcore.workspace.briefing;
import tools.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api/v1/tenants/{tenant}/briefing/boards/{board}")
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class PersonalFollowBoardController {
    public record Save(@NotNull UUID requestId, @NotNull @Min(0) Integer expectedRevision, JsonNode preference) {}
    private final PersonalFollowBoard service;
    public PersonalFollowBoardController(PersonalFollowBoard service) { this.service=service; }
    @ModelAttribute public void privateResponse(HttpServletResponse response) { response.setHeader("Cache-Control","private, no-store"); }
    @GetMapping public PersonalFollowBoard.Board get(Authentication auth,@PathVariable UUID tenant,@PathVariable String board) {
        return service.get(UUID.fromString(auth.getName()),tenant,board);
    }
    @PostMapping public PersonalFollowBoard.Receipt save(Authentication auth,@PathVariable UUID tenant,@PathVariable String board,@Valid @RequestBody Save body) {
        return service.save(UUID.fromString(auth.getName()),tenant,board,body.requestId(),body.expectedRevision(),body.preference());
    }
}
