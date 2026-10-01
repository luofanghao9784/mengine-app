package com.dreamcore.workspace.retention;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.governance.GovernanceAccess;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Removes expired notification duplicates; never business results or guards against replay. */
@Service
public class OperationRetentionService {
 public record Status(UUID tenantId,long pending,long failed,long complete,long removedEvents,long removedAudit,Instant nextDeadline,String coverage,String protectedRecords) {}
 private final JdbcTemplate db;private final RetentionClock clock;private final IdentityService identities;private final GovernanceAccess governance;
 public OperationRetentionService(JdbcTemplate db,RetentionClock clock,IdentityService identities,GovernanceAccess governance){this.db=db;this.clock=clock;this.identities=identities;this.governance=governance;}
 @Transactional public Status tenant(UUID actor,UUID tenant){governance.require(actor,tenant,GovernanceAccess.Capability.TENANT_CONFIG,null);return status(tenant);}
 @Transactional public Status platform(UUID actor){identities.platform(actor);return status(null);}
 private Status status(UUID tenant){return db.queryForObject("SELECT count(*) FILTER(WHERE state='PENDING'),count(*) FILTER(WHERE state='FAILED'),count(*) FILTER(WHERE state='COMPLETE'),coalesce(sum(removed_events),0),coalesce(sum(removed_audit),0),min(due_at) FILTER(WHERE state<>'COMPLETE') FROM operation_retention_windows WHERE (?::uuid IS NULL OR tenant_id=?)",(r,n)->new Status(tenant,r.getLong(1),r.getLong(2),r.getLong(3),r.getLong(4),r.getLong(5),r.getTimestamp(6)==null?null:r.getTimestamp(6).toInstant(),"NEW_CLOSED_TASK_NOTIFICATIONS","BUSINESS_RESULTS_USAGE_IDEMPOTENCY_AUTHORIZATION_DELETION"),tenant,tenant);}
 @Transactional public List<Long> due(){return db.queryForList("SELECT id FROM operation_retention_windows WHERE state<>'COMPLETE' AND due_at<=? ORDER BY due_at,id LIMIT 20",Long.class,Timestamp.from(clock.now()));}
 @Transactional public void clean(long id){
  var rows=db.queryForList("SELECT * FROM operation_retention_windows WHERE id=? AND state<>'COMPLETE' AND due_at<=? FOR UPDATE SKIP LOCKED",id,Timestamp.from(clock.now()));if(rows.isEmpty())return;var row=rows.getFirst();
  int events=db.update("DELETE FROM conversation_events WHERE task_id=? AND seq<=? AND created_at<=?",row.get("task_id"),row.get("through_event"),row.get("original_anchor"));
  // Only redundant task transition audit is eligible; denial/security/permission/lifecycle audit remains.
  int audit=db.update("DELETE FROM identity_audit WHERE tenant_id=? AND target_id=? AND action IN ('TASK_COMPLETE','TASK_FAILED','TASK_CANCELLED','TASK_INTERRUPTED','TASK_SUCCEEDED','TASK_START') AND outcome='SUCCESS' AND created_at<=?",row.get("tenant_id"),row.get("task_id"),row.get("original_anchor"));
  db.update("UPDATE operation_retention_windows SET state='COMPLETE',attempts=attempts+1,error_code=NULL,completed_at=?,removed_events=?,removed_audit=? WHERE id=?",Timestamp.from(clock.now()),events,audit,id);
 }
 @Transactional public void failed(long id){db.update("UPDATE operation_retention_windows SET state='FAILED',attempts=attempts+1,error_code='OPERATION_RETENTION_FAILED' WHERE id=? AND state<>'COMPLETE'",id);}
}
