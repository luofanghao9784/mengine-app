package com.dreamcore.workspace.identity;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/platform-admin/v1")
public class PlatformStaffController {
    private final PlatformStaffService staff;
    private final PlatformIdentity identity;
    private final LocalPhoneDelivery local;
    public PlatformStaffController(PlatformStaffService staff,PlatformIdentity identity,LocalPhoneDelivery local) {this.staff=staff;this.identity=identity;this.local=local;}
    public record Invite(@NotNull UUID requestId,@NotBlank @Size(max=40) String phone) {}
    public record Mutation(@NotNull UUID requestId) {}
    public record Revoke(@NotNull UUID requestId,@NotNull @Min(0) Long expectedVersion) {}
    public record Token(@NotBlank @Size(min=43,max=43) String token) {}
    public record Accept(@NotBlank @Size(min=43,max=43) String token,@NotBlank @Size(max=254) String username,@NotNull @Size(min=6,max=128) String password,@Size(max=80) String displayName) {}
    @GetMapping("/staff/invitations") public List<PlatformStaffService.Invitation> list(Authentication auth) {return staff.list(IdentityController.actor(auth));}
    @PostMapping("/staff/invitations") public PlatformStaffService.Invitation invite(Authentication auth,@Valid @RequestBody Invite body) {return staff.invite(IdentityController.actor(auth),body.requestId(),body.phone());}
    @PostMapping("/staff/invitations/{id}/revoke") @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT)
    public void revokeInvite(Authentication auth,@PathVariable UUID id,@Valid @RequestBody Mutation body) {staff.revokeInvite(IdentityController.actor(auth),id,body.requestId());}
    @PostMapping("/staff/{id}/revoke") @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT)
    public void revoke(Authentication auth,@PathVariable UUID id,@Valid @RequestBody Revoke body) {staff.revoke(IdentityController.actor(auth),id,body.requestId(),body.expectedVersion());}
    @GetMapping("/staff/invitations/{id}/local-link") public Map<String,String> link(Authentication auth,@PathVariable UUID id,HttpServletRequest request) {
        if(!local.previewEnabled(request.getRemoteAddr()))throw new IdentityException(404,"LOCAL_PREVIEW_DISABLED");
        return Map.of("path",staff.localLink(IdentityController.actor(auth),id));
    }
    // Tokens are carried in POST bodies and URL fragments, never in server URLs/access logs.
    @PostMapping("/auth/invitation/preview") public PlatformStaffService.Preview preview(@Valid @RequestBody Token body) {return staff.preview(body.token());}
    @PostMapping("/auth/invitation/accept") public IdentityService.Me accept(@Valid @RequestBody Accept body,HttpServletRequest request,HttpServletResponse response) {
        staff.accept(body.token(),body.username(),body.password(),body.displayName(),request.getRemoteAddr());
        return identity.login(body.username(),body.password(),request,response);
    }
}
