package com.dreamcore.workspace.experience;

import com.dreamcore.workspace.identity.*;
import java.util.*;import java.nio.charset.StandardCharsets;
import org.springframework.jdbc.core.JdbcTemplate;import org.springframework.stereotype.Service;import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;
import static com.dreamcore.workspace.experience.ExperienceAnalysisRuntime.*;

/** Persistent dispatch and private results. Source bodies and quoted evidence are reconstructed, never cached. */
@Service
public class ExperienceAnalysisQueue {
 public record Recovery(UUID id,UUID lease,String state,String engineVersion,boolean expired,boolean recoveryExpired) {}
 private final JdbcTemplate db;private final ExperienceIntakeService intake;private final ExperienceService experiences;private final JsonMapper json=new JsonMapper();
 public ExperienceAnalysisQueue(JdbcTemplate db,ExperienceIntakeService intake,ExperienceService experiences){this.db=db;this.intake=intake;this.experiences=experiences;}
 private IdentityException changed(){return new IdentityException(409,"EXPERIENCE_SOURCE_CHANGED");}
 @Transactional public void discover(){
  intake.discover();
  db.update("INSERT INTO experience_analysis_items(source_id,tenant_id) SELECT i.id,i.tenant_id FROM experience_intake_sources i WHERE i.state='PENDING' AND NOT EXISTS(SELECT 1 FROM experience_analysis_items q WHERE q.source_id=i.id) ORDER BY i.created_at,i.id LIMIT 200 ON CONFLICT DO NOTHING");
 }
 @Transactional(readOnly=true) public List<UUID> tenants(){return db.queryForList("SELECT q.tenant_id FROM experience_analysis_items q JOIN tenants t ON t.id=q.tenant_id AND t.status='ACTIVE' WHERE q.state IN ('QUEUED','RETRY_WAIT') AND q.next_attempt_at<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM experience_analysis_runs r WHERE r.tenant_id=q.tenant_id AND r.state IN ('CLAIMED','DISPATCHED')) GROUP BY q.tenant_id ORDER BY coalesce((SELECT max(previous.created_at) FROM experience_analysis_runs previous WHERE previous.tenant_id=q.tenant_id),to_timestamp(0)),min(q.next_attempt_at),q.tenant_id LIMIT 20",UUID.class);}
 private Map<String,Object> source(UUID id){var rows=db.queryForList("SELECT * FROM experience_intake_sources WHERE id=?",id);if(rows.isEmpty())throw changed();return rows.getFirst();}
 private void eligible(Map<String,Object> s){
  if(!intake.available((UUID)s.get("id"))||!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM tenants WHERE id=? AND status='ACTIVE')",Boolean.class,s.get("tenant_id"))))throw changed();
 }
 private UUID inputId(UUID source,String key){return UUID.nameUUIDFromBytes((source+":"+key).getBytes(StandardCharsets.UTF_8));}
 private void add(List<Input> inputs,UUID source,String key,String kind,String value,boolean complete){
  if(value==null||value.isBlank())return;boolean full=complete&&value.length()<=8000;int end=Math.min(8000,value.length());if(end<value.length()&&Character.isHighSurrogate(value.charAt(end-1)))end--;
  inputs.add(new Input(inputId(source,key),kind,value.substring(0,end),full));
 }
 private List<Input> inputs(Map<String,Object> s,List<UUID> fixedChunks){
  UUID id=(UUID)s.get("id"),task=(UUID)s.get("task_id");var inputs=new ArrayList<Input>();
  Map<String,Object> feedback=null;
  if(s.get("kind").equals("FEEDBACK")){
   feedback=db.queryForMap("SELECT f.*,v.assessment FROM feedback_entries f JOIN feedback_versions v ON v.feedback_id=f.id AND v.revision=f.revision WHERE f.id=?",s.get("feedback_id"));
   add(inputs,id,"feedback","FEEDBACK",feedback.get("assessment").toString(),true);
  }
  if(task!=null){
   int attempt=((Number)s.get("source_attempt")).intValue();int revision=feedback==null?((Number)s.get("source_revision")).intValue():((Number)feedback.get("task_revision")).intValue();
   var current=db.queryForMap("SELECT * FROM conversation_tasks WHERE id=?",task);
   // A changed task never substitutes its latest response for the feedback's fixed target.
   if(((Number)current.get("revision")).intValue()!=revision||((Number)current.get("attempt")).intValue()!=attempt)throw new IdentityException(409,"EXPERIENCE_TARGET_VERSION_UNAVAILABLE");
   add(inputs,id,"input","TASK_INPUT",Objects.toString(current.get("prompt"),"")+"\n"+Objects.toString(current.get("supplemental_input"),""),true);
   add(inputs,id,"result","TASK_RESULT",Objects.toString(current.get("reply"),""),true);
   var receipts=db.queryForList("SELECT sequence,name,status FROM conversation_tool_receipts WHERE task_id=? AND attempt_number=? ORDER BY sequence LIMIT 9",task,attempt);
   if(!receipts.isEmpty())add(inputs,id,"execution","EXECUTION_RECORD","平台记录的工具调用及状态，仅证明这些调用，不证明业务结果或回复内容正确：\n"+json.writeValueAsString(receipts.stream().limit(8).toList()),receipts.size()<=8);
  }else if(feedback!=null){
   for(UUID chunk:fixedChunks){var rows=db.queryForList("SELECT content FROM knowledge_chunks WHERE id=? AND version_id=?",String.class,chunk,feedback.get("material_version_id"));if(rows.isEmpty())throw changed();add(inputs,id,"chunk:"+chunk,"SOURCE_EXCERPT",rows.getFirst(),false);}
   if(fixedChunks.isEmpty())throw new IdentityException(409,"EXPERIENCE_TARGET_VERSION_UNAVAILABLE");
  }
  if(inputs.isEmpty()||inputs.size()>8)throw new IdentityException(409,"EXPERIENCE_TARGET_VERSION_UNAVAILABLE");return List.copyOf(inputs);
 }
 private List<String> parts(String s,int length,int max){if(s==null||s.isBlank())return List.of("原版本未提供此项");var p=new ArrayList<String>();for(int i=0;i<s.length();){int end=Math.min(i+length,s.length());if(end<s.length()&&Character.isHighSurrogate(s.charAt(end-1)))end--;p.add(s.substring(i,end));i=end;}if(p.size()>max)throw changed();return p.stream().distinct().toList();}
 private Existing existing(Map<String,Object> s,UUID version){
  UUID entry=db.queryForObject("SELECT entry_id FROM experience_versions WHERE id=?",UUID.class,version);
  var e=experiences.analysisEntry((UUID)s.get("owner_id"),(UUID)s.get("tenant_id"),(UUID)s.get("workspace_id"),entry,version);
  if(!e.status().equals("PUBLISHED")||!Objects.equals(e.publishedVersion(),version))throw changed();var c=e.version().content();
  return new Existing(version,c.title(),c.summary(),parts(c.body(),800,10),parts(c.applicable(),300,8),parts(c.excluded(),300,8));
 }
 private List<UUID> uuids(Object value){return json.readValue(value.toString(),UUID[].class)==null?List.of():Arrays.asList(json.readValue(value.toString(),UUID[].class));}
 private Job job(Map<String,Object> run){
  var s=source((UUID)run.get("source_id"));eligible(s);var m=json.readTree(run.get("manifest").toString());
  var chunks=uuids(m.get("chunks"));var versions=uuids(m.get("versions"));
  var protectedValues=db.queryForList("SELECT name AS value FROM tenants WHERE id=? UNION SELECT display_name FROM accounts WHERE id=? UNION SELECT email FROM accounts WHERE id=? AND email IS NOT NULL",String.class,s.get("tenant_id"),s.get("owner_id"),s.get("owner_id")).stream().filter(v->v!=null&&!v.isBlank()&&v.length()<=300).distinct().sorted().toList();
  return new Job((UUID)run.get("id"),(UUID)run.get("lease"),(UUID)s.get("tenant_id"),(UUID)s.get("id"),inputs(s,chunks),versions.stream().map(v->existing(s,v)).toList(),protectedValues);
 }
 private String hash(Job job){return IdentityService.hash(json.writeValueAsString(job));}
 @Transactional public Job claim(UUID tenant){
  db.queryForList("SELECT id FROM tenants WHERE id=? FOR SHARE",tenant);db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","experience-analysis:"+tenant);
  if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM experience_analysis_runs WHERE tenant_id=? AND state IN ('CLAIMED','DISPATCHED'))",Boolean.class,tenant)))return null;
  var ids=db.queryForList("SELECT source_id FROM experience_analysis_items WHERE tenant_id=? AND state IN ('QUEUED','RETRY_WAIT') AND next_attempt_at<=clock_timestamp() ORDER BY next_attempt_at,source_id LIMIT 1 FOR UPDATE SKIP LOCKED",UUID.class,tenant);if(ids.isEmpty())return null;
  UUID source=ids.getFirst();var s=source(source);
  try{
   eligible(s);var chunks=s.get("task_id")==null?db.queryForList("SELECT c.id FROM knowledge_chunks c JOIN knowledge_runs r ON r.id=c.run_id JOIN feedback_entries f ON f.material_version_id=c.version_id WHERE f.id=? AND r.status IN ('READY','PARTIAL') AND r.generation=(SELECT max(x.generation) FROM knowledge_runs x WHERE x.version_id=c.version_id AND x.status IN ('READY','PARTIAL')) ORDER BY c.ordinal,c.id LIMIT 4",UUID.class,s.get("feedback_id")):List.<UUID>of();
   var versions=experiences.list((UUID)s.get("owner_id"),tenant,(UUID)s.get("workspace_id"),"","",false,0,5).items().stream().map(ExperienceService.Summary::versionId).filter(v->{try{existing(s,v);return true;}catch(IdentityException unavailable){return false;}}).toList();
   var run=new HashMap<String,Object>();run.put("id",UUID.randomUUID());run.put("lease",UUID.randomUUID());run.put("source_id",source);run.put("manifest",json.writeValueAsString(Map.of("chunks",chunks,"versions",versions)));
   var job=job(run);
   db.update("INSERT INTO experience_analysis_runs(id,source_id,tenant_id,lease,lease_until,state,job_hash,manifest) VALUES (?,?,?,?,now()+interval '10 minutes','CLAIMED',?,?::jsonb)",job.id(),source,tenant,job.lease(),hash(job),run.get("manifest"));
   db.update("UPDATE experience_analysis_items SET state='RUNNING',run_id=?,error_code=NULL,updated_at=now() WHERE source_id=?",job.id(),source);return job;
  }catch(IdentityException unavailable){
   String state=intake.available(source)?"RETRY_WAIT":"SOURCE_UNAVAILABLE";
   db.update("UPDATE experience_analysis_items SET state=?,error_code=?,next_attempt_at=now()+interval '5 minutes',updated_at=now() WHERE source_id=?",state,unavailable.code,source);return null;
  }
 }
 private Map<String,Object> run(UUID id,boolean lock){var rows=db.queryForList("SELECT * FROM experience_analysis_runs WHERE id=?"+(lock?" FOR UPDATE":""),id);if(rows.isEmpty())throw changed();return rows.getFirst();}
 @Transactional public Job restore(UUID id){var r=run(id,false);if((Boolean)r.get("invalidated"))throw changed();var j=job(r);if(!Objects.equals(r.get("job_hash"),hash(j)))throw changed();return j;}
 @Transactional public Job restoreForAdmission(UUID id){try{return restore(id);}catch(IdentityException unavailable){return null;}}
 @Transactional public boolean active(UUID id,UUID lease){
  try{var r=run(id,false);if(!lease.equals(r.get("lease"))||!Set.of("CLAIMED","DISPATCHED").contains(r.get("state"))||Boolean.TRUE.equals(r.get("invalidated"))||!Boolean.TRUE.equals(db.queryForObject("SELECT lease_until>clock_timestamp() FROM experience_analysis_runs WHERE id=?",Boolean.class,id)))return false;restore(id);return true;}catch(IdentityException changed){return false;}
 }
 @Transactional public void dispatched(Job job,Descriptor descriptor){
  var r=run(job.id(),true);if(!"CLAIMED".equals(r.get("state"))||!active(job.id(),job.lease())||!hash(job).equals(r.get("job_hash")))throw changed();
  db.update("UPDATE experience_analysis_runs SET state='DISPATCHED',engine_version=?,execution_class=? WHERE id=?",descriptor.engineVersion(),descriptor.executionClass(),job.id());db.update("UPDATE experience_analysis_items SET attempts=attempts+1 WHERE source_id=?",job.source());
 }
 private List<Map<String,Object>> spans(List<Evidence> evidence,Job job){return evidence.stream().map(e->{var input=job.inputs().stream().filter(i->i.id().equals(e.inputId())).findFirst().orElseThrow(this::changed);int start=input.text().indexOf(e.quote());if(start<0)throw changed();return Map.<String,Object>of("inputId",e.inputId(),"start",start,"end",start+e.quote().length(),"sha256",IdentityService.hash(input.text()));}).toList();}
 /** Persist only cleaned candidates and structured check facts; admission is a separate automatic transaction. */
 @Transactional public void complete(Result result){
  var r=run(result.runId(),true);if(!"DISPATCHED".equals(r.get("state")))return;
  if(!active(result.runId(),result.lease())||!Objects.equals(r.get("engine_version"),result.engineVersion())||!Objects.equals(r.get("execution_class"),result.executionClass())||!Objects.equals(r.get("source_id"),result.source())||!Boolean.FALSE.equals(result.admitted()))throw changed();
  var job=restore(result.runId());
  if(!"live".equals(result.executionClass()))throw new IdentityException(409,"EXPERIENCE_VERIFICATION_ONLY");
  Object candidate=null,review=null,evidence=null;
  if(result.outcome().equals("QUALIFIED")){
   var c=result.candidate();var data=new LinkedHashMap<String,Object>();data.put("targetVersionId",c.targetVersionId());data.put("title",c.title());data.put("summary",c.summary());data.put("steps",c.steps());data.put("applicable",c.applicable());data.put("excluded",c.excluded());data.put("tags",c.tags());candidate=data;
   review=Map.of("checks",result.review().checks(),"basis",result.review().basis());evidence=Map.of("candidate",spans(c.evidence(),job),"review",spans(result.review().evidence(),job));
  }else if(!Set.of("SKIPPED","REJECTED").contains(result.outcome()))throw new IdentityException(422,"EXPERIENCE_ANALYSIS_FAILED");
  db.update("UPDATE experience_analysis_runs SET state='RETURNED',outcome=?,code=?,stages=?::jsonb,candidate=?::jsonb,review=?::jsonb,evidence=?::jsonb,finished_at=now() WHERE id=?",result.outcome(),result.code(),json.writeValueAsString(result.stages()),candidate==null?null:json.writeValueAsString(candidate),review==null?null:json.writeValueAsString(review),evidence==null?null:json.writeValueAsString(evidence),result.runId());
  db.update("UPDATE experience_analysis_items SET state=?,error_code=?,updated_at=now() WHERE run_id=?",result.outcome(),result.code(),result.runId());
 }
 @Transactional public void fail(UUID id,String code,boolean sent,Result result){
  var r=run(id,true);if(!Set.of("CLAIMED","DISPATCHED").contains(r.get("state")))return;
  boolean changed=code.equals("EXPERIENCE_SOURCE_CHANGED"),unknown=code.equals("EXPERIENCE_RESULT_UNKNOWN");
  if(!sent&&r.get("state").equals("DISPATCHED"))db.update("UPDATE experience_analysis_items SET attempts=greatest(0,attempts-1) WHERE run_id=?",id);
  db.update("UPDATE experience_analysis_runs SET state=?,code=?,stages=?::jsonb,finished_at=now() WHERE id=?",changed?"CANCELLED":unknown?"UNKNOWN":"FAILED",code,result==null?null:json.writeValueAsString(result.stages()),id);
  db.update("UPDATE experience_analysis_items SET state=CASE WHEN ? THEN 'SOURCE_UNAVAILABLE' WHEN ? THEN 'UNKNOWN' WHEN attempts>=3 OR ? THEN 'FAILED' ELSE 'RETRY_WAIT' END,error_code=?,next_attempt_at=now()+CASE WHEN ? THEN interval '60 seconds'*greatest(1,attempts) ELSE interval '5 minutes' END,updated_at=now() WHERE run_id=?",changed,unknown,code.equals("EXPERIENCE_VERIFICATION_ONLY"),code,sent,id);
 }
 @Transactional public void uncertain(UUID id){db.update("UPDATE experience_analysis_runs SET code='EXPERIENCE_RESULT_PENDING' WHERE id=? AND state='DISPATCHED'",id);}
 @Transactional(readOnly=true) public List<Recovery> recoveries(){return db.query("SELECT id,lease,state,engine_version,lease_until<clock_timestamp() AS expired,created_at<clock_timestamp()-interval '9 minutes' AS recovery_expired FROM experience_analysis_runs WHERE state='DISPATCHED' AND created_at<clock_timestamp()-interval '5 seconds' OR state='CLAIMED' AND lease_until<clock_timestamp() ORDER BY created_at LIMIT 30",(r,n)->new Recovery(r.getObject("id",UUID.class),r.getObject("lease",UUID.class),r.getString("state"),r.getString("engine_version"),r.getBoolean("expired"),r.getBoolean("recovery_expired")));}
}
