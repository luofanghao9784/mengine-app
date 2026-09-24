package com.dreamcore.workspace.material;

import com.dreamcore.workspace.identity.*;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class MaterialAccess {
    public record Space(UUID id, String name, String kind, boolean canMaintain) {}
    private final JdbcTemplate db; private final IdentityService identities;
    public MaterialAccess(JdbcTemplate db, IdentityService identities) { this.db=db; this.identities=identities; }
    /** Caller holds a transaction. Tenant SHARE lock serializes with permission/status mutations. */
    public Space require(UUID actor, UUID tenant, UUID workspace, boolean write) {
        return check(actor,tenant,workspace,write,true);
    }
    public Space check(UUID actor,UUID tenant,UUID workspace,boolean write,boolean lock) {
        identities.member(actor,tenant,false,lock);
        var rows=db.query("""
            SELECT w.id,w.name,w.kind,(w.kind='PERSONAL' OR coalesce(g.can_maintain,false)) AS can_maintain
            FROM workspaces w LEFT JOIN workspace_members g ON g.tenant_id=w.tenant_id AND g.workspace_id=w.id AND g.account_id=?
            WHERE w.tenant_id=? AND w.id=? AND ((w.kind='PERSONAL' AND w.owner_id=?) OR (w.kind='SHARED' AND g.account_id IS NOT NULL))
            """,(r,n)->new Space(r.getObject("id",UUID.class),r.getString("name"),r.getString("kind"),r.getBoolean("can_maintain")),actor,tenant,workspace,actor);
        if(rows.isEmpty()) throw new IdentityException(404,"MATERIAL_LOCATION_UNAVAILABLE");
        Space space=rows.getFirst();
        if(write && !space.canMaintain()) throw new IdentityException(403,"MATERIAL_READ_ONLY");
        return space;
    }
}
