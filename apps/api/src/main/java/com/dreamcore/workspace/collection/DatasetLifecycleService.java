package com.dreamcore.workspace.collection;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.MaterialAccess;
import com.dreamcore.workspace.governance.GovernanceAccess;
import com.dreamcore.workspace.departure.DepartureAccess;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DatasetLifecycleService {
    public record Item(UUID id,String name,String state,long revision,long snapshots,long rows,boolean canWithdraw,boolean canPurge) {}
    private final JdbcTemplate db; private final IdentityService identities; private final MaterialAccess access;
    private final GovernanceAccess governance; private final DepartureAccess departure; private final IdentityAudit audit;
    public DatasetLifecycleService(JdbcTemplate db,IdentityService identities,MaterialAccess access,GovernanceAccess governance,DepartureAccess departure,IdentityAudit audit) {
        this.db=db;this.identities=identities;this.access=access;this.governance=governance;this.departure=departure;this.audit=audit;
    }
    private Map<String,Object> source(UUID tenant,UUID id) {
        var rows=db.queryForList("SELECT * FROM business_datasets WHERE tenant_id=? AND id=?",tenant,id);
        if(rows.isEmpty())throw new IdentityException(404,"DATASET_NOT_FOUND");return rows.getFirst();
    }
    @Transactional public Item get(UUID actor,UUID tenant,UUID id) {
        var d=source(tenant,id);UUID space=(UUID)d.get("workspace_id");access.require(actor,tenant,space,false);
        boolean removed=(Boolean)d.get("scrubbed");
        return new Item(id,removed?"已清理的数据集":(String)d.get("name"),removed?"PURGED":(String)d.get("status"),((Number)d.get("lifecycle_revision")).longValue(),
            db.queryForObject("SELECT count(*) FROM dataset_snapshots WHERE dataset_id=?",Long.class,id),
            db.queryForObject("SELECT coalesce(sum(jsonb_array_length(data_rows)),0) FROM dataset_snapshots WHERE dataset_id=?",Long.class,id),
            !removed && d.get("status").equals("ACTIVE") && governance.allows(actor,tenant,GovernanceAccess.Capability.TENANT_CONFIG,null),
            !removed && d.get("status").equals("WITHDRAWN") && governance.allows(actor,tenant,GovernanceAccess.Capability.LIFECYCLE_PURGE,space));
    }
    @Transactional public List<Item> records(UUID actor,UUID tenant) {
        identities.member(actor,tenant,false);
        // Scope-filter before returning metadata; do not expose names from other spaces.
        return db.queryForList("SELECT d.id FROM business_datasets d JOIN workspace_members g ON g.tenant_id=d.tenant_id AND g.workspace_id=d.workspace_id AND g.account_id=headquarters_permission_actor(?,d.tenant_id) WHERE d.tenant_id=? AND d.status='WITHDRAWN' ORDER BY d.id LIMIT 100",UUID.class,actor,tenant).stream().map(id->get(actor,tenant,id)).toList();
    }
    @Transactional public Item act(UUID actor,UUID tenant,UUID id,UUID request,long expected,String action,boolean confirmed) {
        if(expected<0||!Set.of("WITHDRAW","PURGE").contains(action)||!confirmed)throw IdentityException.invalid();
        String fp=IdentityService.hash(tenant+"\n"+id+"\n"+expected+"\n"+action);
        UUID prior=identities.priorRequest(actor,request,"DATASET_LIFECYCLE",fp);
        db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",tenant);
        departure.requireActiveBusiness(actor,tenant);
        var d=source(tenant,id);UUID space=(UUID)d.get("workspace_id");access.require(actor,tenant,space,false);
        governance.require(actor,tenant,action.equals("PURGE")?GovernanceAccess.Capability.LIFECYCLE_PURGE:GovernanceAccess.Capability.TENANT_CONFIG,action.equals("PURGE")?space:null);
        if(prior!=null)return get(actor,tenant,id);
        db.queryForList("SELECT id FROM data_connections WHERE id=? FOR UPDATE",d.get("connection_id"));
        if(((Number)d.get("lifecycle_revision")).longValue()!=expected)throw new IdentityException(409,"DATASET_LIFECYCLE_CONFLICT");
        if((Boolean)d.get("scrubbed") || !d.get("status").equals(action.equals("WITHDRAW")?"ACTIVE":"WITHDRAWN"))throw new IdentityException(409,"DATASET_LIFECYCLE_CONFLICT");
        if(action.equals("WITHDRAW")) db.update("UPDATE business_datasets SET status='WITHDRAWN',lifecycle_revision=lifecycle_revision+1 WHERE id=?",id);
        else {
            // Existing triggers invalidate dependent tasks, derived bodies and export caches.
            db.update("UPDATE dataset_snapshots SET data_rows='[]',scrubbed=true WHERE dataset_id=? AND NOT scrubbed",id);
            db.update("UPDATE business_datasets SET scrubbed=true,name='内容已按退出期限清理',description='',dataset_key='removed-'||id::text,column_names='[\"已清理\"]',current_snapshot=NULL,lifecycle_revision=lifecycle_revision+1 WHERE id=?",id);
        }
        db.update("UPDATE data_connections SET revision=revision+1,auto_enabled=CASE WHEN EXISTS(SELECT 1 FROM business_datasets WHERE connection_id=? AND status='ACTIVE') THEN auto_enabled ELSE false END,next_due=CASE WHEN EXISTS(SELECT 1 FROM business_datasets WHERE connection_id=? AND status='ACTIVE') THEN next_due ELSE NULL END WHERE id=?",d.get("connection_id"),d.get("connection_id"),d.get("connection_id"));
        identities.remember(actor,request,"DATASET_LIFECYCLE",fp,id);audit.record(actor,tenant,"DATASET_"+action,id,"SUCCESS");return get(actor,tenant,id);
    }
}
