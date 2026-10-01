package com.dreamcore.workspace.identity;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Platform management projections are explicitly limited to operational metadata. */
@Service
public class PlatformAdminService {
    public record Detail(IdentityService.Tenant tenant, long version, Instant createdAt,
                         IdentityService.Invitation initialAdminInvitation, long activeMemberCount, long workspaceCount) {}
    public record Overview(long totalTenants, long activeTenants, long suspendedTenants,
                           String platform, String database, String invitationDelivery, Instant checkedAt) {}
    public record AuditEntry(long id, UUID actorId, String actorName, String action, UUID targetId, String outcome, Instant createdAt) {}
    private final JdbcTemplate db;
    private final IdentityService identities;
    private final IdentityAudit audit;
    private final LocalInvitationDelivery delivery;
    private final com.dreamcore.workspace.departure.DepartureAccess departure;
    public PlatformAdminService(JdbcTemplate db, IdentityService identities, IdentityAudit audit, LocalInvitationDelivery delivery,com.dreamcore.workspace.departure.DepartureAccess departure) {this.departure=departure;
        this.db=db; this.identities=identities; this.audit=audit; this.delivery=delivery;
    }
    public List<IdentityService.Tenant> tenants(UUID actor, String query, String status, int offset, int limit) {
        identities.platform(actor); bounds(offset,limit);
        if (query == null || query.length()>100 || status == null || !List.of("","ACTIVE","SUSPENDED").contains(status)) throw IdentityException.invalid();
        return db.query("""
            SELECT id,name,status FROM tenants WHERE strpos(lower(name),lower(?))>0 AND (?='' OR status=?)
            ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?
            """, (r,n) -> new IdentityService.Tenant(r.getObject("id",UUID.class),r.getString("name"),r.getString("status")),query.strip(),status,status,limit,offset);
    }
    public Overview overview(UUID actor) {
        identities.platform(actor);
        return db.queryForObject("""
            SELECT count(*) total,count(*) FILTER(WHERE status='ACTIVE') active,count(*) FILTER(WHERE status='SUSPENDED') suspended FROM tenants
            """,(r,n) -> new Overview(r.getLong("total"),r.getLong("active"),r.getLong("suspended"),"AVAILABLE","AVAILABLE",delivery.mode(),Instant.now()));
    }
    @Transactional(readOnly=true, isolation=org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    public Detail detail(UUID actor, UUID tenant) {
        identities.platform(actor); return projection(tenant);
    }
    private Detail projection(UUID tenant) {
        var rows=db.query("SELECT * FROM tenants WHERE id=?",(r,n) -> new Detail(
                new IdentityService.Tenant(r.getObject("id",UUID.class),r.getString("name"),r.getString("status")),
                r.getLong("management_version"),r.getTimestamp("created_at").toInstant(),null,0,0),tenant);
        if (rows.isEmpty()) throw new IdentityException(404,"TENANT_NOT_FOUND");
        var item=rows.getFirst();
        var invites=db.queryForList("SELECT invitation_id FROM tenant_initial_admin WHERE tenant_id=?",UUID.class,tenant);
        return new Detail(item.tenant(),item.version(),item.createdAt(),invites.isEmpty()?null:identities.invitation(invites.getFirst()),
                db.queryForObject("SELECT count(*) FROM tenant_memberships WHERE tenant_id=? AND status='ACTIVE'",Long.class,tenant),
                db.queryForObject("SELECT count(*) FROM workspaces WHERE tenant_id=?",Long.class,tenant));
    }
    private long lock(UUID tenant) {
        var rows=db.queryForList("SELECT management_version FROM tenants WHERE id=? FOR UPDATE",Long.class,tenant);
        if (rows.isEmpty()) throw new IdentityException(404,"TENANT_NOT_FOUND");
        return rows.getFirst();
    }
    private void version(long actual, long expected) {
        if (actual!=expected) throw new IdentityException(409,"STALE_TENANT_VERSION");
    }
    @Transactional
    public Detail status(UUID actor, UUID tenant, UUID requestId, long expectedVersion, String status) {
        identities.platform(actor);
        if (expectedVersion<0 || !List.of("ACTIVE","SUSPENDED").contains(status)) throw IdentityException.invalid();
        String fingerprint=IdentityService.hash(tenant+"\n"+expectedVersion+"\n"+status);
        UUID prior=identities.priorRequest(actor,requestId,"TENANT_STATUS",fingerprint);
        long current=lock(tenant);
        identities.platform(actor); // Recheck after request-key and tenant-lock waits, including retries.
        if (prior!=null) return projection(tenant); // Retry observes current state; never re-applies an old transition.
        version(current,expectedVersion);
        if("ACTIVE".equals(status))departure.requireTenantActivation(tenant);
        String before=db.queryForObject("SELECT status FROM tenants WHERE id=?",String.class,tenant);
        if (!status.equals(before)) {
            db.update("UPDATE tenants SET status=?,management_version=management_version+1 WHERE id=?",status,tenant);
            audit.record(actor,tenant,"ACTIVE".equals(status)?"TENANT_RESUME":"TENANT_SUSPEND",tenant,"SUCCESS");
        }
        identities.remember(actor,requestId,"TENANT_STATUS",fingerprint,tenant);
        return projection(tenant);
    }
    @Transactional
    public Detail replaceInitialInvitation(UUID actor, UUID tenant, UUID requestId, long expectedVersion, String email) {
        identities.platform(actor); String normalized=IdentityService.email(email);
        if (expectedVersion<0) throw IdentityException.invalid();
        String fingerprint=IdentityService.hash(tenant+"\n"+expectedVersion+"\n"+normalized);
        UUID prior=identities.priorRequest(actor,requestId,"INITIAL_ADMIN_INVITE",fingerprint);
        long current=lock(tenant);
        identities.platform(actor);
        if (prior!=null) return projection(tenant);
        version(current,expectedVersion);
        if (!"ACTIVE".equals(db.queryForObject("SELECT status FROM tenants WHERE id=?",String.class,tenant))) throw new IdentityException(409,"TENANT_SUSPENDED");
        var initial=db.queryForList("SELECT invitation_id FROM tenant_initial_admin WHERE tenant_id=?",UUID.class,tenant);
        if (initial.isEmpty()) throw new IdentityException(409,"INITIAL_ADMIN_UNAVAILABLE");
        var invite=identities.invitation(initial.getFirst());
        if ("ACCEPTED".equals(invite.status()) || db.queryForObject("SELECT count(*) FROM tenant_memberships WHERE tenant_id=? AND role='TENANT_ADMIN'",Long.class,tenant)>0)
            throw new IdentityException(409,"INITIAL_ADMIN_ALREADY_SET");
        db.update("UPDATE invitations SET status='REVOKED' WHERE id=?",invite.id());
        var next=identities.issue(actor,tenant,normalized,"TENANT_ADMIN");
        db.update("UPDATE tenant_initial_admin SET invitation_id=? WHERE tenant_id=?",next.id(),tenant);
        db.update("UPDATE governance_initial_designations SET invitation_id=? WHERE tenant_id=?",next.id(),tenant);
        db.update("UPDATE tenants SET management_version=management_version+1 WHERE id=?",tenant);
        audit.record(actor,tenant,"INITIAL_ADMIN_INVITATION_REPLACE",next.id(),"SUCCESS");
        identities.remember(actor,requestId,"INITIAL_ADMIN_INVITE",fingerprint,tenant);
        return projection(tenant);
    }
    public List<AuditEntry> records(UUID actor, UUID tenant, int offset, int limit) {
        identities.platform(actor); bounds(offset,limit);
        if (!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM tenants WHERE id=?)",Boolean.class,tenant))) throw new IdentityException(404,"TENANT_NOT_FOUND");
        // Deliberately excludes member invitations, logins, and all customer work/content events.
        return db.query("""
            SELECT e.id,e.actor_id,a.display_name,e.action,e.target_id,e.outcome,e.created_at
            FROM identity_audit e LEFT JOIN accounts a ON a.id=e.actor_id WHERE e.tenant_id=?
            AND e.action IN ('TENANT_CREATE','TENANT_SUSPEND','TENANT_RESUME','INITIAL_ADMIN_INVITATION_REPLACE')
            ORDER BY e.id DESC LIMIT ? OFFSET ?
            """,(r,n)->new AuditEntry(r.getLong("id"),r.getObject("actor_id",UUID.class),r.getString("display_name"),
                    r.getString("action"),r.getObject("target_id",UUID.class),r.getString("outcome"),r.getTimestamp("created_at").toInstant()),tenant,limit,offset);
    }
    private static void bounds(int offset,int limit) {
        if(offset<0 || offset>1_000_000 || limit<1 || limit>100) throw IdentityException.invalid();
    }
}
