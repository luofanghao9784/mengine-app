package com.dreamcore.workspace.plans;

import com.dreamcore.workspace.conversation.AgentSettings;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.MaterialAccess;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@Service
public class PlanService {
 public record Configuration(UUID workspaceId,String goal,String purpose,String query,String behavior,boolean materialEvents,
   String dailyTime,String timeZone,int minIntervalSeconds,int maxRunsPerDay,int maxTotalRuns,Instant expiresAt,boolean notificationsEnabled){}
 public record Plan(UUID id,UUID tenantId,UUID ownerId,int revision,long executionEpoch,String status,String runtimeState,String reason,
   Configuration configuration,Instant nextDue,Instant lastDispatchedAt,int runs,int todayRuns,Instant checkedAt){}
 public record Page(List<Plan> items,boolean hasMore){}
 public record ConfigurationVersion(UUID planId,int revision,Configuration configuration,Instant createdAt){}
 public record Version(UUID materialId,UUID versionId,String parseStatus){}
 public record Run(UUID id,UUID planId,int planRevision,long executionEpoch,String triggerKind,Instant scheduledFor,int missedSlots,
   long eventThrough,List<Version> sourceVersions,UUID conversationId,UUID taskId,String status,String errorCode,Instant createdAt,Instant finishedAt){}
 public record Runs(List<Run> items,boolean hasMore){}
 private final JdbcTemplate db;private final IdentityService identities;private final MaterialAccess access;private final IdentityAudit audit;
 private final PlanClock clock;private final PlanTaskBridge tasks;private final AgentSettings agents;private final boolean tasksEnabled;
 private final JsonMapper json=new JsonMapper();
 private static final Set<String> TASK_OPEN=Set.of("QUEUED","RUNNING","WAITING_INPUT","WAITING_CAPABILITY","WAITING_EXTERNAL","WAITING_RESULT","PAUSED");
 private final com.dreamcore.workspace.departure.DepartureAccess departure;
    public PlanService(JdbcTemplate db,IdentityService identities,MaterialAccess access,IdentityAudit audit,PlanClock clock,PlanTaskBridge tasks,AgentSettings agents,@Value("${dreamcore.tasks.enabled:false}") boolean tasksEnabled,com.dreamcore.workspace.departure.DepartureAccess departure){this.departure=departure;
  this.db=db;this.identities=identities;this.access=access;this.audit=audit;this.clock=clock;this.tasks=tasks;this.agents=agents;this.tasksEnabled=tasksEnabled;
 }
 private IdentityException missing(){return new IdentityException(404,"PLAN_NOT_FOUND");}
 private void paging(int offset,int limit){if(offset<0||offset>100000||limit<1||limit>50)throw IdentityException.invalid();}
 private Instant instant(Map<String,Object> r,String key){return r.get(key)==null?null:((Timestamp)r.get(key)).toInstant();}
 private void ownerLock(UUID actor){db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,22022))",actor.toString());}
 private Configuration configuration(Map<String,Object> r){return new Configuration((UUID)r.get("workspace_id"),(String)r.get("goal"),(String)r.get("purpose"),(String)r.get("query"),(String)r.get("behavior"),(Boolean)r.get("material_events"),(String)r.get("daily_time"),(String)r.get("time_zone"),(Integer)r.get("min_interval_seconds"),(Integer)r.get("max_runs_per_day"),(Integer)r.get("max_total_runs"),instant(r,"expires_at"),(Boolean)r.get("notify"));}
 private Plan map(Map<String,Object> r){
  UUID id=(UUID)r.get("id");Configuration c=configuration(r);Instant start=clock.now().atZone(ZoneId.of(c.timeZone())).toLocalDate().atStartOfDay(ZoneId.of(c.timeZone())).toInstant();
  return new Plan(id,(UUID)r.get("tenant_id"),(UUID)r.get("owner_id"),(Integer)r.get("revision"),(Long)r.get("execution_epoch"),(String)r.get("status"),(String)r.get("runtime_state"),(String)r.get("reason"),c,instant(r,"next_due"),instant(r,"last_dispatch_at"),db.queryForObject("SELECT count(*) FROM ongoing_plan_runs WHERE plan_id=?",Integer.class,id),db.queryForObject("SELECT count(*) FROM ongoing_plan_runs WHERE plan_id=? AND created_at>=?",Integer.class,id,Timestamp.from(start)),instant(r,"checked_at"));
 }
 private Map<String,Object> own(UUID actor,UUID tenant,UUID id,boolean lock){
  identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);var rows=db.queryForList("SELECT * FROM ongoing_plans WHERE id=? AND tenant_id=? AND owner_id=?"+(lock?" FOR UPDATE":""),id,tenant,actor);if(rows.isEmpty())throw missing();return rows.getFirst();
 }
 private void readable(UUID actor,UUID tenant,Map<String,Object> r){access.require(actor,tenant,(UUID)r.get("workspace_id"),false);}
 @Transactional public Page list(UUID actor,UUID tenant,int offset,int limit){
  paging(offset,limit);identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);
  var rows=db.queryForList("""
   SELECT p.* FROM ongoing_plans p JOIN workspaces w ON w.id=p.workspace_id
   WHERE p.tenant_id=? AND p.owner_id=? AND ((w.kind='PERSONAL' AND w.owner_id=?) OR EXISTS(
   SELECT 1 FROM workspace_members g WHERE g.tenant_id=p.tenant_id AND g.workspace_id=p.workspace_id AND g.account_id=?))
   ORDER BY p.created_at DESC,p.id LIMIT ? OFFSET ?
   """,tenant,actor,actor,actor,limit+1,offset);
  return new Page(rows.stream().limit(limit).map(this::map).toList(),rows.size()>limit);
 }
 @Transactional public Plan get(UUID actor,UUID tenant,UUID id){var r=own(actor,tenant,id,false);readable(actor,tenant,r);return map(r);}
 @Transactional public ConfigurationVersion version(UUID actor,UUID tenant,UUID id,int revision){
  var current=own(actor,tenant,id,false);readable(actor,tenant,current);var rows=db.queryForList("SELECT configuration::text AS configuration,created_at FROM ongoing_plan_versions WHERE plan_id=? AND revision=?",id,revision);if(rows.isEmpty())throw missing();
  var r=rows.getFirst();var configuration=json.readValue((String)r.get("configuration"),Configuration.class);access.require(actor,tenant,configuration.workspaceId(),false);return new ConfigurationVersion(id,revision,configuration,instant(r,"created_at"));
 }
 private void validate(Configuration c){
  if(c==null||c.workspaceId()==null||c.goal()==null||c.goal().isBlank()||c.goal().length()>160||c.purpose()==null||c.purpose().isBlank()||c.purpose().length()>1000||c.query()==null||c.query().isBlank()||!Set.of("SOURCE_LOOKUP","ANALYZE").contains(c.behavior()==null?"":c.behavior())||c.query().length()>(c.behavior().equals("SOURCE_LOOKUP")?200:2000)||c.query().codePoints().anyMatch(x->Character.isISOControl(x)&&x!=10&&x!=13&&x!=9)||c.behavior().equals("SOURCE_LOOKUP")&&c.query().strip().split("\\s+").length>8||c.minIntervalSeconds()<60||c.minIntervalSeconds()>86400||c.maxRunsPerDay()<1||c.maxRunsPerDay()>24||c.maxTotalRuns()<1||c.maxTotalRuns()>10000||c.expiresAt()==null||!c.expiresAt().isAfter(clock.now())||c.expiresAt().isAfter(clock.now().plus(Duration.ofDays(366)))||!c.materialEvents()&&c.dailyTime()==null)throw IdentityException.invalid();
  try{if(!ZoneId.getAvailableZoneIds().contains(c.timeZone()))throw new IllegalArgumentException();if(c.dailyTime()!=null&&(!c.dailyTime().matches("[0-2][0-9]:[0-5][0-9]")||LocalTime.parse(c.dailyTime())==null))throw new IllegalArgumentException();}catch(Exception e){throw IdentityException.invalid();}
  if(c.behavior().equals("ANALYZE")&&PlanTaskBridge.prompt(c).length()>2000)throw new IdentityException(400,"PLAN_INSTRUCTIONS_TOO_LONG");
 }
 private String fingerprint(Object... data){return IdentityService.hash(json.writeValueAsString(data));}
 private Plan replay(UUID actor,UUID key){return json.readValue(db.queryForObject("SELECT receipt::text FROM ongoing_plan_receipts WHERE actor_id=? AND request_id=?",String.class,actor,key),Plan.class);}
 private Plan remember(UUID actor,UUID key,String operation,String hash,Plan plan){identities.remember(actor,key,operation,hash,plan.id());db.update("INSERT INTO ongoing_plan_receipts(actor_id,request_id,receipt) VALUES (?,?,CAST(? AS jsonb))",actor,key,json.writeValueAsString(plan));return plan;}
 private void history(UUID actor,Plan plan){db.update("INSERT INTO ongoing_plan_versions(plan_id,revision,configuration,changed_by) VALUES (?,?,CAST(? AS jsonb),?)",plan.id(),plan.revision(),json.writeValueAsString(plan.configuration()),actor);}
 @Transactional public Plan create(UUID actor,UUID tenant,UUID key,Configuration c){
  if(c==null||c.workspaceId()==null)throw IdentityException.invalid();access.require(actor,tenant,c.workspaceId(),false);departure.requireActiveBusiness(actor,tenant);ownerLock(actor);String hash=fingerprint(tenant,c);UUID prior=identities.priorRequest(actor,key,"PLAN_CREATE",hash);if(prior!=null)return replay(actor,key);validate(c);
  if(db.queryForObject("SELECT count(*) FROM ongoing_plans WHERE owner_id=? AND status NOT IN ('STOPPED','EXPIRED')",Integer.class,actor)>=20)throw new IdentityException(409,"PLAN_COUNT_LIMIT");
  UUID id=UUID.randomUUID();db.update("""
   INSERT INTO ongoing_plans(id,tenant_id,workspace_id,owner_id,goal,purpose,query,behavior,material_events,daily_time,time_zone,min_interval_seconds,max_runs_per_day,max_total_runs,expires_at,notify)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
   """,id,tenant,c.workspaceId(),actor,c.goal().strip(),c.purpose().strip(),c.query().strip(),c.behavior(),c.materialEvents(),c.dailyTime(),c.timeZone(),c.minIntervalSeconds(),c.maxRunsPerDay(),c.maxTotalRuns(),Timestamp.from(c.expiresAt()),c.notificationsEnabled());
  var result=get(actor,tenant,id);history(actor,result);audit.record(actor,tenant,"PLAN_CREATE",id,"SUCCESS");return remember(actor,key,"PLAN_CREATE",hash,result);
 }
 @Transactional public Plan update(UUID actor,UUID tenant,UUID id,UUID key,int revision,Configuration c){return update(actor,tenant,id,key,revision,c,false);}
 @Transactional public Plan update(UUID actor,UUID tenant,UUID id,UUID key,int revision,Configuration c,boolean keepPaused){
  if(c==null||c.workspaceId()==null)throw IdentityException.invalid();identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);ownerLock(actor);var r=own(actor,tenant,id,true);readable(actor,tenant,r);access.require(actor,tenant,c.workspaceId(),false);
  String hash=keepPaused?fingerprint(tenant,id,revision,c,"KEEP_PAUSED"):fingerprint(tenant,id,revision,c);UUID prior=identities.priorRequest(actor,key,"PLAN_UPDATE",hash);if(prior!=null)return replay(actor,key);
  validate(c);
  if(revision!=(Integer)r.get("revision"))throw new IdentityException(409,"PLAN_REVISION_CONFLICT");
  if(!Set.of("DRAFT","PAUSED","AUTHORIZATION_REQUIRED").contains(r.get("status")))throw new IdentityException(409,"PLAN_PAUSE_BEFORE_EDIT");
  db.update("""
   UPDATE ongoing_plans SET workspace_id=?,goal=?,purpose=?,query=?,behavior=?,material_events=?,daily_time=?,time_zone=?,min_interval_seconds=?,max_runs_per_day=?,max_total_runs=?,expires_at=?,notify=?,revision=revision+1,execution_epoch=execution_epoch+1,status=CASE WHEN ? THEN 'PAUSED' ELSE 'DRAFT' END,runtime_state='IDLE',reason=NULL,next_due=NULL,observed_event=0,last_source_key=NULL,updated_at=now() WHERE id=?
   """,c.workspaceId(),c.goal().strip(),c.purpose().strip(),c.query().strip(),c.behavior(),c.materialEvents(),c.dailyTime(),c.timeZone(),c.minIntervalSeconds(),c.maxRunsPerDay(),c.maxTotalRuns(),Timestamp.from(c.expiresAt()),c.notificationsEnabled(),keepPaused&&"PAUSED".equals(r.get("status")),id);
  var result=get(actor,tenant,id);history(actor,result);audit.record(actor,tenant,"PLAN_UPDATE",id,"SUCCESS");return remember(actor,key,"PLAN_UPDATE",hash,result);
 }
 @Transactional public Plan action(UUID actor,UUID tenant,UUID id,UUID key,int revision,String action,boolean accepted){
  if(action==null||!Set.of("ENABLE","PAUSE","RESUME","STOP","RETRY","MUTE","UNMUTE").contains(action))throw IdentityException.invalid();
  identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);ownerLock(actor);var r=own(actor,tenant,id,true);readable(actor,tenant,r);
  String hash=fingerprint(tenant,id,revision,action,accepted);UUID prior=identities.priorRequest(actor,key,"PLAN_ACTION",hash);if(prior!=null)return replay(actor,key);
  if(revision!=(Integer)r.get("revision"))throw new IdentityException(409,"PLAN_REVISION_CONFLICT");String current=(String)r.get("status");Configuration c=configuration(r);Instant now=clock.now();
  if(Set.of("ENABLE","RESUME","RETRY").contains(action)){
   if(!accepted)throw new IdentityException(400,"PLAN_DELEGATION_REQUIRED");validate(c);
   if(action.equals("ENABLE")&&!current.equals("DRAFT")||action.equals("RESUME")&&!Set.of("PAUSED","AUTHORIZATION_REQUIRED").contains(current)||action.equals("RETRY")&&(!current.equals("ACTIVE")||!"NEEDS_ATTENTION".equals(r.get("runtime_state"))))throw new IdentityException(409,"PLAN_STATE_CONFLICT");
   var lastTask=db.queryForList("SELECT t.status,t.reconciliation_required FROM ongoing_plan_runs r JOIN conversation_tasks t ON t.id=r.task_id WHERE r.plan_id=? ORDER BY r.created_at DESC,r.id DESC LIMIT 1",id);
   if(!lastTask.isEmpty()&&Boolean.TRUE.equals(lastTask.getFirst().get("reconciliation_required")))throw new IdentityException(409,"TASK_RECONCILIATION_REQUIRED");
   if(action.equals("RETRY")&&(lastTask.isEmpty()||!Set.of("FAILED","CANCELLED","INTERRUPTED").contains(lastTask.getFirst().get("status"))))throw new IdentityException(409,"PLAN_RESOLVE_ORIGINAL_TASK");
   interrupt(r,"TASK_PLAN_STOPPED");Instant due=c.dailyTime()==null?null:instant(r,"next_due");if(due==null&&c.dailyTime()!=null)due=PlanSchedule.next(now,LocalTime.parse(c.dailyTime()),ZoneId.of(c.timeZone()));
   var previous=db.queryForList("SELECT status FROM ongoing_plan_runs WHERE plan_id=? ORDER BY created_at DESC,id DESC LIMIT 1",String.class,id);
   boolean retry=action.equals("RETRY")||!previous.isEmpty()&&!previous.getFirst().equals("SUCCEEDED");
   db.update("UPDATE ongoing_plans SET status='ACTIVE',runtime_state='IDLE',reason=NULL,revision=revision+1,execution_epoch=execution_epoch+1,next_due=?,retry_requested=?,updated_at=now() WHERE id=?",due==null?null:Timestamp.from(due),retry,id);
  }else if(action.equals("MUTE")||action.equals("UNMUTE")){
   db.update("UPDATE ongoing_plans SET notify=?,revision=revision+1,updated_at=now() WHERE id=?",action.equals("UNMUTE"),id);
  }else{
   if(current.equals("STOPPED")||current.equals("EXPIRED")||action.equals("PAUSE")&&!current.equals("ACTIVE"))throw new IdentityException(409,"PLAN_STATE_CONFLICT");
   db.update("UPDATE ongoing_plans SET status=?,runtime_state='IDLE',reason=NULL,revision=revision+1,execution_epoch=execution_epoch+1,updated_at=now() WHERE id=?",action.equals("PAUSE")?"PAUSED":"STOPPED",id);interrupt(r,"TASK_PLAN_STOPPED");
  }
  var result=get(actor,tenant,id);history(actor,result);audit.record(actor,tenant,"PLAN_"+action,id,"SUCCESS");return remember(actor,key,"PLAN_ACTION",hash,result);
 }
 private void interrupt(Map<String,Object> p,String reason){
  UUID id=(UUID)p.get("id");var ids=db.queryForList("SELECT task_id FROM ongoing_plan_runs WHERE plan_id=? AND status IN ('QUEUED','RUNNING','WAITING_INPUT','WAITING_CAPABILITY','WAITING_EXTERNAL','WAITING_RESULT','PAUSED','PARTIAL')",UUID.class,id);
  tasks.interrupt((UUID)p.get("tenant_id"),ids,reason);
  db.update("UPDATE ongoing_plan_runs SET status='INTERRUPTED',error_code=?,finished_at=coalesce(finished_at,now()) WHERE plan_id=? AND status IN ('QUEUED','RUNNING','WAITING_INPUT','WAITING_CAPABILITY','WAITING_EXTERNAL','WAITING_RESULT','PAUSED','PARTIAL')",reason,id);
 }
 @Transactional public Runs runs(UUID actor,UUID tenant,UUID id,int offset,int limit){
  paging(offset,limit);var p=own(actor,tenant,id,false);readable(actor,tenant,p);
  var rows=db.queryForList("SELECT * FROM ongoing_plan_runs WHERE plan_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",id,limit+1,offset);
  return new Runs(rows.stream().limit(limit).map(r->new Run((UUID)r.get("id"),id,(Integer)r.get("plan_revision"),(Long)r.get("execution_epoch"),(String)r.get("trigger_kind"),instant(r,"scheduled_for"),(Integer)r.get("missed_slots"),(Long)r.get("event_through"),Arrays.asList(json.readValue(r.get("source_versions").toString(),Version[].class)),(UUID)r.get("conversation_id"),(UUID)r.get("task_id"),(String)r.get("status"),(String)r.get("error_code"),instant(r,"created_at"),instant(r,"finished_at"))).toList(),rows.size()>limit);
 }
 public List<UUID> candidates(){return db.queryForList("SELECT id FROM ongoing_plans WHERE status='ACTIVE' OR (status IN ('DRAFT','PAUSED','AUTHORIZATION_REQUIRED') AND expires_at<=?) OR EXISTS(SELECT 1 FROM ongoing_plan_runs r WHERE r.plan_id=ongoing_plans.id AND r.status IN ('QUEUED','RUNNING','WAITING_INPUT','WAITING_CAPABILITY','WAITING_EXTERNAL','WAITING_RESULT','PAUSED','PARTIAL')) ORDER BY checked_at NULLS FIRST,id LIMIT 20",UUID.class,Timestamp.from(clock.now()));}
 private void runtime(UUID id,String state,String reason){db.update("UPDATE ongoing_plans SET runtime_state=?,reason=?,checked_at=? WHERE id=?",state,reason,Timestamp.from(clock.now()),id);}
 @Transactional public void tick(UUID id){
  var preliminary=db.queryForList("SELECT tenant_id,owner_id FROM ongoing_plans WHERE id=?",id);if(preliminary.isEmpty())return;
  UUID tenant=(UUID)preliminary.getFirst().get("tenant_id"),owner=(UUID)preliminary.getFirst().get("owner_id");
  db.queryForList("SELECT id FROM tenants WHERE id=? FOR SHARE",tenant);ownerLock(owner);
  var rows=db.queryForList("SELECT * FROM ongoing_plans WHERE id=? FOR UPDATE",id);if(rows.isEmpty())return;var p=rows.getFirst();Configuration c=configuration(p);Instant now=clock.now();
  if("SUSPENDED".equals(db.queryForObject("SELECT status FROM tenants WHERE id=?",String.class,tenant))){runtime(id,"WAITING_TIME","TENANT_SERVICE_SUSPENDED");return;}
  if(!Set.of("STOPPED","EXPIRED").contains(p.get("status"))&&!c.expiresAt().isAfter(now)){db.update("UPDATE ongoing_plans SET status='EXPIRED',runtime_state='IDLE',reason='PLAN_EXPIRED',execution_epoch=execution_epoch+1,revision=revision+1,checked_at=? WHERE id=?",Timestamp.from(now),id);interrupt(p,"TASK_PLAN_EXPIRED");return;}
  if(!p.get("status").equals("ACTIVE")){interrupt(p,"TASK_PLAN_STOPPED");db.update("UPDATE ongoing_plans SET checked_at=? WHERE id=?",Timestamp.from(now),id);return;}
  try{departure.requireActiveBusiness(owner,tenant);access.require(owner,tenant,c.workspaceId(),false);}catch(IdentityException e){db.update("UPDATE ongoing_plans SET status='AUTHORIZATION_REQUIRED',runtime_state='NEEDS_ATTENTION',reason='AUTHORIZATION_REVOKED',execution_epoch=execution_epoch+1,revision=revision+1,checked_at=? WHERE id=?",Timestamp.from(now),id);interrupt(p,"TASK_PLAN_STOPPED");return;}
  db.update("UPDATE ongoing_plan_runs r SET status=t.status,error_code=t.error_code,finished_at=t.finished_at FROM conversation_tasks t WHERE r.task_id=t.id AND r.plan_id=? AND r.status NOT IN ('INTERRUPTED','CANCELLED')",id);
  var last=db.queryForList("SELECT status FROM ongoing_plan_runs WHERE plan_id=? ORDER BY created_at DESC,id DESC LIMIT 1",id);boolean retry=(Boolean)p.get("retry_requested");
  if(!last.isEmpty()){
   String status=(String)last.getFirst().get("status");if(TASK_OPEN.contains(status)){runtime(id,status.equals("QUEUED")||status.equals("RUNNING")?"RUNNING":status.equals("WAITING_CAPABILITY")?"WAITING_CAPABILITY":"NEEDS_ATTENTION",status.equals("QUEUED")||status.equals("RUNNING")?null:"TASK_NEEDS_ATTENTION");return;}
   if(!status.equals("SUCCEEDED")&&!retry){runtime(id,"NEEDS_ATTENTION","TASK_NEEDS_ATTENTION");return;}
  }
  Instant expected=instant(p,"next_due");boolean daily=expected!=null&&!expected.isAfter(now);
  // One bounded model-scheduled check, still under this exact delegation and all ordinary dispatch gates.
  var checks=db.queryForList("SELECT id,check_at FROM task_plan_checks WHERE plan_id=? AND execution_epoch=? AND state='PENDING' AND NOT scrubbed AND check_at<=? AND EXISTS(SELECT 1 FROM readable_source_tasks WHERE id=task_plan_checks.task_id) ORDER BY check_at,id LIMIT 1 FOR UPDATE",id,p.get("execution_epoch"),Timestamp.from(now));
  boolean check=!checks.isEmpty();
  long event=db.queryForObject("SELECT coalesce(max(sequence),0) FROM ongoing_plan_material_events WHERE tenant_id=? AND workspace_id=?",Long.class,tenant,c.workspaceId());
  boolean changed=c.materialEvents()&&(event>(Long)p.get("observed_event")||p.get("last_source_key")==null&&db.queryForObject("SELECT service_resumed_at IS NULL FROM tenants WHERE id=?",Boolean.class,tenant));
  if(!daily&&!changed&&!retry&&!check){runtime(id,"WAITING_TIME","NO_NEW_VERSION");return;}
  var versions=db.query("""
   SELECT m.id AS material_id,v.id AS version_id,coalesce(k.status,'NOT_REQUESTED') AS parse_status FROM active_materials m
   JOIN material_versions v ON v.material_id=m.id AND v.number=m.current_version
   LEFT JOIN LATERAL(SELECT status FROM knowledge_runs WHERE version_id=v.id ORDER BY generation DESC LIMIT 1) k ON true
   WHERE m.in_library AND m.tenant_id=? AND m.workspace_id=? ORDER BY m.id LIMIT 1001
   """,(r,n)->new Version(r.getObject("material_id",UUID.class),r.getObject("version_id",UUID.class),r.getString("parse_status")),tenant,c.workspaceId());
  if(versions.size()>1000){runtime(id,"WAITING_RESOURCE","SOURCE_COUNT_LIMIT");return;}
  if(versions.isEmpty()||versions.stream().noneMatch(v->Set.of("READY","PARTIAL").contains(v.parseStatus()))){runtime(id,"WAITING_DATA",versions.isEmpty()?"NO_MATERIALS":versions.stream().anyMatch(v->Set.of("FAILED","UNSUPPORTED","CANCELLED").contains(v.parseStatus()))?"SOURCE_REQUIRES_ATTENTION":"MATERIALS_NOT_READY");return;}
  String sourceKey=fingerprint(versions.stream().map(v->List.of(v.materialId(),v.versionId())).toList());
  if(!daily&&!retry&&!check&&sourceKey.equals(p.get("last_source_key"))){db.update("UPDATE ongoing_plans SET observed_event=? WHERE id=?",event,id);runtime(id,"WAITING_TIME","NO_NEW_VERSION");return;}
  if(!tasksEnabled||c.behavior().equals("ANALYZE")&&!agents.enabled()){runtime(id,"WAITING_CAPABILITY",tasksEnabled?"MODEL_NOT_CONFIGURED":"TASK_RUNTIME_UNAVAILABLE");return;}
  var mapped=map(p);if(mapped.runs()>=c.maxTotalRuns()){runtime(id,"NEEDS_ATTENTION","TOTAL_RUN_LIMIT");return;}
  Instant lastDispatch=instant(p,"last_dispatch_at");Instant utcDay=now.atZone(ZoneOffset.UTC).toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant();
  int ownerToday=db.queryForObject("SELECT count(*) FROM ongoing_plan_runs WHERE owner_id=? AND created_at>=?",Integer.class,owner,Timestamp.from(utcDay));
  int ownerConcurrent=db.queryForObject("SELECT count(*) FROM ongoing_plan_runs r JOIN conversation_tasks t ON t.id=r.task_id WHERE r.owner_id=? AND t.status IN ('QUEUED','RUNNING')",Integer.class,owner);
  if(mapped.todayRuns()>=c.maxRunsPerDay()||ownerToday>=48||ownerConcurrent>=2||lastDispatch!=null&&lastDispatch.plusSeconds(c.minIntervalSeconds()).isAfter(now)){runtime(id,"WAITING_RESOURCE",mapped.todayRuns()>=c.maxRunsPerDay()?"DAILY_RUN_LIMIT":ownerToday>=48?"OWNER_DAILY_LIMIT":ownerConcurrent>=2?"OWNER_CONCURRENCY_LIMIT":"MINIMUM_INTERVAL");return;}
  PlanSchedule.Due due=daily?PlanSchedule.due(expected,now,LocalTime.parse(c.dailyTime()),ZoneId.of(c.timeZone())):null;
  String trigger=check?"MODEL_CHECK":retry?"RETRY":daily?"DAILY":"MATERIAL_VERSION";
  String triggerKey=p.get("execution_epoch")+":"+trigger+":"+(check?checks.getFirst().get("id").toString():retry?p.get("revision"):daily?due.latest().toString():sourceKey);
  if(db.queryForObject("SELECT count(*) FROM ongoing_plan_runs WHERE plan_id=? AND trigger_key=?",Integer.class,id,triggerKey)>0){runtime(id,"WAITING_TIME","TRIGGER_ALREADY_ACCEPTED");return;}
  UUID run=UUID.randomUUID();var detail=tasks.submit(owner,tenant,c.workspaceId(),run,c);var task=detail.tasks().getLast();
  db.update("""
   INSERT INTO ongoing_plan_runs(id,tenant_id,plan_id,owner_id,plan_revision,execution_epoch,trigger_key,trigger_kind,scheduled_for,missed_slots,event_through,source_key,source_versions,conversation_id,task_id,status,created_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,CAST(? AS jsonb),?,?,?,?)
   """,run,tenant,id,owner,p.get("revision"),p.get("execution_epoch"),triggerKey,trigger,check?checks.getFirst().get("check_at"):daily?Timestamp.from(due.latest()):null,daily?due.missedSlots():0,event,sourceKey,json.writeValueAsString(versions),detail.conversation().id(),task.id(),task.status(),Timestamp.from(now));
  if(check)db.update("UPDATE task_plan_checks SET state='DISPATCHED',dispatched_task_id=? WHERE id=? AND state='PENDING'",task.id(),checks.getFirst().get("id"));
  Instant next=c.dailyTime()==null?null:daily?PlanSchedule.next(now,LocalTime.parse(c.dailyTime()),ZoneId.of(c.timeZone())):expected;
  db.update("UPDATE ongoing_plans SET runtime_state='RUNNING',reason=NULL,observed_event=?,last_source_key=?,last_dispatch_at=?,next_due=?,retry_requested=false,checked_at=? WHERE id=?",event,sourceKey,Timestamp.from(now),next==null?null:Timestamp.from(next),Timestamp.from(now),id);
  audit.record(owner,tenant,"PLAN_DISPATCH",id,"SUCCESS");
 }
}
