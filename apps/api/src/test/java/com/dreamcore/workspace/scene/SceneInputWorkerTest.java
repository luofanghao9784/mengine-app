package com.dreamcore.workspace.scene;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class SceneInputWorkerTest {
 static class Time extends Clock {long now=100000;public ZoneId getZone(){return ZoneOffset.UTC;}public Clock withZone(ZoneId z){return this;}public Instant instant(){return Instant.ofEpochMilli(now);}}
 final UUID tenant=UUID.randomUUID(),actor=UUID.randomUUID();
 final SceneService scene=mock(SceneService.class);
 final SceneBridgeClient bridge=mock(SceneBridgeClient.class);
 final JdbcTemplate db=mock(JdbcTemplate.class);
 final Time clock=new Time();
 final SceneInputWorker worker=new SceneInputWorker(scene,bridge,db,clock);
 SceneInputWorkerTest(){when(bridge.available()).thenReturn(true);when(db.queryForList(anyString())).thenReturn(List.of(Map.of("tenant_id",tenant,"maintainer_id",actor)));state(true,false,3,false);}
 void state(boolean available,boolean busy,int pending,boolean graph){when(scene.dispatch(actor,tenant,false,"GET","/scene-knowledge",null)).thenReturn(new JsonMapper().readTree("{\"available\":"+available+",\"busy\":"+busy+",\"pending\":"+pending+",\"needsGraph\":"+graph+"}"));}
 void posts(int n){verify(scene,times(n)).dispatch(actor,tenant,false,"POST","/scene-knowledge/sync",Map.of("retry",false));}
 @Test void backlogContinuesAfterCompletionWithoutMinuteGapOrRedundantFullSync(){
  when(scene.dispatch(actor,tenant,false,"POST","/scene-knowledge/sync",Map.of("retry",false))).thenAnswer(i->{clock.now+=25000;return null;});
  worker.tick();worker.tick();posts(1);clock.now+=1000;worker.tick();posts(2);
  verify(scene,times(1)).synchronize(actor,tenant,false);
 }
 @Test void idlePollsRemainOneMinuteAndNewWorkResumes(){state(true,false,0,false);worker.tick();clock.now+=1000;worker.tick();posts(0);verify(scene,times(1)).dispatch(actor,tenant,false,"GET","/scene-knowledge",null);clock.now+=60000;state(true,false,1,false);worker.tick();posts(1);}
 @Test void upstreamBusyNeverStartsDuplicateAndPollsAfterFiveSeconds(){state(true,true,3,false);worker.tick();clock.now+=1000;worker.tick();posts(0);state(true,false,3,false);clock.now+=4000;worker.tick();posts(1);}
 @Test void disabledAndGraphOnlyRespectExistingAdmission(){state(false,false,3,true);worker.tick();posts(0);clock.now+=60000;state(true,false,0,true);worker.tick();posts(1);}
 @Test void failureBacksOffAndNeverRequestsAutomaticRetry(){when(scene.dispatch(actor,tenant,false,"POST","/scene-knowledge/sync",Map.of("retry",false))).thenThrow(new IllegalStateException());worker.tick();clock.now+=1000;worker.tick();posts(1);clock.now+=60000;worker.tick();posts(2);}
 @Test void inactiveTenantIsNotProcessed(){when(db.queryForList(anyString())).thenReturn(List.of());worker.tick();verifyNoInteractions(scene);}
 @Test void permissionLossPreventsWork(){doThrow(new IllegalStateException()).when(scene).synchronize(actor,tenant,false);worker.tick();verify(scene,never()).dispatch(any(),any(),anyBoolean(),anyString(),anyString(),any());}
}
