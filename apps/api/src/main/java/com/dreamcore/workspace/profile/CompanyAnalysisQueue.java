package com.dreamcore.workspace.profile;
import com.dreamcore.workspace.identity.*;
import java.util.*;import java.time.Instant;
import org.springframework.jdbc.core.JdbcTemplate;import org.springframework.stereotype.Service;import org.springframework.transaction.annotation.Transactional;

/** Durable dispatch ledger: provider calls and uncertain outcomes are never inferred from UI state. */
@Service
public class CompanyAnalysisQueue {
 public record Recovery(UUID id,UUID lease,String engineVersion,String state,boolean expired,boolean recoveryExpired) {}
 public record Status(String state,int pending,int running,int attention,Instant lastCompletedAt) {}
 private final JdbcTemplate db;private final CompanyInferenceService inference;private final IdentityService identities;
 public CompanyAnalysisQueue(JdbcTemplate db,CompanyInferenceService inference,IdentityService identities){this.db=db;this.inference=inference;this.identities=identities;}
 @Transactional public void discover(){
  db.update("INSERT INTO company_analysis_items(chunk_id,tenant_id,state) SELECT c.id,c.tenant_id,'QUEUED' FROM company_analysis_current_chunks c WHERE NOT EXISTS(SELECT 1 FROM company_analysis_items i WHERE i.chunk_id=c.id) ORDER BY c.tenant_id,c.id LIMIT 200 ON CONFLICT DO NOTHING");
  db.update("UPDATE company_analysis_items i SET state='CANCELLED',error_code='COMPANY_SOURCE_CHANGED',updated_at=now() WHERE state IN ('QUEUED','RETRY_WAIT') AND NOT EXISTS(SELECT 1 FROM company_analysis_current_chunks c WHERE c.id=i.chunk_id)");
  db.update("UPDATE company_analysis_items i SET state='QUEUED',run_id=NULL,attempts=0,error_code=NULL,next_attempt_at=now()+interval '30 seconds',updated_at=now() WHERE (i.state='CANCELLED' OR i.state='SUCCEEDED' AND EXISTS(SELECT 1 FROM company_inference_runs r WHERE r.id=i.run_id AND r.fenced)) AND EXISTS(SELECT 1 FROM company_analysis_current_chunks c WHERE c.id=i.chunk_id)");
 }
 @Transactional(readOnly=true) public List<UUID> tenants(){return db.queryForList("SELECT i.tenant_id FROM company_analysis_items i WHERE i.state IN ('QUEUED','RETRY_WAIT') AND i.next_attempt_at<=clock_timestamp() AND (SELECT count(*) FROM company_analysis_attempts a WHERE a.tenant_id=i.tenant_id AND a.state IN ('CLAIMED','DISPATCHED'))<2 GROUP BY i.tenant_id ORDER BY min(i.next_attempt_at),i.tenant_id LIMIT 20",UUID.class);}
 @Transactional public CompanyInferenceService.Job claim(UUID tenant){
  db.queryForList("SELECT id FROM tenants WHERE id=? FOR SHARE",tenant);
  db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","company-analysis:"+tenant);
  var slots=db.queryForList("SELECT slot FROM generate_series(1,2) AS slot WHERE NOT EXISTS(SELECT 1 FROM company_analysis_attempts WHERE tenant_id=? AND dispatch_slot=slot AND state IN ('CLAIMED','DISPATCHED')) ORDER BY slot LIMIT 1",Integer.class,tenant);
  if(slots.isEmpty())return null;
  var actors=db.queryForList("SELECT m.account_id FROM tenant_memberships m JOIN accounts a ON a.id=m.account_id LEFT JOIN tenant_governance g ON g.tenant_id=m.tenant_id WHERE m.tenant_id=? AND m.status='ACTIVE' AND a.status='ACTIVE' AND (m.role='TENANT_ADMIN' OR m.account_id=g.owner_id OR EXISTS(SELECT 1 FROM governance_capabilities c WHERE c.tenant_id=m.tenant_id AND c.account_id=m.account_id AND c.workspace_id IS NULL AND c.capability='PROFILE_MAINTAIN')) ORDER BY (m.account_id=g.owner_id) DESC NULLS LAST,m.account_id LIMIT 1",UUID.class,tenant);
  if(actors.isEmpty())return null;
  // Choose a file, not random UUID fragments. Another batch may analyze another file.
  var versions=db.queryForList("SELECT c.version_id FROM company_analysis_items i JOIN company_analysis_current_chunks eligible ON eligible.id=i.chunk_id JOIN knowledge_chunks c ON c.id=i.chunk_id WHERE i.tenant_id=? AND i.state IN ('QUEUED','RETRY_WAIT') AND i.next_attempt_at<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM company_analysis_items busy JOIN knowledge_chunks bc ON bc.id=busy.chunk_id WHERE bc.version_id=c.version_id AND busy.state='RUNNING') ORDER BY i.next_attempt_at,c.version_id,c.ordinal LIMIT 1",UUID.class,tenant);
  if(versions.isEmpty())return null;
  var file=db.queryForList("SELECT c.id,c.content,i.state,i.next_attempt_at<=clock_timestamp() AS due FROM knowledge_chunks c JOIN company_analysis_current_chunks eligible ON eligible.id=c.id LEFT JOIN company_analysis_items i ON i.chunk_id=c.id WHERE c.version_id=? ORDER BY c.ordinal,c.id",versions.getFirst());
  var chunks=new ArrayList<UUID>();var pending=new ArrayList<UUID>();int characters=0;
  for(var part:file){
   int size=((String)part.get("content")).length();
   if(!chunks.isEmpty()&&(chunks.size()>=64||characters+size>8000)){
    if(!pending.isEmpty())break;
    chunks.clear();characters=0;
   }
   chunks.add((UUID)part.get("id"));characters+=size;
   if(Set.of("QUEUED","RETRY_WAIT").contains(String.valueOf(part.get("state")))&&Boolean.TRUE.equals(part.get("due")))pending.add((UUID)part.get("id"));
  }
  if(pending.isEmpty())return null;
  var job=inference.begin(actors.getFirst(),tenant,chunks);
  db.update("INSERT INTO company_analysis_attempts(run_id,tenant_id,state,dispatch_slot) VALUES (?,?,'CLAIMED',?)",job.id(),tenant,slots.getFirst());
  for(UUID chunk:pending)db.update("UPDATE company_analysis_items SET state='RUNNING',run_id=?,error_code=NULL,updated_at=now() WHERE chunk_id=?",job.id(),chunk);
  return job;
 }
 @Transactional public void dispatched(CompanyInferenceService.Job job,CompanyAnalysisRuntime.Descriptor runtime){
  if(!inference.active(job.id(),job.lease()))throw new IdentityException(409,"COMPANY_SOURCE_CHANGED");
  int n=db.update("UPDATE company_analysis_attempts SET state='DISPATCHED',engine_version=?,execution_class=? WHERE run_id=? AND state='CLAIMED'",runtime.engineVersion(),runtime.executionClass(),job.id());
  if(n!=1)throw new IdentityException(409,"COMPANY_INFERENCE_UNAVAILABLE");
  db.update("UPDATE company_analysis_items SET attempts=attempts+1 WHERE run_id=? AND state='RUNNING'",job.id());
 }
 @Transactional public void complete(CompanyAnalysisRuntime.Result result){
  var rows=db.queryForList("SELECT state FROM company_analysis_attempts WHERE run_id=? FOR UPDATE",String.class,result.runId());
  if(rows.isEmpty()||!rows.getFirst().equals("DISPATCHED"))return;
  if(!result.outcome().equals("COMPLETE"))throw new IdentityException(422,"COMPANY_ANALYSIS_FAILED");
  inference.finish(result.runId(),result.lease(),result.candidates());
  metadata(result.runId(),"RETURNED",null,result,false);
  db.update("UPDATE company_analysis_items SET state='SUCCEEDED',error_code=NULL,updated_at=now() WHERE run_id=?",result.runId());
 }
 private void metadata(UUID run,String state,String code,CompanyAnalysisRuntime.Result r,boolean noCall){
  db.update("UPDATE company_analysis_attempts SET state=?,error_code=?,model_name=?,model_calls=?,input_tokens=?,output_tokens=?,finished_at=now() WHERE run_id=?",state,code,r==null?null:r.modelName(),r==null?(noCall?0:null):r.modelCalls(),r==null?(noCall?0L:null):r.inputTokens(),r==null?(noCall?0L:null):r.outputTokens(),run);
 }
 @Transactional public void fail(UUID run,String code,boolean sent,CompanyAnalysisRuntime.Result result){
  var rows=db.queryForList("SELECT state FROM company_analysis_attempts WHERE run_id=? FOR UPDATE",String.class,run);if(rows.isEmpty()||!Set.of("CLAIMED","DISPATCHED").contains(rows.getFirst()))return;
  boolean unknown=code.equals("COMPANY_RESULT_UNKNOWN"),cancelled=code.equals("COMPANY_SOURCE_CHANGED");
  if(!sent&&rows.getFirst().equals("DISPATCHED"))db.update("UPDATE company_analysis_items SET attempts=greatest(0,attempts-1) WHERE run_id=?",run);
  metadata(run,unknown?"UNKNOWN":cancelled?"CANCELLED":"FAILED",code,result,!sent);
  db.update("UPDATE company_inference_runs SET state=?,finished_at=now() WHERE id=? AND state='RUNNING'",cancelled?"CANCELLED":"FAILED",run);
  db.update("UPDATE company_analysis_items SET state=CASE WHEN ? THEN 'UNKNOWN' WHEN ? THEN 'CANCELLED' WHEN attempts>=3 THEN 'FAILED' ELSE 'RETRY_WAIT' END,error_code=?,next_attempt_at=now()+CASE WHEN ? THEN interval '60 seconds'*greatest(1,attempts) ELSE interval '5 minutes' END,updated_at=now() WHERE run_id=?",unknown,cancelled,code,sent,run);
 }
 @Transactional public void uncertain(UUID run){db.update("UPDATE company_analysis_attempts SET error_code='COMPANY_RESULT_PENDING' WHERE run_id=? AND state='DISPATCHED'",run);}
 @Transactional(readOnly=true) public List<Recovery> recoveries(){return db.query("SELECT a.run_id,r.lease_token,a.engine_version,a.state,r.lease_until<clock_timestamp() AS expired,a.created_at<clock_timestamp()-interval '9 minutes' AS recovery_expired FROM company_analysis_attempts a JOIN company_inference_runs r ON r.id=a.run_id WHERE a.state='DISPATCHED' AND a.created_at<clock_timestamp()-interval '5 seconds' OR a.state='CLAIMED' AND r.lease_until<clock_timestamp() ORDER BY a.created_at LIMIT 50",(r,n)->new Recovery(r.getObject("run_id",UUID.class),r.getObject("lease_token",UUID.class),r.getString("engine_version"),r.getString("state"),r.getBoolean("expired"),r.getBoolean("recovery_expired")));}
 @Transactional public Status status(UUID actor,UUID tenant,boolean configured){
  identities.member(actor,tenant,false);
  var row=db.queryForMap("SELECT count(*) FILTER(WHERE state IN ('QUEUED','RETRY_WAIT')) AS pending,count(*) FILTER(WHERE state='RUNNING') AS running,count(*) FILTER(WHERE state IN ('FAILED','UNKNOWN')) AS attention,max(updated_at) FILTER(WHERE state='SUCCEEDED') AS completed FROM company_analysis_items WHERE tenant_id=?",tenant);
  int pending=((Number)row.get("pending")).intValue(),running=((Number)row.get("running")).intValue(),attention=((Number)row.get("attention")).intValue();var completed=(java.sql.Timestamp)row.get("completed");
  return new Status(!configured?"DISABLED":running>0?"PROCESSING":attention>0?"ATTENTION":pending>0?"WAITING":"IDLE",pending,running,attention,completed==null?null:completed.toInstant());
 }
}
