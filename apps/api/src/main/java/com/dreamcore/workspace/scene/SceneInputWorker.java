package com.dreamcore.workspace.scene;

import java.time.Clock;
import java.util.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
public class SceneInputWorker {
 private static final long IDLE_MS=60000, BUSY_MS=5000, CONTINUE_MS=1000;
 private final SceneService scene;
 private final SceneBridgeClient bridge;
 private final JdbcTemplate db;
 private final Clock clock;
 private final Map<UUID,Due> due=new HashMap<>();
 private static final class Due {long input,knowledge;}
 @Autowired
 public SceneInputWorker(SceneService scene,SceneBridgeClient bridge,JdbcTemplate db){this(scene,bridge,db,Clock.systemUTC());}
 SceneInputWorker(SceneService scene,SceneBridgeClient bridge,JdbcTemplate db,Clock clock){this.scene=scene;this.bridge=bridge;this.db=db;this.clock=clock;}

 // One item per tenant per turn: drain backlog without the old minute-long gap,
 // retaining the upstream tenant lock, model admission and fresh authorization.
 @Scheduled(fixedDelay=1000,initialDelay=30000)
 public synchronized void tick(){
  if(!bridge.available())return;
  var bindings=db.queryForList("SELECT b.tenant_id,b.maintainer_id FROM scene_bindings b JOIN tenants t ON t.id=b.tenant_id WHERE t.status='ACTIVE'");
  var active=new HashSet<UUID>();
  for(var b:bindings){
   var actor=(UUID)b.get("maintainer_id");var tenant=(UUID)b.get("tenant_id");active.add(tenant);
   var next=due.computeIfAbsent(tenant,key->new Due());
   try{
    if(clock.millis()>=next.input){scene.synchronize(actor,tenant,false);next.input=clock.millis()+IDLE_MS;}
    if(clock.millis()<next.knowledge)continue;
    var knowledge=scene.dispatch(actor,tenant,false,"GET","/scene-knowledge",null);
    next.knowledge=clock.millis()+IDLE_MS;
    if(!knowledge.path("available").asBoolean())continue;
    if(knowledge.path("busy").asBoolean()){next.knowledge=clock.millis()+BUSY_MS;continue;}
    if(knowledge.path("pending").asInt()>0||knowledge.path("needsGraph").asBoolean()){
     scene.dispatch(actor,tenant,false,"POST","/scene-knowledge/sync",Map.of("retry",false));
     // Successful dispatch already synchronizes its new knowledge to the platform.
     next.input=clock.millis()+IDLE_MS;
     next.knowledge=clock.millis()+CONTINUE_MS;
    }
   }catch(RuntimeException ignored){
    // Do not spin on failed models, permission loss or unreachable sources.
    next.input=next.knowledge=clock.millis()+IDLE_MS;
   }
  }
  due.keySet().retainAll(active);
 }
}
