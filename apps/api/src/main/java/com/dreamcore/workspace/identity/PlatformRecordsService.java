package com.dreamcore.workspace.identity;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Explicit projection of platform management events, never the customer activity feed. */
@Service
public class PlatformRecordsService {
    public record Entry(long id,String category,String action,String outcome,UUID actorId,String actorName,
                        UUID targetId,String targetName,UUID tenantId,String tenantName,Instant createdAt,
                        String internalReason,String publicReason) {}
    private final JdbcTemplate db;
    private final IdentityService identities;
    public PlatformRecordsService(JdbcTemplate db,IdentityService identities){this.db=db;this.identities=identities;}
    @Transactional(readOnly=true)
    public List<Entry> list(UUID actor,String category,String outcome,int offset,int limit) {
        identities.platform(actor);TenantAdminService.page(offset,limit);
        if(!List.of("","ENTERPRISE","ACCOUNT","STAFF","SECURITY").contains(category)
            || !List.of("","SUCCESS","DENIED").contains(outcome)) throw IdentityException.invalid();
        return db.query("""
            WITH events AS (
              SELECT e.*,CASE
                WHEN e.action IN ('TENANT_CREATE','TENANT_SUSPEND','TENANT_RESUME','INITIAL_ADMIN_INVITATION_REPLACE','INITIAL_ADMIN_INVITATION_REVOKE') THEN 'ENTERPRISE'
                WHEN e.action IN ('CUSTOMER_ACCOUNT_DISABLE','CUSTOMER_ACCOUNT_ENABLE') THEN 'ACCOUNT'
                WHEN e.action IN ('PLATFORM_BOOTSTRAP','PLATFORM_STAFF_INVITE','PLATFORM_INVITE_REVOKE','PLATFORM_STAFF_REVOKE','PLATFORM_INVITE_ACCEPT') THEN 'STAFF'
                ELSE 'SECURITY' END AS category
              FROM identity_audit e WHERE e.action IN (
                'TENANT_CREATE','TENANT_SUSPEND','TENANT_RESUME','INITIAL_ADMIN_INVITATION_REPLACE','INITIAL_ADMIN_INVITATION_REVOKE',
                'CUSTOMER_ACCOUNT_DISABLE','CUSTOMER_ACCOUNT_ENABLE',
                'PLATFORM_BOOTSTRAP','PLATFORM_STAFF_INVITE','PLATFORM_INVITE_REVOKE','PLATFORM_STAFF_REVOKE','PLATFORM_INVITE_ACCEPT',
                'PLATFORM_LOGIN','PLATFORM_LOGOUT','PLATFORM_LOGIN_FAILED','PLATFORM_PASSWORD_CHANGE','PLATFORM_PASSWORD_CHANGE_FAILED')
            )
            SELECT e.*,a.display_name AS actor_name,t.name AS tenant_name,
              CASE WHEN e.category='ENTERPRISE' THEN t.name
                WHEN e.category='STAFF' THEN coalesce(i.login_name,target.display_name)
                ELSE target.display_name END AS target_name,
              s.internal_reason,s.public_reason
            FROM events e LEFT JOIN accounts a ON a.id=e.actor_id
            LEFT JOIN tenants t ON t.id=e.tenant_id
            LEFT JOIN accounts target ON target.id=e.target_id
            LEFT JOIN platform_staff_invitations i ON i.id=e.target_id AND e.category='STAFF'
            LEFT JOIN tenant_service_changes s ON s.id=e.target_id AND s.tenant_id=e.tenant_id AND e.action IN ('TENANT_SUSPEND','TENANT_RESUME')
            WHERE (?='' OR e.category=?) AND (?='' OR e.outcome=?)
            ORDER BY e.id DESC LIMIT ? OFFSET ?
            """,(r,n)->new Entry(r.getLong("id"),r.getString("category"),r.getString("action"),r.getString("outcome"),
                r.getObject("actor_id",UUID.class),r.getString("actor_name"),r.getObject("target_id",UUID.class),r.getString("target_name"),
                r.getObject("tenant_id",UUID.class),r.getString("tenant_name"),r.getTimestamp("created_at").toInstant(),
                r.getString("internal_reason"),r.getString("public_reason")),category,category,outcome,outcome,limit,offset);
    }
}
