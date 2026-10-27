package com.dreamcore.workspace.conversation;
import java.util.*;import java.time.*;import java.sql.Timestamp;
import org.springframework.stereotype.Service;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import com.dreamcore.workspace.identity.*;
import tools.jackson.databind.json.JsonMapper;
@Service
public class NativeSchedules {
 public record Config(String title,String prompt,Map<String,Object> rule,boolean materialEvents,int minIntervalSeconds,int maxRunsPerDay,int maxTotalRuns,Instant expiresAt){}
 private final NativeConversationService sessions;private final NativeRuntimeClient runtime;private final NativeScheduleRules rules;private final JdbcTemplate db;private final TransactionTemplate tx;private final JsonMapper json=new JsonMapper();
 public NativeSchedules(NativeConversationService s,NativeRuntimeClient r,NativeScheduleRules rules,JdbcTemplate db,PlatformTransactionManager tm){sessions=s;runtime=r;this.rules=rules;this.db=db;tx=new TransactionTemplate(tm);}
 private Timestamp ts(Instant i){return i==null?null:Timestamp.from(i);}
 private Config config(Map<String,Object> row){return json.readValue(row.get("configuration").toString(),Config.class);}
 private Map<String,Object> row(UUID id){var rows=db.queryForList("SELECT * FROM native_schedules WHERE id=?",id);if(rows.isEmpty())throw new IdentityException(404,"NATIVE_SCHEDULE_NOT_FOUND");return rows.getFirst();}
 private Map<String,Object> view(Map<String,Object> r){var v=new LinkedHashMap<String,Object>();for(String key:List.of("id","session_id","state","reason","next_due","legacy_plan_id"))v.put(key,r.get(key));v.put("configuration",config(r));return v;}
 @Transactional public Object create(UUID actor,UUID tenant,UUID session,UUID key,Config c){
  sessions.require(actor,tenant,session,true);runtime.available();if(key==null||c==null)throw IdentityException.invalid();String hash=IdentityService.hash(json.writeValueAsString(c));
  var prior=db.queryForList("SELECT * FROM native_schedules WHERE session_id=? AND request_id=?",session,key);if(!prior.isEmpty()){if(!hash.equals(prior.getFirst().get("fingerprint")))throw new IdentityException(409,"NATIVE_REQUEST_CONFLICT");return view(prior.getFirst());}
  UUID id=UUID.randomUUID();var record=validate(c,id);
  db.update("INSERT INTO native_schedules(id,session_id,request_id,fingerprint,configuration,record,next_due,observed_event) VALUES (?,?,?,?,?::jsonb,?::jsonb,?,?)",id,session,key,hash,json.writeValueAsString(c),record==null?null:json.writeValueAsString(record),record==null?null:ts(Instant.parse((String)record.get("scheduledAt"))),event(session));return view(row(id));
 }
 private Map<String,Object> validate(Config c,UUID id){
  Instant now=Instant.now();if(c.title()==null||c.title().isBlank()||c.title().length()>120||c.prompt()==null||c.prompt().isBlank()||c.prompt().length()>10000||c.minIntervalSeconds()<60||c.minIntervalSeconds()>86400||c.maxRunsPerDay()<1||c.maxRunsPerDay()>24||c.maxTotalRuns()<1||c.maxTotalRuns()>10000||c.expiresAt()==null||!c.expiresAt().isAfter(now)||c.expiresAt().isAfter(now.plusSeconds(366*86400L))||c.rule()==null&&!c.materialEvents())throw IdentityException.invalid();
  Map<String,Object> record=c.rule()==null?null:rules.evaluate(Map.of("operation","create","id",id.toString(),"prompt",c.prompt(),"title",c.title(),"rule",c.rule(),"now",now.toEpochMilli()));
  return record;
 }
 private long event(UUID session){return db.queryForObject("SELECT coalesce(max(e.sequence),0) FROM ongoing_plan_material_events e JOIN native_conversations s ON e.tenant_id=s.tenant_id AND e.workspace_id=s.workspace_id WHERE s.id=?",Long.class,session);}
 @Transactional public Object list(UUID actor,UUID tenant,UUID session){sessions.require(actor,tenant,session,false);return db.queryForList("SELECT * FROM native_schedules WHERE session_id=? ORDER BY created_at",session).stream().map(this::view).toList();}
 @Transactional public Object action(UUID actor,UUID tenant,UUID session,UUID id,String state){sessions.require(actor,tenant,session,false);var r=row(id);if(!session.equals(r.get("session_id"))||!Set.of("ACTIVE","PAUSED","STOPPED").contains(state))throw IdentityException.invalid();if(Set.of("STOPPED","COMPLETED").contains(r.get("state"))&&!state.equals(r.get("state")))throw new IdentityException(409,"NATIVE_SCHEDULE_NOT_RESUMABLE");if(state.equals("ACTIVE")){if(db.queryForObject("SELECT count(*) FROM native_schedule_runs WHERE schedule_id=? AND state='UNKNOWN'",Integer.class,id)>0)throw new IdentityException(409,"NATIVE_SCHEDULE_NOT_RESUMABLE");runtime.available();sessions.require(actor,tenant,session,true);if(!config(r).expiresAt().isAfter(Instant.now())||Set.of("STOPPED","UNKNOWN").contains(r.get("state"))||"OUTCOME_UNKNOWN".equals(r.get("reason")))throw new IdentityException(409,"NATIVE_SCHEDULE_NOT_RESUMABLE");}db.update("UPDATE native_schedules SET state=?,reason=CASE WHEN ?='ACTIVE' THEN NULL ELSE reason END WHERE id=?",state,state,id);return view(row(id));}
 @Transactional public Object runs(UUID actor,UUID tenant,UUID session,UUID id){sessions.require(actor,tenant,session,false);if(!session.equals(row(id).get("session_id")))throw IdentityException.invalid();return db.queryForList("SELECT id,session_id,state,reason,created_at,dispatched_at,finished_at FROM native_schedule_runs WHERE schedule_id=? ORDER BY created_at DESC LIMIT 100",id);}
 @Transactional public Object edit(UUID actor,UUID tenant,UUID session,UUID id,Config c){
  sessions.require(actor,tenant,session,true);db.queryForList("SELECT id FROM native_schedules WHERE id=? FOR UPDATE",id);var r=row(id);
  if(!session.equals(r.get("session_id"))||!"PAUSED".equals(r.get("state"))||"OUTCOME_UNKNOWN".equals(r.get("reason"))||db.queryForObject("SELECT count(*) FROM native_schedule_runs WHERE schedule_id=? AND finished_at IS NULL",Integer.class,id)>0)throw new IdentityException(409,"NATIVE_SCHEDULE_PAUSE_BEFORE_EDIT");
  if(config(r).equals(c))return view(r);var record=validate(c,id);
  db.update("UPDATE native_schedules SET configuration=?::jsonb,record=?::jsonb,next_due=?,reason=NULL WHERE id=?",json.writeValueAsString(c),record==null?null:json.writeValueAsString(record),record==null?null:ts(Instant.parse((String)record.get("scheduledAt"))),id);return view(row(id));
 }
 public List<UUID> candidates(){return db.queryForList("SELECT id FROM native_schedules WHERE state='ACTIVE' OR EXISTS(SELECT 1 FROM native_schedule_runs r WHERE r.schedule_id=native_schedules.id AND NOT r.reclaimed) ORDER BY next_due NULLS FIRST LIMIT 100",UUID.class);}
 private void attention(UUID id,String reason){db.update("UPDATE native_schedules SET state='PAUSED',reason=? WHERE id=?",reason,id);}
 public void tick(UUID id){
  runtime.available();var r=row(id);UUID parent=(UUID)r.get("session_id");var scope=db.queryForMap("SELECT tenant_id,owner_id FROM native_conversations WHERE id=?",parent);UUID owner=(UUID)scope.get("owner_id"),tenant=(UUID)scope.get("tenant_id");
  try{sessions.require(owner,tenant,parent,true);}catch(IdentityException denied){attention(id,"AUTHORIZATION_REVOKED");cancelRuns(id);return;}
  if(!config(r).expiresAt().isAfter(Instant.now())){attention(id,"EXPIRED");cancelRuns(id);return;}
  if(!r.get("state").equals("ACTIVE")){cancelRuns(id);return;}
  settle(id,owner,tenant);
  UUID run=tx.execute(status->reserve(id,owner,tenant));if(run==null)return;
  if(db.update("UPDATE native_schedule_runs SET state='DISPATCHING',dispatched_at=now() WHERE id=? AND state='READY'",run)==0)return;
  var execution=db.queryForMap("SELECT session_id FROM native_schedule_runs WHERE id=?",run);UUID session=(UUID)execution.get("session_id");boolean handedOff=false;
  try{
   sessions.require(owner,tenant,parent,true);var grant=sessions.grant(owner,tenant,session);
   var attachments=db.queryForList("SELECT id::text FROM native_conversation_attachments WHERE session_id=? ORDER BY created_at",String.class,session);
   handedOff=true;var receipt=runtime.command(session,grant.token(),"messages",Map.of("requestId",run.toString(),"text",config(r).prompt(),"attachments",attachments));
   db.update("UPDATE native_schedule_runs SET state='RUNNING',receipt=?::jsonb WHERE id=? AND state='DISPATCHING'",json.writeValueAsString(receipt),run);
  }catch(RuntimeException e){
   if(e instanceof NativeRuntimeClient.NotDispatched){db.update("UPDATE native_schedule_runs SET state='READY',reason='NOT_DISPATCHED' WHERE id=?",run);}
   else if(!handedOff){db.update("UPDATE native_schedule_runs SET state='FAILED',reason='AUTHORIZATION_REVOKED',finished_at=now() WHERE id=?",run);attention(id,"AUTHORIZATION_REVOKED");runtime.reclaim(session);db.update("UPDATE native_schedule_runs SET reclaimed=true WHERE id=?",run);}
   else{db.update("UPDATE native_schedule_runs SET state='UNKNOWN',reason='OUTCOME_UNKNOWN',finished_at=now() WHERE id=?",run);attention(id,"OUTCOME_UNKNOWN");runtime.reclaim(session);db.update("UPDATE native_schedule_runs SET reclaimed=true WHERE id=?",run);}
  }
 }
 private UUID reserve(UUID id,UUID owner,UUID tenant){
  var initial=row(id);UUID parent=(UUID)initial.get("session_id");sessions.require(owner,tenant,parent,true);
  db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,183))",owner.toString());db.queryForList("SELECT id FROM native_schedules WHERE id=? FOR UPDATE",id);var r=row(id);if(!r.get("state").equals("ACTIVE"))return null;
  var pending=db.queryForList("SELECT id,state FROM native_schedule_runs WHERE schedule_id=? AND finished_at IS NULL ORDER BY created_at LIMIT 1",id);if(!pending.isEmpty())return pending.getFirst().get("state").equals("READY")?(UUID)pending.getFirst().get("id"):null;
  Config c=config(r);Instant now=Instant.now();if(!c.expiresAt().isAfter(now))return null;
  long ev=event(parent);boolean changed=c.materialEvents()&&ev>((Number)r.get("observed_event")).longValue();boolean due=r.get("next_due")!=null&&!((Timestamp)r.get("next_due")).toInstant().isAfter(now);if(!changed&&!due)return null;
  int count=db.queryForObject("SELECT count(*) FROM native_schedule_runs WHERE schedule_id=?",Integer.class,id);
  int legacy=r.get("legacy_plan_id")==null?0:db.queryForObject("SELECT count(*) FROM ongoing_plan_runs WHERE plan_id=?",Integer.class,r.get("legacy_plan_id"));
  if(count+legacy>=c.maxTotalRuns()){attention(id,"TOTAL_RUN_LIMIT");return null;}
  int today=db.queryForObject("SELECT count(*) FROM native_schedule_runs WHERE schedule_id=? AND created_at>=now()-interval '24 hours'",Integer.class,id);
  if(r.get("legacy_plan_id")!=null)today+=db.queryForObject("SELECT count(*) FROM ongoing_plan_runs WHERE plan_id=? AND created_at>=now()-interval '24 hours'",Integer.class,r.get("legacy_plan_id"));
  int ownerToday=db.queryForObject("SELECT count(*) FROM native_schedule_runs r JOIN native_conversations s ON s.id=r.session_id WHERE s.owner_id=? AND r.created_at>=now()-interval '24 hours'",Integer.class,owner)+db.queryForObject("SELECT count(*) FROM ongoing_plan_runs WHERE owner_id=? AND created_at>=now()-interval '24 hours'",Integer.class,owner);
  int active=db.queryForObject("SELECT count(*) FROM native_schedule_runs r JOIN native_conversations s ON s.id=r.session_id WHERE s.owner_id=? AND r.finished_at IS NULL",Integer.class,owner);
  active+=db.queryForObject("SELECT count(*) FROM ongoing_plan_runs WHERE owner_id=? AND finished_at IS NULL",Integer.class,owner);
  if(today>=c.maxRunsPerDay()||ownerToday>=48||active>=2||r.get("last_dispatch_at")!=null&&((Timestamp)r.get("last_dispatch_at")).toInstant().plusSeconds(c.minIntervalSeconds()).isAfter(now))return null;
  Map<String,Object> next=null;String trigger="material:"+ev;
  if(due){var record=json.readValue(r.get("record").toString(),Map.class);next=rules.evaluate(Map.of("operation","due","record",record,"now",now.toEpochMilli()));trigger="time:"+next.get("occurrenceAt");record.put("scheduledAt",next.getOrDefault("nextScheduledAt",record.get("scheduledAt")));db.update("UPDATE native_schedules SET record=?::jsonb,next_due=? WHERE id=?",json.writeValueAsString(record),next.get("nextScheduledAt")==null?null:ts(Instant.parse((String)next.get("nextScheduledAt"))),id);}
  UUID run=UUID.randomUUID();var s=sessions.open(owner,tenant,new NativeConversationService.Open(run,sessions.require(owner,tenant,parent,true).workspaceId(),null));
  db.update("UPDATE native_conversations SET legacy_conversation_id=(SELECT legacy_conversation_id FROM native_conversations WHERE id=?) WHERE id=?",parent,s.id());
  db.update("INSERT INTO native_conversation_sources SELECT ?,version_id,requires_download FROM native_conversation_sources WHERE session_id=?",s.id(),parent);
  db.update("INSERT INTO native_conversation_history SELECT ?,task_id,revision,attempt FROM native_conversation_history WHERE session_id=?",s.id(),parent);
  if(db.queryForObject("SELECT count(*) FROM native_conversation_attachments WHERE session_id=?",Integer.class,parent)>10)throw new IdentityException(409,"NATIVE_SCHEDULE_ATTACHMENT_LIMIT");
  db.update("INSERT INTO native_conversation_attachments(id,session_id,request_id,filename,media_type,sha256,content) SELECT gen_random_uuid(),?,gen_random_uuid(),filename,media_type,sha256,content FROM native_conversation_attachments WHERE session_id=?",s.id(),parent);
  db.update("INSERT INTO native_schedule_runs(id,schedule_id,session_id,trigger_key,configuration) VALUES (?,?,?,?,?::jsonb)",run,id,s.id(),trigger,json.writeValueAsString(c));
  db.update("UPDATE native_schedules SET observed_event=?,last_dispatch_at=now() WHERE id=?",ev,id);return run;
 }
 private void settle(UUID id,UUID owner,UUID tenant){
  for(var run:db.queryForList("SELECT * FROM native_schedule_runs WHERE schedule_id=? AND finished_at IS NULL",id)){
   UUID sid=(UUID)run.get("session_id"),rid=(UUID)run.get("id");String state=run.get("state").toString();
   if(state.equals("DISPATCHING")&&((Timestamp)run.get("dispatched_at")).toInstant().plusSeconds(120).isBefore(Instant.now())){db.update("UPDATE native_schedule_runs SET state='UNKNOWN',reason='DISPATCH_INTERRUPTED',finished_at=now() WHERE id=? AND state='DISPATCHING'",rid);attention(id,"OUTCOME_UNKNOWN");runtime.reclaim(sid);db.update("UPDATE native_schedule_runs SET reclaimed=true WHERE id=?",rid);continue;}
   if(!state.equals("RUNNING"))continue;
   try{sessions.require(owner,tenant,sid,true);}catch(IdentityException e){attention(id,"AUTHORIZATION_REVOKED");cancelRuns(id);return;}
   var ends=db.queryForList("SELECT event->'data'->'reason'->>'kind' FROM native_conversation_events WHERE session_id=? AND event->>'sessionId'=? AND event->>'type'='turn/end' ORDER BY seq DESC LIMIT 1",String.class,sid,sid.toString());
   boolean timed=((Timestamp)run.get("created_at")).toInstant().plusSeconds(1800).isBefore(Instant.now());if(ends.isEmpty()&&!timed)continue;
   String result=!ends.isEmpty()&&"completed".equals(ends.getFirst())?"SUCCEEDED":"NEEDS_ATTENTION";
   // Reclaim first; a failed host cleanup is retried, never called a completed run.
   runtime.reclaim(sid);sessions.stop(owner,tenant,sid);db.update("UPDATE native_schedule_runs SET state=?,reason=?,finished_at=now(),reclaimed=true WHERE id=? AND state='RUNNING'",result,timed?"TIME_LIMIT":result.equals("SUCCEEDED")?null:"TURN_NEEDS_ATTENTION",rid);if(!result.equals("SUCCEEDED"))attention(id,"RUN_NEEDS_ATTENTION");else db.update("UPDATE native_schedules SET state='COMPLETED' WHERE id=? AND next_due IS NULL AND NOT (configuration->>'materialEvents')::boolean",id);
  }
 }
 @Transactional public Object migrate(UUID actor,UUID tenant,UUID session,UUID plan){
  var scope=sessions.require(actor,tenant,session,true);runtime.available();
  db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,22022))",actor.toString());
  var existing=db.queryForList("SELECT * FROM native_schedules WHERE legacy_plan_id=? AND session_id=?",plan,session);if(!existing.isEmpty())return view(existing.getFirst());
  var rows=db.queryForList("SELECT * FROM ongoing_plans WHERE id=? AND owner_id=? AND tenant_id=? FOR UPDATE",plan,actor,tenant);if(rows.isEmpty())throw new IdentityException(404,"PLAN_NOT_FOUND");var old=rows.getFirst();
  if(!scope.workspaceId().equals(old.get("workspace_id"))||Set.of("STOPPED","EXPIRED","AUTHORIZATION_REQUIRED").contains(old.get("status")))throw new IdentityException(409,"NATIVE_PLAN_NOT_MIGRATABLE");
  if(db.queryForObject("SELECT count(*) FROM ongoing_plan_runs WHERE plan_id=? AND finished_at IS NULL",Integer.class,plan)>0)throw new IdentityException(409,"NATIVE_PLAN_RUNNING");
  Map<String,Object> rule=old.get("daily_time")==null?null:Map.of("kind","daily","daily",Map.of("time",old.get("daily_time")+":00","time_zone",old.get("time_zone")));
  String prompt="持续目标："+old.get("goal")+"\n委托用途与边界："+old.get("purpose")+"\n本次检查要求："+old.get("query");
  Config c=new Config(old.get("goal").toString().substring(0,Math.min(120,old.get("goal").toString().length())),prompt,rule,(Boolean)old.get("material_events"),(Integer)old.get("min_interval_seconds"),(Integer)old.get("max_runs_per_day"),(Integer)old.get("max_total_runs"),((Timestamp)old.get("expires_at")).toInstant());
  create(actor,tenant,session,plan,c);UUID id=db.queryForObject("SELECT id FROM native_schedules WHERE session_id=? AND request_id=?",UUID.class,session,plan);
  db.update("UPDATE native_schedules SET legacy_plan_id=?,state=?,observed_event=?,last_dispatch_at=? WHERE id=?",plan,old.get("status").equals("ACTIVE")?"ACTIVE":"PAUSED",old.get("observed_event"),old.get("last_dispatch_at"),id);
  if(old.get("next_due")!=null)db.update("UPDATE native_schedules SET next_due=?,record=jsonb_set(record,'{scheduledAt}',to_jsonb(?::text)) WHERE id=?",old.get("next_due"),((Timestamp)old.get("next_due")).toInstant().truncatedTo(java.time.temporal.ChronoUnit.MILLIS).toString(),id);
  if("NEEDS_ATTENTION".equals(old.get("runtime_state")))attention(id,"LEGACY_NEEDS_ATTENTION");
  db.update("UPDATE ongoing_plans SET status='STOPPED',runtime_state='IDLE',reason='MIGRATED_NATIVE',execution_epoch=execution_epoch+1,revision=revision+1 WHERE id=?",plan);return view(row(id));
 }
 private void cancelRuns(UUID id){for(var r:db.queryForList("SELECT id,session_id FROM native_schedule_runs WHERE schedule_id=? AND NOT reclaimed",id)){runtime.reclaim((UUID)r.get("session_id"));db.update("UPDATE native_conversation_grants SET revoked=true WHERE session_id=?",r.get("session_id"));db.update("UPDATE native_schedule_runs SET state=CASE WHEN state IN ('UNKNOWN','FAILED') THEN state ELSE 'CANCELLED' END,reason=coalesce(reason,'SCHEDULE_STOPPED'),finished_at=coalesce(finished_at,now()),reclaimed=true WHERE id=?",r.get("id"));}}
}
