package com.dreamcore.workspace.scene;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
@Component
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
public class SceneInputWorker {
 private final SceneService scene;private final SceneBridgeClient bridge;private final JdbcTemplate db;
 public SceneInputWorker(SceneService scene,SceneBridgeClient bridge,JdbcTemplate db){this.scene=scene;this.bridge=bridge;this.db=db;}
 @Scheduled(fixedDelay=60000,initialDelay=30000)
 public void tick(){if(!bridge.available())return;for(var b:db.queryForList("SELECT b.tenant_id,b.maintainer_id FROM scene_bindings b JOIN tenants t ON t.id=b.tenant_id WHERE t.status='ACTIVE'"))try{var actor=(UUID)b.get("maintainer_id");var tenant=(UUID)b.get("tenant_id");scene.synchronize(actor,tenant,false);var knowledge=scene.dispatch(actor,tenant,false,"GET","/scene-knowledge",null);if(knowledge.path("available").asBoolean()&&!knowledge.path("busy").asBoolean()&&(knowledge.path("pending").asInt()>0||knowledge.path("needsGraph").asBoolean()))scene.dispatch(actor,tenant,false,"POST","/scene-knowledge/sync",java.util.Map.of("retry",false));}catch(RuntimeException ignored){/* Durable processing run records the failure; no business data in logs. */}}
}
