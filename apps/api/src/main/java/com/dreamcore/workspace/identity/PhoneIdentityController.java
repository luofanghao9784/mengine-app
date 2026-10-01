package com.dreamcore.workspace.identity;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.web.bind.annotation.*;

@RestController
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/auth/phone")
public class PhoneIdentityController {
    public record Token(@Size(max=64) String token) {}
    public record Challenge(@NotNull String purpose,@Size(max=40) String phone,@Size(max=64) String token) {}
    public record Accept(@NotNull UUID requestId,@Size(max=64) String token,@Size(max=80) String displayName,
                         @Size(max=128) String password,UUID challengeId,@Size(max=6) String code,boolean acceptResponsibility) {}
    public record Verification(@NotNull @Size(max=40) String phone,@NotNull @Size(max=128) String password,
                               @NotNull UUID challengeId,@NotNull @Size(max=6) String code) {}
    public record Change(@NotNull @Size(max=128) String currentPassword,@NotNull @Size(max=128) String password) {}
    public record Joined(IdentityService.Me identity,IdentityService.Membership membership) {}
    private final LocalPhoneDelivery delivery;
    private final LocalInvitationDelivery invitations;
    private final PhoneIdentityService phones;
    private final PhoneVerificationService verification;
    private final IdentityService identities;
    private final SessionAuthenticationStrategy sessions;
    private final HttpSessionSecurityContextRepository contexts;
    public PhoneIdentityController(PhoneIdentityService phones,PhoneVerificationService verification,IdentityService identities,
            SessionAuthenticationStrategy sessions,HttpSessionSecurityContextRepository contexts,LocalPhoneDelivery delivery,LocalInvitationDelivery invitations) {
        this.delivery=delivery;this.invitations=invitations;this.phones=phones;this.verification=verification;this.identities=identities;this.sessions=sessions;this.contexts=contexts;
    }
    private String browser(HttpServletRequest request) {
        var session=request.getSession();
        synchronized(session) {
            String nonce=(String)session.getAttribute("PHONE_FLOW");
            if(nonce==null){nonce=UUID.randomUUID().toString();session.setAttribute("PHONE_FLOW",nonce);}
            return nonce;
        }
    }
    private String invitationHash(String token,HttpServletRequest request) {
        if(token!=null && !token.isBlank()) {
            if(!token.matches("[A-Za-z0-9_-]{43}")) throw new IdentityException(400,"INVITATION_INVALID");
            return IdentityService.hash(token);
        }
        String hash=(String)request.getSession().getAttribute("PHONE_INVITE_HASH");
        if(hash==null) throw new IdentityException(409,"INVITATION_CONTEXT_LOST");
        return hash;
    }
    private void authenticate(UUID id,long version,HttpServletRequest request,HttpServletResponse response) {
        var auth=UsernamePasswordAuthenticationToken.authenticated(id.toString(),null,List.of(new SimpleGrantedAuthority("ROLE_USER")));
        sessions.onAuthentication(auth,request,response);
        request.getSession().setAttribute("CREDENTIAL_VERSION",version);
        var context=SecurityContextHolder.createEmptyContext();context.setAuthentication(auth);
        SecurityContextHolder.setContext(context);contexts.saveContext(context,request,response);
    }
    private void clear(HttpServletRequest request) {
        var session=request.getSession(false);if(session!=null)session.invalidate();SecurityContextHolder.clearContext();
    }
    @GetMapping("/configuration")
    public Map<String,Object> configuration(HttpServletRequest request) {
        return Map.of("delivery",delivery.mode(),"localPreview",delivery.previewEnabled(request.getRemoteAddr()));
    }
    @GetMapping("/local-invitation/{id}")
    public Map<String,String> localInvitation(Authentication auth,@PathVariable UUID id,HttpServletRequest request) {
        if(!delivery.previewEnabled(request.getRemoteAddr()))throw new IdentityException(404,"LOCAL_PREVIEW_DISABLED");
        phones.requireInvitationManager(IdentityController.actor(auth),id);
        return Map.of("mode","LOCAL","path","/workspace/#invite="+invitations.localToken(id));
    }
    @PostMapping("/invitation")
    public PhoneIdentityService.Preview preview(Authentication auth,@Valid @RequestBody Token body,HttpServletRequest request) {
        String hash=invitationHash(body.token(),request);
        var result=phones.preview(IdentityController.actor(auth),hash);
        request.getSession().setAttribute("PHONE_INVITE_HASH",hash);
        return result;
    }
    @PostMapping("/challenges")
    public PhoneVerificationService.Receipt challenge(Authentication auth,@Valid @RequestBody Challenge body,HttpServletRequest request) {
        return phones.challenge(IdentityController.actor(auth),body.purpose(),body.phone(),"JOIN".equals(body.purpose())?invitationHash(body.token(),request):null,browser(request),request.getRemoteAddr());
    }
    @PostMapping("/switch-account") @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT)
    public void switchAccount(Authentication auth,@Valid @RequestBody Token body,HttpServletRequest request) {
        String hash=invitationHash(body.token(),request);
        phones.preview(IdentityController.actor(auth),hash);
        clear(request);
        // Preserve only the verified invitation intent, never authentication or verification proofs.
        request.getSession().setAttribute("PHONE_INVITE_HASH",hash);
    }
    @GetMapping("/local-code/{id}")
    public Map<String,String> localCode(@PathVariable UUID id,HttpServletRequest request) {
        return Map.of("mode","LOCAL","code",verification.localCode(id,browser(request),request.getRemoteAddr()));
    }
    @PostMapping("/accept")
    public Joined accept(Authentication auth,@Valid @RequestBody Accept body,HttpServletRequest request,HttpServletResponse response) {
        String browser=browser(request);UUID actor=IdentityController.actor(auth);
        String token=invitationHash(body.token(),request);
        var preview=phones.preview(actor,token);
        if("CREATE".equals(preview.action())) verification.verify(body.challengeId(),body.code(),"JOIN",browser);
        Object savedVersion=request.getSession().getAttribute("CREDENTIAL_VERSION");
        long version=savedVersion instanceof Number number?number.longValue():0;
        var joined=phones.accept(actor,version,token,body.displayName(),body.password(),body.challengeId(),browser,body.acceptResponsibility(),body.requestId(),request.getRemoteAddr());
        authenticate(joined.accountId(),joined.credentialVersion(),request,response);
        return new Joined(identities.me(joined.accountId()),joined.membership());
    }
    @PostMapping("/bind")
    public IdentityService.Me bind(Authentication auth,@Valid @RequestBody Verification body,HttpServletRequest request,HttpServletResponse response) {
        UUID actor=IdentityController.actor(auth);identities.account(actor);String browser=browser(request);
        verification.verify(body.challengeId(),body.code(),"BIND",browser);
        var result=phones.bind(actor,body.phone(),body.password(),body.challengeId(),browser,request.getRemoteAddr());
        clear(request);authenticate(actor,result.account().credentialVersion(),request,response);return result;
    }
    @PostMapping("/reset") @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT)
    public void reset(@Valid @RequestBody Verification body,HttpServletRequest request) {
        String browser=browser(request);verification.verify(body.challengeId(),body.code(),"RESET",browser);
        phones.reset(body.phone(),body.password(),body.challengeId(),browser);clear(request);
    }
    @PostMapping("/password") @ResponseStatus(org.springframework.http.HttpStatus.NO_CONTENT)
    public void password(Authentication auth,@Valid @RequestBody Change body,HttpServletRequest request) {
        phones.changePassword(IdentityController.actor(auth),body.currentPassword(),body.password(),request.getRemoteAddr());clear(request);
    }
}
