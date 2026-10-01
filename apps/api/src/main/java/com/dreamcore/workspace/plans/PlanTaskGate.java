package com.dreamcore.workspace.plans;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
/** Independent of PlanService/ConversationService to avoid an execution dependency cycle. */
@Component public class PlanTaskGate {
 private final JdbcTemplate db;private final PlanClock clock;
 private final com.dreamcore.workspace.departure.DepartureAccess departure;
 public PlanTaskGate(JdbcTemplate db,PlanClock clock,com.dreamcore.workspace.departure.DepartureAccess departure){this.departure=departure;this.db=db;this.clock=clock;}
 public boolean allows(UUID task){
  if(!departure.allowsTask(task))return false;
  if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_generation_batches b JOIN briefing_generation_policies p ON p.id=b.policy_id WHERE b.task_id=? AND (b.policy_epoch<>p.epoch OR b.status NOT IN ('QUEUED','RUNNING')))",Boolean.class,task)))return false;
  if(db.queryForObject("SELECT count(*) FROM ongoing_plan_runs WHERE task_id=?",Integer.class,task)==0)return true;
  return Boolean.TRUE.equals(db.queryForObject("""
   SELECT EXISTS(SELECT 1 FROM ongoing_plan_runs r JOIN ongoing_plans p ON p.id=r.plan_id
    JOIN tenants t ON t.id=p.tenant_id JOIN accounts a ON a.id=p.owner_id
    JOIN tenant_memberships m ON m.tenant_id=p.tenant_id AND m.account_id=p.owner_id
    JOIN workspaces w ON w.id=p.workspace_id AND w.tenant_id=p.tenant_id
    WHERE r.task_id=? AND p.status='ACTIVE' AND p.execution_epoch=r.execution_epoch AND p.expires_at>?
    AND r.status NOT IN ('CANCELLED','INTERRUPTED') AND t.status='ACTIVE' AND a.status='ACTIVE' AND m.status='ACTIVE'
    AND ((w.kind='PERSONAL' AND w.owner_id=p.owner_id) OR (w.kind='SHARED' AND EXISTS(
     SELECT 1 FROM workspace_members g WHERE g.tenant_id=p.tenant_id AND g.workspace_id=p.workspace_id AND g.account_id=p.owner_id))))
   """,Boolean.class,task,java.sql.Timestamp.from(clock.now())));
 }
}
