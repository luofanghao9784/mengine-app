package com.dreamcore.workspace.notification;

import com.dreamcore.workspace.conversation.ConversationService;
import com.dreamcore.workspace.recommendation.RecommendationService;
import jakarta.servlet.http.HttpServletResponse;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/tenants/{tenant}/workspace/notifications")
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class WorkspaceNotificationController {
    public record Summary(UUID tenantId, boolean conversations, boolean briefing) {}
    private final ConversationService conversations;
    private final RecommendationService recommendations;
    public WorkspaceNotificationController(ConversationService conversations, RecommendationService recommendations) {
        this.conversations=conversations;this.recommendations=recommendations;
    }
    @GetMapping public Summary get(Authentication auth,@PathVariable UUID tenant,HttpServletResponse response) {
        response.setHeader("Cache-Control","private, no-store");
        UUID actor=UUID.fromString(auth.getName());
        return new Summary(tenant,conversations.hasUnreadOrAttention(actor,tenant),recommendations.hasUnreadBriefing(actor,tenant));
    }
}
