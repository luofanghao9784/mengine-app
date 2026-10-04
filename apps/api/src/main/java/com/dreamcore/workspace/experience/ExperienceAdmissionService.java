package com.dreamcore.workspace.experience;
import com.dreamcore.workspace.identity.*;
import java.util.*;import org.springframework.jdbc.core.JdbcTemplate;import org.springframework.stereotype.Service;import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Automatic transaction only. No approval route; publication is still bounded by source authorization. */
@Service
public class ExperienceAdmissionService {
 public record Receipt(UUID runId,String outcome,UUID entryId,UUID versionId) {}
 private final JdbcTemplate db;private final ExperienceAnalysisQueue queue;private final ExperienceService experiences;private final IdentityAudit audit;private final JsonMapper json=new JsonMapper();
 public ExperienceAdmissionService(JdbcTemplate db,ExperienceAnalysisQueue queue,ExperienceService experiences,IdentityAudit audit){this.db=db;this.queue=queue;this.experiences=experiences;this.audit=audit;}
 @Transactional(readOnly=true) public List<UUID> pending(){return db.queryForList("SELECT r.id FROM experience_analysis_runs r JOIN tenants t ON t.id=r.tenant_id AND t.status='ACTIVE' WHERE r.state='RETURNED' AND r.outcome='QUALIFIED' AND r.execution_class='live' AND NOT r.invalidated AND r.candidate IS NOT NULL AND NOT EXISTS(SELECT 1 FROM experience_admissions a WHERE a.run_id=r.id) ORDER BY r.created_at,r.id LIMIT 30",UUID.class);}
 private Receipt receipt(UUID run,UUID source,String outcome,UUID entry,UUID version){
  db.update("INSERT INTO experience_admissions(run_id,source_id,outcome,entry_id,version_id) VALUES (?,?,?,?,?)",run,source,outcome,entry,version);
  db.update("UPDATE experience_analysis_runs SET candidate=NULL,review=NULL,evidence=NULL WHERE id=?",run);
  db.update("UPDATE experience_adjustments SET finished=true,content=NULL WHERE id=?",source);
  db.update("UPDATE general_experience_suggestions SET finished=true,content=NULL WHERE id=?",source);
  return new Receipt(run,outcome,entry,version);
 }
 private void event(UUID actor,UUID tenant,UUID entry,UUID version,int revision,String action){db.update("INSERT INTO experience_events(id,entry_id,version_id,revision,action,actor_id) VALUES (?,?,?,?,?,?)",UUID.randomUUID(),entry,version,revision,action,actor);audit.record(actor,tenant,"EXPERIENCE_AUTO_"+action,entry,"SUCCESS");}
 private List<String> strings(tools.jackson.databind.JsonNode value){return Arrays.asList(json.readValue(value.toString(),String[].class));}
 @Transactional public Receipt admit(UUID run){
  var scope=db.queryForList("SELECT r.tenant_id,r.source_id,i.owner_id,i.workspace_id,i.general_suggestion_id FROM experience_analysis_runs r JOIN experience_intake_sources i ON i.id=r.source_id WHERE r.id=?",run);
  if(scope.isEmpty())throw new IdentityException(404,"EXPERIENCE_ANALYSIS_NOT_FOUND");var initial=scope.getFirst();new com.dreamcore.workspace.support.SupportAccess(db).bindObject((UUID)initial.get("owner_id"),(UUID)initial.get("tenant_id"),"experience_intake_sources",(UUID)initial.get("source_id"));
  db.queryForList("SELECT id FROM tenants WHERE id=? FOR SHARE",initial.get("tenant_id"));
  db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","experience-admission:"+initial.get("tenant_id")+":"+initial.get("workspace_id")+":"+initial.get("owner_id"));
  db.queryForList("SELECT pg_advisory_xact_lock_shared(hashtextextended('general-use:'||?::text,0))",initial.get("tenant_id"));
  // Lock both new proposals and inherited fixed general dependencies before source revalidation.
  db.queryForList("SELECT e.id FROM general_experience_entries e JOIN general_experience_versions v ON v.entry_id=e.id WHERE v.id IN (SELECT a.base_version FROM general_experience_suggestions s JOIN general_experience_ancestry a ON a.version_id=s.version_id WHERE s.id=? UNION SELECT d.general_version_id FROM experience_analysis_runs r CROSS JOIN LATERAL jsonb_array_elements_text(r.manifest->'versions') x JOIN experience_general_dependency_closure d ON d.version_id::text=x.value WHERE r.id=?) ORDER BY e.id,v.id FOR SHARE OF e,v",initial.get("general_suggestion_id"),run);
  db.queryForList("SELECT id FROM experience_intake_sources WHERE id=? FOR SHARE",initial.get("source_id"));
  var rows=db.queryForList("SELECT r.*,i.owner_id,i.workspace_id,i.task_id,i.feedback_id,i.adjustment_id,i.general_suggestion_id FROM experience_analysis_runs r JOIN experience_intake_sources i ON i.id=r.source_id WHERE r.id=? FOR UPDATE OF r",run);if(rows.isEmpty())throw new IdentityException(404,"EXPERIENCE_ANALYSIS_NOT_FOUND");var r=rows.getFirst();UUID source=(UUID)r.get("source_id"),tenant=(UUID)r.get("tenant_id"),actor=(UUID)r.get("owner_id"),space=(UUID)r.get("workspace_id");
  var prior=db.query("SELECT outcome,entry_id,version_id FROM experience_admissions WHERE run_id=?",(q,n)->new Receipt(run,q.getString(1),q.getObject(2,UUID.class),q.getObject(3,UUID.class)),run);if(!prior.isEmpty())return prior.getFirst();
  if(!"RETURNED".equals(r.get("state"))||!"QUALIFIED".equals(r.get("outcome"))||!"live".equals(r.get("execution_class")))throw new IdentityException(409,"EXPERIENCE_NOT_QUALIFIED");
  if((Boolean)r.get("invalidated")||r.get("candidate")==null)return receipt(run,source,"SOURCE_UNAVAILABLE",null,null);
  if(!Boolean.TRUE.equals(db.queryForObject("SELECT status='ACTIVE' FROM tenants WHERE id=?",Boolean.class,tenant)))throw new IdentityException(409,"TENANT_SUSPENDED");
  // Freeze referenced versions through admission; concurrent withdrawal then observes the new dependency.
  var manifest=json.readTree(r.get("manifest").toString());
  var versionIds=Arrays.asList(json.readValue(manifest.get("versions").toString(),UUID[].class));
  for(UUID id:versionIds.stream().sorted().toList()){
   db.queryForList("SELECT e.id FROM experience_entries e JOIN experience_versions v ON v.entry_id=e.id WHERE v.id=? FOR SHARE OF e",id);
   db.queryForList("SELECT id FROM experience_versions WHERE id=? FOR SHARE",id);
  }
  ExperienceAnalysisRuntime.Job job=queue.restoreForAdmission(run);if(job==null)return receipt(run,source,"SOURCE_UNAVAILABLE",null,null);
  var c=json.readTree(r.get("candidate").toString());var tags=strings(c.get("tags")).stream().map(s->s.strip().toLowerCase(Locale.ROOT)).distinct().sorted().toList();
  var content=new ExperienceService.Content("METHOD",c.get("title").asString(),c.get("summary").asString(),String.join("\n",strings(c.get("steps"))),tags,String.join("\n",strings(c.get("applicable"))),String.join("\n",strings(c.get("excluded"))),"使用前重新核对当前可用工具与来源范围。","系统已完成来源、适用边界、隐私与新增价值检查；不代表已证明所有场景的业务效果。","SOURCE_BOUND");
  // Keep the existing public experience limits. Do not silently truncate an admitted method.
  if(tags.stream().anyMatch(t->t.length()>40)||content.applicable().length()>2000||content.excluded().length()>2000)return receipt(run,source,"CONFLICT",null,null);
  try{content=experiences.automaticContent(content);}catch(IdentityException invalid){return receipt(run,source,"CONFLICT",null,null);}
  String fingerprint=IdentityService.hash(json.writeValueAsString(content));UUID target=c.get("targetVersionId").isNull()?null:UUID.fromString(c.get("targetVersionId").asString());
  boolean suggestion=r.get("general_suggestion_id")!=null;
  UUID generalVersion=suggestion?db.queryForObject("SELECT version_id FROM general_experience_suggestions WHERE id=?",UUID.class,source):null;
  if(suggestion&&target!=null)return receipt(run,source,"CONFLICT",null,null);
  boolean adjustment=r.get("adjustment_id")!=null;
  if(adjustment){
   var proposal=db.queryForMap("SELECT entry_id,version_id,expected_revision FROM experience_adjustments WHERE id=?",r.get("adjustment_id"));
   if(!Objects.equals(target,proposal.get("version_id")))return receipt(run,source,"CONFLICT",null,null);
   try{experiences.adjustmentTarget(actor,tenant,space,(UUID)proposal.get("entry_id"),target,((Number)proposal.get("expected_revision")).intValue());}catch(IdentityException changed){return receipt(run,source,"CONFLICT",null,null);}
  }
  Map<String,Object> entry=null;UUID current=null;
  if(target!=null){
   if(job.existing().stream().noneMatch(e->e.versionId().equals(target)))return receipt(run,source,"CONFLICT",null,null);
   var matches=db.queryForList("SELECT e.*,v.id version_id,v.origin FROM experience_entries e JOIN experience_versions v ON v.entry_id=e.id WHERE v.id=? AND e.tenant_id=? AND e.workspace_id=? AND (e.created_by=? OR ?) FOR UPDATE OF e",target,tenant,space,actor,adjustment);
   if(matches.isEmpty()||!adjustment&&!"AUTOMATIC".equals(matches.getFirst().get("origin")))return receipt(run,source,"CONFLICT",null,null);entry=matches.getFirst();current=(UUID)entry.get("published_version");
   if(!target.equals(current)||Boolean.TRUE.equals(entry.get("automation_stopped")))return receipt(run,source,"CONFLICT",(UUID)entry.get("id"),null);
  }else{
   var matches=db.queryForList("SELECT e.*,v.id version_id,v.scrubbed FROM experience_versions v JOIN experience_entries e ON e.id=v.entry_id WHERE v.origin='AUTOMATIC' AND v.content_fingerprint=? AND e.tenant_id=? AND e.workspace_id=? AND e.created_by=? ORDER BY e.created_at,v.number DESC LIMIT 1 FOR UPDATE OF e",fingerprint,tenant,space,actor);
   if(!matches.isEmpty()){entry=matches.getFirst();current=(UUID)entry.get("published_version");if(Boolean.TRUE.equals(entry.get("automation_stopped"))||current!=null&&!current.equals(entry.get("version_id")))return receipt(run,source,"CONFLICT",(UUID)entry.get("id"),null);}
  }
  if(suggestion&&entry!=null&&current==null)return receipt(run,source,"CONFLICT",(UUID)entry.get("id"),null);
  // A duplicate is an observation only: never mutate immutable content, evidence or authorization.
  if(current!=null&&fingerprint.equals(db.queryForObject("SELECT content_fingerprint FROM experience_versions WHERE id=?",String.class,current)))return receipt(run,source,"DUPLICATE",(UUID)entry.get("id"),current);
  var refs=new LinkedHashSet<ExperienceService.Evidence>();
  if(r.get("task_id")!=null)refs.add(new ExperienceService.Evidence("TASK",(UUID)r.get("task_id"),space));
  if(r.get("feedback_id")!=null)refs.addAll(db.query("SELECT f.version_id,v.workspace_id FROM feedback_source_versions f JOIN material_versions v ON v.id=f.version_id WHERE f.feedback_id=?",(q,n)->new ExperienceService.Evidence("MATERIAL_VERSION",q.getObject(1,UUID.class),q.getObject(2,UUID.class)),r.get("feedback_id")));
  var dependencies=new LinkedHashSet<UUID>();
  for(var existing:job.existing()){
   var rowsForVersion=db.queryForList("SELECT entry_id FROM experience_versions WHERE id=?",UUID.class,existing.versionId());if(rowsForVersion.isEmpty())return receipt(run,source,"SOURCE_UNAVAILABLE",null,null);
   var item=experiences.analysisEntry(actor,tenant,space,rowsForVersion.getFirst(),existing.versionId());refs.addAll(item.version().evidence());dependencies.add(existing.versionId());
  }
  boolean hasGeneral=generalVersion!=null||dependencies.stream().anyMatch(v->Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM experience_general_dependency_closure WHERE version_id=?)",Boolean.class,v)));
  // Empty TASK/material evidence is allowed only with a separately verified fixed general binding.
  try{if(!refs.isEmpty()||!hasGeneral)refs=new LinkedHashSet<>(experiences.automaticEvidence(actor,tenant,content,List.copyOf(refs)));}catch(IdentityException unavailable){return receipt(run,source,unavailable.status==400?"CONFLICT":"SOURCE_UNAVAILABLE",null,null);}
  UUID entryId=entry==null?UUID.randomUUID():(UUID)entry.get("id");
  int number=entry==null?1:((Number)entry.get("latest_number")).intValue()+1,revision=entry==null?1:((Number)entry.get("revision")).intValue()+1;
  if(entry==null)db.update("INSERT INTO experience_entries(id,tenant_id,workspace_id,created_by) VALUES (?,?,?,?)",entryId,tenant,space,actor);
  UUID version=experiences.appendAutomatic(actor,entryId,number,content,List.copyOf(refs),fingerprint);
  db.update("UPDATE experience_versions SET automatic_basis=?,automatic_steps=?::jsonb WHERE id=?",json.readTree(r.get("review").toString()).get("basis").asString(),c.get("steps").toString(),version);
  db.update("INSERT INTO experience_automatic_sources(version_id,source_id) VALUES (?,?)",version,source);
  if(generalVersion!=null)db.update("INSERT INTO experience_general_dependencies(version_id,general_version_id) VALUES (?,?)",version,generalVersion);
  for(UUID dep:dependencies)db.update("INSERT INTO experience_automatic_dependencies(version_id,dependency_version) VALUES (?,?)",version,dep);
  event(actor,tenant,entryId,version,revision,entry==null?"CREATED":"REVISED");
  if(adjustment)db.update("UPDATE experience_adjustments SET finished=true WHERE id=?",source);
  if(suggestion)db.update("UPDATE general_experience_suggestions SET finished=true WHERE id=?",source);
  db.update("UPDATE experience_entries SET status='PUBLISHED',published_version=?,latest_number=?,revision=?,updated_at=now() WHERE id=?",version,number,revision+1,entryId);event(actor,tenant,entryId,version,revision+1,"PUBLISHED");
  return receipt(run,source,entry==null?"CREATED":"UPDATED",entryId,version);
 }
}
