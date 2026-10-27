package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import java.util.*;import java.time.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import static org.junit.jupiter.api.Assertions.*;import static org.mockito.Mockito.*;
class NativeSchedulesIntegrationTest extends NativeConversationIntegrationTest {
 @Autowired NativeSchedules schedules;@Autowired NativeConversationStream stream;@MockitoBean NativeRuntimeClient runtime;
 NativeSchedules.Config config(Map<String,Object> rule,boolean material){return new NativeSchedules.Config("合成定时","执行合成检查",rule,material,60,2,10,Instant.now().plusSeconds(86400));}
 @SuppressWarnings("unchecked") UUID create(UUID session,NativeSchedules.Config c){return (UUID)((Map<String,Object>)schedules.create(owner,tenant,session,UUID.randomUUID(),c)).get("id");}
 void due(UUID schedule){db.update("UPDATE native_schedules SET next_due=now()-interval '1 second',record=jsonb_set(record,'{scheduledAt}',to_jsonb(?::text)) WHERE id=?",Instant.now().minusSeconds(1).truncatedTo(java.time.temporal.ChronoUnit.MILLIS).toString(),schedule);}
 @Test void oneClaimRealCompletionReceiptAndReclaim()throws Exception{
  var parent=open();UUID id=create(parent.id(),config(Map.of("kind","every","everySeconds",60),false));due(id);
  when(runtime.command(any(),anyString(),eq("messages"),anyMap())).thenReturn(Map.of("accepted",true,"messageId","synthetic"));
  try(var pool=java.util.concurrent.Executors.newFixedThreadPool(2)){var a=pool.submit(()->schedules.tick(id));var b=pool.submit(()->schedules.tick(id));a.get();b.get();}
  verify(runtime,times(1)).command(any(),anyString(),eq("messages"),anyMap());
  UUID sid=db.queryForObject("SELECT session_id FROM native_schedule_runs WHERE schedule_id=?",UUID.class,id);assertNotEquals(parent.id(),sid);var grant=nativeSessions.grant(owner,tenant,sid);
  stream.append(sid,grant.token(),new NativeConversationStream.Ingest("end",Map.of("sessionId",sid.toString(),"type","turn/end","time",1,"data",Map.of("reason",Map.of("kind","completed")))));
  schedules.tick(id);assertEquals("SUCCEEDED",db.queryForObject("SELECT state FROM native_schedule_runs WHERE schedule_id=?",String.class,id));verify(runtime).reclaim(sid);assertEquals("STOPPED",nativeSessions.require(owner,tenant,sid,false).state());
 }
 @Test void uncertainDispatchNeverRetriesAndKnownRefusalReusesRun(){
  var p=open();UUID id=create(p.id(),config(Map.of("kind","every","everySeconds",60),false));due(id);
  when(runtime.command(any(),anyString(),eq("messages"),anyMap())).thenThrow(new NativeRuntimeClient.NotDispatched()).thenThrow(new RuntimeException("unknown"));
  schedules.tick(id);assertEquals("READY",db.queryForObject("SELECT state FROM native_schedule_runs WHERE schedule_id=?",String.class,id));schedules.tick(id);schedules.tick(id);
  assertEquals(1,db.queryForObject("SELECT count(*) FROM native_schedule_runs WHERE schedule_id=?",Integer.class,id));assertEquals("UNKNOWN",db.queryForObject("SELECT state FROM native_schedule_runs WHERE schedule_id=?",String.class,id));verify(runtime,times(2)).command(any(),anyString(),eq("messages"),anyMap());denied(()->schedules.action(owner,tenant,p.id(),id,"ACTIVE"));
 }
 @Test void materialTriggerQuotaAndRevocationUseCurrentAuthority(){
  var p=open();UUID id=create(p.id(),config(null,true));schedules.tick(id);verify(runtime,never()).command(any(),anyString(),eq("messages"),anyMap());
  materials.upload(owner,tenant,space,null,null,null,UUID.randomUUID(),new org.springframework.mock.web.MockMultipartFile("file","trigger.txt","text/plain","new".getBytes()));
  when(runtime.command(any(),anyString(),eq("messages"),anyMap())).thenReturn(Map.of("accepted",true));schedules.tick(id);verify(runtime).command(any(),anyString(),eq("messages"),anyMap());
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);schedules.tick(id);assertEquals("AUTHORIZATION_REVOKED",db.queryForObject("SELECT reason FROM native_schedules WHERE id=?",String.class,id));assertEquals("CANCELLED",db.queryForObject("SELECT state FROM native_schedule_runs WHERE schedule_id=?",String.class,id));
 }
 @Test void migrationStopsOldDelegationAndKeepsLimitsAndEditingPaused(){
  var p=open();UUID old=UUID.randomUUID();db.update("INSERT INTO ongoing_plans(id,tenant_id,workspace_id,owner_id,goal,purpose,query,behavior,material_events,daily_time,time_zone,min_interval_seconds,max_runs_per_day,max_total_runs,expires_at,status) VALUES (?,?,?,?,'旧计划','检查用途','检索','SOURCE_LOOKUP',true,'09:00','Asia/Shanghai',120,2,10,now()+interval '1 day','ACTIVE')",old,tenant,space,owner);
  Object first=schedules.migrate(owner,tenant,p.id(),old);assertEquals(first,schedules.migrate(owner,tenant,p.id(),old));assertEquals("STOPPED",db.queryForObject("SELECT status FROM ongoing_plans WHERE id=?",String.class,old));
  UUID id=db.queryForObject("SELECT id FROM native_schedules WHERE legacy_plan_id=?",UUID.class,old);denied(()->schedules.edit(owner,tenant,p.id(),id,config(null,true)));
  schedules.action(owner,tenant,p.id(),id,"PAUSED");assertNotNull(schedules.edit(owner,tenant,p.id(),id,config(null,true)));denied(()->schedules.list(other,tenant,p.id()));
 }

}
