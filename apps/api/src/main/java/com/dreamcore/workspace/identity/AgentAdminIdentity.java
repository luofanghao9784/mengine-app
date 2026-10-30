package com.dreamcore.workspace.identity;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.ResponseCookie;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Independent fourth-end session realm over the shared account and role registry. */
@Service
public class AgentAdminIdentity {
    private final String cookieName;
    private static final String PATH = "/api/agent-admin/";
    private final JdbcTemplate db;
    private final PasswordEncoder passwords;
    private final IdentityAudit audit;
    private final LoginThrottle throttle;
    private final String dummy;
    public record Session(String tokenHash, String csrfHash, UUID actor) {}
    public AgentAdminIdentity(JdbcTemplate db, PasswordEncoder passwords, IdentityAudit audit, LoginThrottle throttle,
                            @org.springframework.beans.factory.annotation.Value("${dreamcore.agent.cookie-name:DREAMCORE_AGENT}") String cookieName,
                            @org.springframework.beans.factory.annotation.Value("${dreamcore.platform.cookie-name:DREAMCORE_PLATFORM}") String platformCookieName,
                            @org.springframework.beans.factory.annotation.Value("${server.servlet.session.cookie.name:DREAMCORE_SESSION}") String customerCookieName) {
        validateCookieNames(cookieName,platformCookieName,customerCookieName);
        this.cookieName=cookieName;
        this.db=db; this.passwords=passwords; this.audit=audit; this.throttle=throttle;
        dummy=passwords.encode(UUID.randomUUID().toString());
    }
    static void validateCookieNames(String agent,String platform,String customer) {
        if (agent==null || platform==null || customer==null ||
            !agent.matches("[A-Za-z0-9_]{1,100}") || !platform.matches("[A-Za-z0-9_]{1,100}") ||
            agent.equals(platform) || agent.equals(customer) || platform.equals(customer))
            throw new IllegalArgumentException("Invalid or shared identity cookie names");
    }
    private String secret() {
        byte[] bytes=new byte[32]; new SecureRandom().nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
    private void cookie(HttpServletRequest request, HttpServletResponse response, String value, long seconds) {
        response.addHeader("Set-Cookie", ResponseCookie.from(cookieName,value).httpOnly(true)
            .secure(request.isSecure()).sameSite("Strict").path(PATH).maxAge(seconds).build().toString());
        response.setHeader("Cache-Control","no-store");
    }
    public Session read(HttpServletRequest request) {
        if (request.getCookies()==null) return null;
        for (var cookie:request.getCookies()) {
            if (!cookieName.equals(cookie.getName()) || cookie.getValue().length()!=43) continue;
            var rows=db.query("""
                SELECT s.token_hash,s.csrf_hash,s.account_id FROM agent_platform_sessions s
                LEFT JOIN agent_platform_accounts p ON p.account_id=s.account_id
                LEFT JOIN accounts a ON a.id=s.account_id
                WHERE s.token_hash=? AND s.expires_at>now() AND (s.account_id IS NULL OR
                  (p.account_id IS NOT NULL AND a.status='ACTIVE' AND p.credential_version=s.credential_version
                    AND NOT EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.account_id=s.account_id) AND EXISTS
                    (SELECT 1 FROM platform_roles r WHERE r.account_id=s.account_id AND r.role='AGENT_ADMIN')))
                """,(r,n)->new Session(r.getString(1),r.getString(2),r.getObject(3,UUID.class)),IdentityService.hash(cookie.getValue()));
            return rows.isEmpty()?null:rows.getFirst();
        }
        return null;
    }
    private String issue(HttpServletRequest request,HttpServletResponse response,UUID actor,Long version) {
        String token=secret(),csrf=IdentityService.hash("csrf:"+token); long ttl=actor==null?1200:28800;
        db.update("INSERT INTO agent_platform_sessions(token_hash,csrf_hash,account_id,credential_version,expires_at) VALUES (?,?,?,?,now()+(? * interval '1 second'))",
            IdentityService.hash(token),IdentityService.hash(csrf),actor,version,ttl);
        cookie(request,response,token,ttl);
        return csrf;
    }
    @Transactional
    public Map<String,String> csrf(HttpServletRequest request,HttpServletResponse response) {
        Session session=read(request); String token=null;
        if(session==null) token=issue(request,response,null,null);
        else for(var cookie:request.getCookies()) if(cookieName.equals(cookie.getName())) token=IdentityService.hash("csrf:"+cookie.getValue());
        db.update("DELETE FROM agent_platform_sessions WHERE expires_at<=now()");
        response.setHeader("Cache-Control","no-store");
        return Map.of("token",token,"headerName","X-CSRF-TOKEN");
    }
    public boolean validCsrf(Session session,String supplied) {
        return session!=null && supplied!=null && supplied.length()==64 && java.security.MessageDigest.isEqual(
            session.csrfHash().getBytes(java.nio.charset.StandardCharsets.UTF_8),
            IdentityService.hash(supplied).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
    @Transactional
    public Me login(String username,String password,HttpServletRequest request,HttpServletResponse response) {
        String normalized;
        try { normalized=PlatformIdentity.loginName(username); }
        catch (IdentityException invalid) { throw new IdentityException(401,"INVALID_CREDENTIALS"); }
        if(!throttle.allow("agent:"+normalized,"agent:"+request.getRemoteAddr())) throw new IdentityException(429,"LOGIN_THROTTLED");
        if(password==null || password.length()>128) throw new IdentityException(401,"INVALID_CREDENTIALS");
        var rows=db.queryForList("""
            SELECT p.* FROM agent_platform_accounts p JOIN accounts a ON a.id=p.account_id
            WHERE p.login_name=? AND a.status='ACTIVE'
              AND EXISTS (SELECT 1 FROM platform_roles r WHERE r.account_id=p.account_id AND r.role='AGENT_ADMIN')
              AND NOT EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.account_id=p.account_id)
            """,normalized);
        boolean matched=passwords.matches(password,rows.isEmpty()?dummy:(String)rows.getFirst().get("password_hash"));
        if(!matched || rows.isEmpty()) {
            audit.denial(null,"AGENT_LOGIN_FAILED");
            throw new IdentityException(401,"INVALID_CREDENTIALS");
        }
        var row=rows.getFirst(); UUID actor=(UUID)row.get("account_id");
        var previous=read(request);
        if(previous!=null) db.update("DELETE FROM agent_platform_sessions WHERE token_hash=?",previous.tokenHash());
        issue(request,response,actor,((Number)row.get("credential_version")).longValue());
        audit.record(actor,null,"AGENT_LOGIN",actor,"SUCCESS");
        return me(actor);
    }
    public record Me(UUID accountId,String displayName,List<String> roles) {}
    public Me me(UUID actor) {
        var rows=db.query("""
            SELECT a.id,a.display_name FROM accounts a JOIN agent_platform_accounts p ON p.account_id=a.id
            WHERE a.id=? AND a.status='ACTIVE'
              AND EXISTS (SELECT 1 FROM platform_roles r WHERE r.account_id=a.id AND r.role='AGENT_ADMIN')
              AND NOT EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.account_id=a.id)
            """,(r,n)->new Me(r.getObject(1,UUID.class),r.getString(2),List.of("AGENT_ADMIN")),actor);
        if(rows.isEmpty()) throw new IdentityException(401,"AUTHENTICATION_REQUIRED");
        return rows.getFirst();
    }
    @Transactional
    public void logout(HttpServletRequest request,HttpServletResponse response) {
        Session session=read(request);
        if(session!=null) {
            db.update("DELETE FROM agent_platform_sessions WHERE token_hash=?",session.tokenHash());
            if(session.actor()!=null) audit.record(session.actor(),null,"AGENT_LOGOUT",session.actor(),"SUCCESS");
        }
        cookie(request,response,"",0);
    }
}
