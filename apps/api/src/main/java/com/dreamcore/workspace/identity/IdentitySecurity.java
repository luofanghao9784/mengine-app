package com.dreamcore.workspace.identity;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.intercept.AuthorizationFilter;
import org.springframework.security.web.authentication.session.ChangeSessionIdAuthenticationStrategy;
import org.springframework.security.web.authentication.session.CompositeSessionAuthenticationStrategy;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.csrf.CsrfAuthenticationStrategy;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import org.springframework.web.filter.OncePerRequestFilter;

@Configuration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class IdentitySecurity {
    @Bean HttpSessionSecurityContextRepository securityContexts() { return new HttpSessionSecurityContextRepository(); }
    @Bean HttpSessionCsrfTokenRepository csrfTokens() { return new HttpSessionCsrfTokenRepository(); }
    @Bean SessionAuthenticationStrategy loginSessions(HttpSessionCsrfTokenRepository csrf) {
        return new CompositeSessionAuthenticationStrategy(List.of(new ChangeSessionIdAuthenticationStrategy(), new CsrfAuthenticationStrategy(csrf)));
    }
    // Interactive authentication goes through IdentityService; disable Boot's generated default user.
    @Bean UserDetailsService noDefaultUsers() { return username -> { throw new UsernameNotFoundException("Use identity API"); }; }
    @Bean SecurityFilterChain apiSecurity(HttpSecurity http, IdentityService identities,
                                          HttpSessionSecurityContextRepository contexts, HttpSessionCsrfTokenRepository csrf) throws Exception {
        http.securityContext(c -> c.securityContextRepository(contexts).requireExplicitSave(true))
            .csrf(c -> c.csrfTokenRepository(csrf).ignoringRequestMatchers("/internal/v1/agent-access/**"))
            .requestCache(c -> c.disable()).formLogin(c -> c.disable()).httpBasic(c -> c.disable()).logout(c -> c.disable())
            .authorizeHttpRequests(a -> a
                .dispatcherTypeMatchers(jakarta.servlet.DispatcherType.ERROR).permitAll()
                .requestMatchers("/api/v1/system/info", "/actuator/health", "/api/v1/auth/csrf", "/api/v1/auth/login", "/api/v1/auth/invitations/accept").permitAll()
                .requestMatchers("/api/v1/auth/phone/configuration", "/api/v1/auth/phone/invitation", "/api/v1/auth/phone/switch-account", "/api/v1/auth/phone/challenges", "/api/v1/auth/phone/accept", "/api/v1/auth/phone/reset", "/api/v1/auth/phone/local-code/*").permitAll()
                .requestMatchers("/internal/v1/agent-access/**").permitAll() // Every operation validates a running task attempt capability.
                .anyRequest().authenticated())
            .exceptionHandling(e -> e
                .authenticationEntryPoint((request,response,error) -> writeError(response,401,"AUTHENTICATION_REQUIRED"))
                .accessDeniedHandler((request,response,error) -> writeError(response,403,"ACCESS_DENIED")))
            .addFilterBefore(new OncePerRequestFilter() {
                @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
                    var auth = SecurityContextHolder.getContext().getAuthentication();
                    if (auth != null && auth.isAuthenticated() && !(auth instanceof AnonymousAuthenticationToken)) {
                        var currentSession=request.getSession(false);
                        Object savedVersion=currentSession==null?null:currentSession.getAttribute("CREDENTIAL_VERSION");
                        long version=savedVersion instanceof Number number?number.longValue():0;
                        if (!identities.validSession(UUID.fromString(auth.getName()),version)) {
                            var session = request.getSession(false);
                            if (session != null) session.invalidate();
                            SecurityContextHolder.clearContext();
                            writeError(response,401,"AUTHENTICATION_REQUIRED"); return;
                        }
                    }
                    chain.doFilter(request,response);
                }
            }, AuthorizationFilter.class);
        return http.build();
    }
    public static void writeError(HttpServletResponse response, int status, String code) throws IOException {
        response.setStatus(status); response.setContentType("application/json"); response.setCharacterEncoding("UTF-8");
        response.setHeader("Cache-Control","no-store");
        response.getWriter().write("{\"contractVersion\":\"1.0\",\"code\":\"" + code + "\",\"message\":\"请求未获授权。\",\"retryable\":false}");
    }
}
