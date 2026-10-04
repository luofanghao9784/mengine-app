package com.dreamcore.workspace.experience;

import com.dreamcore.workspace.identity.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Platform-only proposals on cleaned fixed methods; a proposal is never approval or publication. */
@Service
public class PlatformExperienceAdjustmentService {
 public record Change(UUID requestId,UUID versionId,Integer expectedRevision,String content) {}
 public record Adjustment(UUID id,UUID versionId,String state,UUID resultVersionId,Instant createdAt) {}
 public record Page(boolean enabled,boolean canSubmit,int revision,UUID currentVersionId,List<Adjustment> items) {}
 public record Work(UUID id,UUID lease,String phase,ExperienceAnalysisRuntime.Job analysis,ExperienceGeneralizationRuntime.Job general) {}
 public record Recovery(UUID id,UUID lease,String phase,String state,String engineVersion,boolean expired,boolean recoveryExpired) {}
 private static final Set<String> PENDING=Set.of("QUEUED","RETRY_WAIT","RUNNING","UNCERTAIN","PUBLISHING");
 private final JdbcTemplate db;private final IdentityService identities;private final IdentityAudit audit;private final GeneralExperienceLibrary library;
 private final ExperienceAnalysisRuntime analysis;private final ExperienceGeneralizationRuntime general;private final JsonMapper json=new JsonMapper();
 public PlatformExperienceAdjustmentService(JdbcTemplate db,IdentityService identities,IdentityAudit audit,GeneralExperienceLibrary library,ExperienceAnalysisRuntime analysis,ExperienceGeneralizationRuntime general){this.db=db;this.identities=identities;this.audit=audit;this.library=library;this.analysis=analysis;this.general=general;}
 private IdentityException changed(){return new IdentityException(409,"GENERAL_ADJUSTMENT_SOURCE_CHANGED");}
 private Map<String,Object> proposal(UUID id,boolean lock){var rows=db.queryForList("SELECT * FROM general_experience_adjustments WHERE id=?"+(lock?" FOR UPDATE":""),id);if(rows.isEmpty())throw changed();return rows.getFirst();}
 private Map<String,Object> run(UUID id,boolean lock){var rows=db.queryForList("SELECT * FROM general_experience_adjustment_runs WHERE id=?"+(lock?" FOR UPDATE":""),id);if(rows.isEmpty())throw changed();return rows.getFirst();}
 private void authorize(UUID actor){
  identities.platform(actor);db.queryForList("SELECT pg_advisory_xact_lock_shared(hashtextextended('platform-staff-management',0))");
  if(db.queryForList("SELECT p.account_id FROM platform_accounts p JOIN accounts a ON a.id=p.account_id WHERE p.account_id=? FOR SHARE OF p,a",actor).isEmpty())throw IdentityException.denied();identities.platform(actor);
 }
 private Adjustment project(Map<String,Object> p){
  UUID result=(UUID)p.get("result_version");if(result!=null&&!Boolean.TRUE.equals(db.queryForObject("SELECT general_experience_available(?)",Boolean.class,result)))result=null;
  return new Adjustment((UUID)p.get("id"),(UUID)p.get("version_id"),(String)p.get("state"),result,((java.sql.Timestamp)p.get("created_at")).toInstant());
 }
 @Transactional public Page list(UUID actor,UUID entry,UUID version,boolean enabled){
  identities.platform(actor);db.queryForList("SELECT id FROM general_experience_entries WHERE id=? FOR SHARE",entry);
  if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM general_experience_versions WHERE id=? AND entry_id=? AND general_experience_history_readable(id))",Boolean.class,version,entry)))throw new IdentityException(404,"EXPERIENCE_NOT_FOUND");
  var current=db.queryForMap("SELECT revision,published_version,status FROM general_experience_entries WHERE id=?",entry);UUID currentVersion=(UUID)current.get("published_version");library.detail(actor,null,entry,currentVersion);
  int revision=((Number)current.get("revision")).intValue();
  boolean pending=Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM general_experience_adjustments WHERE entry_id=? AND state IN ('QUEUED','RETRY_WAIT','RUNNING','UNCERTAIN','PUBLISHING'))",Boolean.class,entry));
  return new Page(enabled,current.get("status").equals("AVAILABLE")&&version.equals(currentVersion)&&!pending,revision,currentVersion,db.queryForList("SELECT * FROM general_experience_adjustments WHERE actor_id=? AND entry_id=? ORDER BY created_at DESC,id DESC LIMIT 10",actor,entry).stream().map(this::project).toList());
 }
 @Transactional public Adjustment submit(UUID actor,UUID entry,Change c){
  authorize(actor);
  if(c==null||c.requestId()==null||c.versionId()==null||c.expectedRevision()==null||c.expectedRevision()<1||c.content()==null||c.content().isBlank()||c.content().length()>12000||c.content().codePoints().anyMatch(x->Character.isISOControl(x)&&x!=9&&x!=10&&x!=13))throw IdentityException.invalid();
  String content=c.content().strip(),hash=IdentityService.hash(json.writeValueAsString(List.of(entry,c.versionId(),c.expectedRevision(),content)));
  db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","platform-experience-request:"+actor+":"+c.requestId());
  var prior=db.queryForList("SELECT * FROM general_experience_adjustments WHERE actor_id=? AND request_id=?",actor,c.requestId());
  if(!prior.isEmpty()){if(!hash.equals(prior.getFirst().get("request_hash")))throw new IdentityException(409,"IDEMPOTENCY_CONFLICT");return project(prior.getFirst());}
  db.queryForList("SELECT id FROM general_experience_entries WHERE id=? FOR UPDATE",entry);
  var detail=library.detail(actor,null,entry,c.versionId());
  if(!detail.status().equals("AVAILABLE"))throw changed();
  if(c.expectedRevision()!=db.queryForObject("SELECT revision FROM general_experience_entries WHERE id=?",Integer.class,entry))throw new IdentityException(409,"REVISION_CONFLICT");
  if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM general_experience_adjustments WHERE entry_id=? AND state IN ('QUEUED','RETRY_WAIT','RUNNING','UNCERTAIN','PUBLISHING'))",Boolean.class,entry)))throw new IdentityException(409,"GENERAL_ADJUSTMENT_PENDING");
  UUID id=UUID.randomUUID();db.update("INSERT INTO general_experience_adjustments(id,actor_id,request_id,request_hash,entry_id,version_id,expected_revision,content) VALUES (?,?,?,?,?,?,?,?)",id,actor,c.requestId(),hash,entry,c.versionId(),c.expectedRevision(),content);
  if(!available(id))throw changed();audit.record(actor,null,"GENERAL_EXPERIENCE_ADJUSTMENT_SUBMITTED",id,"SUCCESS");return project(proposal(id,false));
 }
 private boolean available(UUID id){return Boolean.TRUE.equals(db.queryForObject("SELECT platform_general_adjustment_available(?)",Boolean.class,id));}
 private UUID inputId(UUID id,String kind,int index){return UUID.nameUUIDFromBytes((id+":"+kind+":"+index).getBytes(StandardCharsets.UTF_8));}
 private List<ExperienceAnalysisRuntime.Input> parts(UUID id,String kind,String body){
  var parts=new ArrayList<ExperienceAnalysisRuntime.Input>();for(int start=0;start<body.length();){int end=Math.min(start+7900,body.length());if(end<body.length()&&Character.isHighSurrogate(body.charAt(end-1)))end--;parts.add(new ExperienceAnalysisRuntime.Input(inputId(id,kind,parts.size()),kind,body.substring(start,end),true));start=end;}return parts;
 }
 private ExperienceAnalysisRuntime.Job analysisJob(Map<String,Object> p,Map<String,Object> r){
  if(!available((UUID)p.get("id")))throw changed();
  String body=db.queryForObject("SELECT method::text FROM general_experience_versions WHERE id=?",String.class,p.get("version_id"));
  var m=json.readValue(body,ExperienceGeneralizationRuntime.Method.class);
  var inputs=new ArrayList<>(parts((UUID)p.get("id"),"SOURCE_EXCERPT",json.writeValueAsString(m)));inputs.addAll(parts((UUID)p.get("id"),"FEEDBACK",(String)p.get("content")));
  if(inputs.size()>8)throw new IdentityException(422,"GENERAL_ADJUSTMENT_FORMAT_UNSUPPORTED");
  // Only the submitting platform actor's private labels; never query contributing enterprise identities.
  var protectedValues=db.queryForList("SELECT display_name FROM accounts WHERE id=? UNION SELECT email FROM accounts WHERE id=? AND email IS NOT NULL",String.class,p.get("actor_id"),p.get("actor_id")).stream().filter(v->v!=null&&!v.isBlank()&&v.length()<=300).distinct().sorted().toList();
  return ExperienceAnalysisRuntime.Job.platform((UUID)r.get("id"),(UUID)r.get("lease"),(UUID)p.get("id"),inputs,List.of(new ExperienceAnalysisRuntime.Existing((UUID)p.get("version_id"),m.title(),m.summary(),m.steps(),m.applicable(),m.excluded())),protectedValues);
 }
 private ExperienceAnalysisRuntime.Result extracted(Map<String,Object> p){
  var r=run((UUID)p.get("extraction_run"),false);if(!"RETURNED".equals(r.get("state"))||!"live".equals(r.get("execution_class"))||r.get("receipt")==null)throw changed();
  var job=analysisJob(p,r);if(!IdentityService.hash(json.writeValueAsString(job)).equals(r.get("job_hash")))throw changed();
  var result=analysis.validateReceipt(json.readValue(r.get("receipt").toString(),ExperienceAnalysisRuntime.Result.class),job,(String)r.get("engine_version"));
  if(!"QUALIFIED".equals(result.outcome())||!"live".equals(result.executionClass()))throw changed();return result;
 }
 private Work build(Map<String,Object> p,Map<String,Object> r){
  if(!available((UUID)p.get("id")))throw changed();UUID id=(UUID)r.get("id"),lease=(UUID)r.get("lease");
  if(r.get("phase").equals("EXTRACT"))return new Work(id,lease,"EXTRACT",analysisJob(p,r),null);
  var extracted=extracted(p);var c=extracted.candidate();
  var m=new ExperienceGeneralizationRuntime.Method(c.title(),c.summary(),c.steps(),c.applicable(),c.excluded(),c.tags(),extracted.review().basis());
  if(!ExperienceGeneralizationRuntime.validMethod(m))throw new IdentityException(422,"GENERAL_ADJUSTMENT_FORMAT_UNSUPPORTED");
  return new Work(id,lease,"GENERALIZE",null,ExperienceGeneralizationRuntime.Job.platform(id,lease,(UUID)p.get("id"),m,analysisJob(p,run((UUID)p.get("extraction_run"),false)).protectedValues()));
 }
 private String hash(Work w){return IdentityService.hash(json.writeValueAsString(w.analysis()!=null?w.analysis():w.general()));}
 @Transactional public Work claim(){
  var ids=db.queryForList("SELECT id FROM general_experience_adjustments WHERE state IN ('QUEUED','RETRY_WAIT') AND next_attempt_at<=clock_timestamp() ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",UUID.class);
  if(ids.isEmpty())return null;UUID id=ids.getFirst();var p=proposal(id,false);
  try{
   var r=Map.<String,Object>of("id",UUID.randomUUID(),"lease",UUID.randomUUID(),"phase",p.get("phase"));var w=build(p,r);
   db.update("INSERT INTO general_experience_adjustment_runs(id,proposal_id,phase,lease,lease_until,job_hash,state) VALUES (?,?,?,?,clock_timestamp()+interval '8 minutes',?,'CLAIMED')",w.id(),id,w.phase(),w.lease(),hash(w));
   db.update("UPDATE general_experience_adjustments SET run_id=?,state='RUNNING',attempts=attempts+1,updated_at=clock_timestamp() WHERE id=?",w.id(),id);return w;
  }catch(IdentityException invalid){terminal(id,invalid.status==422?"FAILED":"UNAVAILABLE",invalid.status==422?"GENERAL_ADJUSTMENT_FORMAT_UNSUPPORTED":"GENERAL_ADJUSTMENT_SOURCE_CHANGED");return null;}
  catch(ExperienceAnalysisRuntime.Failure invalid){terminal(id,"FAILED","GENERAL_ADJUSTMENT_RECEIPT_INVALID");return null;}
 }
 @Transactional public Work restore(UUID id){var r=run(id,false);var p=proposal((UUID)r.get("proposal_id"),false);var w=build(p,r);if(!hash(w).equals(r.get("job_hash")))throw changed();return w;}
 @Transactional public boolean active(UUID id,UUID lease){try{var r=run(id,false);if(!lease.equals(r.get("lease"))||!Set.of("CLAIMED","DISPATCHED").contains(r.get("state"))||!Boolean.TRUE.equals(db.queryForObject("SELECT lease_until>clock_timestamp() FROM general_experience_adjustment_runs WHERE id=?",Boolean.class,id)))return false;var p=proposal((UUID)r.get("proposal_id"),false);if(!id.equals(p.get("run_id")))return false;restore(id);return true;}catch(RuntimeException unavailable){return false;}}
 @Transactional public void dispatched(Work work,String engineVersion,String executionClass){
  var metadata=run(work.id(),false);proposal((UUID)metadata.get("proposal_id"),true);var r=run(work.id(),true);if(!"CLAIMED".equals(r.get("state"))||!active(work.id(),work.lease())||!hash(work).equals(r.get("job_hash")))throw changed();
  db.update("UPDATE general_experience_adjustment_runs SET state='DISPATCHED',engine_version=?,execution_class=? WHERE id=?",engineVersion,executionClass,work.id());
 }
 private void terminal(UUID id,String state,String code){db.update("UPDATE general_experience_adjustments SET state=?,error_code=?,updated_at=clock_timestamp() WHERE id=? AND state IN ('QUEUED','RETRY_WAIT','RUNNING','UNCERTAIN','PUBLISHING')",state,code,id);}
 @Transactional public void uncertain(UUID id){var r=run(id,false);db.update("UPDATE general_experience_adjustments SET state='UNCERTAIN',updated_at=clock_timestamp() WHERE id=? AND run_id=? AND state='RUNNING'",r.get("proposal_id"),id);}
 @Transactional public void fail(UUID id,String code,boolean sent){
  var r=run(id,false);var p=proposal((UUID)r.get("proposal_id"),true);r=run(id,true);
  if(!id.equals(p.get("run_id"))||!PENDING.contains(p.get("state")))return;
  if(code.endsWith("SOURCE_CHANGED")||!available((UUID)p.get("id"))){terminal((UUID)p.get("id"),"UNAVAILABLE","GENERAL_ADJUSTMENT_SOURCE_CHANGED");return;}
  db.update("UPDATE general_experience_adjustment_runs SET state=?,receipt=NULL,finished_at=clock_timestamp() WHERE id=?",sent?"UNKNOWN":"FAILED",id);
  if(sent){terminal((UUID)p.get("id"),"UNKNOWN","GENERAL_ADJUSTMENT_RESULT_UNKNOWN");return;}
  int attempts=((Number)p.get("attempts")).intValue();if(attempts>=3){terminal((UUID)p.get("id"),"FAILED","GENERAL_ADJUSTMENT_FAILED");return;}
  db.update("UPDATE general_experience_adjustments SET state='RETRY_WAIT',error_code='GENERAL_ADJUSTMENT_RETRY',next_attempt_at=clock_timestamp()+interval '1 minute',updated_at=clock_timestamp() WHERE id=?",p.get("id"));
 }
 @Transactional public List<Recovery> recoveries(){return db.query("SELECT id,lease,phase,state,engine_version,lease_until<=clock_timestamp() expired,lease_until+interval '1 minute'<=clock_timestamp() recovery_expired FROM general_experience_adjustment_runs WHERE state='DISPATCHED' OR (state='CLAIMED' AND lease_until<=clock_timestamp()) ORDER BY created_at LIMIT 20",(r,n)->new Recovery(r.getObject(1,UUID.class),r.getObject(2,UUID.class),r.getString(3),r.getString(4),r.getString(5),r.getBoolean(6),r.getBoolean(7)));}
 private Map<String,Object> lockForResult(UUID runId){
  var r=run(runId,false);var p=proposal((UUID)r.get("proposal_id"),false);authorize((UUID)p.get("actor_id"));
  db.queryForList("SELECT id FROM general_experience_entries WHERE id=? FOR SHARE",p.get("entry_id"));proposal((UUID)p.get("id"),true);return run(runId,true);
 }
 @Transactional public void complete(ExperienceAnalysisRuntime.Result result){
  var r=lockForResult(result.runId());if("RETURNED".equals(r.get("state")))return;
  if(!active(result.runId(),result.lease())||!"DISPATCHED".equals(r.get("state"))||!"EXTRACT".equals(r.get("phase")))throw changed();
  var w=restore(result.runId());analysis.validateReceipt(result,w.analysis(),(String)r.get("engine_version"));
  finishResult(r,result.outcome(),result.executionClass(),result,result.stages());
  UUID proposal=(UUID)r.get("proposal_id");if(!"live".equals(result.executionClass())){terminal(proposal,"FAILED","GENERAL_ADJUSTMENT_VERIFICATION_ONLY");return;}
  if(!"QUALIFIED".equals(result.outcome())){terminal(proposal,Set.of("SKIPPED","REJECTED").contains(result.outcome())?result.outcome():"FAILED","GENERAL_ADJUSTMENT_NOT_QUALIFIED");return;}
  db.update("UPDATE general_experience_adjustments SET extraction_run=?,phase='GENERALIZE',state='QUEUED',attempts=0,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=?",result.runId(),proposal);
 }
 @Transactional public void complete(ExperienceGeneralizationRuntime.Result result){
  var r=lockForResult(result.runId());if("RETURNED".equals(r.get("state")))return;
  if(!active(result.runId(),result.lease())||!"DISPATCHED".equals(r.get("state"))||!"GENERALIZE".equals(r.get("phase")))throw changed();
  var w=restore(result.runId());general.validateReceipt(result,w.general(),(String)r.get("engine_version"),(String)r.get("execution_class"));
  finishResult(r,result.outcome(),result.executionClass(),result,result.stages());UUID proposal=(UUID)r.get("proposal_id");
  if(!"live".equals(result.executionClass())){terminal(proposal,"FAILED","GENERAL_ADJUSTMENT_VERIFICATION_ONLY");return;}
  if(!"QUALIFIED".equals(result.outcome())){terminal(proposal,Set.of("SKIPPED","REJECTED").contains(result.outcome())?result.outcome():"FAILED","GENERAL_ADJUSTMENT_NOT_QUALIFIED");return;}
  db.update("UPDATE general_experience_adjustments SET state='PUBLISHING',updated_at=clock_timestamp() WHERE id=?",proposal);
 }
 private void finishResult(Map<String,Object> r,String outcome,String executionClass,Object receipt,Object stages){
  if(!executionClass.equals(r.get("execution_class")))throw changed();
  db.update("UPDATE general_experience_adjustment_runs SET state='RETURNED',outcome=?,receipt=?::jsonb,stages=?::jsonb,finished_at=clock_timestamp() WHERE id=?",outcome,json.writeValueAsString(receipt),json.writeValueAsString(stages),r.get("id"));
 }
 @Transactional public List<UUID> pendingPublications(){return db.queryForList("SELECT id FROM general_experience_adjustments WHERE state='PUBLISHING' ORDER BY updated_at,id LIMIT 20",UUID.class);}
 private List<String> clean(List<String> values){return values.stream().map(String::strip).distinct().toList();}
 @Transactional public Adjustment publish(UUID id){
  var initial=proposal(id,false);authorize((UUID)initial.get("actor_id"));
  if(!PENDING.contains(initial.get("state")))return project(initial);
  if(!"PUBLISHING".equals(initial.get("state")))throw changed();
  var gr=run((UUID)initial.get("run_id"),false);if(gr.get("receipt")==null)throw changed();
  var cleaned=json.readValue(gr.get("receipt").toString(),ExperienceGeneralizationRuntime.Result.class);var m=cleaned.method();
  if(m==null)throw changed();m=new ExperienceGeneralizationRuntime.Method(m.title().strip(),m.summary().strip(),clean(m.steps()),clean(m.applicable()),clean(m.excluded()),m.tags().stream().map(s->s.strip().toLowerCase(Locale.ROOT)).distinct().sorted().toList(),m.basis());
  String body=json.writeValueAsString(m),fingerprint=IdentityService.hash(body);
  // Protect every fixed general ancestor from erasure before taking the entry/publication lock.
  db.queryForList("WITH RECURSIVE bases(id) AS (SELECT ?::uuid UNION SELECT d.base_version FROM general_experience_version_edges d JOIN bases b ON b.id=d.version_id) SELECT v.id FROM general_experience_versions v JOIN bases b ON b.id=v.id ORDER BY v.id FOR SHARE OF v",initial.get("version_id"));
  db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","general-experience:"+fingerprint);
  db.queryForList("SELECT e.id FROM general_experience_ancestry a JOIN general_experience_versions v ON v.id=a.base_version JOIN general_experience_entries e ON e.id=v.entry_id WHERE a.version_id=? AND e.id<>? ORDER BY e.id FOR SHARE OF e",initial.get("version_id"),initial.get("entry_id"));
  db.queryForList("SELECT id FROM general_experience_entries WHERE id=? FOR UPDATE",initial.get("entry_id"));var p=proposal(id,true);
  if(!"PUBLISHING".equals(p.get("state")))return project(p);
  if(!available(id)){terminal(id,"UNAVAILABLE","GENERAL_ADJUSTMENT_SOURCE_CHANGED");return project(proposal(id,false));}
  gr=run((UUID)p.get("run_id"),true);
  try{var w=restore((UUID)gr.get("id"));general.validateReceipt(cleaned,w.general(),(String)gr.get("engine_version"),"live");}
  catch(IdentityException | ExperienceAnalysisRuntime.Failure | ExperienceGeneralizationRuntime.Failure invalid){terminal(id,"UNAVAILABLE","GENERAL_ADJUSTMENT_SOURCE_CHANGED");return project(proposal(id,false));}
  if(!"live".equals(gr.get("execution_class"))||!"QUALIFIED".equals(cleaned.outcome())||!"RETURNED".equals(gr.get("state")))throw changed();
  if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM general_experience_versions v JOIN general_experience_entries e ON e.id=v.entry_id WHERE v.content_fingerprint=? AND (e.status='STOPPED' OR general_experience_available(v.id)))",Boolean.class,fingerprint))){terminal(id,"CONFLICT","GENERAL_ADJUSTMENT_DUPLICATE");return project(proposal(id,false));}
  UUID version=UUID.randomUUID();int number=db.queryForObject("SELECT coalesce(max(number),0)+1 FROM general_experience_versions WHERE entry_id=?",Integer.class,p.get("entry_id"));
  db.update("INSERT INTO general_experience_versions(id,entry_id,number,method,content_fingerprint) VALUES (?,?,?,?::jsonb,?)",version,p.get("entry_id"),number,body,fingerprint);
  db.update("INSERT INTO general_experience_version_dependencies(version_id,base_version,adjustment_id) VALUES (?,?,?)",version,p.get("version_id"),id);
  db.update("UPDATE general_experience_adjustments SET state='ADMITTED',result_version=?,updated_at=clock_timestamp() WHERE id=?",version,id);
  db.update("UPDATE general_experience_entries SET published_version=?,revision=revision+1,updated_at=clock_timestamp() WHERE id=?",version,p.get("entry_id"));
  if(!Boolean.TRUE.equals(db.queryForObject("SELECT general_experience_available(?)",Boolean.class,version)))throw changed();
  audit.record((UUID)p.get("actor_id"),null,"GENERAL_EXPERIENCE_ADJUSTMENT_PUBLISHED",id,"SUCCESS");return project(proposal(id,false));
 }
}
