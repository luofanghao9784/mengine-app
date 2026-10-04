package com.dreamcore.workspace.governance;

import com.dreamcore.workspace.identity.*;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import static com.dreamcore.workspace.governance.GovernanceAccess.Capability.*;

@Service
public class GovernanceService {
    public record Handover(UUID id, UUID fromAccount, UUID toAccount, String status, String fromName, String toName, String previousOwnerRole) {}
    public record Snapshot(UUID tenantId, UUID ownerId, String ownerName, long revision, boolean owner, boolean canConfigure,
                           boolean canAcceptInitialResponsibility,boolean canEnterManagement,List<GovernanceAccess.ScopeCapability> capabilities,Handover pendingHandover,Handover latestHandover) {}
    public record Role(UUID accountId,String role,long version) {}
    public record AssignedCapability(UUID accountId,UUID workspaceId,GovernanceAccess.Capability capability,UUID grantedBy,Instant createdAt) {}
    public record Recovery(UUID id,UUID tenantId,String reason,String status,Instant createdAt) {}
    private final JdbcTemplate db; private final IdentityService identities; private final IdentityAudit audit; private final GovernanceAccess access;
    private final com.dreamcore.workspace.departure.DepartureAccess departure;
 public GovernanceService(JdbcTemplate db,IdentityService identities,IdentityAudit audit,GovernanceAccess access,com.dreamcore.workspace.departure.DepartureAccess departure) {this.departure=departure;this.db=db;this.identities=identities;this.audit=audit;this.access=access;}
    private UUID mutation(UUID actor,UUID tenant,UUID key,String action,Object... args) {
        identities.member(actor,tenant,false,false);
        String hash=IdentityService.hash(new tools.jackson.databind.json.JsonMapper().writeValueAsString(Arrays.asList(tenant,args)));
        UUID prior=identities.priorRequest(actor,key,action,hash);
        db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",tenant);
        identities.member(actor,tenant,false);
        db.update("INSERT INTO tenant_governance(tenant_id) VALUES (?) ON CONFLICT DO NOTHING",tenant);
        return prior;
    }
    private void remember(UUID actor,UUID tenant,UUID key,String action,UUID target,Object... args) {
        String hash=IdentityService.hash(new tools.jackson.databind.json.JsonMapper().writeValueAsString(Arrays.asList(tenant,args)));
        identities.remember(actor,key,action,hash,target);audit.record(actor,tenant,action,target,"SUCCESS");
    }
    private void version(UUID tenant,long expected) {
        if(expected<0)throw IdentityException.invalid();
        if(db.queryForObject("SELECT revision FROM tenant_governance WHERE tenant_id=?",Long.class,tenant)!=expected)throw new IdentityException(409,"GOVERNANCE_VERSION_CONFLICT");
    }
    private void changed(UUID tenant){db.update("UPDATE tenant_governance SET revision=revision+1 WHERE tenant_id=?",tenant);}
    private void activeMember(UUID tenant,UUID account) {
        departure.requireMemberActivation(tenant,account);
        if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM tenant_memberships m JOIN accounts a ON a.id=m.account_id WHERE m.tenant_id=? AND m.account_id=? AND m.status='ACTIVE' AND a.status='ACTIVE')",Boolean.class,tenant,account)))throw new IdentityException(409,"MEMBER_INACTIVE");
    }
    private boolean designated(UUID actor,UUID tenant) {
        return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM governance_initial_designations d JOIN invitations i ON i.id=d.invitation_id AND i.tenant_id=d.tenant_id WHERE d.tenant_id=? AND i.status='ACCEPTED' AND i.accepted_by=?)",Boolean.class,tenant,actor));
    }
    @Transactional public Snapshot snapshot(UUID actor,UUID tenant) {
        identities.member(actor,tenant,false);
        var rows=db.queryForList("SELECT owner_id,revision FROM tenant_governance WHERE tenant_id=?",tenant);
        UUID owner=rows.isEmpty()?null:(UUID)rows.getFirst().get("owner_id");long revision=rows.isEmpty()?0:(Long)rows.getFirst().get("revision");
        var pending=db.query("SELECT h.id,h.from_account,h.to_account,h.status,f.display_name,t.display_name,h.previous_owner_role FROM governance_handovers h JOIN accounts f ON f.id=h.from_account JOIN accounts t ON t.id=h.to_account WHERE h.tenant_id=? AND h.status='PENDING' AND (h.from_account=? OR h.to_account=?)",(r,n)->new Handover(r.getObject(1,UUID.class),r.getObject(2,UUID.class),r.getObject(3,UUID.class),r.getString(4),r.getString(5),r.getString(6),r.getString(7)),tenant,actor,actor);
        var latest=db.query("SELECT h.id,h.from_account,h.to_account,h.status,f.display_name,t.display_name,h.previous_owner_role FROM governance_handovers h JOIN accounts f ON f.id=h.from_account JOIN accounts t ON t.id=h.to_account WHERE h.tenant_id=? AND h.status<>'PENDING' AND (h.from_account=? OR h.to_account=?) ORDER BY coalesce(h.closed_at,h.accepted_at,h.created_at) DESC,h.id DESC LIMIT 1",(r,n)->new Handover(r.getObject(1,UUID.class),r.getObject(2,UUID.class),r.getObject(3,UUID.class),r.getString(4),r.getString(5),r.getString(6),r.getString(7)),tenant,actor,actor);
        return new Snapshot(tenant,owner,owner==null?null:db.queryForObject("SELECT display_name FROM accounts WHERE id=?",String.class,owner),revision,actor.equals(owner),access.allows(actor,tenant,TENANT_CONFIG,null),owner==null&&designated(actor,tenant),access.allows(actor,tenant,TENANT_CONFIG,null)||!access.scopes(actor,tenant).isEmpty()||!pending.isEmpty()||Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM workspaces WHERE tenant_id=? AND owner_id=? AND responsibility_confirmed)",Boolean.class,tenant,actor)),access.scopes(actor,tenant),pending.isEmpty()?null:pending.getFirst(),latest.isEmpty()?null:latest.getFirst());
    }
    @Transactional public Snapshot acceptInitial(UUID actor,UUID tenant,UUID key,long expected) {
        UUID prior=mutation(actor,tenant,key,"OWNER_ACCEPT",expected);
        if(prior!=null)return snapshot(actor,tenant);
        version(tenant,expected);departure.requireActiveBusiness(actor,tenant);
        if(!designated(actor,tenant) || db.queryForObject("SELECT owner_id IS NOT NULL FROM tenant_governance WHERE tenant_id=?",Boolean.class,tenant))throw new IdentityException(403,"OWNER_DESIGNATION_REQUIRED");
        db.update("UPDATE tenant_governance SET owner_id=?,revision=revision+1 WHERE tenant_id=?",actor,tenant);
        remember(actor,tenant,key,"OWNER_ACCEPT",actor,expected);return snapshot(actor,tenant);
    }
    @Transactional public Role appoint(UUID actor,UUID tenant,UUID account,UUID key,long expected,String role) {
        if(!Set.of("TENANT_ADMIN","MEMBER").contains(role))throw IdentityException.invalid();
        UUID prior=mutation(actor,tenant,key,"GOVERNANCE_ROLE",account,expected,role);
        access.require(actor,tenant,OWNER,null);if(role.equals("TENANT_ADMIN"))activeMember(tenant,account);
        var targets=db.query("SELECT role,management_version FROM tenant_memberships WHERE tenant_id=? AND account_id=?",(r,n)->new Role(account,r.getString(1),r.getLong(2)),tenant,account);
        if(targets.isEmpty())throw new IdentityException(404,"MEMBER_NOT_FOUND");
        var current=targets.getFirst();
        if(prior!=null)return current;
        if(expected!=current.version())throw new IdentityException(409,"STALE_MANAGEMENT_VERSION");
        if(access.isOwner(account,tenant)&&!role.equals("TENANT_ADMIN"))throw new IdentityException(409,"OWNER_HANDOVER_REQUIRED");
        if(!role.equals(current.role())){db.update("UPDATE tenant_memberships SET role=?,management_version=management_version+1 WHERE tenant_id=? AND account_id=?",role,tenant,account);changed(tenant);}
        remember(actor,tenant,key,"GOVERNANCE_ROLE",account,account,expected,role);
        return db.queryForObject("SELECT role,management_version FROM tenant_memberships WHERE tenant_id=? AND account_id=?",(r,n)->new Role(account,r.getString(1),r.getLong(2)),tenant,account);
    }
    @Transactional public Snapshot capability(UUID actor,UUID tenant,UUID account,UUID workspace,GovernanceAccess.Capability capability,boolean enabled,UUID key,long expected) {
        if(capability==null || Set.of(OWNER,TENANT_CONFIG,CONTENT_MAINTAIN).contains(capability) || (workspace!=null && Set.of(MEMBER_OFFBOARD,TENANT_EXIT).contains(capability)))throw IdentityException.invalid();
        UUID prior=mutation(actor,tenant,key,"CAPABILITY_CHANGE",account,workspace,capability,enabled,expected);
        access.require(actor,tenant,OWNER,null);
        if(prior!=null)return snapshot(actor,tenant);
        version(tenant,expected);if(enabled)activeMember(tenant,account);
        if(workspace!=null && !Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM workspaces w JOIN workspace_members g ON g.tenant_id=w.tenant_id AND g.workspace_id=w.id WHERE w.tenant_id=? AND w.id=? AND w.kind='SHARED' AND g.account_id=?)",Boolean.class,tenant,workspace,account)))throw new IdentityException(404,"WORKSPACE_GRANT_NOT_FOUND");
        int count=enabled?db.update("INSERT INTO governance_capabilities(tenant_id,account_id,workspace_id,capability,granted_by) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING",tenant,account,workspace,capability.name(),actor):db.update("DELETE FROM governance_capabilities WHERE tenant_id=? AND account_id=? AND workspace_id IS NOT DISTINCT FROM ?::uuid AND capability=?",tenant,account,workspace,capability.name());
        if(count>0)changed(tenant);
        remember(actor,tenant,key,"CAPABILITY_CHANGE",workspace==null?tenant:workspace,account,workspace,capability,enabled,expected);return snapshot(actor,tenant);
    }
    @Transactional public List<AssignedCapability> assigned(UUID actor,UUID tenant,UUID account) {
        access.require(actor,tenant,OWNER,null);
        return db.query("SELECT * FROM governance_capabilities WHERE tenant_id=? AND account_id=? ORDER BY workspace_id NULLS FIRST,capability",(r,n)->new AssignedCapability(account,r.getObject("workspace_id",UUID.class),GovernanceAccess.Capability.valueOf(r.getString("capability")),r.getObject("granted_by",UUID.class),r.getTimestamp("created_at").toInstant()),tenant,account);
    }
    @Transactional public Snapshot offer(UUID actor,UUID tenant,UUID account,UUID key,long expected) {
        return offer(actor,tenant,account,key,expected,"TENANT_ADMIN");
    }
    @Transactional public Snapshot offer(UUID actor,UUID tenant,UUID account,UUID key,long expected,String previousOwnerRole) {
        if(previousOwnerRole==null || !Set.of("TENANT_ADMIN","MEMBER").contains(previousOwnerRole))throw IdentityException.invalid();
        Object[] args=previousOwnerRole.equals("TENANT_ADMIN")?new Object[]{account,expected}:new Object[]{account,expected,previousOwnerRole};
        UUID prior=mutation(actor,tenant,key,"OWNER_HANDOVER_OFFER",args);
        access.require(actor,tenant,OWNER,null);if(prior!=null)return snapshot(actor,tenant);
        version(tenant,expected);activeMember(tenant,account);if(actor.equals(account))throw IdentityException.invalid();
        if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM governance_handovers WHERE tenant_id=? AND status='PENDING')",Boolean.class,tenant)))throw new IdentityException(409,"HANDOVER_ALREADY_PENDING");
        UUID id=UUID.randomUUID();db.update("INSERT INTO governance_handovers(id,tenant_id,from_account,to_account,status,previous_owner_role) VALUES (?,?,?,?,'PENDING',?)",id,tenant,actor,account,previousOwnerRole);changed(tenant);
        remember(actor,tenant,key,"OWNER_HANDOVER_OFFER",id,args);return snapshot(actor,tenant);
    }
    @Transactional public Snapshot closeHandover(UUID actor,UUID tenant,UUID id,UUID key,long expected,boolean reject) {
        String action=reject?"OWNER_HANDOVER_REJECT":"OWNER_HANDOVER_CANCEL";
        UUID prior=mutation(actor,tenant,key,action,id,expected);
        var rows=db.queryForList("SELECT * FROM governance_handovers WHERE tenant_id=? AND id=? AND "+(reject?"to_account":"from_account")+"=?",tenant,id,actor);
        if(rows.isEmpty())throw new IdentityException(404,"HANDOVER_NOT_FOUND");
        if(prior!=null)return snapshot(actor,tenant);
        version(tenant,expected);
        if(!"PENDING".equals(rows.getFirst().get("status")))throw new IdentityException(409,"HANDOVER_UNAVAILABLE");
        if(!reject)access.require(actor,tenant,OWNER,null);
        db.update("UPDATE governance_handovers SET status=?,closed_at=now(),closed_by=? WHERE id=?",reject?"REJECTED":"CANCELLED",actor,id);changed(tenant);
        remember(actor,tenant,key,action,id,id,expected);return snapshot(actor,tenant);
    }
    @Transactional public Snapshot acceptHandover(UUID actor,UUID tenant,UUID id,UUID key,long expected) {
        UUID prior=mutation(actor,tenant,key,"OWNER_HANDOVER_ACCEPT",id,expected);
        var rows=db.queryForList("SELECT * FROM governance_handovers WHERE tenant_id=? AND id=? AND to_account=?",tenant,id,actor);
        if(rows.isEmpty())throw new IdentityException(404,"HANDOVER_NOT_FOUND");if(prior!=null)return snapshot(actor,tenant);
        var h=rows.getFirst();version(tenant,expected);departure.requireActiveBusiness(actor,tenant);activeMember(tenant,(UUID)h.get("from_account"));
        if(!"PENDING".equals(h.get("status")) || !access.isOwner((UUID)h.get("from_account"),tenant))throw new IdentityException(409,"HANDOVER_UNAVAILABLE");
        db.update("UPDATE tenant_governance SET owner_id=?,revision=revision+1 WHERE tenant_id=?",actor,tenant);
        db.update("UPDATE tenant_memberships SET role='TENANT_ADMIN',management_version=management_version+1 WHERE tenant_id=? AND account_id=? AND role<>'TENANT_ADMIN'",tenant,actor);
        db.update("UPDATE tenant_memberships SET role=?,management_version=management_version+1 WHERE tenant_id=? AND account_id=? AND role<>?",h.get("previous_owner_role"),tenant,h.get("from_account"),h.get("previous_owner_role"));
        db.update("UPDATE governance_handovers SET status='ACCEPTED',accepted_at=now(),closed_at=now(),closed_by=? WHERE id=?",actor,id);
        remember(actor,tenant,key,"OWNER_HANDOVER_ACCEPT",id,id,expected);return snapshot(actor,tenant);
    }
    @Transactional public Recovery recovery(UUID actor,UUID tenant,UUID key,String reason) {
        if(!Set.of("OWNER_UNAVAILABLE","LEGACY_OWNER_UNVERIFIED").contains(reason))throw IdentityException.invalid();
        UUID prior=mutation(actor,tenant,key,"OWNER_RECOVERY_REQUEST",reason);
        UUID id=prior==null?UUID.randomUUID():prior;
        if(prior==null){db.update("INSERT INTO governance_recovery_requests(id,tenant_id,requested_by,reason) VALUES (?,?,?,?)",id,tenant,actor,reason);remember(actor,tenant,key,"OWNER_RECOVERY_REQUEST",id,reason);}
        return recoveryRecord(actor,tenant,id);
    }
    @Transactional public Recovery recoveryRecord(UUID actor,UUID tenant,UUID id) {
        identities.member(actor,tenant,false);
        var rows=db.query("SELECT * FROM governance_recovery_requests WHERE id=? AND tenant_id=? AND requested_by=?",(r,n)->new Recovery(r.getObject("id",UUID.class),tenant,r.getString("reason"),r.getString("status"),r.getTimestamp("created_at").toInstant()),id,tenant,actor);
        if(rows.isEmpty())throw new IdentityException(404,"RECOVERY_NOT_FOUND");return rows.getFirst();
    }
    /** Technical support intake only: this does not verify evidence or grant any customer capability. */
    @Transactional public Recovery platformRecovery(UUID actor,UUID tenant,UUID key,String reason) {
        identities.platform(actor);
        if(!Set.of("OWNER_UNAVAILABLE","LEGACY_OWNER_UNVERIFIED").contains(reason))throw IdentityException.invalid();
        String hash=IdentityService.hash(tenant+"\n"+reason);UUID prior=identities.priorRequest(actor,key,"PLATFORM_OWNER_RECOVERY",hash);
        if(db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",UUID.class,tenant).isEmpty())throw new IdentityException(404,"TENANT_NOT_FOUND");
        identities.platform(actor);UUID id=prior==null?UUID.randomUUID():prior;
        if(prior==null){db.update("INSERT INTO governance_recovery_requests(id,tenant_id,requested_by,reason) VALUES (?,?,?,?)",id,tenant,actor,reason);identities.remember(actor,key,"PLATFORM_OWNER_RECOVERY",hash,id);audit.record(actor,tenant,"PLATFORM_OWNER_RECOVERY",id,"SUCCESS");}
        return platformRecoveryRecord(actor,tenant,id);
    }
    @Transactional public Recovery platformRecoveryRecord(UUID actor,UUID tenant,UUID id) {
        identities.platform(actor);
        var rows=db.query("SELECT * FROM governance_recovery_requests WHERE id=? AND tenant_id=?",(r,n)->new Recovery(r.getObject("id",UUID.class),tenant,r.getString("reason"),r.getString("status"),r.getTimestamp("created_at").toInstant()),id,tenant);
        if(rows.isEmpty())throw new IdentityException(404,"RECOVERY_NOT_FOUND");return rows.getFirst();
    }
}
