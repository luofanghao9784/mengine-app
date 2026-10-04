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

/** Platform credentials and cookies never use or invalidate a customer HttpSession. */
@Service
public class PlatformIdentity {
    static final String COOKIE = "DREAMCORE_PLATFORM";
    private static final String PATH = "/api/platform-admin/";
    private final JdbcTemplate db;
    private final PasswordEncoder passwords;
    private final IdentityService identities;
    private final IdentityAudit audit;
    private final LoginThrottle throttle;
    private final SecureRandom random = new SecureRandom();
    private final String dummy;
    public record Session(String tokenHash, String csrfHash, UUID actor) {}
    public PlatformIdentity(JdbcTemplate db, PasswordEncoder passwords, IdentityService identities,
                            IdentityAudit audit, LoginThrottle throttle) {
        this.db=db; this.passwords=passwords; this.identities=identities; this.audit=audit; this.throttle=throttle;
        dummy=passwords.encode(UUID.randomUUID().toString());
    }
    private String secret() {
        byte[] bytes=new byte[32]; random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
    private void cookie(HttpServletRequest request, HttpServletResponse response, String value, long seconds) {
        response.addHeader("Set-Cookie", ResponseCookie.from(COOKIE,value).httpOnly(true)
            .secure(request.isSecure()).sameSite("Strict").path(PATH).maxAge(seconds).build().toString());
        response.setHeader("Cache-Control","no-store");
    }
    public Session read(HttpServletRequest request) {
        if (request.getCookies()==null) return null;
        for (var cookie:request.getCookies()) {
            if (!COOKIE.equals(cookie.getName()) || cookie.getValue().length()!=43) continue;
            var rows=db.query("""
                SELECT s.token_hash,s.csrf_hash,s.account_id FROM platform_sessions s
                LEFT JOIN platform_accounts p ON p.account_id=s.account_id
                LEFT JOIN accounts a ON a.id=p.account_id
                WHERE s.token_hash=? AND s.expires_at>now() AND (s.account_id IS NULL OR
                  (a.status='ACTIVE' AND p.credential_version=s.credential_version AND EXISTS
                    (SELECT 1 FROM platform_roles r WHERE r.account_id=p.account_id AND r.role='PLATFORM_ADMIN')))
                """,(r,n)->new Session(r.getString(1),r.getString(2),r.getObject(3,UUID.class)),IdentityService.hash(cookie.getValue()));
            return rows.isEmpty()?null:rows.getFirst();
        }
        return null;
    }
    private String issue(HttpServletRequest request,HttpServletResponse response,UUID actor,Long version) {
        String token=secret(),csrf=IdentityService.hash("csrf:"+token); long ttl=actor==null?1200:28800;
        db.update("INSERT INTO platform_sessions(token_hash,csrf_hash,account_id,credential_version,expires_at) VALUES (?,?,?,?,now()+(? * interval '1 second'))",
            IdentityService.hash(token),IdentityService.hash(csrf),actor,version,ttl);
        cookie(request,response,token,ttl);
        return csrf;
    }
    @Transactional
    public Map<String,String> csrf(HttpServletRequest request,HttpServletResponse response) {
        Session session=read(request); String token=null;
        if(session==null) token=issue(request,response,null,null);
        else for(var cookie:request.getCookies()) if(COOKIE.equals(cookie.getName())) token=IdentityService.hash("csrf:"+cookie.getValue());
        db.update("DELETE FROM platform_sessions WHERE expires_at<=now()");
        response.setHeader("Cache-Control","no-store");
        return Map.of("token",token,"headerName","X-CSRF-TOKEN");
    }
    public boolean validCsrf(Session session,String supplied) {
        return session!=null && supplied!=null && supplied.length()==64 && java.security.MessageDigest.isEqual(
            session.csrfHash().getBytes(java.nio.charset.StandardCharsets.UTF_8),
            IdentityService.hash(supplied).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
    @Transactional
    public IdentityService.Me login(String username,String password,HttpServletRequest request,HttpServletResponse response) {
        String normalized=loginName(username);
        if(!throttle.allow("platform:"+normalized,"platform:"+request.getRemoteAddr())) throw new IdentityException(429,"LOGIN_THROTTLED");
        if(password==null || password.length()>128) throw new IdentityException(401,"INVALID_CREDENTIALS");
        var rows=db.queryForList("SELECT p.* FROM platform_accounts p JOIN accounts a ON a.id=p.account_id WHERE login_name=? AND a.status='ACTIVE'",normalized);
        boolean matched=passwords.matches(password,rows.isEmpty()?dummy:(String)rows.getFirst().get("password_hash"));
        if(!matched || rows.isEmpty()) { audit.denial(null,"PLATFORM_LOGIN_FAILED"); throw new IdentityException(401,"INVALID_CREDENTIALS"); }
        var row=rows.getFirst(); UUID actor=(UUID)row.get("account_id"); identities.platform(actor);
        Session previous=read(request);
        if(previous!=null) db.update("DELETE FROM platform_sessions WHERE token_hash=?",previous.tokenHash());
        issue(request,response,actor,((Number)row.get("credential_version")).longValue());
        audit.record(actor,null,"PLATFORM_LOGIN",actor,"SUCCESS");
        return me(actor);
    }
    static String loginName(String value) {
        return value!=null && value.contains("@")?IdentityService.email(value):PhoneNumbers.normalize(value);
    }
    public IdentityService.Me me(UUID actor) {
        identities.platform(actor);
        var account=identities.account(actor);
        String login=db.queryForObject("SELECT login_name FROM platform_accounts WHERE account_id=?",String.class,actor);
        return new IdentityService.Me(new IdentityService.Account(actor,login.contains("@")?login:null,account.displayName(),login.contains("@")?null:login,0),true,List.of());
    }
    @Transactional
    public void logout(HttpServletRequest request,HttpServletResponse response) {
        Session session=read(request);
        if(session!=null) {
            db.update("DELETE FROM platform_sessions WHERE token_hash=?",session.tokenHash());
            if(session.actor()!=null) audit.record(session.actor(),null,"PLATFORM_LOGOUT",session.actor(),"SUCCESS");
        }
        cookie(request,response,"",0);
    }
}
