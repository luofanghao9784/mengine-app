package com.dreamcore.workspace.taskwork;

import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.plans.*;
import com.dreamcore.workspace.profile.ProfileService;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@Service
public class TaskWorkService {
 public record Request(String action,UUID requestId,Integer expectedRevision,Instant checkAt,String reason,String category,String choice,String evidenceSource,Integer evidenceOffset,String evidence) {}
 private record Task(UUID id,UUID tenant,UUID owner,UUID space,UUID conversation,int attempt,UUID plan) {}
 public record PlanReceipt(UUID id,UUID taskId,UUID planId,UUID requestId,int acceptedRevision,long executionEpoch,Instant checkAt,String reason,String state,boolean currentlyEffective,UUID dispatchedTaskId,boolean dispatchUnavailable) {}
 public record PreferenceReceipt(UUID id,UUID taskId,UUID requestId,String category,String choice,String label,UUID profileId,int acceptedRevision,int currentRevision,String currentStatus,boolean currentlyEffective,boolean canUndo,String evidenceSource,Instant createdAt) {}
 public record Receipts(List<PlanReceipt> checks,List<PreferenceReceipt> preferences,boolean hasMore) {}
 private final JdbcTemplate db;private final AgentTaskService agents;private final ConversationService conversations;private final ProfileService profiles;private final PlanService plans;private final PlanClock clock;private final IdentityService identities;
 private final JsonMapper json=new JsonMapper();
 public TaskWorkService(JdbcTemplate db,AgentTaskService agents,ConversationService conversations,ProfileService profiles,PlanService plans,PlanClock clock,IdentityService identities){this.db=db;this.agents=agents;this.conversations=conversations;this.profiles=profiles;this.plans=plans;this.clock=clock;this.identities=identities;}
 private Map<String,Object> map(Object... v){var r=new LinkedHashMap<String,Object>();for(int i=0;i<v.length;i+=2)r.put((String)v[i],v[i+1]);return r;}
 private IdentityException denied(){return new IdentityException(403,"TASK_WORK_DENIED");}
 private Task metadata(UUID id){var rows=db.queryForList("SELECT t.*,r.plan_id FROM conversation_tasks t LEFT JOIN ongoing_plan_runs r ON r.task_id=t.id WHERE t.id=?",id);if(rows.isEmpty())throw denied();var r=rows.getFirst();return new Task(id,(UUID)r.get("tenant_id"),(UUID)r.get("requested_by"),(UUID)r.get("workspace_id"),(UUID)r.get("conversation_id"),(Integer)r.get("attempt"),(UUID)r.get("plan_id"));}
 private Task task(UUID id,UUID token){
  var t=metadata(id);
  // Existing plan worker order: tenant -> owner -> plan -> task. Never invert it for a callback.
  db.queryForList("SELECT id FROM tenants WHERE id=? FOR SHARE",t.tenant());
  db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,22022))",t.owner().toString());
  if(t.plan()!=null)db.queryForList("SELECT id FROM ongoing_plans WHERE id=? FOR UPDATE",t.plan());
  agents.check(id,token);return metadata(id);
 }
 private void owner(Task t,UUID actor,UUID tenant){if(!t.owner().equals(actor)||!t.tenant().equals(tenant))throw denied();conversations.detail(actor,tenant,t.conversation(),0,1);if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM readable_source_tasks WHERE id=?)",Boolean.class,t.id())))throw denied();}
 private String hash(Object... values){return IdentityService.hash(json.writeValueAsString(values));}
 private Instant instant(Map<String,Object> r,String key){return r.get(key)==null?null:((Timestamp)r.get(key)).toInstant();}
 private Map<String,Object> envelope(String action,Object result){return map("contractVersion","1.0","action",action,"result",result);}
 @Transactional public Map<String,Object> plan(UUID task,UUID token,Request r){
  var t=task(task,token);if(t.plan()==null)throw denied();if(r==null||r.action()==null)throw IdentityException.invalid();
  Object result=switch(r.action()){case "read" -> map("plan",plans.get(t.owner(),t.tenant(),t.plan()),"pending",db.queryForList("SELECT * FROM task_plan_checks WHERE plan_id=? AND state='PENDING' AND EXISTS(SELECT 1 FROM readable_source_tasks WHERE id=task_plan_checks.task_id)",t.plan()).stream().map(this::planReceipt).toList());case "schedule" -> schedule(t,r);default -> throw IdentityException.invalid();};
  agents.check(task,token);return envelope(r.action(),result);
 }
 private PlanReceipt schedule(Task t,Request r){
  if(r.requestId()==null||r.expectedRevision()==null||r.checkAt()==null||r.reason()==null||r.reason().isBlank()||r.reason().length()>500||r.reason().codePoints().anyMatch(Character::isISOControl))throw IdentityException.invalid();
  String h=hash(t.tenant(),t.id(),r.expectedRevision(),r.checkAt(),r.reason());
  UUID prior=identities.priorRequest(t.owner(),r.requestId(),"TASK_PLAN_SCHEDULE",h);
  if(prior!=null)return planReceipt(db.queryForMap("SELECT * FROM task_plan_checks WHERE id=?",prior));
  var p=plans.get(t.owner(),t.tenant(),t.plan());
  if(p.revision()!=r.expectedRevision())throw new IdentityException(409,"PLAN_REVISION_CONFLICT");
  Instant now=clock.now();var c=p.configuration();
  if(!p.status().equals("ACTIVE")||!c.behavior().equals("ANALYZE")||!c.expiresAt().isAfter(now))throw denied();
  if(!r.checkAt().isAfter(now)||!r.checkAt().isBefore(c.expiresAt())||p.lastDispatchedAt()!=null&&r.checkAt().isBefore(p.lastDispatchedAt().plusSeconds(c.minIntervalSeconds())))throw new IdentityException(400,"PLAN_CHECK_OUTSIDE_LIMITS");
  if(p.runs()>=c.maxTotalRuns())throw new IdentityException(409,"PLAN_TOTAL_RUN_LIMIT");
  Instant day=r.checkAt().atZone(ZoneId.of(c.timeZone())).toLocalDate().atStartOfDay(ZoneId.of(c.timeZone())).toInstant();Instant end=day.atZone(ZoneId.of(c.timeZone())).plusDays(1).toInstant();
  if(db.queryForObject("SELECT count(*) FROM ongoing_plan_runs WHERE plan_id=? AND created_at>=? AND created_at<?",Integer.class,p.id(),Timestamp.from(day),Timestamp.from(end))>=c.maxRunsPerDay())throw new IdentityException(409,"PLAN_DAILY_RUN_LIMIT");
  if(db.queryForObject("SELECT count(*) FROM task_plan_checks WHERE plan_id=? AND state='PENDING'",Integer.class,p.id())>0)throw new IdentityException(409,"PLAN_CHECK_ALREADY_PENDING");
  UUID id=UUID.randomUUID();int next=p.revision()+1;
  db.update("UPDATE ongoing_plans SET revision=?,updated_at=now() WHERE id=?",next,p.id());
  db.update("INSERT INTO ongoing_plan_versions(plan_id,revision,configuration,changed_by) VALUES (?,?,CAST(? AS jsonb),?)",p.id(),next,json.writeValueAsString(c),t.owner());
  db.update("INSERT INTO task_plan_checks(id,tenant_id,owner_id,task_id,attempt_number,plan_id,execution_epoch,request_id,request_hash,accepted_revision,check_at,reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",id,t.tenant(),t.owner(),t.id(),t.attempt(),p.id(),p.executionEpoch(),r.requestId(),h,next,Timestamp.from(r.checkAt()),r.reason());
  identities.remember(t.owner(),r.requestId(),"TASK_PLAN_SCHEDULE",h,id);return planReceipt(db.queryForMap("SELECT * FROM task_plan_checks WHERE id=?",id));
 }
 private PlanReceipt planReceipt(Map<String,Object> r){
  boolean valid=Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM ongoing_plans WHERE id=? AND status='ACTIVE' AND execution_epoch=? AND expires_at>? AND EXISTS(SELECT 1 FROM readable_source_tasks WHERE id=?))",Boolean.class,r.get("plan_id"),r.get("execution_epoch"),Timestamp.from(clock.now()),r.get("task_id")));
  return new PlanReceipt((UUID)r.get("id"),(UUID)r.get("task_id"),(UUID)r.get("plan_id"),(UUID)r.get("request_id"),(Integer)r.get("accepted_revision"),(Long)r.get("execution_epoch"),instant(r,"check_at"),(String)r.get("reason"),(String)r.get("state"),valid&&!Boolean.TRUE.equals(r.get("scrubbed"))&&"PENDING".equals(r.get("state")),(UUID)r.get("dispatched_task_id"),"DISPATCHED".equals(r.get("state"))&&r.get("dispatched_task_id")==null);
 }
 @Transactional public Map<String,Object> preference(UUID task,UUID token,Request r){
  var t=task(task,token);if(r==null||r.action()==null)throw IdentityException.invalid();
  Object result=switch(r.action()){case "read" -> map("choices",TaskPreferenceCatalog.CHOICES,"current",db.queryForList("SELECT e.id FROM profile_entries e JOIN profile_versions v ON v.entry_id=e.id AND v.revision=e.revision WHERE e.tenant_id=? AND e.scope='PERSONAL' AND e.account_id=? AND e.entry_key IN ('ai.preference.RESPONSE_LENGTH','ai.preference.RESPONSE_FORMAT','ai.preference.TONE') AND NOT v.scrubbed AND object_is_active('PROFILE_VERSION',v.id) ORDER BY e.entry_key",UUID.class,t.tenant(),t.owner()).stream().map(id->profiles.get(t.owner(),t.tenant(),id,null)).toList(),"unavailable",db.queryForList("SELECT e.id,e.entry_key AS key,e.revision,'UNAVAILABLE' AS status FROM profile_entries e JOIN profile_versions v ON v.entry_id=e.id AND v.revision=e.revision WHERE e.tenant_id=? AND e.scope='PERSONAL' AND e.account_id=? AND e.entry_key IN ('ai.preference.RESPONSE_LENGTH','ai.preference.RESPONSE_FORMAT','ai.preference.TONE') AND (v.scrubbed OR NOT object_is_active('PROFILE_VERSION',v.id)) ORDER BY e.entry_key",t.tenant(),t.owner()),"scope","CURRENT_USER_PERSONAL","otherWritingsAllowed",false);case "save" -> save(t,r);default -> throw IdentityException.invalid();};
  agents.check(task,token);return envelope(r.action(),result);
 }
 private Object save(Task t,Request r){
  if(r.requestId()==null||r.expectedRevision()==null||r.expectedRevision()<0)throw IdentityException.invalid();
  var choice=TaskPreferenceCatalog.find(r.category(),r.choice());
  if(choice==null)throw IdentityException.invalid();
  String h=hash(t.tenant(),t.id(),r.expectedRevision(),r.category(),r.choice(),r.evidenceSource(),r.evidenceOffset(),r.evidence());
  UUID prior=identities.priorRequest(t.owner(),r.requestId(),"TASK_PREFERENCE_SAVE",h);
  if(prior!=null)return map("saved",true,"receipt",preferenceReceipt(db.queryForMap("SELECT * FROM task_preference_saves WHERE id=?",prior)));
  if(!validEvidence(t,r,choice))return map("saved",false,"reason","EXPLICIT_CURRENT_INPUT_REQUIRED","message","尚未保存：需要用户在本次输入明确表达受支持的长期偏好。请澄清，或让用户在个人档案自行维护。");
  String key="ai.preference."+r.category();
  db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","profile:"+t.tenant()+":PERSONAL:"+t.owner()+":"+key);
  var found=db.queryForList("SELECT id,kind,revision FROM profile_entries WHERE tenant_id=? AND scope='PERSONAL' AND account_id=? AND entry_key=? FOR UPDATE",t.tenant(),t.owner(),key);
  var content=new ProfileService.Content(choice.label(),"本人在任务 "+t.id()+" 的明确长期偏好；独立表达设置，不是业务授权",ProfileService.Status.ACTIVE,null);
  UUID profileRequest=UUID.nameUUIDFromBytes(("task-preference-profile:"+r.requestId()).getBytes(java.nio.charset.StandardCharsets.UTF_8));
  ProfileService.Value value;
  if(found.isEmpty()){if(r.expectedRevision()!=0)throw new IdentityException(409,"PROFILE_VERSION_CONFLICT");value=profiles.create(t.owner(),t.tenant(),ProfileService.Scope.PERSONAL,t.owner(),key,ProfileService.Kind.PREFERENCE,content,profileRequest);}
  else{var e=found.getFirst();if(!"PREFERENCE".equals(e.get("kind")))throw denied();value=profiles.save(t.owner(),t.tenant(),(UUID)e.get("id"),r.expectedRevision(),content,profileRequest);}
  UUID id=UUID.randomUUID();db.update("INSERT INTO task_preference_saves(id,tenant_id,owner_id,task_id,attempt_number,request_id,request_hash,category,choice,profile_id,profile_revision,evidence_source,evidence_offset,evidence_length,evidence_sha) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",id,t.tenant(),t.owner(),t.id(),t.attempt(),r.requestId(),h,r.category(),r.choice(),value.id(),value.revision(),r.evidenceSource(),r.evidenceOffset(),r.evidence().length(),IdentityService.hash(r.evidence()));
  identities.remember(t.owner(),r.requestId(),"TASK_PREFERENCE_SAVE",h,id);return map("saved",true,"receipt",preferenceReceipt(db.queryForMap("SELECT * FROM task_preference_saves WHERE id=?",id)));
 }
 private boolean validEvidence(Task t,Request r,TaskPreferenceCatalog.Choice c){
  if(r.evidenceSource()==null||!Set.of("PROMPT","SUPPLEMENT").contains(r.evidenceSource())||r.evidenceOffset()==null||r.evidenceOffset()<0||r.evidence()==null||r.evidence().length()>200||!TaskPreferenceCatalog.explicit(c,r.evidence()))return false;
  // Plan and feedback-generated prompts are derived instructions, not a fresh user utterance.
  if(r.evidenceSource().equals("PROMPT")&&(t.plan()!=null||db.queryForObject("SELECT count(*) FROM feedback_actions WHERE receipt->>'targetId'=? AND kind='CORRECTION'",Integer.class,t.id().toString())>0||db.queryForObject("SELECT count(*) FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id WHERE t.id=? AND c.purpose='BRIEFING_ADJUSTMENT'",Integer.class,t.id())>0))return false;
  String source=db.queryForObject("SELECT "+(r.evidenceSource().equals("PROMPT")?"prompt":"supplemental_input")+" FROM conversation_tasks WHERE id=?",String.class,t.id());
  int start=r.evidenceOffset(),end=start+r.evidence().length();
  if(source==null||end>source.length()||!source.substring(start,end).equals(r.evidence()))return false;
  // Standalone sentence only: never extract an affirmative fragment from a negation or quotation.
  return source.substring(0,start).isBlank()&&source.substring(end).matches("[\\s。.!！]*");
 }
 private PreferenceReceipt preferenceReceipt(Map<String,Object> r){
  var v=profiles.currentMetadata((UUID)r.get("owner_id"),(UUID)r.get("tenant_id"),(UUID)r.get("profile_id"));int accepted=(Integer)r.get("profile_revision");boolean effective=v.bodyAvailable()&&v.revision()==accepted&&v.effectiveStatus().equals("ACTIVE");
  return new PreferenceReceipt((UUID)r.get("id"),(UUID)r.get("task_id"),(UUID)r.get("request_id"),(String)r.get("category"),(String)r.get("choice"),TaskPreferenceCatalog.find((String)r.get("category"),(String)r.get("choice")).label(),(UUID)r.get("profile_id"),accepted,v.revision(),v.bodyAvailable()?v.effectiveStatus():"UNAVAILABLE",effective,effective,(String)r.get("evidence_source"),instant(r,"created_at"));
 }
 @Transactional public Receipts receipts(UUID actor,UUID tenant,UUID id,int offset){
  if(offset<0||offset>100000)throw IdentityException.invalid();var t=metadata(id);owner(t,actor,tenant);
  var p=db.queryForList("SELECT * FROM task_plan_checks WHERE task_id=? ORDER BY created_at,id LIMIT 21 OFFSET ?",id,offset);var f=db.queryForList("SELECT * FROM task_preference_saves WHERE task_id=? ORDER BY created_at,id LIMIT 21 OFFSET ?",id,offset);
  return new Receipts(p.stream().limit(20).map(this::planReceipt).toList(),f.stream().limit(20).map(this::preferenceReceipt).toList(),p.size()>20||f.size()>20);
 }
 @Transactional public PreferenceReceipt undo(UUID actor,UUID tenant,UUID task,UUID receipt,UUID request){
  var t=metadata(task);owner(t,actor,tenant);var rows=db.queryForList("SELECT * FROM task_preference_saves WHERE id=? AND task_id=?",receipt,task);if(rows.isEmpty())throw denied();var r=rows.getFirst();
  profiles.withdraw(actor,tenant,(UUID)r.get("profile_id"),(Integer)r.get("profile_revision"),request);return preferenceReceipt(r);
 }
}
