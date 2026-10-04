package com.dreamcore.workspace.lifecycle;

import com.dreamcore.workspace.governance.GovernanceAccess;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.*;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Material lifecycle is platform state. Model output and UI visibility cannot override it. */
@Service
public class MaterialLifecycleService {
    public record Item(UUID id,String kind,String name,String state,int revision,Instant trashedAt,Instant purgeAfter,UUID cleanupJobId,boolean canPurge,List<String> path,boolean parentAvailable) {}
    public record Page(List<Item> items,boolean hasMore) {}
    public record Preview(Item item,long documents,long versions,long folders,String restoration) {}
    public record Receipt(UUID objectId,String kind,String action,String resultingState,int revision,Instant occurredAt,Instant purgeAfter,UUID cleanupJobId) {}
    public record Cleanup(UUID id,String state,int revision,int attempts,String errorCode,long originals,long originalsRemoved,Instant completedAt,String backupState) {}
    private final com.dreamcore.workspace.conversation.ConversationService conversations;
    private final JdbcTemplate db;private final MaterialAccess access;private final IdentityService identities;private final GovernanceAccess governance;private final IdentityAudit audit;
    private final com.dreamcore.workspace.retention.RetentionService retention;
    private final JsonMapper json=new JsonMapper();
    public MaterialLifecycleService(com.dreamcore.workspace.conversation.ConversationService conversations,JdbcTemplate db,MaterialAccess access,IdentityService identities,GovernanceAccess governance,IdentityAudit audit,com.dreamcore.workspace.retention.RetentionService retention){this.retention=retention;this.conversations=conversations;this.db=db;this.access=access;this.identities=identities;this.governance=governance;this.audit=audit;}
    private IdentityException missing(){return new IdentityException(404,"LIFECYCLE_NOT_FOUND");}
    private String table(String kind){return switch(kind){case "MATERIAL"->"materials";case "FOLDER"->"material_folders";default->throw IdentityException.invalid();};}
    private Instant time(Map<String,Object> r,String key){return r.get(key)==null?null:((java.sql.Timestamp)r.get(key)).toInstant();}
    private boolean canPurge(UUID actor,UUID tenant,UUID space){var permission=access.require(actor,tenant,space,true);return permission.kind().equals("PERSONAL") || governance.allows(actor,tenant,GovernanceAccess.Capability.LIFECYCLE_PURGE,space);}
    private Map<String,Object> object(UUID tenant,UUID space,String kind,UUID id){var rows=db.queryForList("SELECT * FROM "+table(kind)+" WHERE tenant_id=? AND workspace_id=? AND id=?",tenant,space,id);if(rows.isEmpty())throw missing();return rows.getFirst();}
    private Item item(UUID actor,UUID tenant,UUID space,String kind,UUID id){
        var original=object(tenant,space,kind,id);var states=db.queryForList("SELECT * FROM content_lifecycle WHERE object_kind=? AND object_id=?",kind,id);
        boolean purge=canPurge(actor,tenant,space);
        UUID parent=(UUID)original.get(kind.equals("MATERIAL")?"folder_id":"parent_id");
        var path=originalPath(tenant,space,parent);
        boolean parentAvailable=parent==null || !db.queryForList("SELECT id FROM active_material_folders WHERE tenant_id=? AND workspace_id=? AND id=?",tenant,space,parent).isEmpty();
        if(states.isEmpty())return new Item(id,kind,(String)original.get("name"),"ACTIVE",0,null,null,null,purge,path,parentAvailable);
        var l=states.getFirst();return new Item(id,kind,(String)original.get("name"),(String)l.get("state"),(Integer)l.get("revision"),time(l,"trashed_at"),time(l,"purge_after"),(UUID)l.get("purge_job_id"),purge,path,parentAvailable);
    }
    private void ancestorActive(UUID tenant,UUID space,String kind,UUID id){
        var obj=object(tenant,space,kind,id);UUID parent=(UUID)obj.get(kind.equals("MATERIAL")?"folder_id":"parent_id");
        if(parent!=null && db.queryForList("SELECT id FROM active_material_folders WHERE tenant_id=? AND workspace_id=? AND id=?",tenant,space,parent).isEmpty())throw new IdentityException(409,"LIFECYCLE_PARENT_UNAVAILABLE");
    }
    private List<UUID> folders(UUID tenant,UUID space,UUID id){return db.queryForList("WITH RECURSIVE tree AS (SELECT id FROM material_folders WHERE tenant_id=? AND workspace_id=? AND id=? UNION ALL SELECT f.id FROM material_folders f JOIN tree t ON f.parent_id=t.id) SELECT id FROM tree",UUID.class,tenant,space,id);}
    private List<UUID> materials(UUID tenant,UUID space,String kind,UUID id){if(kind.equals("MATERIAL"))return List.of(id);return db.queryForList("WITH RECURSIVE tree AS (SELECT id FROM material_folders WHERE tenant_id=? AND workspace_id=? AND id=? UNION ALL SELECT f.id FROM material_folders f JOIN tree t ON f.parent_id=t.id) SELECT m.id FROM materials m JOIN tree t ON m.folder_id=t.id",UUID.class,tenant,space,id);}
    @Transactional public Preview preview(UUID actor,UUID tenant,UUID space,String kind,UUID id){
        access.require(actor,tenant,space,true);var item=item(actor,tenant,space,kind,id);var docs=materials(tenant,space,kind,id);long count=0;for(UUID material:docs)count+=db.queryForObject("SELECT count(*) FROM material_versions WHERE material_id=?",Long.class,material);
        return new Preview(item,docs.size(),count,kind.equals("FOLDER")?folders(tenant,space,id).size():0,"CURRENT_PERMISSIONS_NO_TASK_RESTART");
    }
    // Only names and original directory metadata are exposed; deleted bodies stay unreadable.
    private List<String> originalPath(UUID tenant,UUID space,UUID parent){
        var path=new ArrayList<String>();
        path.add(db.queryForObject("SELECT name FROM workspaces WHERE tenant_id=? AND id=?",String.class,tenant,space));
        if(parent!=null)path.addAll(db.queryForList("""
            WITH RECURSIVE trail AS (
              SELECT id,parent_id,name,0 AS depth FROM material_folders WHERE tenant_id=? AND workspace_id=? AND id=?
              UNION ALL SELECT f.id,f.parent_id,f.name,t.depth+1 FROM material_folders f JOIN trail t ON t.parent_id=f.id
                WHERE f.tenant_id=? AND f.workspace_id=? AND t.depth<128
            ) SELECT name FROM trail ORDER BY depth DESC
            """,String.class,tenant,space,parent,tenant,space));
        return List.copyOf(path);
    }
    @Transactional public Page list(UUID actor,UUID tenant,UUID space,int offset,int limit){
        return list(actor,tenant,space,offset,limit,"ALL","");
    }
    @Transactional public Page list(UUID actor,UUID tenant,UUID space,int offset,int limit,String view,String query){
        if(offset<0 || offset>100000 || limit<1 || limit>50 || view==null || !Set.of("ALL","TRASH","RECORDS").contains(view) || query==null || query.length()>180)throw IdentityException.invalid();
        access.require(actor,tenant,space,true);
        String filter=switch(view){case "TRASH"->"l.state='TRASHED' AND l.purge_after>now()";case "RECORDS"->"(l.state IN ('PURGING','PURGED') OR (l.state='TRASHED' AND l.purge_after<=now()))";default->"l.state<>'ACTIVE'";};
        var rows=db.queryForList("""
            SELECT l.object_kind,l.object_id FROM content_lifecycle l
            LEFT JOIN materials m ON l.object_kind='MATERIAL' AND m.id=l.object_id AND m.tenant_id=l.tenant_id AND m.workspace_id=l.workspace_id
            LEFT JOIN material_folders f ON l.object_kind='FOLDER' AND f.id=l.object_id AND f.tenant_id=l.tenant_id AND f.workspace_id=l.workspace_id
            WHERE l.tenant_id=? AND l.workspace_id=? AND
            """+filter+" AND strpos(lower(coalesce(m.name,f.name,'')),lower(?))>0 ORDER BY l.changed_at DESC,l.object_kind,l.object_id LIMIT ? OFFSET ?",tenant,space,query.trim(),limit+1,offset);
        return new Page(rows.stream().limit(limit).map(r->item(actor,tenant,space,(String)r.get("object_kind"),(UUID)r.get("object_id"))).toList(),rows.size()>limit);
    }
    @Transactional public Receipt act(UUID actor,UUID tenant,UUID space,String kind,UUID id,UUID key,int revision,String action){
        table(kind);if(!Set.of("TRASH","RESTORE","PURGE","RETRY_CLEANUP").contains(action) || revision<0)throw IdentityException.invalid();
        String fingerprint=IdentityService.hash(json.writeValueAsString(new Object[]{tenant,space,kind,id,revision,action}));
        UUID prior=identities.priorRequest(actor,key,"MATERIAL_LIFECYCLE",fingerprint);
        // Upgrade before taking any SHARE lock: this serializes with uploads, reads and late parser/task writes.
        access.check(actor,tenant,space,true,false);db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",tenant);access.require(actor,tenant,space,true);
        var before=item(actor,tenant,space,kind,id);if((action.equals("PURGE") || action.equals("RETRY_CLEANUP")) && !before.canPurge())throw new IdentityException(403,"CAPABILITY_REQUIRED");
        if(prior!=null)return json.readValue(db.queryForObject("SELECT receipt::text FROM content_lifecycle_receipts WHERE actor_id=? AND request_id=?",String.class,actor,key),Receipt.class);
        if(before.revision()!=revision)throw new IdentityException(409,"LIFECYCLE_REVISION_CONFLICT");
        Instant now=db.queryForObject("SELECT now()",(r,n)->r.getTimestamp(1).toInstant());UUID job=null;String state;
        if(action.equals("TRASH")){
            if(!before.state().equals("ACTIVE"))throw new IdentityException(409,"LIFECYCLE_STATE_CONFLICT");ancestorActive(tenant,space,kind,id);
            var deadline=retention.resolveDeadline(tenant,"TRASH",now);
            db.update("INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state,changed_by,trashed_at,purge_after,retention_policy_revision) VALUES (?,?,?,?,'TRASHED',?,?,?,?) ON CONFLICT(object_kind,object_id) DO UPDATE SET state='TRASHED',revision=content_lifecycle.revision+1,changed_by=EXCLUDED.changed_by,changed_at=now(),trashed_at=EXCLUDED.trashed_at,purge_after=EXCLUDED.purge_after,retention_policy_revision=EXCLUDED.retention_policy_revision,purge_job_id=NULL",tenant,space,kind,id,actor,java.sql.Timestamp.from(deadline.anchor()),java.sql.Timestamp.from(deadline.dueAt()),deadline.policyRevision());
            invalidate(materials(tenant,space,kind,id));state="TRASHED";
        }else if(action.equals("RESTORE")){
            if(!before.state().equals("TRASHED") || !now.isBefore(before.purgeAfter()))throw new IdentityException(409,"LIFECYCLE_NOT_RESTORABLE");ancestorActive(tenant,space,kind,id);
            db.update("UPDATE content_lifecycle SET state='ACTIVE',revision=revision+1,changed_by=?,changed_at=now(),trashed_at=NULL,purge_after=NULL WHERE object_kind=? AND object_id=?",actor,kind,id);state="ACTIVE";
        }else if(action.equals("PURGE")){
            if(!before.state().equals("TRASHED"))throw new IdentityException(409,"LIFECYCLE_STATE_CONFLICT");job=enqueue(tenant,space,kind,id,actor);state="PURGING";
        }else{
            if(!before.state().equals("PURGING") || before.cleanupJobId()==null)throw new IdentityException(409,"LIFECYCLE_STATE_CONFLICT");
            job=before.cleanupJobId();if(db.update("UPDATE content_cleanup_jobs SET state='QUEUED',revision=revision+1,error_code=NULL WHERE id=? AND state='FAILED'",job)!=1)throw new IdentityException(409,"LIFECYCLE_STATE_CONFLICT");
            db.update("UPDATE content_lifecycle SET revision=revision+1,changed_by=?,changed_at=now() WHERE object_kind=? AND object_id=?",actor,kind,id);state="PURGING";
        }
        var after=item(actor,tenant,space,kind,id);var receipt=new Receipt(id,kind,action,state,after.revision(),now,after.purgeAfter(),job);
        identities.remember(actor,key,"MATERIAL_LIFECYCLE",fingerprint,id);db.update("INSERT INTO content_lifecycle_receipts(actor_id,request_id,receipt) VALUES (?,?,CAST(? AS jsonb))",actor,key,json.writeValueAsString(receipt));audit.record(actor,tenant,"MATERIAL_"+action,id,"SUCCESS");return receipt;
    }
    private void invalidate(List<UUID> docs){
        if(!docs.isEmpty()){UUID tenant=db.queryForObject("SELECT tenant_id FROM materials WHERE id=?",UUID.class,docs.getFirst());conversations.invalidateMaterials(tenant,docs);}
        for(UUID id:docs)db.update("UPDATE knowledge_runs SET status='CANCELLED',warnings='SOURCE_REMOVED',lease_token=NULL,lease_until=NULL,finished_at=now() WHERE material_id=? AND status IN ('QUEUED','RUNNING')",id);
    }
    UUID enqueue(UUID tenant,UUID space,String kind,UUID id,UUID actor){
        var docs=materials(tenant,space,kind,id);var fs=kind.equals("FOLDER")?folders(tenant,space,id):List.<UUID>of();
        for(UUID d:docs)if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM content_lifecycle WHERE object_kind='MATERIAL' AND object_id=? AND state='PURGING')",Boolean.class,d)))throw new IdentityException(409,"LIFECYCLE_CLEANUP_IN_PROGRESS");
        for(UUID f:fs)if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM content_lifecycle WHERE object_kind='FOLDER' AND object_id=? AND state='PURGING')",Boolean.class,f)))throw new IdentityException(409,"LIFECYCLE_CLEANUP_IN_PROGRESS");
        UUID job=UUID.randomUUID();db.update("INSERT INTO content_cleanup_jobs(id,tenant_id,workspace_id,object_kind,object_id,requested_by,state) VALUES (?,?,?,?,?,?,'QUEUED')",job,tenant,space,kind,id,actor);
        for(UUID d:docs){
            markPurging(tenant,space,"MATERIAL",d,actor,job);
            db.update("INSERT INTO content_cleanup_materials(job_id,material_id) VALUES (?,?)",job,d);
            db.update("INSERT INTO content_cleanup_blobs(job_id,object_id) SELECT ?,object_id FROM material_versions WHERE material_id=?",job,d);
        }
        for(UUID f:fs)markPurging(tenant,space,"FOLDER",f,actor,job);invalidate(docs);return job;
    }
    private void markPurging(UUID tenant,UUID space,String kind,UUID id,UUID actor,UUID job){db.update("INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state,changed_by,purge_job_id) VALUES (?,?,?,?,'PURGING',?,?) ON CONFLICT(object_kind,object_id) DO UPDATE SET state='PURGING',revision=content_lifecycle.revision+1,changed_by=EXCLUDED.changed_by,changed_at=now(),purge_job_id=EXCLUDED.purge_job_id",tenant,space,kind,id,actor,job);}
    @Transactional public Cleanup cleanup(UUID actor,UUID tenant,UUID space,UUID id){
        access.require(actor,tenant,space,true);var rows=db.queryForList("SELECT * FROM content_cleanup_jobs WHERE id=? AND tenant_id=? AND workspace_id=?",id,tenant,space);if(rows.isEmpty())throw missing();var r=rows.getFirst();
        long count=db.queryForObject("SELECT count(*) FROM content_cleanup_blobs WHERE job_id=?",Long.class,id),deleted=db.queryForObject("SELECT count(*) FROM content_cleanup_blobs WHERE job_id=? AND deleted_at IS NOT NULL",Long.class,id);
        return new Cleanup(id,(String)r.get("state"),(Integer)r.get("revision"),(Integer)r.get("attempts"),(String)r.get("error_code"),count,deleted,time(r,"completed_at"),"NOT_COVERED_BY_ONLINE_CLEANUP");
    }
    /** Only objects explicitly put in recycle by an authorized action have a deadline. */
    @Transactional public boolean enqueueDue(){
        var rows=db.queryForList("""
            SELECT l.tenant_id,l.workspace_id,l.object_kind,l.object_id FROM content_lifecycle l
            WHERE l.state='TRASHED' AND l.purge_after<=now() AND (l.object_kind<>'FOLDER' OR NOT EXISTS(
              WITH RECURSIVE tree AS (SELECT id FROM material_folders WHERE id=l.object_id
                UNION ALL SELECT f.id FROM material_folders f JOIN tree t ON f.parent_id=t.id)
              SELECT 1 FROM content_lifecycle child WHERE child.state='PURGING' AND
                ((child.object_kind='FOLDER' AND child.object_id IN (SELECT id FROM tree)) OR
                 (child.object_kind='MATERIAL' AND child.object_id IN (SELECT m.id FROM materials m JOIN tree t ON t.id=m.folder_id)))
            )) ORDER BY l.purge_after,l.object_id LIMIT 1
            """);if(rows.isEmpty())return false;var r=rows.getFirst();
        UUID tenant=(UUID)r.get("tenant_id"),space=(UUID)r.get("workspace_id"),id=(UUID)r.get("object_id");String kind=(String)r.get("object_kind");
        db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",tenant);
        if(db.queryForList("SELECT object_id FROM content_lifecycle WHERE object_kind=? AND object_id=? AND state='TRASHED' AND purge_after<=now()",kind,id).isEmpty())return false;
        enqueue(tenant,space,kind,id,null);return true;
    }
}
