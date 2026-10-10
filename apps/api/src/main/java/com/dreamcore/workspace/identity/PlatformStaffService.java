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

/** Interactive invitations grant a role to a verified unified identity. */
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
        return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM accounts a JOIN platform_roles r ON r.account_id=a.id WHERE a.id=? AND a.status='ACTIVE' AND r.role='PLATFORM_ADMIN')",Boolean.class,id));
    }
    /** Called only by the offline bootstrap command with an owner-only activation secret. */
    @Transactional
    public UUID initialize(String suppliedPhone,String token) {
        String phone=PhoneNumbers.normalize(suppliedPhone);
        if(token==null||!token.matches("[A-Za-z0-9_-]{43}"))throw IdentityException.invalid();
        lock();db.execute("SELECT pg_advisory_xact_lock(743012009)");
        if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM platform_initialization) OR EXISTS(SELECT 1 FROM platform_roles) OR EXISTS(SELECT 1 FROM platform_accounts)",Boolean.class)))
            throw new IdentityException(409,"BOOTSTRAP_ALREADY_COMPLETED");
        UUID source=UUID.randomUUID(),invite=UUID.randomUUID();
        db.update("INSERT INTO accounts(id,email,display_name,password_hash,status) VALUES (?, ?,'初始化操作记录','!INITIALIZATION!','DISABLED')",source,"initialization-"+source+"@identity.invalid");
        db.update("INSERT INTO platform_staff_invitations(id,login_name,token_hash,invited_by,expires_at) VALUES (?,?,?,?,now()+(? * interval '1 hour'))",invite,phone,IdentityService.hash(token),source,ttlHours);
        db.update("INSERT INTO platform_initialization(singleton,invitation_id) VALUES (true,?)",invite);
        audit.record(source,null,"PLATFORM_INITIALIZATION_REQUEST",invite,"SUCCESS");
        return invite;
    }
    private boolean inviterAllowed(java.util.Map<String,Object> invitation) {
        if(administrator((UUID)invitation.get("invited_by")))return true;
        return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM platform_initialization WHERE invitation_id=? AND (completed_at IS NULL AND NOT EXISTS(SELECT 1 FROM platform_roles) OR completed_at IS NOT NULL AND ?='ACCEPTED'))",Boolean.class,invitation.get("id"),invitation.get("status")));
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
        var accounts=db.queryForList("SELECT account_id FROM platform_accounts WHERE login_name=? UNION SELECT id AS account_id FROM accounts WHERE phone=?",contact,contact);
        if(accounts.stream().anyMatch(a->administrator((UUID)a.get("account_id"))))throw new IdentityException(409,"PLATFORM_ALREADY_ADMIN");
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
        if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM accounts a WHERE a.id=? AND (EXISTS(SELECT 1 FROM platform_roles r WHERE r.account_id=a.id) OR EXISTS(SELECT 1 FROM platform_accounts p WHERE p.account_id=a.id)))",Boolean.class,id)))throw new IdentityException(404,"ACCOUNT_NOT_FOUND");
        if(expectedVersion<0 || db.queryForObject("SELECT management_version FROM accounts WHERE id=?",Long.class,id)!=expectedVersion)throw new IdentityException(409,"STALE_MANAGEMENT_VERSION");
        if(administrator(id) && db.queryForObject("SELECT count(*) FROM accounts a JOIN platform_roles r ON r.account_id=a.id WHERE a.status='ACTIVE' AND r.role='PLATFORM_ADMIN'",Long.class)<=1)throw new IdentityException(409,"LAST_PLATFORM_ADMIN");
        if(db.update("DELETE FROM platform_roles WHERE account_id=? AND role='PLATFORM_ADMIN'",id)>0) {
            db.update("UPDATE accounts SET management_version=management_version+1 WHERE id=?",id);
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
        if(db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN') ON CONFLICT DO NOTHING",target)>0)db.update("UPDATE accounts SET management_version=management_version+1 WHERE id=?",target);
        db.update("UPDATE platform_staff_invitations SET status='ACCEPTED',accepted_by=? WHERE id=?",target,invite.id());
        audit.record(target,null,"PLATFORM_INVITE_ACCEPT",invite.id(),"SUCCESS");
    }
    @Transactional(readOnly=true)
    public String localLink(UUID actor,UUID id) {
        identities.platform(actor);if(!invitation(id).status().equals("PENDING"))throw new IdentityException(409,"INVITATION_UNAVAILABLE");
        return "/platform-admin/#invite="+delivery.localToken(id);
    }
    public boolean requiresPhoneVerification(String token) {
        var row=byToken(token);
        return !Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM accounts WHERE phone=?)",Boolean.class,row.get("login_name")));
    }
    @Transactional(readOnly=true)
    public Preview previewUnified(String token) {
        var row=byToken(token);var invite=invitation((UUID)row.get("id"));
        if(!invite.status().equals("PENDING")||!inviterAllowed(row))throw new IdentityException(409,"INVITATION_UNAVAILABLE");
        return new Preview(invite.loginName(),Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM accounts WHERE phone=?)",Boolean.class,invite.loginName())));
    }
    @Transactional
    public PhoneVerificationService.Receipt challenge(String token,String browser,String ip,PhoneVerificationService verification) {
        var preview=previewUnified(token);
        if(preview.existingAccount())throw new IdentityException(409,"INVITATION_ACCOUNT_LOGIN_REQUIRED");
        var row=byToken(token);
        var receipt=verification.issue(preview.loginName(),"STAFF",browser,null,null,true,ip);
        db.update("UPDATE phone_challenges SET staff_invitation_id=? WHERE id=?",row.get("id"),receipt.id());
        return receipt;
    }
    @Transactional
    public IdentityService.Account acceptUnified(UUID actor,long actorVersion,String token,String suppliedPhone,String password,String displayName,UUID proof,String browser,String ip,PhoneVerificationService verification) {
        String phone=PhoneNumbers.normalize(suppliedPhone);lock();var row=byToken(token);var invite=invitation((UUID)row.get("id"));
        if(!phone.equals(invite.loginName()))throw IdentityException.denied();
        if(!List.of("PENDING","ACCEPTED").contains(invite.status())||!inviterAllowed(row))throw new IdentityException(409,"INVITATION_UNAVAILABLE");
        db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","phone:"+phone);
        var accounts=db.queryForList("SELECT id FROM accounts WHERE phone=?",UUID.class,phone);
        UUID target;
        if(accounts.isEmpty()) {
            if(actor!=null)throw new IdentityException(403,"INVITATION_ACCOUNT_MISMATCH");
            IdentityService.password(password);String name=IdentityService.name(displayName,80);
            if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM phone_challenges WHERE id=? AND staff_invitation_id=?)",Boolean.class,proof,invite.id())))throw new IdentityException(400,"CODE_INVALID");
            verification.consume(proof,phone,"STAFF",browser,null,null);
            target=UUID.randomUUID();
            db.update("INSERT INTO accounts(id,phone,phone_verified_at,display_name,password_hash) VALUES (?,?,now(),?,?)",target,phone,name,passwords.encode(password));
        } else {
            target=accounts.getFirst();
            if(actor!=null && !actor.equals(target))throw new IdentityException(403,"INVITATION_ACCOUNT_MISMATCH");
            if(actor==null)identities.login(phone,password,ip);
            db.queryForList("SELECT id FROM accounts WHERE id=? FOR NO KEY UPDATE",target);
            identities.account(target);
            if(actor!=null&&!identities.validSession(actor,actorVersion))throw new IdentityException(401,"AUTHENTICATION_REQUIRED");
        }
        if(invite.status().equals("ACCEPTED")) {
            if(!target.equals(row.get("accepted_by"))||!administrator(target))throw new IdentityException(409,"INVITATION_UNAVAILABLE");
            return identities.account(target);
        }
        if(db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN') ON CONFLICT DO NOTHING",target)>0)
            db.update("UPDATE accounts SET management_version=management_version+1 WHERE id=?",target);
        db.update("UPDATE platform_staff_invitations SET status='ACCEPTED',accepted_by=? WHERE id=?",target,invite.id());
        db.update("UPDATE platform_initialization SET completed_at=now() WHERE invitation_id=? AND completed_at IS NULL",invite.id());
        audit.record(target,null,"PLATFORM_INVITE_ACCEPT",invite.id(),"SUCCESS");
        return identities.account(target);
    }

}
