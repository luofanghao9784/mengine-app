package com.dreamcore.workspace.conversation;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Caller owns the transaction and task authorization. No URLs or object-store IDs leave this service. */
@Service
public class TaskOriginals {
    public record Selection(UUID materialId, UUID versionId) {}
    public record File(UUID materialId, UUID versionId, String filename, int version, long bytes, String sha256, boolean read,UUID workspaceId,UUID attachmentConversationId) {}
    public record Content(UUID versionId, String sha256, String contentBase64) {}
    private final JdbcTemplate db; private final MaterialAccess access; private final ObjectStore store; private final IdentityAudit audit;
    public TaskOriginals(JdbcTemplate db,MaterialAccess access,ObjectStore store,IdentityAudit audit){this.db=db;this.access=access;this.store=store;this.audit=audit;}
    public List<Selection> normalize(List<Selection> selections){
        if(selections==null)return List.of();
        if(selections.size()>3 || selections.stream().anyMatch(s->s==null || s.materialId()==null || s.versionId()==null) || selections.stream().map(Selection::materialId).distinct().count()!=selections.size() || selections.stream().map(Selection::versionId).distinct().count()!=selections.size())throw IdentityException.invalid();
        return selections.stream().sorted(Comparator.comparing(s->s.versionId().toString())).toList();
    }
    private File metadata(UUID tenant,UUID space,Selection s){
        access.requireVersionActive(tenant,space,s.versionId());
        var files=db.query("SELECT v.*,m.attachment_conversation_id FROM material_versions v JOIN materials m ON m.id=v.material_id WHERE v.tenant_id=? AND v.workspace_id=? AND v.material_id=? AND v.id=?",(r,n)->new File(s.materialId(),s.versionId(),r.getString("filename"),r.getInt("number"),r.getLong("size_bytes"),r.getString("sha256"),false,space,r.getObject("attachment_conversation_id",UUID.class)),tenant,space,s.materialId(),s.versionId());
        if(files.isEmpty())throw new IdentityException(404,"TASK_ORIGINAL_UNAVAILABLE");return files.getFirst();
    }
    public void select(UUID actor,UUID tenant,UUID space,UUID task,List<Selection> selections){
        access.require(actor,tenant,space,false);long total=0;
        for(var selection:normalize(selections)){
            var spaces=db.queryForList("SELECT workspace_id FROM material_versions WHERE tenant_id=? AND material_id=? AND id=?",UUID.class,tenant,selection.materialId(),selection.versionId());
            if(spaces.isEmpty())throw new IdentityException(404,"TASK_ORIGINAL_UNAVAILABLE");UUID sourceSpace=spaces.getFirst();
            if(!sourceSpace.equals(space) && "WORKSPACE".equals(db.queryForObject("SELECT source_scope FROM conversation_tasks WHERE id=?",String.class,task)))throw new IdentityException(404,"TASK_ORIGINAL_UNAVAILABLE");
            access.require(actor,tenant,sourceSpace,false);var file=metadata(tenant,sourceSpace,selection);total+=file.bytes();
            boolean raw="verification".equals(db.queryForObject("SELECT execution_class FROM conversation_tasks WHERE id=?",String.class,task));
            if(file.bytes()>(raw?262144:20971520) || total>(raw?524288:62914560))throw new IdentityException(413,"TASK_ORIGINAL_TOO_LARGE");
            db.update("INSERT INTO conversation_originals(tenant_id,workspace_id,task_id,material_id,version_id) VALUES (?,?,?,?,?) ON CONFLICT (task_id,version_id) DO NOTHING",tenant,sourceSpace,task,selection.materialId(),selection.versionId());
        }
    }
    public List<File> list(UUID actor,UUID tenant,UUID space,UUID task){
        access.require(actor,tenant,space,false);
        var selections=db.query("SELECT material_id,version_id FROM conversation_originals WHERE tenant_id=? AND task_id=? ORDER BY version_id",(r,n)->new Selection(r.getObject(1,UUID.class),r.getObject(2,UUID.class)),tenant,task);
        return selections.stream().map(s->{UUID sourceSpace=db.queryForObject("SELECT workspace_id FROM material_versions WHERE tenant_id=? AND id=?",UUID.class,tenant,s.versionId());access.require(actor,tenant,sourceSpace,false);var f=metadata(tenant,sourceSpace,s);boolean read=db.queryForObject("SELECT EXISTS(SELECT 1 FROM conversation_original_reads r JOIN conversation_tasks t ON t.id=r.task_id WHERE r.task_id=? AND r.version_id=? AND r.attempt_number=t.attempt AND t.status<>'QUEUED')",Boolean.class,task,s.versionId());return new File(f.materialId(),f.versionId(),f.filename(),f.version(),f.bytes(),f.sha256(),read,sourceSpace,f.attachmentConversationId());}).toList();
    }
    public List<UUID> readIds(UUID task,UUID attempt){return db.queryForList("SELECT version_id FROM conversation_original_reads WHERE task_id=? AND attempt_id=? ORDER BY version_id",UUID.class,task,attempt);}
    public Content read(ConversationService.Job job,UUID version){
        var file=list(job.actor(),job.tenant(),job.space(),job.id()).stream().filter(f->f.versionId().equals(version)).findFirst().orElseThrow(()->new IdentityException(403,"TASK_ORIGINAL_NOT_SELECTED"));
        if(file.bytes()>262144)throw new IdentityException(413,"TASK_ORIGINAL_TOO_LARGE");
        UUID object=db.queryForObject("SELECT object_id FROM material_versions WHERE tenant_id=? AND workspace_id=? AND material_id=? AND id=?",UUID.class,job.tenant(),file.workspaceId(),file.materialId(),version);
        byte[] bytes=store.read(object,file.bytes(),file.sha256());
        int attempt=db.queryForObject("SELECT attempt FROM conversation_tasks WHERE id=?",Integer.class,job.id());
        db.update("INSERT INTO conversation_original_reads(tenant_id,workspace_id,task_id,version_id,attempt_id,attempt_number,sha256) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",job.tenant(),file.workspaceId(),job.id(),version,job.token(),attempt,file.sha256());
        audit.record(job.actor(),job.tenant(),"TASK_ORIGINAL_READ",version,"SUCCESS");
        return new Content(version,file.sha256(),Base64.getEncoder().encodeToString(bytes));
    }
}
