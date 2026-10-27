package com.dreamcore.workspace.experience;

import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Internal metadata-only discovery. Neither a source nor a satisfied user is an admitted experience. */
@Service
public class ExperienceIntakeService {
 private final JdbcTemplate db;
 public ExperienceIntakeService(JdbcTemplate db){this.db=db;}
 @Transactional public void discover(){
  // Serialize bounded discovery without calling models or holding source bodies in this queue.
  db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended('experience-intake-discovery',0))");
  db.update("""
   INSERT INTO experience_intake_sources(id,tenant_id,owner_id,workspace_id,kind,source_id,source_revision,source_attempt,task_id)
   SELECT gen_random_uuid(),t.tenant_id,t.requested_by,t.workspace_id,'TASK',t.id,t.revision,t.attempt,t.id
   FROM conversation_tasks t JOIN tenants tenant ON tenant.id=t.tenant_id AND tenant.status='ACTIVE'
   JOIN accounts a ON a.id=t.requested_by AND a.status='ACTIVE'
   JOIN tenant_memberships m ON m.tenant_id=t.tenant_id AND m.account_id=t.requested_by AND m.status='ACTIVE'
   JOIN workspaces w ON w.id=t.workspace_id AND w.tenant_id=t.tenant_id
   WHERE t.mode='AGENT' AND t.execution_class='live' AND t.status='SUCCEEDED' AND t.attempt>0
    AND EXISTS(SELECT 1 FROM conversation_attempts run WHERE run.task_id=t.id AND run.attempt_number=t.attempt AND run.status='SUCCEEDED' AND run.provenance='RECORDED')
    AND ((w.kind='PERSONAL' AND w.owner_id=t.requested_by) OR EXISTS(SELECT 1 FROM workspace_members g WHERE g.workspace_id=w.id AND g.tenant_id=w.tenant_id AND g.account_id=t.requested_by))
    AND NOT EXISTS(SELECT 1 FROM experience_intake_sources i WHERE i.kind='TASK' AND i.source_id=t.id AND i.source_revision=t.revision AND i.source_attempt=t.attempt)
   ORDER BY t.finished_at,t.id LIMIT 100 ON CONFLICT DO NOTHING
   """);
  db.update("""
   INSERT INTO experience_intake_sources(id,tenant_id,owner_id,workspace_id,kind,source_id,source_revision,source_attempt,task_id,feedback_id)
   SELECT gen_random_uuid(),f.tenant_id,f.actor_id,f.workspace_id,'FEEDBACK',f.id,f.revision,f.attempt,f.task_id,f.id
   FROM feedback_entries f JOIN feedback_versions v ON v.feedback_id=f.id AND v.revision=f.revision
   JOIN tenants tenant ON tenant.id=f.tenant_id AND tenant.status='ACTIVE'
   JOIN accounts a ON a.id=f.actor_id AND a.status='ACTIVE'
   JOIN tenant_memberships m ON m.tenant_id=f.tenant_id AND m.account_id=f.actor_id AND m.status='ACTIVE'
   JOIN workspaces w ON w.id=f.workspace_id AND w.tenant_id=f.tenant_id
   WHERE v.status='ACTIVE' AND NOT f.scrubbed
    AND ((w.kind='PERSONAL' AND w.owner_id=f.actor_id) OR EXISTS(SELECT 1 FROM workspace_members g WHERE g.workspace_id=w.id AND g.tenant_id=w.tenant_id AND g.account_id=f.actor_id))
    AND (f.task_id IS NULL OR f.snapshot->>'executionClass'='live')
    AND NOT EXISTS(SELECT 1 FROM document_publications pub JOIN private_documents doc ON doc.id=pub.document_id JOIN conversation_tasks origin ON origin.id=doc.source_task_id WHERE pub.id=f.publication_id AND origin.execution_class='verification')
    AND NOT EXISTS(SELECT 1 FROM experience_intake_sources i WHERE i.kind='FEEDBACK' AND i.source_id=f.id AND i.source_revision=f.revision AND i.source_attempt=f.attempt)
   ORDER BY v.created_at,f.id LIMIT 100 ON CONFLICT DO NOTHING
   """);
  // One availability call per due row. Unchanged pending rows wait 10 minutes; a changed task, feedback, or lifecycle is still checked on this pass.
  db.update("""
   WITH due AS MATERIALIZED (
    SELECT s.id FROM experience_intake_sources s
    WHERE s.state='PENDING' AND (
     s.checked_at IS NULL OR s.checked_at<now()-interval '10 minutes'
     OR (s.kind='TASK' AND NOT EXISTS(SELECT 1 FROM conversation_tasks t WHERE t.id=s.task_id AND t.tenant_id=s.tenant_id
      AND t.revision=s.source_revision AND t.attempt=s.source_attempt AND t.status='SUCCEEDED' AND t.execution_class='live'))
     OR (s.kind='FEEDBACK' AND NOT EXISTS(SELECT 1 FROM feedback_entries f JOIN feedback_versions v ON v.feedback_id=f.id AND v.revision=f.revision
      WHERE f.id=s.feedback_id AND f.revision=s.source_revision AND f.attempt=s.source_attempt AND v.status='ACTIVE' AND NOT f.scrubbed))
     OR EXISTS(SELECT 1 FROM object_lifecycle l WHERE l.state<>'ACTIVE' AND l.kind='TASK' AND l.object_id=s.task_id)
    )
    ORDER BY s.checked_at NULLS FIRST,s.created_at,s.id LIMIT 50
   )
   UPDATE experience_intake_sources AS i
   SET checked_at=now(),
    state=CASE WHEN checked.ok THEN i.state ELSE 'SOURCE_UNAVAILABLE' END,
    reason=CASE WHEN checked.ok THEN i.reason ELSE 'SOURCE_CHANGED' END,
    invalidated_at=CASE WHEN checked.ok THEN i.invalidated_at ELSE now() END
   FROM (SELECT id,experience_intake_available(id) AS ok FROM due) checked
   WHERE i.id=checked.id
   """);
 }
 /** Called again by a future extractor at claim and commit, never a customer source-read endpoint. */
 @Transactional public boolean available(UUID id){return Boolean.TRUE.equals(db.queryForObject("SELECT experience_intake_available(?)",Boolean.class,id));}
}
