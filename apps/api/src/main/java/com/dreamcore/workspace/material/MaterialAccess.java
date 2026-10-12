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
        return checkObject(actor,tenant,workspace,"WORKSPACE",workspace,write,lock);
    }
    public Space requireObject(UUID actor,UUID tenant,UUID workspace,String kind,UUID id,boolean write) {
        return checkObject(actor,tenant,workspace,kind,id,write,true);
    }
    public Space checkObject(UUID actor,UUID tenant,UUID workspace,String kind,UUID id,boolean write,boolean lock) {
        identities.member(actor,tenant,false,lock);
        if(write) departure.requireActiveBusiness(actor,tenant);
        String table=switch(kind){case "WORKSPACE"->"workspaces";case "FOLDER"->"active_material_folders";case "MATERIAL"->"active_materials";default->throw IdentityException.invalid();};
        String scope=kind.equals("WORKSPACE")?"id":"workspace_id";
        if(db.queryForList("SELECT id FROM "+table+" WHERE tenant_id=? AND "+scope+"=? AND id=?",tenant,workspace,id).isEmpty())throw new IdentityException(404,"MATERIAL_NOT_FOUND");
        int mask=db.queryForObject("SELECT library_mask(?,?,?,?)",Integer.class,actor,tenant,kind,id);
        if((mask&1)==0)throw new IdentityException(404,"MATERIAL_NOT_FOUND");
        if(write&&(mask&2)==0)throw new IdentityException(403,"MATERIAL_READ_ONLY");
        return db.queryForObject("SELECT id,name,kind FROM workspaces WHERE tenant_id=? AND id=?",(r,n)->new Space(workspace,r.getString("name"),r.getString("kind"),(mask&2)!=0&&!departure.exiting(tenant)),tenant,workspace);
    }
    public int mask(UUID actor,UUID tenant,String kind,UUID id){return db.queryForObject("SELECT library_mask(?,?,?,?)",Integer.class,actor,tenant,kind,id);}
    public boolean manages(UUID actor,UUID tenant,UUID space){return Boolean.TRUE.equals(db.queryForObject("SELECT library_can_manage(?,?,?)",Boolean.class,actor,tenant,space));}
    public void requireDownload(UUID actor,UUID tenant,UUID workspace,UUID material){
        requireObject(actor,tenant,workspace,"MATERIAL",material,false);
        if((mask(actor,tenant,"MATERIAL",material)&4)==0)throw new IdentityException(403,"LIBRARY_DOWNLOAD_DENIED");
    }
    public void requireManageFiles(UUID actor,UUID tenant,UUID workspace,String kind,UUID id){
        identities.member(actor,tenant,false);departure.requireActiveBusiness(actor,tenant);
        int m=mask(actor,tenant,kind,id);
        if((m&1)==0||((m&8)==0&&!manages(actor,tenant,workspace)))throw new IdentityException(403,"LIBRARY_MANAGE_FILES_REQUIRED");
    }
    /** Caller also checks current actor/space permission in the same transaction. */
    public void requireVersionActive(UUID tenant,UUID workspace,UUID version) {
        if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM material_versions v JOIN active_materials m ON m.id=v.material_id WHERE v.tenant_id=? AND v.workspace_id=? AND v.id=?)",Boolean.class,tenant,workspace,version)))throw new IdentityException(404,"MATERIAL_NOT_FOUND");
    }
    public void requireMaterialActive(UUID tenant,UUID workspace,UUID material) {
        if(db.queryForList("SELECT id FROM active_materials WHERE tenant_id=? AND workspace_id=? AND id=?",tenant,workspace,material).isEmpty())throw new IdentityException(404,"MATERIAL_NOT_FOUND");
    }
}
