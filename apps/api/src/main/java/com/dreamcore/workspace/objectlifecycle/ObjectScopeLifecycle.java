package com.dreamcore.workspace.objectlifecycle;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.conversation.ConversationService;
import com.dreamcore.workspace.retention.RetentionClock;
import java.time.*;import java.time.temporal.ChronoUnit;import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
/** Internal bounded adapter. Caller has already recorded an authorized offboarding/exit decision. No HTTP route. */
@Service public class ObjectScopeLifecycle {
 public record Progress(UUID executionId,String state,long discovered,long queued,long purged,long failed,long remaining,boolean discoveryComplete,boolean complete) {}
 private final JdbcTemplate db;private final ConversationService tasks;private final RetentionClock clock;
 public ObjectScopeLifecycle(JdbcTemplate db,ConversationService tasks,RetentionClock clock){this.db=db;this.tasks=tasks;this.clock=clock;}
 private java.sql.Timestamp ts(Instant i){return java.sql.Timestamp.from(i);}
 private void size(int n){if(n<1||n>100)throw IdentityException.invalid();}
 private Map<String,Object> locked(UUID tenant,UUID execution){db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",tenant);var rows=db.queryForList("SELECT * FROM object_lifecycle_scopes WHERE execution_id=? AND tenant_id=? FOR UPDATE",execution,tenant);if(rows.isEmpty())throw new IdentityException(404,"LIFECYCLE_SCOPE_NOT_FOUND");return rows.getFirst();}
 private long remaining(Map<String,Object> s){return db.queryForObject("SELECT count(*) FROM lifecycle_object_sources source LEFT JOIN object_lifecycle l ON l.kind=source.kind AND l.object_id=source.object_id WHERE source.tenant_id=? AND (?::uuid IS NULL OR source.owner_id=?) AND (l.id IS NULL OR NOT EXISTS(SELECT 1 FROM object_lifecycle_scope_items si WHERE si.execution_id=? AND si.object_record=l.id))",Long.class,s.get("tenant_id"),s.get("owner_id"),s.get("owner_id"),s.get("execution_id"));}
 private Progress progress(Map<String,Object> s){UUID id=(UUID)s.get("execution_id");var counts=db.queryForMap("SELECT count(*) discovered,count(*) FILTER(WHERE state='PURGE_PENDING') queued,count(*) FILTER(WHERE state='PURGED') purged,count(*) FILTER(WHERE state='PURGE_FAILED') failed,count(*) FILTER(WHERE state NOT IN('PURGED')) unfinished FROM object_lifecycle l JOIN object_lifecycle_scope_items si ON si.object_record=l.id WHERE si.execution_id=?",id);long remaining=remaining(s);boolean discovery=remaining==0;boolean complete=discovery&&((Number)counts.get("unfinished")).longValue()==0;String state=(String)s.get("state");if(state.equals("PURGING")&&complete){db.update("UPDATE object_lifecycle_scopes SET state='COMPLETE',discovery_complete=true WHERE execution_id=?",id);state="COMPLETE";}return new Progress(id,state,((Number)counts.get("discovered")).longValue(),((Number)counts.get("queued")).longValue(),((Number)counts.get("purged")).longValue(),((Number)counts.get("failed")).longValue(),remaining,discovery,state.equals("COMPLETE")&&complete);}
 @Transactional public Progress isolateScope(UUID tenant,UUID owner,UUID execution,Instant effectiveAt,Instant deadline,int batchSize){
  size(batchSize);if(tenant==null||execution==null||effectiveAt==null||deadline==null||deadline.isBefore(effectiveAt))throw IdentityException.invalid();
  // 与 Postgres timestamptz 微秒精度对齐
  effectiveAt=effectiveAt.truncatedTo(ChronoUnit.MICROS);deadline=deadline.truncatedTo(ChronoUnit.MICROS);db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",tenant);
  db.update("INSERT INTO object_lifecycle_scopes(execution_id,tenant_id,owner_id,effective_at,deadline,state) VALUES (?,?,?,?,?,'ISOLATING') ON CONFLICT(execution_id) DO NOTHING",execution,tenant,owner,ts(effectiveAt),ts(deadline));var s=locked(tenant,execution);
  if(!Objects.equals(owner,s.get("owner_id"))||!effectiveAt.equals(((java.sql.Timestamp)s.get("effective_at")).toInstant())||!deadline.equals(((java.sql.Timestamp)s.get("deadline")).toInstant()))throw new IdentityException(409,"LIFECYCLE_SCOPE_BOUNDARY_CHANGED");if(Set.of("RESTORING","RESTORED").contains(s.get("state")))throw new IdentityException(409,"LIFECYCLE_SCOPE_ALREADY_RESTORED");
  var sources=db.queryForList("SELECT source.* FROM lifecycle_object_sources source LEFT JOIN object_lifecycle l ON l.kind=source.kind AND l.object_id=source.object_id WHERE source.tenant_id=? AND (?::uuid IS NULL OR source.owner_id=?) AND (l.id IS NULL OR NOT EXISTS(SELECT 1 FROM object_lifecycle_scope_items si WHERE si.execution_id=? AND si.object_record=l.id)) ORDER BY source.kind,source.object_id LIMIT ?",tenant,owner,owner,execution,batchSize);
  for(var source:sources){db.update("INSERT INTO object_lifecycle(kind,object_id,tenant_id,workspace_id,owner_id,parent_kind,parent_id,original_anchor) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(kind,object_id) DO NOTHING",source.get("kind"),source.get("object_id"),tenant,source.get("workspace_id"),source.get("owner_id"),source.get("parent_kind"),source.get("parent_id"),source.get("original_anchor"));
   db.update("UPDATE object_lifecycle SET prior_state=CASE WHEN state='ISOLATED' THEN prior_state ELSE state END,state=CASE WHEN state IN('PURGE_PENDING','PURGE_FAILED') THEN state ELSE 'ISOLATED' END,scope_execution=?,scope_due=least(coalesce(scope_due,?),?),revision=revision+1,changed_at=now() WHERE kind=? AND object_id=? AND state<>'PURGED'",execution,ts(deadline),ts(deadline),source.get("kind"),source.get("object_id"));
   db.update("INSERT INTO object_lifecycle_scope_items(execution_id,object_record) SELECT ?,id FROM object_lifecycle WHERE kind=? AND object_id=? ON CONFLICT DO NOTHING",execution,source.get("kind"),source.get("object_id"));
   if(source.get("kind").equals("TASK"))tasks.interruptTasks(tenant,List.of((UUID)source.get("object_id")),"TASK_SOURCE_UNAVAILABLE");
  }
  if(remaining(s)==0)db.update("UPDATE object_lifecycle_scopes SET discovery_complete=true,state=CASE WHEN state='ISOLATING' THEN 'ISOLATED' ELSE state END WHERE execution_id=?",execution);return progress(locked(tenant,execution));
 }
 /** Enqueue at the original absolute deadline. The worker, not this receipt, proves actual erasure. */
 @Transactional public Progress purgeScope(UUID tenant,UUID owner,UUID execution,int batchSize){size(batchSize);var s=locked(tenant,execution);if(!Objects.equals(owner,s.get("owner_id")))throw new IdentityException(409,"LIFECYCLE_SCOPE_BOUNDARY_CHANGED");if(clock.now().isBefore(((java.sql.Timestamp)s.get("deadline")).toInstant()))throw new IdentityException(409,"LIFECYCLE_SCOPE_NOT_DUE");if(Set.of("RESTORING","RESTORED").contains(s.get("state")))throw new IdentityException(409,"LIFECYCLE_SCOPE_ALREADY_RESTORED");
  db.update("UPDATE object_lifecycle_scopes SET state='PURGING' WHERE execution_id=? AND state<>'COMPLETE'",execution);
  // Failed objects are retried only when the owning explicit execution asks again.
  db.update("UPDATE object_lifecycle SET state='PURGE_PENDING',error_code=NULL,revision=revision+1,changed_at=now() WHERE id IN(SELECT l.id FROM object_lifecycle l JOIN object_lifecycle_scope_items si ON si.object_record=l.id WHERE si.execution_id=? AND state NOT IN('PURGE_PENDING','PURGED') ORDER BY l.id LIMIT ?)",execution,batchSize);return progress(locked(tenant,execution));
 }
 @Transactional public Progress status(UUID tenant,UUID execution){return progress(locked(tenant,execution));}
 @Transactional public Progress restoreScope(UUID tenant,UUID execution,int batchSize){size(batchSize);var s=locked(tenant,execution);if(!clock.now().isBefore(((java.sql.Timestamp)s.get("deadline")).toInstant())||Set.of("PURGING","COMPLETE").contains(s.get("state")))throw new IdentityException(409,"LIFECYCLE_SCOPE_RESTORE_CLOSED");
  db.update("UPDATE object_lifecycle_scopes SET state='RESTORING' WHERE execution_id=?",execution);
  db.update("UPDATE object_lifecycle SET state=coalesce(prior_state,'DISABLED'),scope_execution=NULL,scope_due=NULL,prior_state=NULL,revision=revision+1,changed_at=now() WHERE id IN(SELECT id FROM object_lifecycle WHERE scope_execution=? AND state='ISOLATED' AND (trash_due IS NULL OR trash_due>?) AND (is_formal OR policy_due IS NULL OR policy_due>?) ORDER BY id LIMIT ?)",execution,ts(clock.now()),ts(clock.now()),batchSize);
  long remaining=db.queryForObject("SELECT count(*) FROM object_lifecycle WHERE scope_execution=? AND state='ISOLATED' AND (trash_due IS NULL OR trash_due>?) AND (is_formal OR policy_due IS NULL OR policy_due>?)",Long.class,execution,ts(clock.now()),ts(clock.now()));
  if(remaining==0)db.update("UPDATE object_lifecycle_scopes SET state='RESTORED' WHERE execution_id=?",execution);var result=progress(locked(tenant,execution));return new Progress(execution,result.state(),result.discovered(),result.queued(),result.purged(),result.failed(),remaining,true,result.state().equals("RESTORED"));
 }
 /** Only the still-effective departure execution may call this after a cancellation failed to finish. */
 @Transactional public Progress resumeExpiredScope(UUID tenant,UUID owner,UUID execution,Instant effectiveAt,Instant deadline,int batchSize){
  // 与 Postgres timestamptz 微秒精度对齐
  effectiveAt=effectiveAt.truncatedTo(ChronoUnit.MICROS);deadline=deadline.truncatedTo(ChronoUnit.MICROS);
  size(batchSize);var s=locked(tenant,execution);if(clock.now().isBefore(deadline))throw new IdentityException(409,"LIFECYCLE_SCOPE_NOT_DUE");
  if(!Objects.equals(owner,s.get("owner_id"))||!effectiveAt.equals(((java.sql.Timestamp)s.get("effective_at")).toInstant())||!deadline.equals(((java.sql.Timestamp)s.get("deadline")).toInstant()))throw new IdentityException(409,"LIFECYCLE_SCOPE_BOUNDARY_CHANGED");
  if(Set.of("RESTORING","RESTORED").contains(s.get("state"))){
   db.update("UPDATE object_lifecycle_scopes SET state='ISOLATING',discovery_complete=false WHERE execution_id=?",execution);
   // Restore may have released records before the caller committed cancellation. Rediscover those records.
   db.update("DELETE FROM object_lifecycle_scope_items si USING object_lifecycle l WHERE si.object_record=l.id AND si.execution_id=? AND l.scope_execution IS DISTINCT FROM ? AND l.state<>'PURGED'",execution,execution);
  }
  return isolateScope(tenant,owner,execution,effectiveAt,deadline,batchSize);
 }

}
