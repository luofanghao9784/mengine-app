package com.dreamcore.workspace.support;
import com.dreamcore.workspace.identity.*;
import jakarta.servlet.*;import jakarta.servlet.http.*;
import java.io.IOException;import java.util.*;
import org.springframework.context.annotation.*;import org.springframework.core.annotation.Order;
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
public class SupportSecurity {
 public static boolean allowed(String path,UUID tenant,String method){
  String v="/api/v1/tenants/"+tenant,admin="/api/tenant-admin/v1/tenants/"+tenant;
  if(path.equals(admin)||path.startsWith(admin+"/"))return true;
  if(!path.startsWith(v+"/"))return false;
  String tail=path.substring(v.length()+1);
  // Dedicated owner procedures cannot be performed through delegated authority.
  if(tail.startsWith("governance/"))return tail.equals("governance/capabilities")||tail.matches("governance/members/[0-9a-f-]{36}/role");
  if(Set.of("context","governance","library","knowledge/processing").contains(tail))return method.equals("GET");
  if(tail.startsWith("workspaces/"))return tail.matches("workspaces/[0-9a-f-]{36}/(library|folders|materials|knowledge|sources|lifecycle|experiences)(/.*)?");
  return tail.matches("(news-sources|database|company-information|experience-library|general-experiences|profiles|retention|departures|departure-exports|export-batches|object-lifecycle|evaluation|methods)(/.*)?");
 }
 @Bean @Order(0) SecurityFilterChain supportSecurityChain(HttpSecurity http,PlatformIdentity identities,SupportAccess access)throws Exception{
  http.securityMatcher("/api/platform-admin/v1/support-access/*/api/**")
   .sessionManagement(c->c.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
   .securityContext(c->c.securityContextRepository(new NullSecurityContextRepository()))
   .csrf(c->c.disable()).requestCache(c->c.disable()).formLogin(c->c.disable()).httpBasic(c->c.disable()).logout(c->c.disable())
   .authorizeHttpRequests(c->c.anyRequest().authenticated())
   .addFilterBefore(new OncePerRequestFilter(){
    protected void doFilterInternal(HttpServletRequest q,HttpServletResponse r,FilterChain chain)throws ServletException,IOException{
     var previous=SupportContext.current();SupportContext.Access a=null;UUID requestedId=null;String path="";
     try{
      String raw=q.getRequestURI();String prefix="/api/platform-admin/v1/support-access/";
      int split=raw.indexOf("/api/",prefix.length());UUID id=UUID.fromString(raw.substring(prefix.length(),split));requestedId=id;path=raw.substring(split);
      var session=identities.read(q);if(session==null||session.actor()==null)throw new IdentityException(401,"AUTHENTICATION_REQUIRED");
      a=access.read(id,session.tokenHash());
      if(!List.of("GET","HEAD","OPTIONS").contains(q.getMethod())&&!identities.validCsrf(session,q.getHeader("X-CSRF-TOKEN")))throw new IdentityException(403,"ACCESS_DENIED");
      if(!allowed(path,a.tenant(),q.getMethod()))throw new IdentityException(403,"SUPPORT_SCOPE_DENIED");
      SupportContext.set(a);SecurityContextHolder.getContext().setAuthentication(UsernamePasswordAuthenticationToken.authenticated(a.actor().toString(),null,List.of(new SimpleGrantedAuthority("ROLE_HEADQUARTERS_SUPPORT"))));
      final String target=path;
      r.setHeader("Cache-Control","no-store");
      chain.doFilter(new HttpServletRequestWrapper(q){
       public String getRequestURI(){return target;}
       public String getServletPath(){return target;}
       public StringBuffer getRequestURL(){return new StringBuffer(q.getScheme()+"://"+q.getServerName()+":"+q.getServerPort()+target);}
      },r);
      access.event(a,q.getMethod()+" "+path,r.getStatus()<400?"SUCCESS":r.getStatus()<500?"DENIED":"FAILURE",r.getStatus());
     }catch(IdentityException e){
      if(a!=null)access.event(a,q.getMethod()+" "+path,"DENIED",e.status);
      else if(requestedId!=null)access.invalidated(requestedId,identities.presentedSessionHash(q));
      IdentitySecurity.writeError(r,e.status,e.code);
     }catch(IllegalArgumentException e){IdentitySecurity.writeError(r,403,"SUPPORT_SCOPE_DENIED");}
     catch(ServletException|IOException|RuntimeException e){if(a!=null)access.event(a,q.getMethod()+" "+path,"FAILURE",500);throw e;}
     finally{SupportContext.set(previous);}
    }
   },AuthorizationFilter.class);
  return http.build();
 }
}
