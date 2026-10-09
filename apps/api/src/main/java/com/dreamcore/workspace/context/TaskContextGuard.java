package com.dreamcore.workspace.context;

import com.dreamcore.workspace.identity.IdentityException;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** No dependency on task services: suitable for both callbacks and the final commit fence. */
@Service
public class TaskContextGuard {
 @org.springframework.beans.factory.annotation.Autowired private com.dreamcore.workspace.briefing.BriefingFlowGuard briefingFlow;
 private final JdbcTemplate db;
 public TaskContextGuard(JdbcTemplate db){this.db=db;}
 @org.springframework.transaction.annotation.Transactional
 public void requireCurrent(UUID task){
  if(briefingFlow!=null)briefingFlow.requireCurrent(task);
  // Serialize tenant future-use changes even while the default usage row does not exist.
  db.queryForList("SELECT pg_advisory_xact_lock_shared(hashtextextended('general-use:'||tenant_id::text,0)) FROM conversation_tasks WHERE id=?",task);
  // Fence a simultaneous revision/publication through the caller's transaction, including final commit.
  db.queryForList("SELECT e.id FROM profile_entries e JOIN task_context_reads r ON r.reference_id=e.id AND r.kind='PROFILE' JOIN conversation_tasks t ON t.id=r.task_id WHERE t.id=? AND r.attempt_number=t.attempt ORDER BY e.id FOR SHARE OF e",task);
  db.queryForList("SELECT e.id FROM experience_entries e JOIN task_context_reads r ON r.reference_id=e.id AND r.kind='EXPERIENCE' JOIN conversation_tasks t ON t.id=r.task_id WHERE t.id=? AND r.attempt_number=t.attempt ORDER BY e.id FOR SHARE OF e",task);
  db.queryForList("SELECT e.id FROM task_general_experience_dependencies(?) r JOIN general_experience_entries e ON e.id=r.entry_id JOIN general_experience_versions v ON v.id=r.version_id ORDER BY e.id FOR SHARE OF e,v",task);
  if(Boolean.TRUE.equals(db.queryForObject("SELECT NOT task_general_experiences_current(?) OR EXISTS(SELECT 1 FROM task_general_experience_fences f JOIN conversation_tasks t ON t.id=f.task_id WHERE t.id=? AND f.attempt_number=t.attempt) OR NOT task_general_experiences_readable(?)",Boolean.class,task,task,task)))throw new IdentityException(409,"TASK_CONTEXT_CHANGED");
  boolean stale=Boolean.TRUE.equals(db.queryForObject("""
   SELECT EXISTS(SELECT 1 FROM task_context_reads r JOIN conversation_tasks t ON t.id=r.task_id
   WHERE t.id=? AND r.attempt_number=t.attempt AND (
    (r.kind='PROFILE' AND NOT EXISTS(SELECT 1 FROM profile_entries e JOIN profile_versions v ON v.entry_id=e.id AND v.revision=e.revision
     WHERE NOT v.scrubbed AND object_is_active('PROFILE_VERSION',v.id) AND company_profile_readable(v.id) AND e.id=r.reference_id AND (e.revision::text=r.version_key OR EXISTS(SELECT 1 FROM task_preference_saves s WHERE s.task_id=t.id AND s.attempt_number=t.attempt AND s.profile_id=e.id AND s.profile_revision=e.revision AND s.owner_id=t.requested_by AND e.scope='PERSONAL' AND e.account_id=t.requested_by AND e.kind='PREFERENCE')) AND
      (v.status='ACTIVE' AND (v.expires_at IS NULL OR v.expires_at>clock_timestamp()) OR e.kind='INFERENCE' AND v.status='PROPOSED' AND (v.expires_at IS NULL OR v.expires_at>clock_timestamp()))))
    OR (r.kind='EXPERIENCE' AND NOT EXISTS(SELECT 1 FROM experience_entries e JOIN experience_versions v ON v.id=e.published_version
     WHERE e.id=r.reference_id AND e.status='PUBLISHED' AND v.origin='AUTOMATIC' AND v.evaluation='AUTOMATIC_CHECKED' AND v.id::text=r.version_key AND NOT v.scrubbed AND object_is_active('EXPERIENCE_VERSION',v.id)))
   ))
   """,Boolean.class,task));
  if(stale || !Boolean.TRUE.equals(db.queryForObject("SELECT task_datasets_readable(?) AND NOT EXISTS(SELECT 1 FROM task_dataset_fences f JOIN conversation_tasks t ON t.id=f.task_id AND t.attempt=f.attempt_number WHERE t.id=?)",Boolean.class,task,task)))throw new IdentityException(409,"TASK_CONTEXT_CHANGED");
 }
}
