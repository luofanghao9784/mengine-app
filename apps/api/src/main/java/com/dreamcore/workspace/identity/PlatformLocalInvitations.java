package com.dreamcore.workspace.identity;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

/** Local synthetic delivery only. Never grants platform users access to customer content. */
@RestController
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/platform-admin/v1/local-invitations")
public class PlatformLocalInvitations {
    private final IdentityService identities;
    private final LocalPhoneDelivery delivery;
    private final LocalInvitationDelivery invitations;
    private final JdbcTemplate db;
    public PlatformLocalInvitations(IdentityService identities,LocalPhoneDelivery delivery,LocalInvitationDelivery invitations,JdbcTemplate db) {
        this.identities=identities;this.delivery=delivery;this.invitations=invitations;this.db=db;
    }
    @GetMapping("/configuration") public Map<String,Object> configuration(Authentication auth,HttpServletRequest request) {
        identities.platform(IdentityController.actor(auth));
        return Map.of("localPreview",delivery.previewEnabled(request.getRemoteAddr()));
    }
    @GetMapping("/{id}") public Map<String,String> link(Authentication auth,@PathVariable UUID id,HttpServletRequest request) {
        identities.platform(IdentityController.actor(auth));
        if(!delivery.previewEnabled(request.getRemoteAddr())) throw new IdentityException(404,"LOCAL_PREVIEW_DISABLED");
        if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM tenant_initial_admin WHERE invitation_id=?)",Boolean.class,id))) throw IdentityException.denied();
        if(!"PENDING".equals(identities.invitation(id).status())) throw new IdentityException(409,"INVITATION_UNAVAILABLE");
        return Map.of("mode","LOCAL","path","/workspace/#invite="+invitations.localToken(id));
    }
}
