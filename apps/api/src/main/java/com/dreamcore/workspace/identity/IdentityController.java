package com.dreamcore.workspace.identity;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.logout.SecurityContextLogoutHandler;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.*;

@RestController
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type = org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
public class IdentityController {
    public record Login(@NotNull @Size(max=254) String email, @NotNull @Size(max=128) String password) {}
    public record CreateTenant(@NotNull UUID requestId, @NotNull @Size(max=100) String name, @NotNull @Size(max=254) String adminEmail) {}
    public record Invite(@NotNull UUID requestId, @NotNull @Size(max=254) String email) {}
    public record Accept(@NotNull @Size(max=64) String token, @Size(max=80) String displayName, @Size(max=128) String password) {}
    private final IdentityService identities;
    private final IdentityAudit audit;
    private final SessionAuthenticationStrategy sessions;
    private final HttpSessionSecurityContextRepository contexts;
    public IdentityController(IdentityService identities, IdentityAudit audit, SessionAuthenticationStrategy sessions, HttpSessionSecurityContextRepository contexts) {
        this.identities = identities; this.audit = audit; this.sessions = sessions; this.contexts = contexts;
    }
    static UUID actor(Authentication authentication) {
        return authentication == null || authentication instanceof AnonymousAuthenticationToken ? null : UUID.fromString(authentication.getName());
    }
    @GetMapping("/api/v1/auth/csrf")
    public Map<String,String> csrf(CsrfToken token, HttpServletResponse response) {
        response.setHeader("Cache-Control","no-store");
        return Map.of("token",token.getToken(),"headerName",token.getHeaderName());
    }
    @PostMapping("/api/v1/auth/login")
    public IdentityService.Me login(@Valid @RequestBody Login body, HttpServletRequest request, HttpServletResponse response) {
        var account = identities.login(body.email(),body.password(),request.getRemoteAddr());
        var auth = UsernamePasswordAuthenticationToken.authenticated(account.id().toString(),null,List.of(new SimpleGrantedAuthority("ROLE_USER")));
        sessions.onAuthentication(auth,request,response);
        var context = SecurityContextHolder.createEmptyContext(); context.setAuthentication(auth);
        SecurityContextHolder.setContext(context); contexts.saveContext(context,request,response);
        return identities.me(account.id());
    }
    @PostMapping("/api/v1/auth/logout") @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT)
    public void logout(Authentication auth, HttpServletRequest request, HttpServletResponse response) {
        audit.record(actor(auth),null,"LOGOUT",actor(auth),"SUCCESS");
        new SecurityContextLogoutHandler().logout(request,response,auth);
    }
    @GetMapping("/api/v1/me")
    public IdentityService.Me me(Authentication auth) { return identities.me(actor(auth)); }
    @GetMapping("/api/v1/tenants/{tenant}/context")
    public IdentityService.TenantContext tenantContext(Authentication auth, @PathVariable UUID tenant) { return identities.context(actor(auth),tenant); }
    @GetMapping("/api/tenant-admin/v1/tenants/{tenant}/invitations")
    public List<IdentityService.Invitation> invitations(Authentication auth, @PathVariable UUID tenant,
            @RequestParam(defaultValue="0") int offset, @RequestParam(defaultValue="50") int limit) {
        return identities.invitations(actor(auth),tenant,offset,limit);
    }
    @PostMapping("/api/tenant-admin/v1/tenants/{tenant}/invitations") @ResponseStatus(org.springframework.http.HttpStatus.CREATED)
    public IdentityService.Invitation invite(Authentication auth, @PathVariable UUID tenant, @Valid @RequestBody Invite body) {
        return identities.invite(actor(auth),tenant,body.requestId(),body.email());
    }
    @DeleteMapping("/api/tenant-admin/v1/tenants/{tenant}/invitations/{id}") @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT)
    public void revoke(Authentication auth, @PathVariable UUID tenant, @PathVariable UUID id) { identities.revoke(actor(auth),tenant,id); }
    @PostMapping("/api/v1/auth/invitations/accept")
    public IdentityService.Membership accept(Authentication auth, @Valid @RequestBody Accept body) { return identities.accept(actor(auth),body.token(),body.displayName(),body.password()); }
}
