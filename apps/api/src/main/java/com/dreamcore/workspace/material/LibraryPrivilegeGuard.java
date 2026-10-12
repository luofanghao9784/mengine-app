package com.dreamcore.workspace.material;

import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;

/** Caller holds the tenant mutation lock. Check every existing object, including derived dependants. */
public final class LibraryPrivilegeGuard {
    private LibraryPrivilegeGuard() {}
    public static final String OBJECTS="SELECT 'WORKSPACE' kind,id,tenant_id,id workspace_id,name FROM workspaces WHERE kind='SHARED' UNION ALL SELECT 'FOLDER',id,tenant_id,workspace_id,name FROM material_folders UNION ALL SELECT 'MATERIAL',id,tenant_id,workspace_id,name FROM materials";
    public static Map<String,Integer> snapshot(JdbcTemplate db,UUID actor,UUID tenant){
        if(!Boolean.TRUE.equals(db.queryForObject("SELECT library_permissions_enabled(?)",Boolean.class,tenant)))return Map.of();
        var result=new TreeMap<String,Integer>();
        db.query("SELECT o.kind,o.id,library_mask(?,o.tenant_id,o.kind,o.id) mask FROM ("+OBJECTS+") o WHERE o.tenant_id=?",(org.springframework.jdbc.core.RowCallbackHandler)r->result.put(r.getString("kind")+":"+r.getString("id"),r.getInt("mask")),actor,tenant);
        return result;
    }
    public static void verify(JdbcTemplate db,UUID actor,UUID tenant,Map<String,Integer> before){
        if(before.isEmpty())return;
        var after=snapshot(db,actor,tenant);
        for(var value:before.entrySet())if((after.getOrDefault(value.getKey(),0)&~value.getValue())!=0)throw new IdentityException(403,"LIBRARY_SELF_GRANT_REQUIRES_REVIEW");
    }
}
