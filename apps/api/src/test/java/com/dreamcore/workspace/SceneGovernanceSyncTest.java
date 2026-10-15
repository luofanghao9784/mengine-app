package com.dreamcore.workspace;
import com.dreamcore.workspace.scene.*;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.json.JsonMapper;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.junit.jupiter.api.Assertions.*;

class SceneGovernanceSyncTest extends CompanyAnalysisFixture {
 @Autowired SceneService scene;
 @MockitoBean SceneBridgeClient bridge;
 @org.junit.jupiter.api.AfterEach void clearSyncQueue(){
  db.update("UPDATE knowledge_runs SET status='CANCELLED',lease_token=NULL,lease_until=NULL WHERE tenant_id=? AND status IN('QUEUED','RUNNING')",tenant);
  db.update("UPDATE collection_runs SET status='INTERRUPTED',reason='TEST_FINISHED',finished_at=now(),lease_token=NULL,lease_until=NULL WHERE tenant_id=? AND status IN('QUEUED','RUNNING')",tenant);
 }
 @Test void unchangedSyncRenewsPolicyWithoutDuplicatingAssetsAndRevocationWithdrawsOldCopies(){
  var json=new JsonMapper();UUID connection=UUID.randomUUID();
  db.update("INSERT INTO scene_bindings(tenant_id,workspace_id,connection_id,maintainer_id) VALUES(?,?,?,?)",tenant,space,connection,admin);
  when(bridge.available()).thenReturn(true);
  when(bridge.call(eq(tenant),anyString(),eq("GET"),eq("/scene-access"),isNull())).thenReturn(json.readTree("{\"user\":{\"role\":\"admin\"}}"));
  when(bridge.call(eq(tenant),anyString(),eq("GET"),eq("/scene-knowledge"),isNull())).thenReturn(json.readTree("{\"items\":[],\"scopeRevision\":\"k1\"}"));
  var export=json.readTree("""
   {"contractVersion":"1.1","tenantId":"%s","revision":"r1","assets":[{"id":"table-a","kind":"数据表","title":"合成订单","version":1,"fields":[{"name":"amount","type":"number"}],"dictionaryStatus":"generated","dictionary":{"fields":[{"name":"amount","meaning":"金额","evidence":"部署推断"}],"templates":[{"id":"total","name":"金额汇总"}]},"governance":{"allowedActors":["%s","%s"]}},{"id":"doc-a","kind":"资料","title":"合成制度","content":"正文不变","version":1,"governance":{"allowedActors":["%s"]}}]}
   """.formatted(tenant,admin,reader,admin));
  when(bridge.call(eq(tenant),anyString(),eq("GET"),eq("/scene-export"),isNull())).thenReturn(export);
  scene.synchronize(admin,tenant,false);
  UUID first=db.queryForObject("SELECT target_id FROM scene_asset_links WHERE tenant_id=? AND kind='TABLE'",UUID.class,tenant);
  assertTrue(db.queryForObject("SELECT scene_asset_readable(?,?)",Boolean.class,reader,first));
  db.update("UPDATE scene_bindings SET governance_valid_until=now()-interval '1 second' WHERE tenant_id=?",tenant);
  scene.synchronize(admin,tenant,false);
  assertEquals(first,db.queryForObject("SELECT target_id FROM scene_asset_links WHERE tenant_id=? AND kind='TABLE'",UUID.class,tenant));
  assertEquals(2,db.queryForObject("SELECT count(*) FROM scene_asset_revisions WHERE tenant_id=?",Integer.class,tenant));
  assertTrue(db.queryForObject("SELECT scene_asset_readable(?,?)",Boolean.class,reader,first));
  ((tools.jackson.databind.node.ObjectNode)export).put("revision","rows-refreshed");
  ((tools.jackson.databind.node.ObjectNode)export.path("assets").get(0)).put("version",2);
  ((tools.jackson.databind.node.ObjectNode)export.path("assets").get(0).path("governance")).put("sourceVersion",2).put("policyDigest","new-row-version");
  scene.synchronize(admin,tenant,false);
  assertEquals(first,db.queryForObject("SELECT target_id FROM scene_asset_links WHERE tenant_id=? AND kind='TABLE'",UUID.class,tenant));
  ((tools.jackson.databind.node.ObjectNode)export).put("revision","r2");
  ((tools.jackson.databind.node.ObjectNode)export.path("assets").get(0).path("governance")).set("allowedActors",json.valueToTree(java.util.List.of(admin.toString())));
  ((tools.jackson.databind.node.ObjectNode)export.path("assets").get(1).path("governance")).put("policyVersion",2);
  scene.synchronize(admin,tenant,false);
  assertEquals(1,db.queryForObject("SELECT m.current_version FROM materials m JOIN scene_asset_links l ON l.target_id=m.id WHERE l.tenant_id=? AND l.source_id='doc-a'",Integer.class,tenant));
  UUID second=db.queryForObject("SELECT target_id FROM scene_asset_links WHERE tenant_id=? AND kind='TABLE'",UUID.class,tenant);
  assertNotEquals(first,second);assertFalse(db.queryForObject("SELECT scene_asset_readable(?,?)",Boolean.class,reader,second));
  assertFalse(db.queryForObject("SELECT scene_asset_readable(?,?)",Boolean.class,admin,first));
  assertTrue(db.queryForObject("SELECT scene_asset_readable(?,?)",Boolean.class,admin,second));
  assertEquals("金额汇总",db.queryForObject("SELECT metadata#>>'{dictionary,templates,0,name}' FROM scene_asset_links WHERE tenant_id=? AND kind='TABLE'",String.class,tenant));
 }
}
