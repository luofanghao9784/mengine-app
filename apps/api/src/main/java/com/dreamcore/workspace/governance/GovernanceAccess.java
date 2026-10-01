package com.dreamcore.workspace.governance;

import com.dreamcore.workspace.identity.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Shared action checks. Caller transactions keep authorization and writes under the same tenant lock. */
@Service
public class GovernanceAccess {
    public enum Capability { OWNER, TENANT_CONFIG, PROFILE_MAINTAIN, CONTENT_MAINTAIN, EXPERIENCE_MAINTAIN, EVALUATION_MAINTAIN, LIFECYCLE_PURGE, BULK_EXPORT, METHOD_ADOPT, PLAN_CONFIGURE, MEMBER_OFFBOARD, TENANT_EXIT }
    public record ScopeCapability(UUID workspaceId, Capability capability) {}
    private final JdbcTemplate db;
    private final IdentityService identities;
    public GovernanceAccess(JdbcTemplate db, IdentityService identities) { this.db=db; this.identities=identities; }

    boolean isOwner(UUID actor, UUID tenant) {
        return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM tenant_governance WHERE tenant_id=? AND owner_id=?)",Boolean.class,tenant,actor));
    }
    public boolean allows(UUID actor, UUID tenant, Capability capability, UUID workspace) {
        String role=identities.member(actor,tenant,false);
        if(capability==Capability.OWNER) return workspace==null && isOwner(actor,tenant);
        if(capability==Capability.TENANT_CONFIG) return workspace==null && (isOwner(actor,tenant) || role.equals("TENANT_ADMIN"));
        if(workspace==null) return (capability==Capability.PROFILE_MAINTAIN && (isOwner(actor,tenant) || role.equals("TENANT_ADMIN"))) || explicit(actor,tenant,capability,null);
        var spaces=db.queryForList("""
            SELECT w.kind,w.owner_id,g.account_id,g.can_maintain FROM workspaces w
            LEFT JOIN workspace_members g ON g.tenant_id=w.tenant_id AND g.workspace_id=w.id AND g.account_id=?
            WHERE w.tenant_id=? AND w.id=?
            """,actor,tenant,workspace);
        if(spaces.isEmpty())return false;
        var s=spaces.getFirst();
        if("PERSONAL".equals(s.get("kind"))) return actor.equals(s.get("owner_id")) && Set.of(Capability.CONTENT_MAINTAIN,Capability.PROFILE_MAINTAIN).contains(capability);
        if(s.get("account_id")==null)return false; // An action grant never creates content visibility.
        if(capability==Capability.CONTENT_MAINTAIN)return Boolean.TRUE.equals(s.get("can_maintain"));
        return explicit(actor,tenant,capability,workspace);
    }
    private boolean explicit(UUID actor,UUID tenant,Capability capability,UUID workspace) {
        return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM governance_capabilities WHERE tenant_id=? AND account_id=? AND workspace_id IS NOT DISTINCT FROM ?::uuid AND capability=?)",Boolean.class,tenant,actor,workspace,capability.name()));
    }
    public void require(UUID actor,UUID tenant,Capability capability,UUID workspace) {
        if(!allows(actor,tenant,capability,workspace))throw new IdentityException(403,"CAPABILITY_REQUIRED");
    }
    public List<ScopeCapability> scopes(UUID actor,UUID tenant) {
        identities.member(actor,tenant,false);
        var result=new ArrayList<>(db.query("SELECT workspace_id,capability FROM governance_capabilities WHERE tenant_id=? AND account_id=? ORDER BY workspace_id,capability",(r,n)->new ScopeCapability(r.getObject(1,UUID.class),Capability.valueOf(r.getString(2))),tenant,actor));
        db.queryForList("SELECT workspace_id FROM workspace_members WHERE tenant_id=? AND account_id=? AND can_maintain",UUID.class,tenant,actor).forEach(w->result.add(new ScopeCapability(w,Capability.CONTENT_MAINTAIN)));
        return List.copyOf(result);
    }
    /** Existing admin routes must not provide a reciprocal-grant bypass for management identities. */
    public void contentGrant(UUID actor,UUID tenant,UUID target,boolean enabled) {
        identities.member(actor,tenant,true);
        if(!enabled)return;
        if(isOwner(actor,tenant))return;
        if(actor.equals(target))throw new IdentityException(403,"SELF_GRANT_NOT_ENABLED");
        var roles=db.queryForList("SELECT role FROM tenant_memberships WHERE tenant_id=? AND account_id=?",String.class,tenant,target);
        if(isOwner(target,tenant) || roles.contains("TENANT_ADMIN"))throw new IdentityException(403,"OWNER_REQUIRED_FOR_ADMIN_GRANT");
    }
    public void protectOwner(UUID tenant,UUID account,String status) {
        if(!"ACTIVE".equals(status) && isOwner(account,tenant))throw new IdentityException(409,"OWNER_HANDOVER_REQUIRED");
    }
}
