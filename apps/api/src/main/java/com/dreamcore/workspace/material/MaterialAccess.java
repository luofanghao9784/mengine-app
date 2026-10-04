package com.dreamcore.workspace.material;

import com.dreamcore.workspace.identity.*;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class MaterialAccess {
    public record Space(UUID id, String name, String kind, boolean canMaintain) {}
    private final JdbcTemplate db; private final IdentityService identities;
    private final com.dreamcore.workspace.departure.DepartureAccess departure;
    public MaterialAccess(JdbcTemplate db, IdentityService identities,com.dreamcore.workspace.departure.DepartureAccess departure) {this.departure=departure; this.db=db; this.identities=identities; }
    /** Caller holds a transaction. Tenant SHARE lock serializes with permission/status mutations. */
    public Space require(UUID actor, UUID tenant, UUID workspace, boolean write) {
        return check(actor,tenant,workspace,write,true);
    }
    public Space check(UUID actor,UUID tenant,UUID workspace,boolean write,boolean lock) {
        identities.member(actor,tenant,false,lock);
        if(write) departure.requireActiveBusiness(actor,tenant);
        UUID permission=identities.permissionActor(actor,tenant);
        departure.requireContentRead(permission,tenant,workspace);
        var rows=db.query("""
            SELECT w.id,w.name,w.kind,(w.kind='PERSONAL' OR coalesce(g.can_maintain,false)) AS can_maintain
            FROM workspaces w LEFT JOIN workspace_members g ON g.tenant_id=w.tenant_id AND g.workspace_id=w.id AND g.account_id=?
            WHERE w.tenant_id=? AND w.id=? AND ((w.kind='PERSONAL' AND w.owner_id=?) OR (w.kind='SHARED' AND g.account_id IS NOT NULL))
            """,(r,n)->new Space(r.getObject("id",UUID.class),r.getString("name"),r.getString("kind"),r.getBoolean("can_maintain")),permission,tenant,workspace,permission);
        if(rows.isEmpty()) throw new IdentityException(404,"MATERIAL_LOCATION_UNAVAILABLE");
        Space space=rows.getFirst();
        if(write && !space.canMaintain()) throw new IdentityException(403,"MATERIAL_READ_ONLY");
        return departure.exiting(tenant)?new Space(space.id(),space.name(),space.kind(),false):space;
    }
    /** Caller also checks current actor/space permission in the same transaction. */
    public void requireVersionActive(UUID tenant,UUID workspace,UUID version) {
        if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM material_versions v JOIN active_materials m ON m.id=v.material_id WHERE v.tenant_id=? AND v.workspace_id=? AND v.id=?)",Boolean.class,tenant,workspace,version)))throw new IdentityException(404,"MATERIAL_NOT_FOUND");
    }
    public void requireMaterialActive(UUID tenant,UUID workspace,UUID material) {
        if(db.queryForList("SELECT id FROM active_materials WHERE tenant_id=? AND workspace_id=? AND id=?",tenant,workspace,material).isEmpty())throw new IdentityException(404,"MATERIAL_NOT_FOUND");
    }
}
