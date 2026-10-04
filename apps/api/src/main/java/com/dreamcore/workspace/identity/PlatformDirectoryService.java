package com.dreamcore.workspace.identity;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PlatformDirectoryService {
    public record Customer(UUID id,String displayName,String phone,String email,String status,long version,long tenantCount) {}
    public record Membership(UUID tenantId,String tenantName,String role,String membershipStatus,String serviceStatus) {}
    public record Change(UUID id,String actorName,String previousStatus,String nextStatus,String reason,Instant createdAt) {}
    public record Detail(Customer account,List<Membership> memberships,List<Change> records) {}
    public record Staff(UUID id,String displayName,String loginName,String status,boolean administrator,long version) {}
    private final JdbcTemplate db;
    private final IdentityService identities;
    private final IdentityAudit audit;
    private static final String CUSTOMERS="""
        SELECT a.*,(SELECT count(*) FROM tenant_memberships m WHERE m.account_id=a.id) AS tenant_count
        FROM accounts a WHERE NOT EXISTS(SELECT 1 FROM platform_accounts p WHERE p.account_id=a.id)
        """;
    private static final org.springframework.jdbc.core.RowMapper<Customer> CUSTOMER=(r,n)->new Customer(
        r.getObject("id",UUID.class),r.getString("display_name"),r.getString("phone"),r.getString("email"),r.getString("status"),r.getLong("management_version"),r.getLong("tenant_count"));
    public PlatformDirectoryService(JdbcTemplate db,IdentityService identities,IdentityAudit audit) { this.db=db;this.identities=identities;this.audit=audit; }
    @Transactional(readOnly=true)
    public List<Customer> customers(UUID actor,String q,String status,int offset,int limit) {
        identities.platform(actor);TenantAdminService.page(offset,limit);
        if(q==null || q.length()>180 || !List.of("","ACTIVE","DISABLED").contains(status)) throw IdentityException.invalid();
        // strpos keeps '%' and '_' literal; names/contacts are management metadata, never workspace content.
        return db.query(CUSTOMERS+" AND (?='' OR a.status=?) AND (?='' OR strpos(lower(a.display_name||' '||coalesce(a.phone,'')||' '||coalesce(a.email,'')),lower(?))>0) ORDER BY a.created_at DESC,a.id OFFSET ? LIMIT ?",
            CUSTOMER,status,status,q,q,offset,limit);
    }
    @Transactional(readOnly=true)
    public List<Customer> enterpriseCustomers(UUID actor, UUID tenant, String q, String status, int offset, int limit) {
        identities.platform(actor);TenantAdminService.page(offset,limit);
        if(q==null || q.length()>180 || !List.of("","ACTIVE","DISABLED").contains(status)) throw IdentityException.invalid();
        if(db.queryForObject("SELECT count(*) FROM tenants WHERE id=?",Long.class,tenant)==0) throw new IdentityException(404,"TENANT_NOT_FOUND");
        return db.query(CUSTOMERS+" AND EXISTS(SELECT 1 FROM tenant_memberships m WHERE m.account_id=a.id AND m.tenant_id=?) AND (?='' OR a.status=?) AND (?='' OR strpos(lower(a.display_name||' '||coalesce(a.phone,'')||' '||coalesce(a.email,'')),lower(?))>0) ORDER BY a.created_at DESC,a.id OFFSET ? LIMIT ?",
            CUSTOMER,tenant,status,status,q,q,offset,limit);
    }
    private Customer customer(UUID id) {
        var rows=db.query(CUSTOMERS+" AND a.id=?",CUSTOMER,id);
        if(rows.isEmpty()) throw new IdentityException(404,"ACCOUNT_NOT_FOUND");
        return rows.getFirst();
    }
    @Transactional(readOnly=true)
    public Detail detail(UUID actor,UUID id) {
        identities.platform(actor);var account=customer(id);
        var memberships=db.query("SELECT t.id,t.name,m.role,m.status,t.status FROM tenant_memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.account_id=? ORDER BY t.name,t.id",
            (r,n)->new Membership(r.getObject(1,UUID.class),r.getString(2),r.getString(3),r.getString(4),r.getString(5)),id);
        var records=db.query("SELECT c.*,a.display_name FROM platform_account_changes c JOIN accounts a ON a.id=c.actor_id WHERE c.account_id=? ORDER BY c.created_at DESC,c.id LIMIT 50",
            (r,n)->new Change(r.getObject("id",UUID.class),r.getString("display_name"),r.getString("previous_status"),r.getString("next_status"),r.getString("reason"),r.getTimestamp("created_at").toInstant()),id);
        return new Detail(account,memberships,records);
    }
    @Transactional
    public Detail status(UUID actor,UUID id,UUID request,long expectedVersion,String next,String suppliedReason) {
        identities.platform(actor);
        if(!List.of("ACTIVE","DISABLED").contains(next) || expectedVersion<0) throw IdentityException.invalid();
        String reason=IdentityService.name(suppliedReason,500),operation="CUSTOMER_ACCOUNT_STATUS";
        String fingerprint=IdentityService.hash(id+"\n"+expectedVersion+"\n"+next+"\n"+reason);
        UUID prior=identities.priorRequest(actor,request,operation,fingerprint);
        db.queryForList("SELECT id FROM accounts WHERE id=? FOR UPDATE",id);
        identities.platform(actor);var current=customer(id);
        if(prior!=null) return detail(actor,id);
        if(current.version()!=expectedVersion) throw new IdentityException(409,"STALE_MANAGEMENT_VERSION");
        if(!current.status().equals(next)) {
            db.update("UPDATE accounts SET status=?,management_version=management_version+1,credential_version=credential_version+1 WHERE id=?",next,id);
            db.update("DELETE FROM spring_session WHERE principal_name=?",id.toString());
            db.update("INSERT INTO platform_account_changes(id,actor_id,account_id,previous_status,next_status,reason) VALUES (?,?,?,?,?,?)",UUID.randomUUID(),actor,id,current.status(),next,reason);
            audit.record(actor,null,next.equals("DISABLED")?"CUSTOMER_ACCOUNT_DISABLE":"CUSTOMER_ACCOUNT_ENABLE",id,"SUCCESS");
        }
        identities.remember(actor,request,operation,fingerprint,id);
        return detail(actor,id);
    }
    @Transactional(readOnly=true)
    public List<Staff> staff(UUID actor) {
        identities.platform(actor);
        return db.query("SELECT a.id,a.display_name,p.login_name,p.management_version,a.status,EXISTS(SELECT 1 FROM platform_roles r WHERE r.account_id=a.id AND r.role='PLATFORM_ADMIN') AS administrator FROM platform_accounts p JOIN accounts a ON a.id=p.account_id ORDER BY p.created_at,a.id",
            (r,n)->new Staff(r.getObject(1,UUID.class),r.getString(2),r.getString(3),r.getString("status"),r.getBoolean("administrator"),r.getLong("management_version")));
    }
}
