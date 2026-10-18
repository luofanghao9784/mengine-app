package com.dreamcore.workspace.lifecycle;

import com.dreamcore.workspace.material.ObjectStore;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Two durable stages: external originals first, then online derived content. No backup claim. */
@Service
public class MaterialCleanupService {
    public record Job(UUID id,UUID token,UUID tenant) {}
    private final JdbcTemplate db;private final ObjectStore store;
    public MaterialCleanupService(JdbcTemplate db,ObjectStore store){this.db=db;this.store=store;}
    @Transactional public Job claim(){
        var rows=db.queryForList("SELECT id,tenant_id FROM content_cleanup_jobs WHERE state='QUEUED' OR (state='CLEANING' AND lease_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1");if(rows.isEmpty())return null;
        var r=rows.getFirst();UUID id=(UUID)r.get("id"),token=UUID.randomUUID();db.update("UPDATE content_cleanup_jobs SET state='CLEANING',attempts=attempts+1,lease_token=?,lease_until=now()+interval '120 seconds' WHERE id=?",token,id);return new Job(id,token,(UUID)r.get("tenant_id"));
    }
    private boolean owned(Job job){return !db.queryForList("SELECT id FROM content_cleanup_jobs WHERE id=? AND state='CLEANING' AND lease_token=? AND lease_until>now() FOR UPDATE",job.id(),job.token()).isEmpty();}
    @Transactional public List<UUID> pending(Job job){if(!owned(job))return List.of();return db.queryForList("SELECT object_id FROM content_cleanup_blobs WHERE job_id=? AND deleted_at IS NULL ORDER BY object_id LIMIT 50",UUID.class,job.id());}
    public void remove(UUID object){store.purge(object);}
    @Transactional public void removed(Job job,UUID object){if(!owned(job))return;db.update("UPDATE content_cleanup_blobs SET deleted_at=coalesce(deleted_at,now()) WHERE job_id=? AND object_id=?",job.id(),object);}
    @Transactional public void fail(Job job){db.update("UPDATE content_cleanup_jobs SET state='FAILED',revision=revision+1,error_code='ONLINE_CLEANUP_FAILED',lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=? AND state='CLEANING'",job.id(),job.token());}
    @Transactional public void finish(Job job){
        // Read/write business paths obtain tenant before object/task locks.
        db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",job.tenant());if(!owned(job))return;
        if(db.queryForObject("SELECT count(*) FROM content_cleanup_blobs WHERE job_id=? AND deleted_at IS NULL",Long.class,job.id())>0){db.update("UPDATE content_cleanup_jobs SET state='QUEUED',lease_token=NULL,lease_until=NULL WHERE id=?",job.id());return;}
        var docs=db.queryForList("SELECT material_id FROM content_cleanup_materials WHERE job_id=?",UUID.class,job.id());
        for(UUID material:docs){
            db.queryForList("SELECT scrub_wiki_material(?)",material);
            db.queryForList("SELECT scrub_governance_proposals(?)",material);
            db.queryForList("SELECT scrub_experience_material(?)",material);
            db.queryForList("SELECT scrub_feedback_material(?)",material);
            db.queryForList("SELECT scrub_file_tables(?)",material);
            db.queryForList("SELECT scrub_adjustment_material(?)",material);
            db.queryForList("SELECT scrub_task_context_material(?)",material);
            db.queryForList("SELECT scrub_export_material(?)",material);
            db.queryForList("SELECT scrub_evaluation_material(?)",material);
            db.queryForList("SELECT scrub_departure_material_version(id) FROM material_versions WHERE material_id=?",material);
            var tasks=db.queryForList("""
                SELECT s.task_id FROM conversation_sources s JOIN knowledge_chunks c ON c.id=s.chunk_id WHERE c.material_id=?
                UNION SELECT task_id FROM conversation_originals WHERE material_id=?
                UNION SELECT g.task_id FROM conversation_agent_grants g JOIN knowledge_chunks c ON c.id=g.chunk_id WHERE c.material_id=?
                UNION SELECT d.task_id FROM feedback_task_sources d JOIN material_versions v ON v.id=d.version_id WHERE v.material_id=?
                UNION SELECT d.task_id FROM task_context_materials d JOIN material_versions v ON v.id=d.version_id WHERE v.material_id=?
                """,UUID.class,material,material,material,material,material);
            for(UUID task:tasks){
                db.update("UPDATE experience_uses SET conditions='',adjustments='',context_key='purged:'||id::text WHERE task_id=?",task);
                db.update("UPDATE experience_feedback SET note='' WHERE use_id IN (SELECT id FROM experience_uses WHERE task_id=?)",task);
                db.update("UPDATE conversation_tasks SET reply=NULL,required_input=NULL,web_sources='[]',skills='[]',lease_token=NULL,lease_until=NULL,error_code='SOURCE_REMOVED',status=CASE WHEN status IN ('QUEUED','RUNNING') THEN 'INTERRUPTED' ELSE status END,revision=revision+1 WHERE id=?",task);
                db.update("UPDATE conversation_artifacts SET content=''::bytea,filename='removed',sha256=? WHERE task_id=?",ObjectStore.sha256(new byte[0]),task);
                db.update("UPDATE private_document_versions SET title='内容已清理',body='' WHERE document_id IN (SELECT id FROM private_documents WHERE source_task_id=?)",task);
                db.update("DELETE FROM private_document_exports WHERE document_id IN (SELECT id FROM private_documents WHERE source_task_id=?)",task);
                if(Boolean.TRUE.equals(db.queryForObject("SELECT to_regclass('conversation_attempts') IS NOT NULL",Boolean.class)))db.update("UPDATE conversation_attempts SET input='内容已按资料生命周期清理',snapshot='{}'::jsonb WHERE task_id=?",task);
            }
            // FK identities remain as non-readable tombstones for provenance, old keys and backup guards.
            db.update("UPDATE knowledge_chunks SET content='',locator='REMOVED' WHERE material_id=?",material);
            db.update("UPDATE material_versions SET filename='内容已清理' WHERE material_id=?",material);
            db.update("UPDATE materials SET name=? WHERE id=?","已清理-"+material,material);
        }
        db.update("UPDATE material_folders SET name='已清理-'||id::text WHERE id IN (SELECT object_id FROM content_lifecycle WHERE purge_job_id=? AND object_kind='FOLDER')",job.id());
        // External index copies are part of online content. An unknown create must be reconciled,
        // never treated as erased merely because the local original/chunks were scrubbed.
        if(Boolean.TRUE.equals(db.queryForObject("""
            SELECT EXISTS(SELECT 1 FROM knowledge_remote_index i
              JOIN content_cleanup_materials m ON m.material_id=i.material_id
              WHERE m.job_id=? AND i.state<>'DELETED')
            """,Boolean.class,job.id()))){
            db.update("UPDATE content_cleanup_jobs SET state='QUEUED',error_code='REMOTE_INDEX_CLEANUP_PENDING',lease_token=NULL,lease_until=NULL WHERE id=?",job.id());return;
        }
        db.update("UPDATE content_lifecycle SET state='PURGED',revision=revision+1,changed_at=now() WHERE purge_job_id=?",job.id());
        db.update("UPDATE content_cleanup_jobs SET state='COMPLETE',revision=revision+1,completed_at=now(),lease_token=NULL,lease_until=NULL,error_code=NULL WHERE id=?",job.id());
    }
}
