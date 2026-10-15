package com.dreamcore.workspace.conversation;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import tools.jackson.databind.json.JsonMapper;

/** Reattaches a completed receipt only to its latest attempt. Publication uses all ordinary validators. */
@Service
public class AgentReceiptRecovery {
 private final JdbcTemplate db;private final AgentTaskService agents;private final TransactionTemplate transactions;private final JsonMapper json=new JsonMapper();
 public AgentReceiptRecovery(JdbcTemplate db,AgentTaskService agents,PlatformTransactionManager manager){this.db=db;this.agents=agents;this.transactions=new TransactionTemplate(manager);}
 public void recover(){
  var candidates=db.queryForList("SELECT r.task_id,r.attempt_id,t.tenant_id FROM engine_execution_receipts r JOIN conversation_tasks t ON t.id=r.task_id JOIN conversation_attempts a ON a.task_id=t.id AND a.attempt_number=t.attempt AND a.attempt_id=r.attempt_id WHERE r.kind='AGENT' AND r.result IS NOT NULL AND r.accepted_at>now()-interval '7 days' AND r.completed_at<now()-interval '5 seconds' AND t.status IN ('RUNNING','RESULT_UNKNOWN') AND (r.recovery_checked_at IS NULL OR r.recovery_checked_at<now()-interval '5 minutes') ORDER BY r.completed_at LIMIT 20");
  for(var candidate:candidates)try{transactions.executeWithoutResult(status->{
   UUID tenant=(UUID)candidate.get("tenant_id"),id=(UUID)candidate.get("task_id"),attempt=(UUID)candidate.get("attempt_id");
   db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",tenant);
   var rows=db.queryForList("SELECT t.*,r.result::text AS receipt FROM conversation_tasks t JOIN conversation_attempts a ON a.task_id=t.id AND a.attempt_number=t.attempt JOIN engine_execution_receipts r ON r.kind='AGENT' AND r.task_id=t.id AND r.attempt_id=a.attempt_id WHERE t.id=? AND a.attempt_id=? AND t.status IN ('RUNNING','RESULT_UNKNOWN') AND r.result IS NOT NULL FOR UPDATE OF t",id,attempt);
   if(rows.isEmpty())return;var row=rows.getFirst();
   // No model call or tool execution is allowed here. The lease is only restored inside this publication transaction.
   db.update("UPDATE conversation_tasks SET status='RUNNING',lease_token=?,lease_until=clock_timestamp()+interval '30 seconds' WHERE id=?",attempt,id);
   var job=new ConversationService.Job(id,tenant,(UUID)row.get("workspace_id"),(UUID)row.get("conversation_id"),(UUID)row.get("requested_by"),(String)row.get("prompt"),attempt,"AGENT");
   agents.finish(job,json.readValue(row.get("receipt").toString(),AgentResult.class));
   db.update("UPDATE conversation_tasks SET reconciliation_required=false WHERE id=?",id);
   db.update("UPDATE engine_execution_receipts SET recovery_checked_at=now(),recovery_error_code='RECOVERED' WHERE kind='AGENT' AND task_id=? AND attempt_id=?",id,attempt);
  });}catch(Exception rejected){
   // Rollback preserves UNKNOWN; throttle rejected receipts so they cannot starve other tenants.
   try{db.update("UPDATE engine_execution_receipts SET recovery_checked_at=now(),recovery_error_code=? WHERE kind='AGENT' AND task_id=? AND attempt_id=?",rejected instanceof com.dreamcore.workspace.identity.IdentityException e?e.code:"RECOVERY_UNAVAILABLE",candidate.get("task_id"),candidate.get("attempt_id"));}catch(Exception unavailable){}
  }
 }
}
