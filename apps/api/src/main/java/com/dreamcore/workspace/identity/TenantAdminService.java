package com.dreamcore.workspace.identity;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TenantAdminService {
    public record Member(UUID accountId, String email, String displayName, String role, String status, String accountStatus, long version, String phone) {}
    public record EmergencyDisableReceipt(UUID accountId, String status, long version, String securityAction,
                                          UUID recoveryRequestId, String recoveryStatus) {}
    public record SharedWorkspace(UUID id, UUID tenantId, String name, String kind, long version, long memberCount) {}
    public record Grant(UUID accountId, String email, String displayName, String status, String accountStatus, boolean canMaintain, String phone) {}
    public record Overview(UUID tenantId, String name, long version, long activeMemberCount, long disabledMemberCount,
                           long sharedWorkspaceCount, String invitationDelivery) {}
    public record AuditEntry(long id, UUID actorId, String actorName, String action, UUID targetId, String targetName,
                             UUID relatedAccountId, String relatedAccountName, Instant createdAt) {}
    private static final String MEMBER_SQL = """
        SELECT m.account_id,a.email,a.phone,a.display_name,m.role,m.status,a.status AS account_status,m.management_version
        FROM tenant_memberships m JOIN accounts a ON a.id=m.account_id WHERE m.tenant_id=?
        """;
    private static final RowMapper<Member> MEMBER = (r,n) -> new Member(r.getObject("account_id",UUID.class),r.getString("email"),
        r.getString("display_name"),r.getString("role"),r.getString("status"),r.getString("account_status"),r.getLong("management_version"),r.getString("phone"));
    private static final String SPACE_SQL = """
        SELECT w.id,w.tenant_id,w.name,w.kind,w.management_version,
        (SELECT count(*) FROM workspace_members g WHERE g.tenant_id=w.tenant_id AND g.workspace_id=w.id) AS member_count
        FROM workspaces w WHERE w.tenant_id=? AND w.kind='SHARED'
        """;
    private static final RowMapper<SharedWorkspace> SPACE = (r,n) -> new SharedWorkspace(r.getObject("id",UUID.class),
        r.getObject("tenant_id",UUID.class),r.getString("name"),r.getString("kind"),r.getLong("management_version"),r.getLong("member_count"));
    private final JdbcTemplate db;
    private final IdentityService identities;
    private final IdentityAudit audit;
    private final LocalInvitationDelivery delivery;
    private final com.dreamcore.workspace.governance.GovernanceAccess governance;
    private final com.dreamcore.workspace.departure.DepartureAccess departure;
    public TenantAdminService(JdbcTemplate db, IdentityService identities, IdentityAudit audit, LocalInvitationDelivery delivery, com.dreamcore.workspace.governance.GovernanceAccess governance,com.dreamcore.workspace.departure.DepartureAccess departure) {this.departure=departure;
        this.db=db; this.identities=identities; this.audit=audit; this.delivery=delivery;this.governance=governance;
    }
    static void page(int offset, int limit) { if (offset<0 || offset>100000 || limit<1 || limit>100) throw IdentityException.invalid(); }
    private static void version(long supplied, long current) {
        if (supplied<0) throw IdentityException.invalid();
        if (supplied!=current) throw new IdentityException(409,"STALE_MANAGEMENT_VERSION");
    }
    // Request key -> tenant -> child rows. Recheck authorization after taking the tenant lock.
    private UUID mutation(UUID actor, UUID tenant, UUID key, String operation, String fingerprint) {
        identities.member(actor,tenant,true,false);
        UUID prior=identities.priorRequest(actor,key,operation,fingerprint);
        db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",tenant);
        identities.member(actor,tenant,true);
        return prior;
    }
    @Transactional
    public Overview overview(UUID actor, UUID tenant) {
        identities.member(actor,tenant,true);
        return db.queryForObject("""
            SELECT t.name,t.settings_version,
            (SELECT count(*) FROM tenant_memberships WHERE tenant_id=t.id AND status='ACTIVE') AS active_members,
            (SELECT count(*) FROM tenant_memberships WHERE tenant_id=t.id AND status='DISABLED') AS disabled_members,
            (SELECT count(*) FROM workspaces WHERE tenant_id=t.id AND kind='SHARED') AS spaces
            FROM tenants t WHERE t.id=?
            """,(r,n)->new Overview(tenant,r.getString("name"),r.getLong("settings_version"),r.getLong("active_members"),
                r.getLong("disabled_members"),r.getLong("spaces"),delivery.mode()),tenant);
    }
    @Transactional
    public Overview renameTenant(UUID actor, UUID tenant, UUID key, long expectedVersion, String suppliedName) {
        String name=IdentityService.name(suppliedName,100), fingerprint=IdentityService.hash(tenant+"\n"+expectedVersion+"\n"+name);
        UUID prior=mutation(actor,tenant,key,"RENAME_TENANT",fingerprint);
        if (prior!=null) return overview(actor,tenant);
        var current=overview(actor,tenant); version(expectedVersion,current.version());
        if (!current.name().equals(name)) {
            db.update("UPDATE tenants SET name=?,settings_version=settings_version+1 WHERE id=?",name,tenant);
            audit.record(actor,tenant,"TENANT_RENAME",tenant,"SUCCESS");
        }
        identities.remember(actor,key,"RENAME_TENANT",fingerprint,tenant); return overview(actor,tenant);
    }
    @Transactional
    public List<Member> members(UUID actor, UUID tenant, String query, String status, int offset, int limit) {
        identities.member(actor,tenant,true); page(offset,limit);
        if (query.length()>100 || !List.of("","ACTIVE","DISABLED").contains(status)) throw IdentityException.invalid();
        return db.query(MEMBER_SQL+" AND (?='' OR m.status=?) AND (strpos(lower(coalesce(a.phone,a.email)),lower(?))>0 OR strpos(lower(a.display_name),lower(?))>0) ORDER BY a.display_name,a.id LIMIT ? OFFSET ?",
            MEMBER,tenant,status,status,query.strip(),query.strip(),limit,offset);
    }
    private Member member(UUID tenant, UUID id) {
        var rows=db.query(MEMBER_SQL+" AND m.account_id=?",MEMBER,tenant,id);
        if (rows.isEmpty()) throw new IdentityException(404,"MEMBER_NOT_FOUND"); return rows.getFirst();
    }
    @Transactional
    public Member status(UUID actor, UUID tenant, UUID id, UUID key, long expectedVersion, String status) {
        if (!List.of("ACTIVE","DISABLED").contains(status)) throw IdentityException.invalid();
        String fingerprint=IdentityService.hash(tenant+"\n"+id+"\n"+expectedVersion+"\n"+status);
        UUID prior=mutation(actor,tenant,key,"MEMBER_STATUS",fingerprint);
        Member current=member(tenant,id); if (prior!=null) return current; if("ACTIVE".equals(status))departure.requireMemberActivation(tenant,id); version(expectedVersion,current.version());
        if (!current.status().equals(status)) {
            if ("ACTIVE".equals(status) && Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM governance_security_stops s JOIN governance_recovery_requests r ON r.id=s.recovery_request_id AND r.tenant_id=s.tenant_id WHERE s.tenant_id=? AND s.account_id=? AND r.status='PENDING_VERIFICATION')",Boolean.class,tenant,id)))
                throw new IdentityException(409,"SECURITY_RECOVERY_PENDING");
            governance.protectOwner(tenant,id,status);
            protectLastAdmin(tenant,current,status,current.role());
            db.update("UPDATE tenant_memberships SET status=?,management_version=management_version+1 WHERE tenant_id=? AND account_id=?",status,tenant,id);
            audit.record(actor,tenant,"ACTIVE".equals(status)?"MEMBER_ENABLE":"MEMBER_DISABLE",id,"SUCCESS");
        }
        identities.remember(actor,key,"MEMBER_STATUS",fingerprint,id); return member(tenant,id);
    }
    /** Safety stop is independent of ordinary handover. It never transfers responsibility or content rights. */
    @Transactional
    public EmergencyDisableReceipt emergencyDisable(UUID actor, UUID tenant, UUID id, UUID key, long expectedVersion, String securityAction) {
        if (!"SECURITY_RISK".equals(securityAction)) throw IdentityException.invalid();
        String operation="MEMBER_SECURITY_DISABLE", fingerprint=IdentityService.hash(tenant+"\n"+id+"\n"+expectedVersion+"\n"+securityAction);
        UUID prior=mutation(actor,tenant,key,operation,fingerprint);
        if (prior!=null) return securityReceipt(tenant,prior);
        Member current=member(tenant,id); version(expectedVersion,current.version());
        boolean owner=Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM tenant_governance WHERE tenant_id=? AND owner_id=?)",Boolean.class,tenant,id));
        boolean lastAdmin="TENANT_ADMIN".equals(current.role()) && db.queryForObject("""
            SELECT count(*) FROM tenant_memberships m JOIN accounts a ON a.id=m.account_id
            WHERE m.tenant_id=? AND m.account_id<>? AND m.role='TENANT_ADMIN' AND m.status='ACTIVE' AND a.status='ACTIVE'
            """,Long.class,tenant,id)==0;
        if (!"DISABLED".equals(current.status()))
            db.update("UPDATE tenant_memberships SET status='DISABLED',management_version=management_version+1 WHERE tenant_id=? AND account_id=?",tenant,id);
        UUID recovery=null;
        if (owner || lastAdmin) {
            recovery=UUID.randomUUID();
            db.update("INSERT INTO governance_recovery_requests(id,tenant_id,requested_by,reason) VALUES (?,?,?,?)",recovery,tenant,actor,owner?"OWNER_UNAVAILABLE":"LEGACY_OWNER_UNVERIFIED");
            audit.record(actor,tenant,"SECURITY_RECOVERY_REQUIRED",recovery,"SUCCESS");
        }
        UUID receipt=UUID.randomUUID();
        db.update("INSERT INTO governance_security_stops(id,tenant_id,account_id,requested_by,member_version,security_action,recovery_request_id) VALUES (?,?,?,?,?,?,?)",
            receipt,tenant,id,actor,member(tenant,id).version(),securityAction,recovery);
        identities.remember(actor,key,operation,fingerprint,receipt);
        audit.record(actor,tenant,operation,id,"SUCCESS");
        // Self-stop may remove the caller's last tenant role. Return only this already-authorized receipt.
        return securityReceipt(tenant,receipt);
    }
    private EmergencyDisableReceipt securityReceipt(UUID tenant,UUID receipt) {
        return db.queryForObject("SELECT account_id,member_version,security_action,recovery_request_id FROM governance_security_stops WHERE tenant_id=? AND id=?",
            (r,n)->new EmergencyDisableReceipt(r.getObject("account_id",UUID.class),"DISABLED",r.getLong("member_version"),r.getString("security_action"),
                r.getObject("recovery_request_id",UUID.class),r.getObject("recovery_request_id")==null?null:"PENDING_VERIFICATION"),tenant,receipt);
    }
    private void protectLastAdmin(UUID tenant, Member current, String status, String role) {
        if ("TENANT_ADMIN".equals(current.role()) && "ACTIVE".equals(current.status()) && "ACTIVE".equals(current.accountStatus()) &&
            (!"ACTIVE".equals(status) || !"TENANT_ADMIN".equals(role)) && db.queryForObject("""
              SELECT count(*) FROM tenant_memberships m JOIN accounts a ON a.id=m.account_id
              WHERE m.tenant_id=? AND m.role='TENANT_ADMIN' AND m.status='ACTIVE' AND a.status='ACTIVE'
              """,Long.class,tenant)<=1) throw new IdentityException(409,"LAST_TENANT_ADMIN");
    }
    @Transactional
    public List<SharedWorkspace> spaces(UUID actor, UUID tenant, String query, int offset, int limit) {
        identities.member(actor,tenant,true); page(offset,limit); if (query.length()>100) throw IdentityException.invalid();
        return db.query(SPACE_SQL+" AND strpos(lower(w.name),lower(?))>0 ORDER BY w.name,w.id LIMIT ? OFFSET ?",SPACE,tenant,query.strip(),limit,offset);
    }
    private SharedWorkspace space(UUID tenant, UUID id) {
        var rows=db.query(SPACE_SQL+" AND w.id=?",SPACE,tenant,id);
        if (rows.isEmpty()) throw new IdentityException(404,"WORKSPACE_NOT_FOUND"); return rows.getFirst();
    }
    @Transactional
    public SharedWorkspace spaceInfo(UUID actor, UUID tenant, UUID id) { identities.member(actor,tenant,true); return space(tenant,id); }
    @Transactional
    public List<Grant> grants(UUID actor, UUID tenant, UUID id, int offset, int limit) {
        identities.member(actor,tenant,true); page(offset,limit); space(tenant,id);
        return db.query("""
            SELECT g.account_id,a.email,a.phone,a.display_name,m.status,a.status AS account_status,g.can_maintain FROM workspace_members g
            JOIN tenant_memberships m ON m.tenant_id=g.tenant_id AND m.account_id=g.account_id JOIN accounts a ON a.id=g.account_id
            WHERE g.tenant_id=? AND g.workspace_id=? ORDER BY a.display_name,a.id LIMIT ? OFFSET ?
            """,(r,n)->new Grant(r.getObject("account_id",UUID.class),r.getString("email"),r.getString("display_name"),
                r.getString("status"),r.getString("account_status"),r.getBoolean("can_maintain"),r.getString("phone")),tenant,id,limit,offset);
    }
    @Transactional
    public SharedWorkspace createSpace(UUID actor, UUID tenant, UUID key, String suppliedName) {
        String name=IdentityService.name(suppliedName,100), fingerprint=IdentityService.hash(tenant+"\n"+name);
        UUID prior=mutation(actor,tenant,key,"CREATE_SHARED_SPACE",fingerprint); if (prior!=null) return space(tenant,prior);
        departure.requireActiveBusiness(actor,tenant);
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,?,'SHARED')",id,tenant,actor,name);
        identities.remember(actor,key,"CREATE_SHARED_SPACE",fingerprint,id); audit.record(actor,tenant,"WORKSPACE_CREATE",id,"SUCCESS");
        return space(tenant,id);
    }
    @Transactional
    public SharedWorkspace renameSpace(UUID actor, UUID tenant, UUID id, UUID key, long expectedVersion, String suppliedName) {
        String name=IdentityService.name(suppliedName,100), fingerprint=IdentityService.hash(tenant+"\n"+id+"\n"+expectedVersion+"\n"+name);
        UUID prior=mutation(actor,tenant,key,"RENAME_SHARED_SPACE",fingerprint); SharedWorkspace current=space(tenant,id);
        if (prior!=null) return current; version(expectedVersion,current.version());
        if (!current.name().equals(name)) {
            db.update("UPDATE workspaces SET name=?,management_version=management_version+1 WHERE tenant_id=? AND id=?",name,tenant,id);
            audit.record(actor,tenant,"WORKSPACE_RENAME",id,"SUCCESS");
        }
        identities.remember(actor,key,"RENAME_SHARED_SPACE",fingerprint,id); return space(tenant,id);
    }
    @Transactional
    public SharedWorkspace grant(UUID actor, UUID tenant, UUID id, UUID accountId, UUID key, long expectedVersion, boolean enabled) {
        String fingerprint=IdentityService.hash(tenant+"\n"+id+"\n"+accountId+"\n"+expectedVersion+"\n"+enabled);
        UUID prior=mutation(actor,tenant,key,"SPACE_MEMBERSHIP",fingerprint); SharedWorkspace current=space(tenant,id);
        if (prior!=null) return current; version(expectedVersion,current.version());
        Member target=member(tenant,accountId);
        if(enabled){departure.requireActiveBusiness(actor,tenant);departure.requireMemberActivation(tenant,accountId);}
        governance.contentGrant(actor,tenant,accountId,enabled);
        if (enabled && (!"ACTIVE".equals(target.status()) || !"ACTIVE".equals(target.accountStatus())))
            throw new IdentityException(409,"MEMBER_INACTIVE");
        int changed=enabled ? db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES (?,?,?) ON CONFLICT DO NOTHING",tenant,id,accountId)
            : db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,id,accountId);
        if (changed>0) {
            db.update("UPDATE workspaces SET management_version=management_version+1 WHERE tenant_id=? AND id=?",tenant,id);
            db.update("INSERT INTO identity_audit(actor_id,tenant_id,action,target_id,related_account_id,outcome) VALUES (?,?,?,?,?,'SUCCESS')",
                actor,tenant,enabled?"WORKSPACE_GRANT":"WORKSPACE_REVOKE",id,accountId);
        }
        identities.remember(actor,key,"SPACE_MEMBERSHIP",fingerprint,id); return space(tenant,id);
    }
    @Transactional
    public SharedWorkspace maintenance(UUID actor, UUID tenant, UUID id, UUID accountId, UUID key, long expectedVersion, boolean enabled) {
        String fingerprint=IdentityService.hash(tenant+"\n"+id+"\n"+accountId+"\n"+expectedVersion+"\n"+enabled);
        UUID prior=mutation(actor,tenant,key,"SPACE_MAINTENANCE",fingerprint);
        SharedWorkspace current=space(tenant,id); if (prior!=null) return current;
        version(expectedVersion,current.version()); Member target=member(tenant,accountId);
        if(enabled){departure.requireActiveBusiness(actor,tenant);departure.requireMemberActivation(tenant,accountId);}
        governance.contentGrant(actor,tenant,accountId,enabled);
        if (enabled && (!"ACTIVE".equals(target.status()) || !"ACTIVE".equals(target.accountStatus()))) throw new IdentityException(409,"MEMBER_INACTIVE");
        var grants=db.queryForList("SELECT can_maintain FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",Boolean.class,tenant,id,accountId);
        if (grants.isEmpty()) throw new IdentityException(404,"WORKSPACE_GRANT_NOT_FOUND");
        if (grants.getFirst()!=enabled) {
            db.update("UPDATE workspace_members SET can_maintain=? WHERE tenant_id=? AND workspace_id=? AND account_id=?",enabled,tenant,id,accountId);
            db.update("UPDATE workspaces SET management_version=management_version+1 WHERE tenant_id=? AND id=?",tenant,id);
            db.update("INSERT INTO identity_audit(actor_id,tenant_id,action,target_id,related_account_id,outcome) VALUES (?,?,?,?,?,'SUCCESS')",
                actor,tenant,enabled?"WORKSPACE_MAINTAIN":"WORKSPACE_READONLY",id,accountId);
        }
        identities.remember(actor,key,"SPACE_MAINTENANCE",fingerprint,id); return space(tenant,id);
    }
    @Transactional
    public List<AuditEntry> records(UUID actor, UUID tenant, int offset, int limit) {
        identities.member(actor,tenant,true); page(offset,limit);
        return db.query("""
            SELECT e.id,e.actor_id,a.display_name AS actor_name,e.action,e.target_id,e.related_account_id,b.display_name AS related_name,e.created_at,
              CASE WHEN e.action LIKE 'INVITATION_%' THEN coalesce(i.phone,i.email) WHEN e.action LIKE 'MEMBER_%' THEN c.display_name
                   WHEN e.action LIKE 'WORKSPACE_%' THEN w.name WHEN e.action='TENANT_RENAME' THEN t.name END AS target_name
            FROM identity_audit e JOIN accounts a ON a.id=e.actor_id LEFT JOIN accounts b ON b.id=e.related_account_id
            LEFT JOIN accounts c ON c.id=e.target_id LEFT JOIN invitations i ON i.id=e.target_id AND i.tenant_id=e.tenant_id
            LEFT JOIN workspaces w ON w.id=e.target_id AND w.tenant_id=e.tenant_id AND w.kind='SHARED'
            LEFT JOIN tenants t ON t.id=e.target_id AND t.id=e.tenant_id
            WHERE e.tenant_id=? AND e.outcome='SUCCESS' AND e.action IN ('INVITATION_CREATE','INVITATION_REVOKE','INVITATION_ACCEPT',
                'MEMBER_ENABLE','MEMBER_DISABLE','MEMBER_SECURITY_DISABLE','MEMBER_ROLE','WORKSPACE_CREATE','WORKSPACE_RENAME','WORKSPACE_GRANT','WORKSPACE_REVOKE','WORKSPACE_MAINTAIN','WORKSPACE_READONLY','TENANT_RENAME')
            ORDER BY e.created_at DESC,e.id DESC LIMIT ? OFFSET ?
            """,(r,n)->new AuditEntry(r.getLong("id"),r.getObject("actor_id",UUID.class),r.getString("actor_name"),r.getString("action"),
                r.getObject("target_id",UUID.class),r.getString("target_name"),r.getObject("related_account_id",UUID.class),
                r.getString("related_name"),r.getTimestamp("created_at").toInstant()),tenant,limit,offset);
    }
}
