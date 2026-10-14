package com.dreamcore.workspace;

import com.dreamcore.workspace.identity.EngineTelemetryService;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import static org.junit.jupiter.api.Assertions.*;

class SceneWorkLoopTelemetryTest extends CompanyAnalysisFixture {
 @Autowired EngineTelemetryService telemetry;
 EngineTelemetryService.Channel channel(String code){return telemetry.read(admin,tenant,false).channels().stream().filter(c->c.code().equals(code)).findFirst().orElseThrow();}
 @Test void actualSceneJobsEnterProcessingWithoutCountingNoChangeSyncs(){
  db.update("INSERT INTO scene_bindings(tenant_id,workspace_id,connection_id,maintainer_id) VALUES(?,?,?,?)",tenant,space,UUID.randomUUID(),admin);
  var run=UUID.randomUUID();
  db.update("INSERT INTO scene_processing_runs(id,tenant_id,actor_id,operation,state) VALUES(?,?,?,'/scene-knowledge/sync','RUNNING')",run,tenant,admin);
  db.update("INSERT INTO scene_processing_runs(id,tenant_id,actor_id,operation,state) VALUES(?,?,?,'SYNC_INPUTS','RUNNING')",UUID.randomUUID(),tenant,admin);
  assertEquals(1,channel("SCENE_KNOWLEDGE").running());
  db.update("UPDATE scene_processing_runs SET state='SUCCEEDED',finished_at=now() WHERE id=?",run);
  assertEquals(0,channel("SCENE_KNOWLEDGE").running());assertEquals(1,channel("SCENE_KNOWLEDGE").completedRecent());
  var foreign=UUID.randomUUID();db.update("INSERT INTO tenants(id,name) VALUES(?,'其他企业')",foreign);
  db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES(?,?,'TENANT_ADMIN')",foreign,admin);
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES(?,?,?,'隔离空间','SHARED')",foreign,foreign,admin);
  db.update("INSERT INTO scene_bindings(tenant_id,workspace_id,connection_id,maintainer_id) VALUES(?,?,?,?)",foreign,foreign,UUID.randomUUID(),admin);
  db.update("INSERT INTO scene_processing_runs(id,tenant_id,actor_id,operation,state) VALUES(?,?,?,'/scene-knowledge/sync','RUNNING')",UUID.randomUUID(),foreign,admin);
  assertEquals(0,channel("SCENE_KNOWLEDGE").running());
 }
 @Test void pendingSourcesBecomeOneRealAttemptWithoutDoubleCounting(){
  queue.discover();assertEquals(1,channel("COMPANY").queued());assertEquals(0,channel("COMPANY").running());
  var job=queue.claim(tenant);assertNotNull(job);assertEquals(0,channel("COMPANY").queued());assertEquals(1,channel("COMPANY").running());
  queue.dispatched(job,descriptor());queue.complete(result(job,"COMPLETE"));
  assertEquals(0,channel("COMPANY").running());assertEquals(1,channel("COMPANY").completedRecent());
  queue.discover();assertEquals(0,channel("COMPANY").queued());
 }
}
