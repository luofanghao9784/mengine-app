package com.dreamcore.workspace.agentadmin;

import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;

/** 仅允许无副作用的登记 stub 返回 501；落库前必须替换为正式鉴权及 CSRF 校验。 */
@Configuration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class CapabilityRegistryStubSecurity {
    @Bean
    @Order(2)
    SecurityFilterChain capabilityRegistryStubChain(HttpSecurity http) throws Exception {
        http.securityMatcher(request -> "POST".equals(request.getMethod())
                        && CapabilityRegistryController.PATH.equals(request.getServletPath()))
                .sessionManagement(c -> c.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .csrf(c -> c.disable())
                .requestCache(c -> c.disable()).formLogin(c -> c.disable())
                .httpBasic(c -> c.disable()).logout(c -> c.disable())
                .authorizeHttpRequests(a -> a.anyRequest().permitAll());
        return http.build();
    }
}
