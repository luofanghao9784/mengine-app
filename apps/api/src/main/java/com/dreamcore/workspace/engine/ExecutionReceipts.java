package com.dreamcore.workspace.engine;

import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@Service
public class ExecutionReceipts {
 private final JdbcTemplate db; private final JsonMapper json=new JsonMapper();
 public ExecutionReceipts(JdbcTemplate db){this.db=db;}
 public record Claim(String inputHash,String engineVersion) {}
 public record Finish(String inputHash,Map<String,Object> result) {}
 private void kind(String kind){if(!Set.of("AGENT","COMPANY").contains(kind))throw IdentityException.invalid();}
 private UUID activeTenant(String kind,UUID task,UUID attempt){
  kind(kind);
  var rows=kind.equals("AGENT")
   ?db.queryForList("SELECT tenant_id FROM conversation_tasks WHERE id=? AND lease_token=? AND status='RUNNING' AND lease_until>clock_timestamp() AND object_is_active('TASK',id)",UUID.class,task,attempt)
   :db.queryForList("SELECT tenant_id FROM company_inference_runs WHERE id=? AND lease_token=? AND state='RUNNING' AND lease_until>clock_timestamp()",UUID.class,task,attempt);
  if(rows.size()!=1)throw new IdentityException(403,"EXECUTION_RECEIPT_DENIED");return rows.getFirst();
 }
 @Transactional public Map<String,Object> claim(String kind,UUID task,UUID attempt,Claim body){
  if(body==null||body.inputHash()==null||!body.inputHash().matches("[a-f0-9]{64}")||body.engineVersion()==null||body.engineVersion().isBlank()||body.engineVersion().length()>100)throw IdentityException.invalid();
  UUID tenant=activeTenant(kind,task,attempt);
  int inserted=db.update("INSERT INTO engine_execution_receipts(kind,task_id,attempt_id,tenant_id,input_hash,engine_version,state) VALUES(?,?,?,?,?,?,'ACCEPTED') ON CONFLICT DO NOTHING",kind,task,attempt,tenant,body.inputHash(),body.engineVersion());
  var row=db.queryForMap("SELECT input_hash,engine_version,result::text FROM engine_execution_receipts WHERE kind=? AND task_id=? AND attempt_id=?",kind,task,attempt);
  if(!body.inputHash().equals(row.get("input_hash"))||!body.engineVersion().equals(row.get("engine_version")))throw new IdentityException(409,"EXECUTION_RECEIPT_CONFLICT");
  if(row.get("result")!=null)return Map.of("state","COMPLETED","result",json.readValue(row.get("result").toString(),Map.class));
  return Map.of("state",inserted==1?"NEW":"ACCEPTED");
 }
 @Transactional public void finish(String kind,UUID task,UUID attempt,Finish body){
  kind(kind);if(body==null||body.result()==null||body.inputHash()==null)throw IdentityException.invalid();
  String payload=json.writeValueAsString(body.result());if(payload.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>262144)throw new IdentityException(413,"EXECUTION_RECEIPT_TOO_LARGE");
  var rows=db.queryForList("SELECT input_hash,engine_version,result::text FROM engine_execution_receipts WHERE kind=? AND task_id=? AND attempt_id=? FOR UPDATE",kind,task,attempt);
  if(rows.size()!=1)throw new IdentityException(409,"EXECUTION_RECEIPT_MISSING");var row=rows.getFirst();
  if(!body.inputHash().equals(row.get("input_hash"))||!row.get("engine_version").equals(body.result().get("engineVersion"))||!task.toString().equals(body.result().get(kind.equals("AGENT")?"taskId":"runId"))||!attempt.toString().equals(body.result().get(kind.equals("AGENT")?"attemptId":"lease")))throw new IdentityException(409,"EXECUTION_RECEIPT_CONFLICT");
  if(row.get("result")!=null){if(!json.readTree(row.get("result").toString()).equals(json.readTree(payload)))throw new IdentityException(409,"EXECUTION_RECEIPT_CONFLICT");return;}
  // Storage is not publication. Late receipts remain private; ordinary source/lease checks gate publication.
  db.update("UPDATE engine_execution_receipts SET state='COMPLETED',result=?::jsonb,completed_at=clock_timestamp() WHERE kind=? AND task_id=? AND attempt_id=?",payload,kind,task,attempt);
 }
 public String result(String kind,UUID task,UUID attempt){
  kind(kind);var rows=db.queryForList("SELECT result::text FROM engine_execution_receipts WHERE kind=? AND task_id=? AND attempt_id=? AND result IS NOT NULL AND accepted_at>now()-interval '7 days'",String.class,kind,task,attempt);return rows.isEmpty()?null:rows.getFirst();
 }
 @org.springframework.scheduling.annotation.Scheduled(fixedDelay=3600000,initialDelay=3600000)
 public void expirePayloads(){db.update("UPDATE engine_execution_receipts SET result=NULL WHERE result IS NOT NULL AND accepted_at<now()-interval '7 days'");}
}
