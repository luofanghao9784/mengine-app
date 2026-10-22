package com.dreamcore.workspace.knowledge;

import com.dreamcore.workspace.material.MaterialAccess;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Component
@ConditionalOnProperty(name="dreamcore.weknora.enabled",havingValue="true")
public class WeKnoraIndexWorker {
    private final JdbcTemplate db;private final WeKnoraClient client;private final MaterialAccess access;
    private final TransactionTemplate tx;
    record Job(UUID id,UUID chunk,String kb,String remote,String state,UUID token) {}
    public WeKnoraIndexWorker(JdbcTemplate db,WeKnoraClient client,MaterialAccess access,PlatformTransactionManager manager){
        this.db=db;this.client=client;this.access=access;tx=new TransactionTemplate(manager);
    }
    private static final String ACTIVE="""
        SELECT 1 FROM knowledge_chunks c JOIN active_materials m ON m.id=c.material_id AND m.tenant_id=c.tenant_id
        JOIN knowledge_index_targets t ON t.tenant_id=c.tenant_id AND t.enabled AND t.knowledge_base_id=i.knowledge_base_id
        WHERE c.id=i.chunk_id AND c.tenant_id=i.tenant_id
        """;
    private boolean active(UUID id){return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM knowledge_remote_index i WHERE i.id=? AND EXISTS("+ACTIVE+"))",Boolean.class,id));}
    private Job claim(){
        // A timed-out create has unknown side effects: never blindly repeat it.
        db.update("UPDATE knowledge_remote_index SET state='UNKNOWN',error_code='CREATE_RESULT_UNKNOWN',updated_at=now() WHERE state='UPLOADING' AND lease_until<now()");
        db.update("UPDATE knowledge_remote_index SET state='DELETE_PENDING',lease_token=NULL WHERE state='DELETING' AND lease_until<now()");
        db.update("UPDATE knowledge_remote_index i SET state=CASE WHEN remote_id IS NULL THEN 'DELETED' ELSE 'DELETE_PENDING' END,updated_at=now() WHERE state IN ('QUEUED','INDEXING','READY','FAILED') AND NOT EXISTS("+ACTIVE+")");
        db.update("""
            INSERT INTO knowledge_remote_index(id,chunk_id,tenant_id,material_id,version_id,knowledge_base_id)
            SELECT gen_random_uuid(),c.id,c.tenant_id,c.material_id,c.version_id,t.knowledge_base_id
            FROM knowledge_chunks c JOIN knowledge_runs r ON r.id=c.run_id
            JOIN active_materials m ON m.id=c.material_id AND m.tenant_id=c.tenant_id
            JOIN knowledge_index_targets t ON t.tenant_id=c.tenant_id AND t.enabled
            WHERE r.status IN ('READY','PARTIAL') AND NOT EXISTS(
                SELECT 1 FROM knowledge_remote_index i WHERE i.chunk_id=c.id AND i.state<>'DELETED')
            ORDER BY r.created_at,c.ordinal LIMIT 100
            ON CONFLICT(chunk_id) DO UPDATE SET state='QUEUED',knowledge_base_id=excluded.knowledge_base_id,
                remote_id=NULL,error_code=NULL,lease_token=NULL,next_attempt_at=now(),updated_at=now()
            WHERE knowledge_remote_index.state='DELETED'
            """);
        var rows=db.queryForList("SELECT * FROM knowledge_remote_index WHERE state IN ('QUEUED','INDEXING','DELETE_PENDING') AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY CASE WHEN state='DELETE_PENDING' THEN 0 ELSE 1 END,created_at FOR UPDATE SKIP LOCKED LIMIT 1");
        if(rows.isEmpty())return null;var row=rows.getFirst();String state=(String)row.get("state");UUID token=UUID.randomUUID(),id=(UUID)row.get("id");
        db.update("UPDATE knowledge_remote_index SET state=?,lease_token=?,lease_until=now()+interval '30 seconds',updated_at=now() WHERE id=?",state.equals("QUEUED")?"UPLOADING":state.equals("DELETE_PENDING")?"DELETING":state,token,id);
        return new Job(id,(UUID)row.get("chunk_id"),(String)row.get("knowledge_base_id"),(String)row.get("remote_id"),state,token);
    }
    private String input(Job job){
        if(!active(job.id()))return null;
        var rows=db.queryForList("SELECT c.*,r.requested_by FROM knowledge_chunks c JOIN knowledge_runs r ON r.id=c.run_id WHERE c.id=?",job.chunk());
        if(rows.isEmpty())return null;var c=rows.getFirst();
        // Deployment-enabled indexing reads an already parsed source; it does not edit it.
        // Scene-synchronized sources intentionally remain read-only even to their requester.
        access.requireObject((UUID)c.get("requested_by"),(UUID)c.get("tenant_id"),(UUID)c.get("workspace_id"),"MATERIAL",(UUID)c.get("material_id"),false);
        access.requireVersionActive((UUID)c.get("tenant_id"),(UUID)c.get("workspace_id"),(UUID)c.get("version_id"));
        return (String)c.get("content");
    }
    private void finish(Job job,String state,String remote,String error){
        tx.executeWithoutResult(s->{
            String next=state;
            if(!Set.of("DELETED","DELETE_PENDING","UNKNOWN").contains(next) && !active(job.id()))next=remote==null?"DELETED":"DELETE_PENDING";
            db.update("UPDATE knowledge_remote_index SET state=?,remote_id=?,error_code=?,lease_until=NULL,lease_token=NULL,next_attempt_at=now()+interval '5 seconds',updated_at=now() WHERE id=? AND lease_token=?",next,remote,error,job.id(),job.token());
        });
    }
    @Scheduled(fixedDelayString="${dreamcore.weknora.poll-ms:1000}",initialDelayString="${dreamcore.weknora.initial-delay-ms:1000}")
    public void tick(){
        Job job=tx.execute(s->claim());if(job==null)return;
        String remote=job.remote();boolean dispatched=false;
        try {
            if(job.state().equals("DELETE_PENDING")){
                client.delete(remote);
                finish(job,client.get(job.kb(),remote)==null?"DELETED":"DELETE_PENDING",remote,null);return;
            }
            if(job.state().equals("QUEUED")){
                String content=tx.execute(s->input(job));
                if(content==null){finish(job,"DELETED",null,null);return;}
                dispatched=true;var created=client.create(job.kb(),job.id(),content);remote=created.id();
                // Preserve a known handle even after revocation so cleanup remains possible.
                try{if(tx.execute(s->input(job))==null){finish(job,"DELETE_PENDING",remote,"ACCESS_CHANGED");return;}}
                catch(IdentityException e){finish(job,"DELETE_PENDING",remote,"ACCESS_CHANGED");return;}
                finish(job,"completed".equals(created.status())?"READY":"INDEXING",remote,null);
            } else {
                var document=client.get(job.kb(),remote);
                String state=document==null || "failed".equals(document.status())?"FAILED":"completed".equals(document.status())?"READY":"INDEXING";
                finish(job,state,remote,state.equals("FAILED")?"REMOTE_INDEX_FAILED":null);
            }
        } catch(IdentityException e){finish(job,remote==null?"FAILED":"DELETE_PENDING",remote,"ACCESS_CHANGED");}
        catch(Exception e){finish(job,job.state().equals("DELETE_PENDING")?"DELETE_PENDING":dispatched&&remote==null?"UNKNOWN":job.state().equals("INDEXING")?"INDEXING":"FAILED",remote,dispatched&&remote==null?"CREATE_RESULT_UNKNOWN":"REMOTE_INDEX_UNAVAILABLE");}
    }
}
