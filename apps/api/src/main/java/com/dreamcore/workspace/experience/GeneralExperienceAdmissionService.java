package com.dreamcore.workspace.experience;
import com.dreamcore.workspace.identity.*;import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;import org.springframework.stereotype.Service;import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;
import static com.dreamcore.workspace.experience.ExperienceGeneralizationRuntime.*;

/** Automatic global admission after current tenant-source checks. Public content and private provenance never share a projection. */
@Service
public class GeneralExperienceAdmissionService {
 public record Receipt(UUID runId,String outcome,UUID entryId,UUID versionId) {}
 private final JdbcTemplate db;private final ExperienceGeneralizationQueue queue;private final ExperienceGeneralizationRuntime runtime;private final JsonMapper json=new JsonMapper();
 public GeneralExperienceAdmissionService(JdbcTemplate db,ExperienceGeneralizationQueue queue,ExperienceGeneralizationRuntime runtime){this.db=db;this.queue=queue;this.runtime=runtime;}
 @Transactional(readOnly=true) public List<UUID> pending(){return db.queryForList("SELECT r.id FROM experience_generalization_runs r JOIN tenants t ON t.id=r.tenant_id AND t.status='ACTIVE' WHERE r.state='RETURNED' AND r.outcome='QUALIFIED' AND r.execution_class='live' AND NOT r.invalidated AND r.method IS NOT NULL AND NOT EXISTS(SELECT 1 FROM general_experience_admissions a WHERE a.run_id=r.id) ORDER BY r.created_at,r.id LIMIT 30",UUID.class);}
 private Receipt receipt(UUID run,UUID source,String outcome,UUID entry,UUID version){db.update("INSERT INTO general_experience_admissions(run_id,outcome,entry_id,version_id) VALUES (?,?,?,?)",run,outcome,entry,version);db.update("UPDATE experience_generalization_runs SET method=NULL,privacy=NULL,quality=NULL WHERE id=?",run);db.update("UPDATE experience_generalization_sources SET state=?,updated_at=now() WHERE version_id=?",outcome.equals("CREATED")?"ADMITTED":outcome,source);return new Receipt(run,outcome,entry,version);}
 private List<String> clean(List<String> items){return items.stream().map(String::strip).distinct().toList();}
 private Method canonical(Method m){return new Method(m.title().strip(),m.summary().strip(),clean(m.steps()),clean(m.applicable()),clean(m.excluded()),m.tags().stream().map(s->s.strip().toLowerCase(Locale.ROOT)).distinct().sorted().toList(),m.basis());}
 @Transactional public Receipt admit(UUID id){
  var metadata=db.queryForList("SELECT r.tenant_id,r.source_id,v.entry_id FROM experience_generalization_runs r JOIN experience_versions v ON v.id=r.source_id WHERE r.id=?",id);if(metadata.isEmpty())throw new IdentityException(404,"GENERALIZATION_NOT_FOUND");var initial=metadata.getFirst();
  db.queryForList("SELECT id FROM tenants WHERE id=? FOR SHARE",initial.get("tenant_id"));
  db.queryForList("SELECT id FROM experience_entries WHERE id=? FOR SHARE",initial.get("entry_id"));
  db.queryForList("SELECT id FROM experience_versions WHERE id=? FOR SHARE",initial.get("source_id"));
  db.queryForList("SELECT version_id FROM experience_generalization_sources WHERE version_id=? FOR UPDATE",initial.get("source_id"));
  var r=db.queryForMap("SELECT * FROM experience_generalization_runs WHERE id=? FOR UPDATE",id);UUID source=(UUID)r.get("source_id");
  var previous=db.query("SELECT outcome,entry_id,version_id FROM general_experience_admissions WHERE run_id=?",(q,n)->new Receipt(id,q.getString(1),q.getObject(2,UUID.class),q.getObject(3,UUID.class)),id);if(!previous.isEmpty())return previous.getFirst();
  if(!"RETURNED".equals(r.get("state"))||!"QUALIFIED".equals(r.get("outcome"))||!"live".equals(r.get("execution_class")))throw new IdentityException(409,"GENERALIZATION_NOT_QUALIFIED");
  if(Boolean.TRUE.equals(r.get("invalidated"))||r.get("method")==null)return receipt(id,source,"SOURCE_UNAVAILABLE",null,null);
  if(!Boolean.TRUE.equals(db.queryForObject("SELECT status='ACTIVE' FROM tenants WHERE id=?",Boolean.class,initial.get("tenant_id"))))throw new IdentityException(409,"TENANT_SUSPENDED");
  var job=queue.restoreForAdmission(id);if(job==null)return receipt(id,source,"SOURCE_UNAVAILABLE",null,null);
  var method=json.readValue(r.get("method").toString(),Method.class);
  var result=new Result("1.0",(String)r.get("engine_version"),"live",id,(UUID)r.get("lease"),source,false,"QUALIFIED",null,method,json.readValue(r.get("privacy").toString(),Map.class),json.readValue(r.get("quality").toString(),Map.class),Arrays.asList(json.readValue(r.get("stages").toString(),Stage[].class)));
  try{runtime.validateReceipt(result,job,(String)r.get("engine_version"),"live");}catch(Failure invalid){return receipt(id,source,"CONFLICT",null,null);}
  method=canonical(method);String content=json.writeValueAsString(method),fingerprint=IdentityService.hash(content);
  db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","general-experience:"+fingerprint);
  if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM general_experience_versions v JOIN general_experience_entries e ON e.id=v.entry_id WHERE v.content_fingerprint=? AND e.status='STOPPED')",Boolean.class,fingerprint)))return receipt(id,source,"CONFLICT",null,null);
  var matches=db.queryForList("SELECT v.id,v.entry_id FROM general_experience_versions v JOIN general_experience_entries e ON e.id=v.entry_id WHERE v.content_fingerprint=? AND general_experience_available(v.id) ORDER BY v.created_at,v.id LIMIT 1 FOR SHARE OF e",fingerprint);
  // Duplicate observations never replace original source linkage or count as additional independent proof.
  if(!matches.isEmpty())return receipt(id,source,"DUPLICATE",(UUID)matches.getFirst().get("entry_id"),(UUID)matches.getFirst().get("id"));
  UUID entry=UUID.randomUUID(),version=UUID.randomUUID();
  db.update("INSERT INTO general_experience_entries(id) VALUES (?)",entry);
  db.update("INSERT INTO general_experience_versions(id,entry_id,number,method,content_fingerprint) VALUES (?,?,1,?::jsonb,?)",version,entry,content,fingerprint);
  db.update("INSERT INTO general_experience_origins(version_id,source_version) VALUES (?,?)",version,source);
  db.update("UPDATE general_experience_entries SET published_version=? WHERE id=?",version,entry);
  return receipt(id,source,"CREATED",entry,version);
 }
}
