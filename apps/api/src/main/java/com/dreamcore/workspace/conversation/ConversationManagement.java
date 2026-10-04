package com.dreamcore.workspace.conversation;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.MaterialAccess;
import com.dreamcore.workspace.departure.DepartureAccess;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Account-owned visibility/read receipts, separate from execution and shared publications. */
@Service
public class ConversationManagement {
 public record Receipt(UUID id,int revision,Instant trashedAt) {}
 public record ReadReceipt(UUID id,long readReplyRevision) {}
 private final JdbcTemplate db;private final ConversationService conversations;private final IdentityService identities;
 private final MaterialAccess access;private final DepartureAccess departure;private final AgentUsageLedger usage;private final IdentityAudit audit;
 public ConversationManagement(JdbcTemplate db,ConversationService conversations,IdentityService identities,MaterialAccess access,DepartureAccess departure,AgentUsageLedger usage,IdentityAudit audit){this.db=db;this.conversations=conversations;this.identities=identities;this.access=access;this.departure=departure;this.usage=usage;this.audit=audit;}
 private Map<String,Object> owned(UUID actor,UUID tenant,UUID id){
  identities.member(actor,tenant,false);departure.requireActiveBusiness(actor,tenant);
  // Same tenant-before-task order as worker/authority fences; excludes a simultaneous claim.
  db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",tenant);
  var rows=db.queryForList("SELECT * FROM conversations WHERE id=? AND tenant_id=? AND owner_id=? AND purpose='BUSINESS' FOR UPDATE",id,tenant,actor);
  if(rows.isEmpty())throw new IdentityException(404,"CONVERSATION_NOT_FOUND");
  var row=rows.getFirst();access.require(actor,tenant,(UUID)row.get("workspace_id"),false);return row;
 }
 private Receipt receipt(Map<String,Object> row){return new Receipt((UUID)row.get("id"),(Integer)row.get("management_revision"),row.get("trashed_at")==null?null:((java.sql.Timestamp)row.get("trashed_at")).toInstant());}
 @Transactional public Receipt action(UUID actor,UUID tenant,UUID id,UUID key,int expected,String action,boolean stopRunning){
  if(key==null||action==null||expected<0||!Set.of("TRASH","RESTORE").contains(action))throw IdentityException.invalid();
  String fingerprint=IdentityService.hash(tenant+"\n"+id+"\n"+expected+"\n"+action+"\n"+stopRunning);
  var row=owned(actor,tenant,id);UUID prior=identities.priorRequest(actor,key,"CONVERSATION_MANAGEMENT",fingerprint);
  if(prior!=null)return receipt(row);
  if(expected!=(Integer)row.get("management_revision"))throw new IdentityException(409,"CONVERSATION_STATE_CHANGED");
  boolean trashed=row.get("trashed_at")!=null;
  if(action.equals("TRASH")&&!trashed){
   var tasks=db.queryForList("SELECT * FROM conversation_tasks WHERE conversation_id=? AND origin='USER' AND status IN ('QUEUED','RUNNING','PAUSED','WAITING_INPUT','WAITING_CAPABILITY') ORDER BY id FOR UPDATE",id);
   if(!stopRunning&&tasks.stream().anyMatch(t->Set.of("QUEUED","RUNNING").contains(t.get("status"))))throw new IdentityException(409,"CONVERSATION_BUSY");
   for(var task:tasks){
    UUID taskId=(UUID)task.get("id");
    db.update("UPDATE conversation_tasks SET status='CANCELLED',revision=revision+1,lease_token=NULL,lease_until=NULL,wait_reason=NULL,finished_at=now() WHERE id=?",taskId);
    if("RUNNING".equals(task.get("status")))usage.terminal(taskId,(UUID)task.get("lease_token"),"CANCELLED");
    conversations.archive(taskId);
    conversations.event(tenant,(UUID)row.get("workspace_id"),id,taskId,"CANCELLED",(Integer)task.get("revision")+1);
   }
   db.update("UPDATE conversations SET trashed_at=now(),management_revision=management_revision+1 WHERE id=?",id);
  }else if(action.equals("RESTORE")&&trashed){
   db.update("UPDATE conversations SET trashed_at=NULL,management_revision=management_revision+1 WHERE id=?",id);
  }
  identities.remember(actor,key,"CONVERSATION_MANAGEMENT",fingerprint,id);audit.record(actor,tenant,"CONVERSATION_"+action,id,"SUCCESS");
  return receipt(db.queryForMap("SELECT * FROM conversations WHERE id=?",id));
 }
 @Transactional public ReadReceipt read(UUID actor,UUID tenant,UUID id,long revision){
  if(revision<0)throw IdentityException.invalid();conversations.require(actor,tenant,id,true);
  int changed=db.update("UPDATE conversations SET read_reply_revision=greatest(read_reply_revision,?) WHERE id=? AND reply_revision>=?",revision,id,revision);
  if(changed!=1)throw new IdentityException(409,"CONVERSATION_STATE_CHANGED");
  return new ReadReceipt(id,db.queryForObject("SELECT read_reply_revision FROM conversations WHERE id=?",Long.class,id));
 }
}
