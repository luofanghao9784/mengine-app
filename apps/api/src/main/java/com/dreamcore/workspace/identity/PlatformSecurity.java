package com.dreamcore.workspace.identity;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.intercept.AuthorizationFilter;
import org.springframework.security.web.context.NullSecurityContextRepository;
import org.springframework.web.filter.OncePerRequestFilter;

@Configuration
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
public class PlatformSecurity {
    @Bean @Order(1)
    SecurityFilterChain platformSecurityChain(HttpSecurity http,PlatformIdentity identities) throws Exception {
        http.securityMatcher("/api/platform-admin/**")
            .sessionManagement(c->c.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .securityContext(c->c.securityContextRepository(new NullSecurityContextRepository()))
            // A dedicated session-bound CSRF token is checked below, including login/logout.
            .csrf(c->c.disable()).requestCache(c->c.disable()).formLogin(c->c.disable())
            .httpBasic(c->c.disable()).logout(c->c.disable())
            .authorizeHttpRequests(a->a.requestMatchers("/api/platform-admin/v1/auth/csrf","/api/platform-admin/v1/auth/login","/api/platform-admin/v1/auth/invitation/preview","/api/platform-admin/v1/auth/invitation/accept","/api/platform-admin/v1/auth/invitation/challenge").permitAll().anyRequest().authenticated())
            .exceptionHandling(e->e.authenticationEntryPoint((q,r,x)->IdentitySecurity.writeError(r,401,"AUTHENTICATION_REQUIRED"))
                .accessDeniedHandler((q,r,x)->IdentitySecurity.writeError(r,403,"ACCESS_DENIED")))
            .addFilterBefore(new OncePerRequestFilter() {
                @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws ServletException,IOException {
                    var session=identities.read(request);
                    response.setHeader("Cache-Control","no-store");
                    if(!List.of("GET","HEAD","OPTIONS").contains(request.getMethod()) && !identities.validCsrf(session,request.getHeader("X-CSRF-TOKEN"))) {
                        IdentitySecurity.writeError(response,403,"ACCESS_DENIED"); return;
                    }
                    if(session!=null && session.actor()!=null) SecurityContextHolder.getContext().setAuthentication(
                        UsernamePasswordAuthenticationToken.authenticated(session.actor().toString(),null,List.of(new SimpleGrantedAuthority("ROLE_PLATFORM_ADMIN"))));
                    chain.doFilter(request,response);
                }
            },AuthorizationFilter.class);
        return http.build();
    }
}
