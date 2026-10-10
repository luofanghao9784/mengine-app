package com.dreamcore.workspace.identity;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import java.util.UUID;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.session.ChangeSessionIdAuthenticationStrategy;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.CsrfAuthenticationStrategy;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;

/** One principal and credential version for every interactive surface. */
final class UnifiedLogin {
    private UnifiedLogin() {}
    static void authenticate(IdentityService identities,UUID actor,long version,String source,HttpServletRequest request,HttpServletResponse response) {
        // A new identity must not inherit another identity's invitation or support context.
        var old=request.getSession(false);
        if(old!=null){identities.closeSupportSession(IdentityService.hash(old.getId()));old.invalidate();}
        var auth=UsernamePasswordAuthenticationToken.authenticated(actor.toString(),null,List.of(new SimpleGrantedAuthority("ROLE_USER")));
        new ChangeSessionIdAuthenticationStrategy().onAuthentication(auth,request,response);
        new CsrfAuthenticationStrategy(new HttpSessionCsrfTokenRepository()).onAuthentication(auth,request,response);
        request.getSession().setAttribute("CREDENTIAL_VERSION",version);
        request.getSession().setAttribute("AUTHENTICATION_SOURCE",source);
        var context=SecurityContextHolder.createEmptyContext();
        context.setAuthentication(auth);
        SecurityContextHolder.setContext(context);
        new HttpSessionSecurityContextRepository().saveContext(context,request,response);
    }
}
