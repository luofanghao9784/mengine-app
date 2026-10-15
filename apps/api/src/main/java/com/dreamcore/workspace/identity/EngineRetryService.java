package com.dreamcore.workspace.identity;

import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.dreamcore.workspace.briefing.BriefingGenerationService;
import com.dreamcore.workspace.conversation.ConversationService;
import com.dreamcore.workspace.knowledge.KnowledgeService;
import com.dreamcore.workspace.collection.CollectionService;
import com.dreamcore.workspace.scene.SceneService;
import com.dreamcore.workspace.export.ExportBatchService;
import com.dreamcore.workspace.experience.PlatformExperienceAdjustmentService;
import com.dreamcore.workspace.experience.ExperienceIntakeService;

/** Platform control plane only. Execution still uses the original business actor and domain gates. */
@Service
public class EngineRetryService {
 public record Request(UUID requestId,UUID tenantId,String channel,UUID id,String expectedState,String input) {}
 public record Receipt(UUID id,String state,String message) {}
 private final JdbcTemplate db;private final IdentityService identities;private final IdentityAudit audit;
 private final BriefingGenerationService briefings;private final ConversationService conversations;
 private final KnowledgeService knowledge;private final CollectionService collections;private final SceneService scene;
 private final ExportBatchService exports;private final PlatformExperienceAdjustmentService adjustments;private final ExperienceIntakeService intake;
 public EngineRetryService(JdbcTemplate db,IdentityService identities,IdentityAudit audit,BriefingGenerationService briefings,ConversationService conversations,KnowledgeService knowledge,CollectionService collections,SceneService scene,ExportBatchService exports,PlatformExperienceAdjustmentService adjustments,ExperienceIntakeService intake){
  this.db=db;this.identities=identities;this.audit=audit;this.briefings=briefings;this.conversations=conversations;this.knowledge=knowledge;this.collections=collections;this.scene=scene;this.exports=exports;this.adjustments=adjustments;this.intake=intake;
 }
 private IdentityException changed(){return new IdentityException(409,"ENGINE_RETRY_STATE_CHANGED");}
 private IdentityException unavailable(){return new IdentityException(409,"ENGINE_RETRY_SOURCE_UNAVAILABLE");}
 private Map<String,Object> row(String table,String column,UUID id){
  var rows=db.queryForList("SELECT * FROM "+table+" WHERE "+column+"=? FOR UPDATE",id);
  if(rows.isEmpty())throw new IdentityException(404,"ENGINE_RETRY_NOT_FOUND");return rows.getFirst();
 }
 private UUID uuid(Map<String,Object> r,String key){return (UUID)r.get(key);}
 private String state(Map<String,Object> r){return String.valueOf(r.getOrDefault("status",r.get("state")));}
 private void allowed(Map<String,Object> r,String... states){if(!Set.of(states).contains(state(r)))throw changed();}
 private Receipt receipt(UUID id,String state){return new Receipt(id,state,"已重新检查并提交处理；仍受数据可用性、能力配置和额度限制。");}
 @Transactional public Receipt retry(UUID actor,Request request){
  identities.platform(actor);
  if(request==null||request.requestId()==null||request.id()==null||request.channel()==null||request.expectedState()==null||request.input()!=null&&request.input().length()>2000)throw IdentityException.invalid();
  String table,column="id";
  switch(request.channel()){
   case "TASK","RETRIEVAL" -> table="conversation_tasks";
   case "BRIEFING" -> table="briefing_generation_batches";
   case "KNOWLEDGE" -> table="knowledge_runs";
   case "FILE_TABLE" -> table="materials";
   case "COLLECTION" -> table="collection_runs";
   case "SCENE_KNOWLEDGE" -> table="scene_processing_runs";
   case "COMPANY" -> {table="company_analysis_attempts";column="run_id";}
   case "COMPANY_RETRY" -> {table="company_analysis_items";column="chunk_id";}
   case "EXPERIENCE" -> {table="experience_analysis_items";column="source_id";}
   case "GENERALIZATION" -> {table="experience_generalization_sources";column="version_id";}
   case "GENERAL_ADJUSTMENT" -> table="general_experience_adjustments";
   case "EXPORT" -> table="export_batches";
   default -> throw IdentityException.invalid();
  }
  String hash=IdentityService.hash(request.channel()+":"+request.id()+":"+request.tenantId()+":"+request.expectedState()+":"+Objects.toString(request.input(),""));
  db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","engine-retry-request:"+actor+":"+request.requestId());
  var prior=db.queryForList("SELECT * FROM platform_engine_retries WHERE actor_id=? AND request_id=?",actor,request.requestId());
  if(!prior.isEmpty()){var r=prior.getFirst();if(!hash.equals(r.get("input_hash")))throw new IdentityException(409,"IDEMPOTENCY_CONFLICT");return receipt(uuid(r,"result_id"),(String)r.get("result_state"));}
  // Serialize competing clicks before domain-specific row locks; never erase the old run.
  db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","engine-retry:"+request.channel()+":"+request.id());
  var r=row(table,column,request.id());UUID tenant=uuid(r,"tenant_id");
  if(!Objects.equals(tenant,request.tenantId()))throw new IdentityException(404,"ENGINE_RETRY_NOT_FOUND");
  if(tenant!=null&&db.queryForList("SELECT id FROM tenants WHERE id=? AND status='ACTIVE' FOR SHARE",tenant).isEmpty())throw new IdentityException(409,"ENGINE_RETRY_TENANT_INACTIVE");
  String before=request.channel().equals("FILE_TABLE")?"V"+r.get("current_version"):state(r);String projected=switch(request.channel()){
   case "FILE_TABLE" -> "V"+r.get("current_version");
   case "COMPANY_RETRY" -> before.equals("RETRY_WAIT")?"WAITING_CAPABILITY":before;
   case "KNOWLEDGE" -> before.equals("UNSUPPORTED")?"FAILED":before;
   case "EXPERIENCE" -> {
    var admission=db.queryForList("SELECT outcome FROM experience_admissions WHERE run_id=?",String.class,r.get("run_id"));
    yield !admission.isEmpty()&&admission.getFirst().equals("CONFLICT")?"FAILED":Set.of("RETRY_WAIT","QUALIFIED").contains(before)?"WAITING_CAPABILITY":before;
   }
   case "GENERALIZATION" -> Set.of("RETRY_WAIT","QUALIFIED","CONFLICT").contains(before)?"WAITING_CAPABILITY":before;
   case "GENERAL_ADJUSTMENT" -> before.equals("UNCERTAIN")?"RESULT_UNKNOWN":Set.of("RETRY_WAIT","CONFLICT").contains(before)?"WAITING_CAPABILITY":before;
   default -> before;
  };
  if(!projected.equals(request.expectedState()))throw changed();
  Receipt result=switch(request.channel()){
   case "TASK","RETRIEVAL" -> task(r,request);
   case "BRIEFING" -> briefing(r,request.requestId());
   case "KNOWLEDGE" -> parse(r,request.requestId());
   case "FILE_TABLE" -> fileTable(r,request.requestId());
   case "COLLECTION" -> collect(r,request.requestId());
   case "COMPANY","COMPANY_RETRY" -> company(r,request);
   case "EXPERIENCE" -> experience(r,request.id());
   case "GENERALIZATION" -> generalize(r,request.id());
   case "GENERAL_ADJUSTMENT" -> adjustment(actor,r,request.requestId());
   case "EXPORT" -> {
    allowed(r,"FAILED","PARTIAL","QUEUED");
    if(state(r).equals("QUEUED"))yield receipt(request.id(),"QUEUED");
    if(state(r).equals("PARTIAL")){
     var old=exports.get(uuid(r,"owner_id"),tenant,request.id());
     var b=exports.create(uuid(r,"owner_id"),tenant,uuid(r,"workspace_id"),(String)r.get("scope"),request.requestId(),old.retentionDays(),old.items().stream().map(ExportBatchService.Item::selection).toList());
     yield receipt(b.id(),b.state());
    }
    var b=exports.command(uuid(r,"owner_id"),tenant,request.id(),request.requestId(),(Integer)r.get("revision"),"RETRY");yield receipt(b.id(),b.state());
   }
   case "SCENE_KNOWLEDGE" -> {
    allowed(r,"FAILED","INTERRUPTED","PARTIAL");
    if(!"/scene-knowledge/sync".equals(r.get("operation")))throw changed();
    var v=scene.dispatch(actor,tenant,true,"POST","/scene-knowledge/sync",Map.of("retry",true));
    yield receipt(request.id(),v.path("busy").asBoolean()?"RUNNING":"RECHECKED");
   }
   default -> throw IdentityException.invalid();
  };
  db.update("INSERT INTO platform_engine_retries(actor_id,request_id,tenant_id,channel,source_id,input_hash,previous_state,previous_code,result_id,result_state) VALUES (?,?,?,?,?,?,?,?,?,?)",actor,request.requestId(),tenant,request.channel(),request.id(),hash,before,r.get("error_code"),result.id(),result.state());
  audit.record(actor,tenant,"ENGINE_RETRY",request.id(),"SUCCESS");return result;
 }
 private Receipt task(Map<String,Object> r,Request req){
  allowed(r,"FAILED","INTERRUPTED","RESULT_UNKNOWN","PAUSED","PARTIAL","WAITING_INPUT","WAITING_CAPABILITY","QUEUED");
  UUID owner=uuid(r,"requested_by"),tenant=uuid(r,"tenant_id"),id=uuid(r,"id");
  identities.member(owner,tenant,false);
  if(state(r).equals("QUEUED"))return new Receipt(id,"QUEUED","任务已在执行队列中，保留原任务，不重复创建。");
  if(Boolean.TRUE.equals(r.get("reconciliation_required"))||state(r).equals("RESULT_UNKNOWN")){
   // Reuse the existing server-validated no-business-writes reconciliation gate.
   if("SYSTEM_BRIEFING".equals(r.get("origin"))){
    boolean safe=Boolean.TRUE.equals(db.queryForObject("SELECT task_retry_is_safe(?,?)",Boolean.class,id,r.get("attempt")));
    if(!safe)throw new IdentityException(409,"TASK_RECONCILIATION_REQUIRED");
   }else{
    conversations.action(owner,tenant,uuid(r,"conversation_id"),id,UUID.nameUUIDFromBytes(("reconcile:"+req.requestId()).getBytes(java.nio.charset.StandardCharsets.UTF_8)),(Integer)r.get("revision"),"RECONCILE");
    r=row("conversation_tasks","id",id);
   }
  }
  if("SYSTEM_BRIEFING".equals(r.get("origin"))){
   var priorBatch=db.queryForList("SELECT b.id,b.status FROM platform_engine_retries h JOIN briefing_generation_batches b ON b.id=h.result_id WHERE h.source_id=? AND h.channel IN ('TASK','RETRIEVAL') AND b.status IN ('QUEUED','RUNNING','WAITING_DATA','WAITING_RESOURCE','WAITING_CAPABILITY','SUCCEEDED','NO_NEW_CONTENT') ORDER BY h.created_at DESC LIMIT 1",id);
   if(!priorBatch.isEmpty()){var previous=priorBatch.getFirst();return new Receipt(uuid(previous,"id"),(String)previous.get("status"),"该异常已有后续重试任务，已返回现有处理记录，不重复调用模型。");}
   var batches=db.queryForList("SELECT * FROM briefing_generation_batches WHERE task_id=? FOR UPDATE",id);
   if(batches.isEmpty())throw unavailable();
   briefings.tick(uuid(batches.getFirst(),"policy_id"));
   return briefing(row("briefing_generation_batches","id",uuid(batches.getFirst(),"id")),req.requestId());
  }
  String action=Set.of("FAILED","INTERRUPTED","CANCELLED").contains(state(r))?"RETRY":"RESUME";
  conversations.action(owner,tenant,uuid(r,"conversation_id"),id,req.requestId(),(Integer)r.get("revision"),action,req.input());
  return receipt(id,db.queryForObject("SELECT status FROM conversation_tasks WHERE id=?",String.class,id));
 }
 private Receipt briefing(Map<String,Object> r,UUID key){
  allowed(r,"QUEUED","WAITING_DATA","WAITING_RESOURCE","WAITING_CAPABILITY","FAILED","CANCELLED","AUTHORITY_REVOKED","NO_NEW_CONTENT");
  // Generate reuses a pending batch and preserves quotas, owner access and source selection.
  var b=briefings.generate(uuid(r,"owner_id"),uuid(r,"tenant_id"),key,uuid(r,"workspace_id"),(String)r.get("business_type"));
  briefings.tick(db.queryForObject("SELECT policy_id FROM briefing_generation_batches WHERE id=?",UUID.class,b.id()));
  var latest=briefings.get(uuid(r,"owner_id"),uuid(r,"tenant_id"),b.id());
  return new Receipt(b.id(),latest.status(),latest.reason()==null?"已提交引擎处理。":"已检查执行条件："+latest.reason());
 }
 private Receipt parse(Map<String,Object> r,UUID key){
  allowed(r,"FAILED","PARTIAL","UNSUPPORTED","QUEUED");
  var m=row("materials","id",uuid(r,"material_id"));
  if(!Boolean.TRUE.equals(m.get("in_library"))||!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM material_versions v JOIN materials m ON m.id=v.material_id AND m.current_version=v.number WHERE v.id=?)",Boolean.class,r.get("version_id"))))throw unavailable();
  var latest=db.queryForMap("SELECT * FROM knowledge_runs WHERE version_id=? ORDER BY generation DESC LIMIT 1",r.get("version_id"));
  if(!latest.get("id").equals(r.get("id"))||Set.of("READY","RUNNING").contains(latest.get("status")))throw new IdentityException(409,"ENGINE_RETRY_ALREADY_PROCESSED");
  if(state(r).equals("QUEUED"))return receipt(uuid(r,"id"),"QUEUED");
  UUID actor=uuid(r,"requested_by");if(actor==null)actor=uuid(m,"created_by");
  var a=knowledge.request(actor,uuid(r,"tenant_id"),uuid(r,"workspace_id"),uuid(r,"material_id"),uuid(r,"version_id"),key,(Integer)r.get("generation"));
  return receipt(db.queryForObject("SELECT id FROM knowledge_runs WHERE version_id=? AND generation=?",UUID.class,r.get("version_id"),a.generation()),a.status());
 }
 private Receipt fileTable(Map<String,Object> material,UUID key){
  if(!Boolean.TRUE.equals(material.get("in_library")))throw unavailable();
  var runs=db.queryForList("SELECT k.* FROM knowledge_runs k JOIN material_versions v ON v.id=k.version_id WHERE v.material_id=? AND v.number=? AND lower(v.filename) ~ '[.](csv|tsv|xlsx|xls)$' ORDER BY k.generation DESC LIMIT 1 FOR UPDATE OF k",material.get("id"),material.get("current_version"));
  if(runs.isEmpty())throw unavailable();var r=runs.getFirst();
  if(Set.of("QUEUED","RUNNING").contains(state(r)))return receipt(uuid(r,"id"),state(r));
  var a=knowledge.request(uuid(r,"requested_by"),uuid(r,"tenant_id"),uuid(r,"workspace_id"),uuid(r,"material_id"),uuid(r,"version_id"),key,(Integer)r.get("generation"));
  return receipt(db.queryForObject("SELECT id FROM knowledge_runs WHERE version_id=? AND generation=?",UUID.class,r.get("version_id"),a.generation()),a.status());
 }
 private Receipt collect(Map<String,Object> r,UUID key){
  allowed(r,"FAILED","INTERRUPTED","QUEUED");
  var c=row("data_connections","id",uuid(r,"connection_id"));
  UUID actor=uuid(r,"requested_by");
  if(actor==null){var owners=db.queryForList("SELECT owner_id FROM tenant_governance WHERE tenant_id=?",UUID.class,r.get("tenant_id"));if(owners.isEmpty())throw unavailable();actor=owners.getFirst();}
  var run=collections.updateNow(actor,uuid(r,"tenant_id"),uuid(r,"connection_id"),key,((Number)c.get("revision")).longValue());
  return receipt(run.id(),run.status());
 }
 private Receipt company(Map<String,Object> r,Request req){
  allowed(r,"FAILED","UNKNOWN","RETRY_WAIT","QUEUED");
  List<UUID> chunks=req.channel().equals("COMPANY_RETRY")?List.of(req.id()):db.queryForList("SELECT chunk_id FROM company_analysis_items WHERE run_id=? AND state IN ('FAILED','UNKNOWN','RETRY_WAIT') FOR UPDATE",UUID.class,req.id());
  int changed=0;
  for(UUID chunk:chunks)changed+=db.update("UPDATE company_analysis_items SET state='QUEUED',next_attempt_at=now(),updated_at=now() WHERE chunk_id=? AND tenant_id=? AND state IN ('FAILED','UNKNOWN','RETRY_WAIT','QUEUED') AND EXISTS(SELECT 1 FROM company_analysis_current_chunks c WHERE c.id=chunk_id)",chunk,req.tenantId());
  if(changed==0)throw new IdentityException(409,"ENGINE_RETRY_ALREADY_PROCESSED");
  return receipt(req.id(),"QUEUED");
 }
 private Receipt experience(Map<String,Object> r,UUID id){
  allowed(r,"FAILED","UNKNOWN","RETRY_WAIT","QUALIFIED","QUEUED");
  if(!intake.available(id))throw unavailable();
  if(r.get("run_id")!=null&&Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM experience_admissions WHERE run_id=? AND outcome IN ('CREATED','UPDATED','DUPLICATE'))",Boolean.class,r.get("run_id"))))throw new IdentityException(409,"ENGINE_RETRY_ALREADY_PROCESSED");
  if(state(r).equals("QUALIFIED")&&!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM experience_admissions WHERE run_id=?)",Boolean.class,r.get("run_id"))))return new Receipt(id,"QUALIFIED","模型已完成，正在等待入库核验，不重复调用模型。");
  db.update("UPDATE experience_analysis_items SET state='QUEUED',next_attempt_at=now(),updated_at=now() WHERE source_id=?",id);return receipt(id,"QUEUED");
 }
 private Receipt generalize(Map<String,Object> r,UUID id){
  allowed(r,"FAILED","UNKNOWN","RETRY_WAIT","CONFLICT","QUALIFIED","QUEUED");
  if(!Boolean.TRUE.equals(db.queryForObject("SELECT generalization_source_current(?)",Boolean.class,id)))throw unavailable();
  if(state(r).equals("QUALIFIED"))return receipt(id,"QUALIFIED");
  db.update("UPDATE experience_generalization_sources SET state='QUEUED',next_attempt_at=now(),updated_at=now() WHERE version_id=?",id);return receipt(id,"QUEUED");
 }
 private Receipt adjustment(UUID actor,Map<String,Object> r,UUID key){
  if(Set.of("UNCERTAIN","RUNNING","PUBLISHING").contains(state(r)))throw new IdentityException(409,"TASK_RECONCILIATION_REQUIRED");
  allowed(r,"FAILED","UNKNOWN","CONFLICT","RETRY_WAIT","QUEUED");
  if(Set.of("RETRY_WAIT","QUEUED").contains(state(r))){db.update("UPDATE general_experience_adjustments SET next_attempt_at=now() WHERE id=?",r.get("id"));return receipt(uuid(r,"id"),"QUEUED");}
  var a=adjustments.submit(actor,uuid(r,"entry_id"),new PlatformExperienceAdjustmentService.Change(key,uuid(r,"version_id"),(Integer)r.get("expected_revision"),(String)r.get("content")));return receipt(a.id(),a.state());
 }
}
