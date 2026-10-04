package com.dreamcore.workspace.identity;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Staff identity is independent even when a customer's phone matches an invitation. */
@Service
public class PlatformStaffService {
    public record Invitation(UUID id,String loginName,String status,Instant createdAt,Instant expiresAt,String deliveryMode) {}
    public record Preview(String loginName,boolean existingAccount) {}
    private final JdbcTemplate db;
    private final IdentityService identities;
    private final IdentityAudit audit;
    private final PasswordEncoder passwords;
    private final LocalInvitationDelivery delivery;
    private final LoginThrottle throttle;
    private final String dummy;
    private final int ttlHours;
    public PlatformStaffService(JdbcTemplate db,IdentityService identities,IdentityAudit audit,PasswordEncoder passwords,LocalInvitationDelivery delivery,LoginThrottle throttle,@org.springframework.beans.factory.annotation.Value("${dreamcore.invitation.ttl-hours}") int ttlHours) {
        this.ttlHours=ttlHours;this.db=db;this.identities=identities;this.audit=audit;this.passwords=passwords;this.delivery=delivery;this.throttle=throttle;
        dummy=passwords.encode(UUID.randomUUID().toString());
    }
    // Serialize acceptance and revocation, including the final-active-administrator check.
    private void lock() { db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended('platform-staff-management',0))"); }
    private boolean administrator(UUID id) {
        return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM platform_accounts p JOIN accounts a ON a.id=p.account_id JOIN platform_roles r ON r.account_id=a.id WHERE a.id=? AND a.status='ACTIVE' AND r.role='PLATFORM_ADMIN')",Boolean.class,id));
    }
    private Invitation invitation(UUID id) {
        var rows=db.query("SELECT *,CASE WHEN status='PENDING' AND expires_at<=now() THEN 'EXPIRED' ELSE status END AS state FROM platform_staff_invitations WHERE id=?",
            (r,n)->new Invitation(r.getObject("id",UUID.class),r.getString("login_name"),r.getString("state"),r.getTimestamp("created_at").toInstant(),r.getTimestamp("expires_at").toInstant(),delivery.mode()),id);
        if(rows.isEmpty()) throw new IdentityException(404,"INVITATION_UNAVAILABLE");
        return rows.getFirst();
    }
    @Transactional(readOnly=true)
    public List<Invitation> list(UUID actor) {
        identities.platform(actor);
        return db.query("SELECT id FROM platform_staff_invitations ORDER BY created_at DESC,id LIMIT 100",(r,n)->r.getObject(1,UUID.class)).stream().map(this::invitation).toList();
    }
    @Transactional
    public Invitation invite(UUID actor,UUID request,String suppliedPhone) {
        identities.platform(actor);String contact=PhoneNumbers.normalize(suppliedPhone);
        UUID prior=identities.priorRequest(actor,request,"PLATFORM_STAFF_INVITE",IdentityService.hash(contact));
        lock();identities.platform(actor);
        if(prior!=null)return invitation(prior);
        var accounts=db.queryForList("SELECT account_id FROM platform_accounts WHERE login_name=?",contact);
        if(!accounts.isEmpty()&&administrator((UUID)accounts.getFirst().get("account_id")))throw new IdentityException(409,"PLATFORM_ALREADY_ADMIN");
        if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM platform_staff_invitations WHERE login_name=? AND status='PENDING' AND expires_at>now())",Boolean.class,contact)))throw new IdentityException(409,"INVITATION_ALREADY_PENDING");
        byte[] bytes=new byte[32];new SecureRandom().nextBytes(bytes);String token=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);UUID id=UUID.randomUUID();
        db.update("INSERT INTO platform_staff_invitations(id,login_name,token_hash,invited_by,expires_at) VALUES (?,?,?,?,now()+(? * interval '1 hour'))",id,contact,IdentityService.hash(token),actor,ttlHours);
        delivery.deliverPlatform(id,contact,token);
        audit.record(actor,null,"PLATFORM_STAFF_INVITE",id,"SUCCESS");
        identities.remember(actor,request,"PLATFORM_STAFF_INVITE",IdentityService.hash(contact),id);
        return invitation(id);
    }
    @Transactional
    public void revokeInvite(UUID actor,UUID id,UUID request) {
        identities.platform(actor);UUID prior=identities.priorRequest(actor,request,"PLATFORM_INVITE_REVOKE",IdentityService.hash(id.toString()));
        lock();identities.platform(actor);if(prior!=null)return;
        if(!invitation(id).status().equals("PENDING"))throw new IdentityException(409,"INVITATION_UNAVAILABLE");
        db.update("UPDATE platform_staff_invitations SET status='REVOKED' WHERE id=?",id);
        audit.record(actor,null,"PLATFORM_INVITE_REVOKE",id,"SUCCESS");identities.remember(actor,request,"PLATFORM_INVITE_REVOKE",IdentityService.hash(id.toString()),id);
    }
    @Transactional
    public void revoke(UUID actor,UUID id,UUID request,long expectedVersion) {
        identities.platform(actor);UUID prior=identities.priorRequest(actor,request,"PLATFORM_STAFF_REVOKE",IdentityService.hash(id+"\n"+expectedVersion));
        lock();identities.platform(actor);if(prior!=null)return;
        if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM platform_accounts WHERE account_id=?)",Boolean.class,id)))throw new IdentityException(404,"ACCOUNT_NOT_FOUND");
        if(expectedVersion<0 || db.queryForObject("SELECT management_version FROM platform_accounts WHERE account_id=?",Long.class,id)!=expectedVersion)throw new IdentityException(409,"STALE_MANAGEMENT_VERSION");
        if(administrator(id) && db.queryForObject("SELECT count(*) FROM platform_accounts p JOIN accounts a ON a.id=p.account_id JOIN platform_roles r ON r.account_id=a.id WHERE a.status='ACTIVE' AND r.role='PLATFORM_ADMIN'",Long.class)<=1)throw new IdentityException(409,"LAST_PLATFORM_ADMIN");
        if(db.update("DELETE FROM platform_roles WHERE account_id=? AND role='PLATFORM_ADMIN'",id)>0) {
            db.update("UPDATE platform_accounts SET management_version=management_version+1 WHERE account_id=?",id);
            db.update("UPDATE platform_staff_invitations SET status='REVOKED' WHERE invited_by=? AND status='PENDING'",id);
            audit.record(actor,null,"PLATFORM_STAFF_REVOKE",id,"SUCCESS");
        }
        identities.remember(actor,request,"PLATFORM_STAFF_REVOKE",IdentityService.hash(id+"\n"+expectedVersion),id);
    }
    private java.util.Map<String,Object> byToken(String token) {
        if(token==null||!token.matches("[A-Za-z0-9_-]{43}"))throw new IdentityException(404,"INVITATION_UNAVAILABLE");
        var rows=db.queryForList("SELECT * FROM platform_staff_invitations WHERE token_hash=?",IdentityService.hash(token));
        if(rows.isEmpty())throw new IdentityException(404,"INVITATION_UNAVAILABLE");return rows.getFirst();
    }
    @Transactional(readOnly=true)
    public Preview preview(String token) {
        var row=byToken(token);var invite=invitation((UUID)row.get("id"));
        if(!invite.status().equals("PENDING")||!administrator((UUID)row.get("invited_by")))throw new IdentityException(409,"INVITATION_UNAVAILABLE");
        return new Preview(invite.loginName(),Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM platform_accounts WHERE login_name=?)",Boolean.class,invite.loginName())));
    }
    @Transactional
    public void accept(String token,String suppliedLogin,String password,String displayName,String ip) {
        String login=PlatformIdentity.loginName(suppliedLogin);
        if(!throttle.allow("platform-accept:"+login,"platform-accept:"+ip))throw new IdentityException(429,"LOGIN_THROTTLED");
        IdentityService.password(password);lock();var row=byToken(token);var invite=invitation((UUID)row.get("id"));
        if(!login.equals(invite.loginName()))throw IdentityException.denied();
        var existing=db.queryForList("SELECT p.*,a.status FROM platform_accounts p JOIN accounts a ON a.id=p.account_id WHERE login_name=? FOR UPDATE OF p,a",login);
        UUID target=null;
        if(!existing.isEmpty()) {
            var account=existing.getFirst();
            if(!passwords.matches(password,(String)account.get("password_hash"))||!"ACTIVE".equals(account.get("status")))throw new IdentityException(403,"PLATFORM_INVITE_CREDENTIALS");
            target=(UUID)account.get("account_id");
        } else passwords.matches(password,dummy);
        // Retry may authenticate an already accepted invitation, but cannot restore a revoked role.
        if(invite.status().equals("ACCEPTED")) {
            if(target==null||!target.equals(row.get("accepted_by"))||!administrator(target))throw new IdentityException(409,"INVITATION_UNAVAILABLE");
            return;
        }
        if(!invite.status().equals("PENDING")||!administrator((UUID)row.get("invited_by")))throw new IdentityException(409,"INVITATION_UNAVAILABLE");
        if(target==null) {
            String name=IdentityService.name(displayName,80);target=UUID.randomUUID();
            db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",target,"platform-"+target+"@identity.invalid",name,passwords.encode(UUID.randomUUID().toString()));
            db.update("INSERT INTO platform_accounts(account_id,login_name,password_hash) VALUES (?,?,?)",target,login,passwords.encode(password));
        }
        if(db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN') ON CONFLICT DO NOTHING",target)>0)db.update("UPDATE platform_accounts SET management_version=management_version+1 WHERE account_id=?",target);
        db.update("UPDATE platform_staff_invitations SET status='ACCEPTED',accepted_by=? WHERE id=?",target,invite.id());
        audit.record(target,null,"PLATFORM_INVITE_ACCEPT",invite.id(),"SUCCESS");
    }
    @Transactional(readOnly=true)
    public String localLink(UUID actor,UUID id) {
        identities.platform(actor);if(!invitation(id).status().equals("PENDING"))throw new IdentityException(409,"INVITATION_UNAVAILABLE");
        return "/platform-admin/#invite="+delivery.localToken(id);
    }
}
