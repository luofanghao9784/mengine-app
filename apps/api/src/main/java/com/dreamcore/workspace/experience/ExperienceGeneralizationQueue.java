package com.dreamcore.workspace.experience;
import com.dreamcore.workspace.identity.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;import org.springframework.stereotype.Service;import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;
import static com.dreamcore.workspace.experience.ExperienceGeneralizationRuntime.*;

/** Persistent fixed-version generalization. Only cleaned output is staged; original bodies are reconstructed. */
@Service
public class ExperienceGeneralizationQueue {
 public record Recovery(UUID id,UUID lease,String state,String engineVersion,boolean expired,boolean recoveryExpired) {}
 private final JdbcTemplate db;private final ExperienceService experiences;private final ExperienceGeneralizationRuntime runtime;private final JsonMapper json=new JsonMapper();
 public ExperienceGeneralizationQueue(JdbcTemplate db,ExperienceService experiences,ExperienceGeneralizationRuntime runtime){this.db=db;this.experiences=experiences;this.runtime=runtime;}
 private IdentityException changed(){return new IdentityException(409,"GENERALIZATION_SOURCE_CHANGED");}
 @Transactional public void discover(){
  db.update("UPDATE experience_generalization_sources SET state='SOURCE_UNAVAILABLE',error_code='GENERALIZATION_SOURCE_CHANGED',updated_at=now() WHERE state<>'SOURCE_UNAVAILABLE' AND NOT generalization_source_available(version_id)");
  db.update("INSERT INTO experience_generalization_sources(version_id,tenant_id,workspace_id,actor_id) SELECT v.id,e.tenant_id,e.workspace_id,v.created_by FROM experience_versions v JOIN experience_entries e ON e.id=v.entry_id JOIN tenants t ON t.id=e.tenant_id AND t.status='ACTIVE' WHERE v.origin='AUTOMATIC' AND v.evaluation='AUTOMATIC_CHECKED' AND v.automatic_basis IS NOT NULL AND v.automatic_steps IS NOT NULL AND NOT v.scrubbed AND v.content->>'kind'='METHOD' AND e.status='PUBLISHED' AND e.published_version=v.id AND NOT e.automation_stopped AND NOT EXISTS(SELECT 1 FROM experience_generalization_sources s WHERE s.version_id=v.id) ORDER BY v.created_at,v.id LIMIT 200 ON CONFLICT DO NOTHING");
 }
 @Transactional(readOnly=true) public List<UUID> tenants(){return db.queryForList("SELECT s.tenant_id FROM experience_generalization_sources s JOIN tenants t ON t.id=s.tenant_id AND t.status='ACTIVE' WHERE s.state IN ('QUEUED','RETRY_WAIT') AND s.next_attempt_at<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM experience_generalization_runs r WHERE r.tenant_id=s.tenant_id AND r.state IN ('CLAIMED','DISPATCHED')) GROUP BY s.tenant_id ORDER BY coalesce((SELECT max(r.created_at) FROM experience_generalization_runs r WHERE r.tenant_id=s.tenant_id),to_timestamp(0)),min(s.next_attempt_at),s.tenant_id LIMIT 20",UUID.class);}
 private List<String> parts(String s,int size,int max){if(s==null||s.isBlank())throw new IdentityException(422,"GENERALIZATION_FORMAT_UNSUPPORTED");var result=new ArrayList<String>();for(int start=0;start<s.length();){int end=Math.min(start+size,s.length());if(end<s.length()&&Character.isHighSurrogate(s.charAt(end-1)))end--;result.add(s.substring(start,end));start=end;}if(result.size()>max)throw new IdentityException(422,"GENERALIZATION_FORMAT_UNSUPPORTED");return result.stream().distinct().toList();}
 private Job job(Map<String,Object> run){
  UUID source=(UUID)run.get("source_id");if(!Boolean.TRUE.equals(db.queryForObject("SELECT generalization_source_available(?)",Boolean.class,source)))throw changed();
  if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM experience_generalization_sources s JOIN tenants t ON t.id=s.tenant_id AND t.status='ACTIVE' WHERE s.version_id=?)",Boolean.class,source)))throw changed();
  var s=db.queryForMap("SELECT s.*,v.entry_id,v.automatic_basis,v.automatic_steps FROM experience_generalization_sources s JOIN experience_versions v ON v.id=s.version_id JOIN tenants t ON t.id=s.tenant_id AND t.status='ACTIVE' WHERE s.version_id=?",source);
  var e=experiences.analysisEntry((UUID)s.get("actor_id"),(UUID)s.get("tenant_id"),(UUID)s.get("workspace_id"),(UUID)s.get("entry_id"),source);var c=e.version().content();
  var original=new Method(c.title(),c.summary(),Arrays.asList(json.readValue(s.get("automatic_steps").toString(),String[].class)),parts(c.applicable(),300,8),parts(c.excluded(),300,8),c.tags(),(String)s.get("automatic_basis"));if(!validMethod(original))throw new IdentityException(422,"GENERALIZATION_FORMAT_UNSUPPORTED");
  var values=db.queryForList("SELECT name AS value FROM tenants WHERE id=? UNION SELECT name FROM workspaces WHERE id=? UNION SELECT display_name FROM accounts WHERE id=? UNION SELECT email FROM accounts WHERE id=? AND email IS NOT NULL",String.class,s.get("tenant_id"),s.get("workspace_id"),s.get("actor_id"),s.get("actor_id")).stream().filter(v->v!=null&&!v.isBlank()&&v.length()<=300).distinct().sorted().toList();
  return new Job((UUID)run.get("id"),(UUID)run.get("lease"),(UUID)s.get("tenant_id"),source,original,values);
 }
 private String hash(Job job){return IdentityService.hash(json.writeValueAsString(job));}
 @Transactional public Job claim(UUID tenant){
  db.queryForList("SELECT id FROM tenants WHERE id=? FOR SHARE",tenant);db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","experience-generalization:"+tenant);
  if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM tenants WHERE id=? AND status='ACTIVE')",Boolean.class,tenant))||Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM experience_generalization_runs WHERE tenant_id=? AND state IN ('CLAIMED','DISPATCHED'))",Boolean.class,tenant)))return null;
  var ids=db.queryForList("SELECT version_id FROM experience_generalization_sources WHERE tenant_id=? AND state IN ('QUEUED','RETRY_WAIT') AND next_attempt_at<=clock_timestamp() ORDER BY next_attempt_at,version_id LIMIT 1 FOR UPDATE SKIP LOCKED",UUID.class,tenant);if(ids.isEmpty())return null;UUID source=ids.getFirst();
  try{var run=Map.<String,Object>of("id",UUID.randomUUID(),"lease",UUID.randomUUID(),"source_id",source);var j=job(run);
   db.update("INSERT INTO experience_generalization_runs(id,source_id,tenant_id,lease,lease_until,state,job_hash) VALUES (?,?,?,?,now()+interval '10 minutes','CLAIMED',?)",j.id(),source,tenant,j.lease(),hash(j));
   db.update("UPDATE experience_generalization_sources SET state='RUNNING',run_id=?,error_code=NULL,updated_at=now() WHERE version_id=?",j.id(),source);return j;
  }catch(IdentityException unavailable){db.update("UPDATE experience_generalization_sources SET state=?,error_code=?,updated_at=now() WHERE version_id=?",unavailable.status==422?"FAILED":"SOURCE_UNAVAILABLE",unavailable.code,source);return null;}
 }
 private Map<String,Object> run(UUID id,boolean lock){var rows=db.queryForList("SELECT * FROM experience_generalization_runs WHERE id=?"+(lock?" FOR UPDATE":""),id);if(rows.isEmpty())throw changed();return rows.getFirst();}
 @Transactional public Job restore(UUID id){var r=run(id,false);if(Boolean.TRUE.equals(r.get("invalidated")))throw changed();var j=job(r);if(!hash(j).equals(r.get("job_hash")))throw changed();return j;}
 @Transactional public Job restoreForAdmission(UUID id){try{return restore(id);}catch(IdentityException unavailable){return null;}}
 @Transactional public boolean active(UUID id,UUID lease){try{var r=run(id,false);if(!lease.equals(r.get("lease"))||!Set.of("CLAIMED","DISPATCHED").contains(r.get("state"))||Boolean.TRUE.equals(r.get("invalidated"))||!Boolean.TRUE.equals(db.queryForObject("SELECT lease_until>clock_timestamp() FROM experience_generalization_runs WHERE id=?",Boolean.class,id)))return false;restore(id);return true;}catch(IdentityException unavailable){return false;}}
 @Transactional public void dispatched(Job j,Descriptor d){var r=run(j.id(),true);if(!"CLAIMED".equals(r.get("state"))||!active(j.id(),j.lease())||!hash(j).equals(r.get("job_hash")))throw changed();db.update("UPDATE experience_generalization_runs SET state='DISPATCHED',engine_version=?,execution_class=? WHERE id=?",d.engineVersion(),d.executionClass(),j.id());db.update("UPDATE experience_generalization_sources SET attempts=attempts+1 WHERE version_id=?",j.source());}
 @Transactional public void complete(Result result){
  var r=run(result.runId(),true);if(!"DISPATCHED".equals(r.get("state")))return;if(!active(result.runId(),result.lease()))throw changed();var j=restore(result.runId());
  if(!"live".equals(r.get("execution_class")))throw new IdentityException(409,"GENERALIZATION_VERIFICATION_ONLY");
  try{runtime.validateReceipt(result,j,(String)r.get("engine_version"),"live");}catch(Failure invalid){throw new IdentityException(422,"GENERALIZATION_RECEIPT_INVALID");}
  if(!Set.of("QUALIFIED","SKIPPED","REJECTED").contains(result.outcome()))throw new IdentityException(422,"GENERALIZATION_FAILED");
  db.update("UPDATE experience_generalization_runs SET state='RETURNED',outcome=?,code=?,method=?::jsonb,privacy=?::jsonb,quality=?::jsonb,stages=?::jsonb,finished_at=now() WHERE id=?",result.outcome(),result.code(),result.method()==null?null:json.writeValueAsString(result.method()),result.privacy()==null?null:json.writeValueAsString(result.privacy()),result.quality()==null?null:json.writeValueAsString(result.quality()),json.writeValueAsString(result.stages()),result.runId());
  db.update("UPDATE experience_generalization_sources SET state=?,error_code=?,updated_at=now() WHERE run_id=?",result.outcome(),result.code(),result.runId());
 }
 @Transactional public void fail(UUID id,String code,boolean sent,Result result){var r=run(id,true);if(!Set.of("CLAIMED","DISPATCHED").contains(r.get("state")))return;boolean paused=code.equals("GENERALIZATION_SOURCE_CHANGED")&&Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM tenants WHERE id=? AND status='SUSPENDED') AND generalization_source_available(?)",Boolean.class,r.get("tenant_id"),r.get("source_id")));
  if(paused)code="GENERALIZATION_TENANT_PAUSED";boolean changed=code.equals("GENERALIZATION_SOURCE_CHANGED"),unknown=code.equals("GENERALIZATION_RESULT_UNKNOWN");
  if(!sent&&r.get("state").equals("DISPATCHED"))db.update("UPDATE experience_generalization_sources SET attempts=greatest(0,attempts-1) WHERE run_id=?",id);
  db.update("UPDATE experience_generalization_runs SET state=?,code=?,stages=?::jsonb,finished_at=now() WHERE id=?",changed?"CANCELLED":unknown?"UNKNOWN":"FAILED",code,result==null?null:json.writeValueAsString(result.stages()),id);
  db.update("UPDATE experience_generalization_sources SET state=CASE WHEN ? THEN 'SOURCE_UNAVAILABLE' WHEN ? THEN 'UNKNOWN' WHEN ? THEN 'RETRY_WAIT' WHEN attempts>=3 OR ? THEN 'FAILED' ELSE 'RETRY_WAIT' END,error_code=?,next_attempt_at=now()+CASE WHEN ? THEN interval '60 seconds'*greatest(1,attempts) ELSE interval '5 minutes' END,updated_at=now() WHERE run_id=?",changed,unknown,paused,code.equals("GENERALIZATION_VERIFICATION_ONLY"),code,sent,id);
 }
 @Transactional public void uncertain(UUID id){db.update("UPDATE experience_generalization_runs SET code='GENERALIZATION_RESULT_PENDING' WHERE id=? AND state='DISPATCHED'",id);}
 @Transactional(readOnly=true) public List<Recovery> recoveries(){return db.query("SELECT id,lease,state,engine_version,lease_until<clock_timestamp() expired,created_at<clock_timestamp()-interval '9 minutes' recovery_expired FROM experience_generalization_runs WHERE state='DISPATCHED' AND created_at<clock_timestamp()-interval '5 seconds' OR state='CLAIMED' AND lease_until<clock_timestamp() ORDER BY created_at LIMIT 30",(r,n)->new Recovery(r.getObject(1,UUID.class),r.getObject(2,UUID.class),r.getString(3),r.getString(4),r.getBoolean(5),r.getBoolean(6)));}
}
