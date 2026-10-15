package com.dreamcore.workspace;

import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.scene.SceneService;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

/** Real Java -> signed HTTP -> isolated SQLite backend, with models disabled. */
class SceneBridgeIntegrationTest extends CompanyAnalysisFixture {
 static final JsonMapper JSON=new JsonMapper();
 static Process backend; static BufferedReader output; static BufferedWriter input; static int port;
 @Autowired SceneService scenes;
 @Autowired com.dreamcore.workspace.scene.SceneCollectionAdapter adapter;
 @DynamicPropertySource static void configuration(DynamicPropertyRegistry r) throws Exception {
  Path root=Path.of(System.getProperty("user.dir")).toAbsolutePath();
  while(!Files.exists(root.resolve("integrations/mengine-wiki"))) root=root.getParent();
  var pb=new ProcessBuilder("node",root.resolve("integrations/mengine-wiki/node_modules/tsx/dist/cli.mjs").toString(),root.resolve("scripts/local/scene-test-server.ts").toString());
  pb.directory(root.toFile());pb.redirectError(ProcessBuilder.Redirect.INHERIT);
  String key="synthetic-bridge-test-key-never-production";
  pb.environment().put("SCENE_ISOLATED_TEST","true");pb.environment().put("MENGINE_PLATFORM_BRIDGE_KEY",key);
  backend=pb.start();output=backend.inputReader();input=backend.outputWriter();
  String line=output.readLine();if(line==null)throw new IllegalStateException("Synthetic backend failed to start");
  port=JSON.readTree(line).path("port").asInt();
  r.add("MENGINE_PLATFORM_BRIDGE_KEY",()->key);
  r.add("MENGINE_PLATFORM_BRIDGE_URL",()->"http://127.0.0.1:"+port+"/api/internal/platform-scene");
 }
 @AfterAll static void stop() throws Exception {
  if(backend!=null){input.close();if(!backend.waitFor(10,TimeUnit.SECONDS))backend.destroyForcibly();}
 }
 @Test void signedBridgePreservesIdentityScopeAndRevisions() throws Exception {
  db.update("INSERT INTO scene_bindings(tenant_id,workspace_id,connection_id,maintainer_id) VALUES(?,?,?,?)",tenant,space,UUID.randomUUID(),admin);
  input.write(JSON.writeValueAsString(Map.of("tenant",tenant.toString(),"actor",admin.toString())));input.newLine();input.flush();assertEquals("bound",output.readLine());
  var list=scenes.dispatch(admin,tenant,false,"GET","/scene-foundation",null);
  assertTrue(list.path("items").size()>0);
  var access=scenes.dispatch(admin,tenant,false,"GET","/scene-access",null);
  assertEquals("admin",access.path("user").path("role").asText());
  var newcomer=scenes.dispatch(reader,tenant,false,"GET","/scene-access",null);
  assertEquals("member",newcomer.path("user").path("role").asText());assertEquals(0,newcomer.path("user").path("clearance").asInt());
  assertEquals(0,newcomer.path("members").size());
  var asset=list.path("items").get(0);var source=asset.path("id").asText();
  var stale=Map.<String,Object>of("action","recheck","version",asset.path("version").asInt()+99,"policyVersion",asset.path("policyVersion").asInt());
  assertEquals(409,assertThrows(IdentityException.class,()->scenes.dispatch(admin,tenant,false,"POST","/scene-foundation/"+source+"/actions",stale)).status);
  assertEquals(400,assertThrows(IdentityException.class,()->scenes.dispatch(admin,tenant,false,"GET","/scene-export",null)).status);
  assertEquals(403,assertThrows(IdentityException.class,()->scenes.dispatch(admin,UUID.randomUUID(),false,"GET","/scene-foundation",null)).status);
  var knowledge=scenes.dispatch(admin,tenant,false,"GET","/scene-knowledge",null);
  assertTrue(knowledge.has("items"));
  scenes.synchronize(admin,tenant,false);
  var first=db.queryForList("SELECT source_id,target_id,revision FROM scene_asset_links WHERE tenant_id=? ORDER BY source_id",tenant);
  assertFalse(first.isEmpty());
  scenes.synchronize(admin,tenant,false);
  assertEquals(first,db.queryForList("SELECT source_id,target_id,revision FROM scene_asset_links WHERE tenant_id=? ORDER BY source_id",tenant));
  input.write("{\"operation\":\"table\"}");input.newLine();input.flush();assertEquals("table",output.readLine());
  scenes.synchronize(admin,tenant,false);
  assertEquals(1,db.queryForObject("SELECT count(*) FROM scene_asset_links WHERE tenant_id=? AND kind='TABLE' AND active",Integer.class,tenant));
  var dataset=db.queryForMap("SELECT source_id,target_id FROM scene_asset_links WHERE tenant_id=? AND kind='TABLE' AND active",tenant);
  var connection=db.queryForObject("SELECT connection_id FROM scene_bindings WHERE tenant_id=?",UUID.class,tenant);
  var request=new com.dreamcore.workspace.collection.CollectionAdapter.Request("1.0",tenant,connection,UUID.randomUUID(),List.of(new com.dreamcore.workspace.collection.CollectionAdapter.Dataset((UUID)dataset.get("target_id"),dataset.get("source_id").toString(),List.of("amount"))));
  assertEquals(List.of(List.of("12")),adapter.collect(request).snapshots().getFirst().rows());
  assertThrows(IllegalStateException.class,()->adapter.collect(request,()->false));
  var withTable=db.queryForList("SELECT source_id,target_id,revision FROM scene_asset_links WHERE tenant_id=? ORDER BY source_id",tenant);
  scenes.synchronize(admin,tenant,false);
  assertEquals(withTable,db.queryForList("SELECT source_id,target_id,revision FROM scene_asset_links WHERE tenant_id=? ORDER BY source_id",tenant));
  input.write("{\"operation\":\"refresh\"}");input.newLine();input.flush();assertEquals("refreshed",output.readLine());
  scenes.synchronize(admin,tenant,false);
  assertEquals(dataset.get("target_id"),db.queryForObject("SELECT target_id FROM scene_asset_links WHERE tenant_id=? AND kind='TABLE' AND active",UUID.class,tenant));
  assertEquals(List.of(List.of("24")),adapter.collect(request).snapshots().getFirst().rows());
  db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,reader);
  assertEquals(403,assertThrows(IdentityException.class,()->scenes.dispatch(reader,tenant,false,"GET","/scene-access",null)).status);
 }
}
