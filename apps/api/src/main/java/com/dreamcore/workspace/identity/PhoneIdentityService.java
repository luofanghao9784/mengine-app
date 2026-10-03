package com.dreamcore.workspace.identity;

import com.dreamcore.workspace.departure.DepartureAccess;
import com.dreamcore.workspace.governance.GovernanceService;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PhoneIdentityService {
    public record Preview(String tenantName, UUID tenantId, String phone, String maskedPhone, String status,
                          String action, boolean designatedOwner) {}
    public record Accepted(UUID accountId, long credentialVersion, IdentityService.Membership membership) {}
    private final JdbcTemplate db;
    private final IdentityService identities;
    private final PhoneVerificationService verification;
    private final PasswordEncoder passwords;
    private final IdentityAudit audit;
    private final DepartureAccess departure;
    private final GovernanceService governance;
    public PhoneIdentityService(JdbcTemplate db,IdentityService identities,PhoneVerificationService verification,
            PasswordEncoder passwords,IdentityAudit audit,DepartureAccess departure,GovernanceService governance) {
        this.db=db;this.identities=identities;this.verification=verification;this.passwords=passwords;
        this.audit=audit;this.departure=departure;this.governance=governance;
    }
    private Map<String,Object> invitation(String token,boolean lock) {
        if(token==null || !token.matches("[a-f0-9]{64}")) throw new IdentityException(400,"INVITATION_INVALID");
        var rows=db.queryForList("SELECT * FROM invitations WHERE token_hash=?",token);
        if(rows.isEmpty()) throw new IdentityException(409,"INVITATION_UNAVAILABLE");
        UUID tenant=(UUID)rows.getFirst().get("tenant_id");
        var tenants=db.queryForList("SELECT status FROM tenants WHERE id=?"+(lock?" FOR UPDATE":""),String.class,tenant);
        if(tenants.isEmpty() || !"ACTIVE".equals(tenants.getFirst())) throw new IdentityException(409,"INVITATION_UNAVAILABLE");
        rows=db.queryForList("SELECT *,expires_at>now() AS unexpired FROM invitations WHERE token_hash=?"+(lock?" FOR UPDATE":""),token);
        var invite=rows.getFirst();
        if(!"ACCEPTED".equals(invite.get("status")) && !("PENDING".equals(invite.get("status")) && Boolean.TRUE.equals(invite.get("unexpired"))))
            throw new IdentityException(409,"INVITATION_UNAVAILABLE");
        if(invite.get("phone")==null) throw new IdentityException(409,"LEGACY_INVITATION");
        return invite;
    }
    public void requireInvitationManager(UUID actor, UUID id) {
        var i=identities.invitation(id);
        identities.member(actor,i.tenantId(),true);
        if(!"PENDING".equals(i.status()))throw new IdentityException(409,"INVITATION_UNAVAILABLE");
    }
    private UUID accountFor(String phone) {
        var rows=db.queryForList("SELECT id FROM accounts WHERE phone=?",UUID.class,phone);
        return rows.isEmpty()?null:rows.getFirst();
    }
    @Transactional(readOnly=true)
    public Preview preview(UUID actor,String token) {
        var i=invitation(token,false);String phone=(String)i.get("phone");UUID account=accountFor(phone);
        String action=actor!=null ? (actor.equals(account)?"CONFIRM":"SWITCH") : account!=null?"LOGIN":"CREATE";
        UUID tenant=(UUID)i.get("tenant_id");
        boolean designated=Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM governance_initial_designations WHERE tenant_id=? AND invitation_id=?)",Boolean.class,tenant,i.get("id")));
        return new Preview(db.queryForObject("SELECT name FROM tenants WHERE id=?",String.class,tenant),tenant,phone,PhoneNumbers.mask(phone),(String)i.get("status"),action,designated);
    }
    public PhoneVerificationService.Receipt challenge(UUID actor,String purpose,String suppliedPhone,String token,String browser,String ip) {
        String phone;UUID account=null,invite=null;boolean eligible=true;
        switch(purpose==null?"":purpose) {
            case "JOIN" -> {
                var i=invitation(token,false);phone=(String)i.get("phone");invite=(UUID)i.get("id");
                if(actor!=null || accountFor(phone)!=null || !"PENDING".equals(i.get("status"))) throw new IdentityException(409,"INVITATION_ACCOUNT_LOGIN_REQUIRED");
            }
            case "BIND" -> {
                var a=identities.account(actor);
                if(a.phone()!=null) throw new IdentityException(409,"PHONE_ALREADY_BOUND");
                phone=PhoneNumbers.normalize(suppliedPhone);account=actor;
            }
            case "RESET" -> {
                phone=PhoneNumbers.normalize(suppliedPhone);account=accountFor(phone);
                eligible=account!=null && identities.active(account);
            }
            default -> throw IdentityException.invalid();
        }
        return verification.issue(phone,purpose,browser,account,invite,eligible,ip);
    }
    @Transactional
    public Accepted accept(UUID actor,long actorVersion,String token,String name,String password,UUID proof,String browser,boolean owner,UUID requestId,String ip) {
        var i=invitation(token,true);UUID tenant=(UUID)i.get("tenant_id"),invite=(UUID)i.get("id");String phone=(String)i.get("phone");
        departure.requireTenantActivation(tenant);
        db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","phone:"+phone);
        UUID account=accountFor(phone);
        if(account!=null) {
            if(actor!=null && !actor.equals(account)) throw new IdentityException(403,"INVITATION_ACCOUNT_MISMATCH");
            db.queryForList("SELECT id FROM accounts WHERE id=? FOR NO KEY UPDATE",account);
            if(actor==null) account=identities.login(phone,password,ip).id();
            else if(!identities.validSession(actor,actorVersion)) throw new IdentityException(401,"AUTHENTICATION_REQUIRED");
            identities.account(account);
        } else {
            if(actor!=null) throw new IdentityException(403,"INVITATION_ACCOUNT_MISMATCH");
            IdentityService.password(password);String display=IdentityService.name(name,80);
            verification.consume(proof,phone,"JOIN",browser,null,invite);
            account=UUID.randomUUID();
            db.update("INSERT INTO accounts(id,phone,phone_verified_at,display_name,password_hash) VALUES (?,?,now(),?,?)",account,phone,display,passwords.encode(password));
        }
        departure.requireMemberActivation(tenant,account);
        if("ACCEPTED".equals(i.get("status"))) {
            if(!account.equals(i.get("accepted_by"))) throw new IdentityException(409,"INVITATION_UNAVAILABLE");
            identities.member(account,tenant,false); // Retry cannot restore disabled membership or grants.
        } else {
            db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,account,i.get("role"));
            db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'个人空间','PERSONAL')",UUID.randomUUID(),tenant,account);
            db.update("UPDATE invitations SET status='ACCEPTED',accepted_by=? WHERE id=?",account,invite);
            audit.record(account,tenant,"INVITATION_ACCEPT",invite,"SUCCESS");
        }
        if(owner) {
            if(requestId==null) throw IdentityException.invalid();
            var snapshot=governance.snapshot(account,tenant);
            if(!snapshot.owner()) governance.acceptInitial(account,tenant,requestId,snapshot.revision());
        }
        return new Accepted(account,identities.account(account).credentialVersion(),new IdentityService.Membership(tenant,db.queryForObject("SELECT name FROM tenants WHERE id=?",String.class,tenant),identities.member(account,tenant,false)));
    }
    @Transactional
    public IdentityService.Me bind(UUID actor,String suppliedPhone,String password,UUID proof,String browser,String ip) {
        String phone=PhoneNumbers.normalize(suppliedPhone);
        db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","phone:"+phone);
        db.queryForList("SELECT id FROM accounts WHERE id=? FOR NO KEY UPDATE",actor);
        var a=identities.account(actor);
        if(a.phone()!=null) throw new IdentityException(409,"PHONE_ALREADY_BOUND");
        // Ownership of a cached legacy session alone is insufficient to change its login identity.
        identities.login(a.email(),password,ip);
        if(accountFor(phone)!=null) throw new IdentityException(409,"PHONE_IN_USE");
        verification.consume(proof,phone,"BIND",browser,actor,null);
        db.update("UPDATE accounts SET phone=?,phone_verified_at=now(),credential_version=credential_version+1 WHERE id=?",phone,actor);
        revokeSessions(actor);
        audit.record(actor,null,"PHONE_BIND",actor,"SUCCESS");
        return identities.me(actor);
    }
    @Transactional
    public void reset(String suppliedPhone,String password,UUID proof,String browser) {
        String phone=PhoneNumbers.normalize(suppliedPhone);IdentityService.password(password);
        UUID account=accountFor(phone);
        if(account==null) throw new IdentityException(400,"CODE_INVALID");
        db.queryForList("SELECT id FROM accounts WHERE id=? FOR NO KEY UPDATE",account);
        identities.account(account);
        verification.consume(proof,phone,"RESET",browser,account,null);
        db.update("UPDATE accounts SET password_hash=?,credential_version=credential_version+1 WHERE id=?",passwords.encode(password),account);
        db.update("UPDATE phone_challenges SET consumed_at=now() WHERE account_id=? AND purpose='RESET' AND consumed_at IS NULL",account);
        revokeSessions(account);
        audit.record(account,null,"PASSWORD_RESET",account,"SUCCESS");
    }
    @Transactional
    public void changePassword(UUID actor,String currentPassword,String nextPassword,String ip) {
        db.queryForList("SELECT id FROM accounts WHERE id=? FOR NO KEY UPDATE",actor);
        var a=identities.account(actor);
        identities.login(a.phone()!=null?a.phone():a.email(),currentPassword,ip);
        IdentityService.password(nextPassword);
        db.update("UPDATE accounts SET password_hash=?,credential_version=credential_version+1 WHERE id=?",passwords.encode(nextPassword),actor);
        revokeSessions(actor);audit.record(actor,null,"PASSWORD_CHANGE",actor,"SUCCESS");
    }
    private void revokeSessions(UUID account) {
        db.update("DELETE FROM spring_session WHERE principal_name=?",account.toString());
    }
}
