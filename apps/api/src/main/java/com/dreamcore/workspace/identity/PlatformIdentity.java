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

/** Dedicated credentials authenticate the same user and browser session as the unified entrance. */
@Service
public class PlatformIdentity {
    private final String cookieName;
    private static final String PATH = "/api/platform-admin/";
    private final JdbcTemplate db;
    private final PasswordEncoder passwords;
    private final IdentityService identities;
    private final IdentityAudit audit;
    private final LoginThrottle throttle;
    private final String dummy;
    public record Session(String tokenHash, String csrfHash, UUID actor) {}
    public PlatformIdentity(JdbcTemplate db, PasswordEncoder passwords, IdentityService identities,
                            IdentityAudit audit, LoginThrottle throttle,
                            @org.springframework.beans.factory.annotation.Value("${dreamcore.platform.cookie-name:DREAMCORE_PLATFORM}") String cookieName,
                            @org.springframework.beans.factory.annotation.Value("${server.servlet.session.cookie.name:DREAMCORE_SESSION}") String customerCookieName) {
        if (!cookieName.matches("[A-Za-z0-9_]{1,100}") || cookieName.equals(customerCookieName)) throw new IllegalArgumentException("Invalid or shared platform cookie name");
        this.cookieName=cookieName;
        this.db=db; this.passwords=passwords; this.identities=identities; this.audit=audit; this.throttle=throttle;
        dummy=passwords.encode(UUID.randomUUID().toString());
    }
    private void cookie(HttpServletRequest request, HttpServletResponse response, String value, long seconds) {
        response.addHeader("Set-Cookie", ResponseCookie.from(cookieName,value).httpOnly(true)
            .secure(request.isSecure()).sameSite("Strict").path(PATH).maxAge(seconds).build().toString());
        response.setHeader("Cache-Control","no-store");
    }
    public String presentedSessionHash(HttpServletRequest request) {
        var session=request.getSession(false);
        return session==null?null:IdentityService.hash(session.getId());
    }
    public Session read(HttpServletRequest request) {
        var session=request.getSession(false);
        if(session==null)return null;
        var saved=session.getAttribute(org.springframework.security.web.context.HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY);
        if(!(saved instanceof org.springframework.security.core.context.SecurityContext context) || context.getAuthentication()==null)return null;
        UUID actor=UUID.fromString(context.getAuthentication().getName());
        Object version=session.getAttribute("CREDENTIAL_VERSION");
        if(!(version instanceof Number number)||!identities.validSession(actor,number.longValue()))return null;
        try { identities.platform(actor); } catch(IdentityException denied) { return null; }
        String hash=presentedSessionHash(request);
        db.update("DELETE FROM platform_sessions WHERE token_hash=? AND expires_at<=now()",hash);
        // A server-side support capability lease, never an alternate authentication cookie.
        db.update("INSERT INTO platform_sessions(token_hash,csrf_hash,account_id,credential_version,expires_at) VALUES (?,?,?,?,now()+(? * interval '1 second')) ON CONFLICT(token_hash) DO UPDATE SET expires_at=EXCLUDED.expires_at WHERE platform_sessions.account_id=EXCLUDED.account_id AND platform_sessions.credential_version=EXCLUDED.credential_version",
            hash,IdentityService.hash("support:"+hash),actor,number.longValue(),session.getMaxInactiveInterval());
        return new Session(hash,IdentityService.hash("support:"+hash),actor);
    }
    @Transactional
    public Map<String,String> csrf(HttpServletRequest request,HttpServletResponse response) {
        var token=(org.springframework.security.web.csrf.CsrfToken)request.getAttribute(org.springframework.security.web.csrf.CsrfToken.class.getName());
        response.setHeader("Cache-Control","no-store");
        return Map.of("token",token.getToken(),"headerName",token.getHeaderName());
    }
    @Transactional
    public IdentityService.Me login(String username,String password,HttpServletRequest request,HttpServletResponse response) {
        String normalized=loginName(username);
        if(!throttle.allow("platform:"+normalized,"platform:"+request.getRemoteAddr())) throw new IdentityException(429,"LOGIN_THROTTLED");
        if(password==null || password.length()>128) throw new IdentityException(401,"INVALID_CREDENTIALS");
        var rows=db.queryForList("SELECT p.*,a.credential_version AS unified_version FROM platform_accounts p JOIN accounts a ON a.id=p.account_id WHERE login_name=? AND a.status='ACTIVE'",normalized);
        boolean matched=passwords.matches(password,rows.isEmpty()?dummy:(String)rows.getFirst().get("password_hash"));
        if(!matched || rows.isEmpty()) { audit.denial(null,"PLATFORM_LOGIN_FAILED"); throw new IdentityException(401,"INVALID_CREDENTIALS"); }
        var row=rows.getFirst(); UUID actor=(UUID)row.get("account_id"); identities.platform(actor);
        Session previous=read(request);
        if(previous!=null) db.update("DELETE FROM platform_sessions WHERE token_hash=?",previous.tokenHash());
        UnifiedLogin.authenticate(identities,actor,((Number)row.get("unified_version")).longValue(),"PLATFORM_PASSWORD",request,response);
        cookie(request,response,"",0);
        audit.record(actor,null,"PLATFORM_LOGIN",actor,"SUCCESS");
        return me(actor);
    }
    @Transactional
    public void changePassword(UUID actor,String currentPassword,String password,HttpServletRequest request,HttpServletResponse response) {
        IdentityService.password(password);
        if(!throttle.allow("platform-password:"+actor,"platform-password:"+request.getRemoteAddr())) throw new IdentityException(429,"LOGIN_THROTTLED");
        // Same order as staff changes: revoked credentials cannot win a concurrent password change.
        db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended('platform-staff-management',0))");
        db.queryForList("SELECT account_id FROM platform_accounts WHERE account_id=? FOR UPDATE",actor);
        identities.platform(actor);
        Session session=read(request);
        if(session==null || !actor.equals(session.actor())) throw new IdentityException(401,"AUTHENTICATION_REQUIRED");
        String encoded=db.queryForObject("SELECT password_hash FROM platform_accounts WHERE account_id=?",String.class,actor);
        if(currentPassword==null || currentPassword.length()>128 || !passwords.matches(currentPassword,encoded)) {
            audit.denial(actor,"PLATFORM_PASSWORD_CHANGE_FAILED");
            throw new IdentityException(400,"CURRENT_PASSWORD_INCORRECT");
        }
        if(passwords.matches(password,encoded)) throw new IdentityException(400,"PASSWORD_UNCHANGED");
        db.update("UPDATE platform_accounts SET password_hash=?,credential_version=credential_version+1 WHERE account_id=?",passwords.encode(password),actor);
        db.update("DELETE FROM platform_sessions WHERE account_id=?",actor);
        audit.record(actor,null,"PLATFORM_PASSWORD_CHANGE",actor,"SUCCESS");
        logout(request,response);
    }
    public Map<String,Object> credentials(UUID actor) {
        identities.platform(actor);
        var names=db.queryForList("SELECT login_name FROM platform_accounts WHERE account_id=?",String.class,actor);
        return Map.of("configured",!names.isEmpty(),"username",names.isEmpty()?"":names.getFirst());
    }
    @Transactional
    public void configureCredentials(UUID actor,String username,String currentPassword,String password,HttpServletRequest request,HttpServletResponse response) {
        identities.platform(actor);IdentityService.password(password);String login=loginName(username);
        if(!throttle.allow("platform-configure:"+actor,"platform-configure:"+request.getRemoteAddr()))throw new IdentityException(429,"LOGIN_THROTTLED");
        db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended('platform-staff-management',0))");
        db.queryForList("SELECT id FROM accounts WHERE id=? FOR UPDATE",actor);
        identities.platform(actor);
        var session=read(request);
        if(session==null||!actor.equals(session.actor()))throw new IdentityException(401,"AUTHENTICATION_REQUIRED");
        var existing=db.queryForList("SELECT password_hash FROM platform_accounts WHERE account_id=?",String.class,actor);
        String hash=existing.isEmpty()?db.queryForObject("SELECT password_hash FROM accounts WHERE id=?",String.class,actor):existing.getFirst();
        if(currentPassword==null||currentPassword.length()>128||!passwords.matches(currentPassword,hash))throw new IdentityException(400,"CURRENT_PASSWORD_INCORRECT");
        if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM platform_accounts WHERE login_name=? AND account_id<>?)",Boolean.class,login,actor)))throw new IdentityException(409,"PLATFORM_LOGIN_OCCUPIED");
        db.update("INSERT INTO platform_accounts(account_id,login_name,password_hash) VALUES (?,?,?) ON CONFLICT(account_id) DO UPDATE SET login_name=EXCLUDED.login_name,password_hash=EXCLUDED.password_hash,credential_version=platform_accounts.credential_version+1",actor,login,passwords.encode(password));
        if(existing.isEmpty())db.update("UPDATE accounts SET credential_version=credential_version+1 WHERE id=?",actor);
        audit.record(actor,null,"PLATFORM_CREDENTIALS_SET",actor,"SUCCESS");
        logout(request,response);
    }
    @Transactional
    public void linkCustomer(UUID actor,String currentPassword,String phone,String customerPassword,HttpServletRequest request,HttpServletResponse response) {
        if(!throttle.allow("platform-link:"+actor,"platform-link:"+request.getRemoteAddr()))throw new IdentityException(429,"LOGIN_THROTTLED");
        db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended('platform-staff-management',0))");
        identities.platform(actor);var session=read(request);
        if(session==null||!actor.equals(session.actor()))throw new IdentityException(401,"AUTHENTICATION_REQUIRED");
        var target=identities.login(PhoneNumbers.normalize(phone),customerPassword,request.getRemoteAddr());
        if(actor.equals(target.id()))throw new IdentityException(409,"IDENTITY_ALREADY_UNIFIED");
        db.queryForList("SELECT id FROM accounts WHERE id IN (?,?) ORDER BY id FOR UPDATE",actor,target.id());
        if(!identities.validSession(target.id(),target.credentialVersion())||read(request)==null)throw new IdentityException(401,"AUTHENTICATION_REQUIRED");
        if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM tenant_memberships WHERE account_id=?) OR EXISTS(SELECT 1 FROM platform_accounts WHERE account_id=?) OR EXISTS(SELECT 1 FROM unified_identity_links WHERE source_id=? OR target_id=?)",Boolean.class,actor,target.id(),actor,actor)))
            throw new IdentityException(409,"IDENTITY_LINK_REQUIRES_REVIEW");
        var hashes=db.queryForList("SELECT password_hash FROM platform_accounts WHERE account_id=? FOR UPDATE",String.class,actor);
        if(hashes.isEmpty()||currentPassword==null||currentPassword.length()>128||!passwords.matches(currentPassword,hashes.getFirst()))throw new IdentityException(400,"CURRENT_PASSWORD_INCORRECT");
        // Keep the old audit actor row; only verified credentials and the platform role move.
        db.update("INSERT INTO unified_identity_links(source_id,target_id,verified_by) VALUES (?,?,?)",actor,target.id(),actor);
        db.update("UPDATE platform_accounts SET account_id=? WHERE account_id=?",target.id(),actor);
        db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN') ON CONFLICT DO NOTHING",target.id());
        db.update("DELETE FROM platform_roles WHERE account_id=?",actor);
        db.update("UPDATE accounts SET status='DISABLED',credential_version=credential_version+1 WHERE id=?",actor);
        db.update("UPDATE accounts SET credential_version=credential_version+1,management_version=management_version+1 WHERE id=?",target.id());
        db.update("UPDATE platform_staff_invitations SET status='REVOKED' WHERE invited_by=? AND status='PENDING'",actor);
        audit.record(actor,null,"UNIFIED_IDENTITY_LINK",target.id(),"SUCCESS");
        logout(request,response);
    }
    static String loginName(String value) {
        if(value==null)throw IdentityException.invalid();
        String normalized=value.trim().toLowerCase(java.util.Locale.ROOT);
        if(normalized.contains("@"))return IdentityService.email(normalized);
        if(normalized.matches("[+0-9 ()-]+"))return PhoneNumbers.normalize(normalized);
        if(!normalized.matches("[a-z][a-z0-9._-]{2,63}"))throw IdentityException.invalid();
        return normalized;
    }
    public IdentityService.Me me(UUID actor) {
        identities.platform(actor);
        return identities.me(actor);
    }
    @Transactional
    public void logout(HttpServletRequest request,HttpServletResponse response) {
        Session session=read(request);
        if(session!=null) {
            db.update("DELETE FROM platform_sessions WHERE token_hash=?",session.tokenHash());
            if(session.actor()!=null) audit.record(session.actor(),null,"PLATFORM_LOGOUT",session.actor(),"SUCCESS");
        }
        new org.springframework.security.web.authentication.logout.SecurityContextLogoutHandler().logout(request,response,org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication());
        cookie(request,response,"",0);
    }
}
