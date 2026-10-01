package com.dreamcore.workspace.plans;
import com.dreamcore.workspace.identity.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
/** Read projection of existing plan facts, not a second queue or a task completion ledger. */
@Service public class PlanAttentionService {
 public record Item(UUID id,UUID workspaceId,String title,String reason,String status,int revision,UUID taskId,UUID conversationId,String action){}
 public record Page(List<Item> items,boolean hasMore){}
 private final JdbcTemplate db;private final IdentityService identities;
 private final com.dreamcore.workspace.departure.DepartureAccess departure;
 public PlanAttentionService(JdbcTemplate db,IdentityService identities,com.dreamcore.workspace.departure.DepartureAccess departure){this.departure=departure;this.db=db;this.identities=identities;}
 @Transactional public Page list(UUID actor,UUID tenant,int offset,int limit){
  if(offset<0||offset>100000||limit<1||limit>50)throw IdentityException.invalid();identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);
  var rows=db.query("""
   SELECT p.id,p.workspace_id,p.goal,p.reason,p.status,p.revision,r.task_id,r.conversation_id FROM ongoing_plans p JOIN workspaces w ON w.id=p.workspace_id
   LEFT JOIN LATERAL(SELECT task_id,conversation_id FROM ongoing_plan_runs WHERE plan_id=p.id ORDER BY created_at DESC,id DESC LIMIT 1) r ON true
   WHERE p.tenant_id=? AND p.owner_id=? AND ((w.kind='PERSONAL' AND w.owner_id=?) OR EXISTS(
    SELECT 1 FROM workspace_members g WHERE g.tenant_id=p.tenant_id AND g.workspace_id=p.workspace_id AND g.account_id=?))
   AND (p.status='AUTHORIZATION_REQUIRED' OR (p.status='ACTIVE' AND ((p.runtime_state='WAITING_DATA' AND p.reason IN ('NO_MATERIALS','SOURCE_REQUIRES_ATTENTION')) OR p.runtime_state='NEEDS_ATTENTION')))
   ORDER BY p.updated_at,p.id LIMIT ? OFFSET ?
   """,(r,n)->new Item(r.getObject("id",UUID.class),r.getObject("workspace_id",UUID.class),r.getString("goal"),r.getString("reason"),r.getString("status"),r.getInt("revision"),r.getObject("task_id",UUID.class),r.getObject("conversation_id",UUID.class),"TASK_NEEDS_ATTENTION".equals(r.getString("reason"))?"OPEN_TASK":"OPEN_PLAN"),tenant,actor,actor,actor,limit+1,offset);
  return new Page(rows.stream().limit(limit).toList(),rows.size()>limit);
 }
}
