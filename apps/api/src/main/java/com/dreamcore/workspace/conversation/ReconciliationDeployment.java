package com.dreamcore.workspace.conversation;

import com.dreamcore.workspace.context.*;
import com.dreamcore.workspace.material.MaterialAccess;
import java.nio.file.*;
import java.util.*;
import org.springframework.stereotype.Component;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.core.env.Environment;
import tools.jackson.databind.json.JsonMapper;

/** Local host-only Codex first-round execution. Never impersonates a runtime model call. */
@Component
public class ReconciliationDeployment {
 private final JdbcTemplate db;private final TransactionTemplate tx;private final Environment env;private final ConversationService conversations;private final TaskContextService context;private final TaskContextGuard guard;private final MaterialAccess access;
 public ReconciliationDeployment(JdbcTemplate db,TransactionTemplate tx,Environment env,ConversationService conversations,TaskContextService context,TaskContextGuard guard,MaterialAccess access){this.db=db;this.tx=tx;this.env=env;this.conversations=conversations;this.context=context;this.guard=guard;this.access=access;}
 @org.springframework.beans.factory.annotation.Autowired private FirstBriefingDeployment firstBriefing;
 public record Input(UUID tenantId,UUID actorId,UUID workspaceId,String storeId,String dateFrom,String dateTo) {}
 public void run() throws Exception {
  if(!Arrays.asList(env.getActiveProfiles()).contains("local")||!"verification".equals(env.getProperty("dreamcore.tasks.agent-mode")))throw new IllegalStateException("Local only");
  var json=new JsonMapper();var input=Path.of(env.getRequiredProperty("RECONCILIATION_TASK_FILE"));var output=Path.of(env.getRequiredProperty("RECONCILIATION_TASK_RECEIPT"));
  if(!input.isAbsolute()||!output.isAbsolute()||Files.exists(output)||!Files.isRegularFile(input,LinkOption.NOFOLLOW_LINKS)||Files.size(input)>65536)throw new IllegalArgumentException();
  if(json.readTree(Files.readString(input)).has("action")){
   var result=firstBriefing.execute(json.readValue(Files.readString(input),FirstBriefingDeployment.Input.class));
   Files.createFile(output,java.nio.file.attribute.PosixFilePermissions.asFileAttribute(java.nio.file.attribute.PosixFilePermissions.fromString("rw-------")));
   Files.writeString(output,json.writeValueAsString(result));return;
  }
  var m=json.readValue(Files.readString(input),Input.class);
  var result=tx.execute(status->{
   access.require(m.actorId(),m.tenantId(),m.workspaceId(),false);
   var d=conversations.submit(m.actorId(),m.tenantId(),null,m.workspaceId(),UUID.randomUUID(),"Codex首轮固定三表核查；不计算净收入或利润","AGENT");
   UUID id=d.tasks().getLast().id(),token=UUID.randomUUID();
   db.update("UPDATE conversation_tasks SET status='QUEUED',execution_class='verification',source_scope='WORKSPACE',wait_reason=NULL WHERE id=?",id);
   db.update("INSERT INTO conversation_attempts(task_id,attempt_number,attempt_id,input,status,started_at,provenance,execution_policy,allowed_tools) VALUES (?,1,?,'Codex首轮固定三表核查','RUNNING',now(),'EXTERNAL_DEPLOYMENT','READ_ONLY_PRIVATE_V1','[\"task_context\"]')",id,token);
   db.update("UPDATE conversation_tasks SET status='RUNNING',attempt=1,revision=revision+1,lease_token=?,lease_until=now()+interval '10 minutes',wait_reason=NULL WHERE id=?",token,id);
   db.update("INSERT INTO conversation_tool_receipts(task_id,attempt_number,sequence,name,status,started_at) VALUES (?,1,1,'task_context','STARTED',now())",id);
   var r=context.context(id,token,new TaskContextService.Request("reconciliation_execute",null,null,null,null,null,null,null,null,null,null,null,null,m.storeId(),m.dateFrom(),m.dateTo()));
   guard.requireCurrent(id);
   db.update("UPDATE conversation_tool_receipts SET status='succeeded',received_at=now(),finished_at=now() WHERE task_id=? AND sequence=1",id);
   db.update("UPDATE conversation_tasks SET status='SUCCEEDED',reply='固定三表核查已完成，详见任务计算回执；非净收入或利润。',revision=revision+1,model_name='codex-external',model_calls=NULL,token_usage=NULL,engine_version='deployment-1',lease_token=NULL,lease_until=NULL,finished_at=now() WHERE id=?",id);
   conversations.archive(id);
   return r;
  });
  Files.createFile(output,java.nio.file.attribute.PosixFilePermissions.asFileAttribute(java.nio.file.attribute.PosixFilePermissions.fromString("rw-------")));
  Files.writeString(output,json.writeValueAsString(result));
 }
}
