package com.dreamcore.workspace.conversation;

import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LiveAnswerService {
 public record Update(int step,int version,String text,String state) {}
 public record Item(UUID taskId,int attempt,int step,int version,String text,String state) {}
 private final JdbcTemplate db;private final AgentTaskService agents;private final ConversationService conversations;
 public LiveAnswerService(JdbcTemplate db,AgentTaskService agents,ConversationService conversations){this.db=db;this.agents=agents;this.conversations=conversations;}
 @Transactional public void publish(UUID task,UUID token,Update value){
  if(value==null||value.step()<1||value.step()>8||value.version()<1||value.text()==null||value.text().length()>65536||value.state()==null||!Set.of("STREAMING","COMPLETE").contains(value.state()))throw IdentityException.invalid();
  agents.check(task,token);
  var rows=db.queryForList("SELECT attempt FROM conversation_tasks WHERE id=? AND lease_token=? AND status='RUNNING' FOR UPDATE",Integer.class,task,token);
  if(rows.isEmpty())throw new IdentityException(403,"TASK_ACCESS_DENIED");
  agents.check(task,token);int attempt=rows.getFirst();
  var prior=db.queryForList("SELECT version,text,state FROM conversation_live_output WHERE task_id=? AND attempt_number=? AND step=?",task,attempt,value.step());
  if(!prior.isEmpty()){
   var p=prior.getFirst();int version=((Number)p.get("version")).intValue();
   if(version==value.version()&&p.get("text").equals(value.text())&&p.get("state").equals(value.state()))return;
   if(version>=value.version()||!p.get("state").equals("STREAMING")||!value.text().startsWith((String)p.get("text")))throw new IdentityException(409,"TASK_STATE_CHANGED");
  }
  db.update("INSERT INTO conversation_live_output(task_id,attempt_number,step,version,text,state) VALUES (?,?,?,?,?,?) ON CONFLICT(task_id,attempt_number,step) DO UPDATE SET version=excluded.version,text=excluded.text,state=excluded.state",task,attempt,value.step(),value.version(),value.text(),value.state());
 }
 @Transactional public List<Item> snapshot(UUID actor,UUID tenant,UUID conversation){
  conversations.require(actor,tenant,conversation,false);
  var rows=db.query("""
   SELECT t.id,t.attempt,s.step,s.version,coalesce(nullif(t.reply,''),s.text),
    CASE WHEN coalesce(t.reply,'')<>'' THEN 'COMPLETE' WHEN t.status='RUNNING' THEN s.state ELSE 'INTERRUPTED' END AS state
   FROM conversation_tasks t JOIN LATERAL (
    SELECT * FROM conversation_live_output o WHERE o.task_id=t.id AND o.attempt_number=t.attempt AND o.text<>'' ORDER BY o.step DESC LIMIT 1
   ) s ON true WHERE t.tenant_id=? AND t.conversation_id=? AND t.origin='USER'
    AND object_is_active('TASK',t.id)
   ORDER BY t.created_at DESC,t.id LIMIT 20
   """,(r,n)->new Item(r.getObject(1,UUID.class),r.getInt(2),r.getInt(3),r.getInt(4),r.getString(5),r.getString(6)),tenant,conversation);
  return rows.stream().filter(r->conversations.sourcesReadable(r.taskId())).toList();
 }
}
