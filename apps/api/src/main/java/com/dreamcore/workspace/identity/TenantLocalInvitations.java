package com.dreamcore.workspace.identity;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

/** Tenant-bound local preview, including audited headquarters support requests. */
@RestController
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
public class TenantLocalInvitations {
    private final IdentityService identities;
    private final LocalPhoneDelivery delivery;
    private final LocalInvitationDelivery invitations;
    public TenantLocalInvitations(IdentityService identities, LocalPhoneDelivery delivery, LocalInvitationDelivery invitations) {
        this.identities=identities; this.delivery=delivery; this.invitations=invitations;
    }
    @GetMapping("/api/tenant-admin/v1/tenants/{tenant}/invitations/{id}/local-link")
    public Map<String,String> link(Authentication auth, @PathVariable UUID tenant, @PathVariable UUID id,
                                   HttpServletRequest request, HttpServletResponse response) {
        identities.member(IdentityController.actor(auth),tenant,true);
        if(!delivery.previewEnabled(request.getRemoteAddr())) throw new IdentityException(404,"LOCAL_PREVIEW_DISABLED");
        var invite=identities.invitation(id);
        if(!tenant.equals(invite.tenantId())) throw IdentityException.denied();
        if(!"PENDING".equals(invite.status()) || !invite.expiresAt().isAfter(Instant.now())) throw new IdentityException(409,"INVITATION_UNAVAILABLE");
        response.setHeader("Cache-Control","no-store");
        return Map.of("mode","LOCAL","path","/workspace/#invite="+invitations.localToken(id));
    }
}
