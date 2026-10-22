package com.dreamcore.workspace;
import com.dreamcore.workspace.scene.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.json.JsonMapper;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.junit.jupiter.api.Assertions.*;

class SceneRoutingIntegrationTest extends CompanyAnalysisFixture {
 @Autowired SceneCollectionAdapter adapter;
 @Autowired ScenePublication publication;
 @Autowired com.dreamcore.workspace.knowledge.KnowledgeService knowledge;
 @Autowired com.dreamcore.workspace.material.MaterialService materialService;
 @Autowired SceneService scene; @Autowired SceneRouting routing;
 @MockitoBean SceneBridgeClient bridge;
 UUID second; final JsonMapper json=new JsonMapper();
 @BeforeEach void setupRoutes(){
  second=UUID.randomUUID();
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'另一门店','SHARED')",second,tenant,admin);
  for(var who:List.of(admin,reader))db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",tenant,second,who);
  db.update("INSERT INTO scene_bindings(tenant_id,workspace_id,connection_id,maintainer_id) VALUES (?,?,?,?)",tenant,space,UUID.randomUUID(),admin);
  when(bridge.available()).thenReturn(true);
  when(bridge.call(eq(tenant),anyString(),eq("GET"),eq("/scene-access"),isNull())).thenReturn(json.readTree("{\"user\":{\"role\":\"admin\"}}"));
  when(bridge.call(eq(tenant),anyString(),eq("GET"),eq("/scene-knowledge"),any())).thenReturn(json.readTree("""
    {"scopeRevision":"k1","items":[{"id":"knowledge-a","sourceId":"salary","sourceVersion":1,"name":"薪酬依据","verdict":"合成依据","kv":[]}]}
    """));
  var assets=json.createArrayNode();
  for(var name:List.of("salary","dividend","other-store")){
   var a=json.createObjectNode();a.put("id",name).put("kind","数据表").put("title",name).put("version",1).put("updatedAt","2026-10-19T00:00:00Z");
   a.set("fields",json.readTree("[{\"name\":\"amount\",\"type\":\"number\"}]"));a.set("rows",json.readTree("[[\"100\"]]"));
   a.set("governance",json.readTree("{\"sourceVersion\":1,\"allowedActors\":[\"%s\",\"%s\"]}".formatted(admin,reader)));assets.add(a);
  }
  var doc=json.createObjectNode();doc.put("id","document").put("kind","资料").put("title","规则").put("content","合成规则").put("version",1);doc.set("governance",json.readTree("{\"sourceVersion\":1,\"allowedActors\":[\"%s\"]}".formatted(admin)));assets.add(doc);
  var export=json.createObjectNode();export.put("tenantId",tenant.toString()).put("contractVersion","1.1").put("revision","r1");export.set("assets",assets);
  when(bridge.call(eq(tenant),anyString(),eq("GET"),eq("/scene-export"),any())).thenReturn(export);
 }
 SceneRouting.Route route(String source,UUID destination,UUID... readers){return new SceneRouting.Route(source,destination,List.of(readers));}
 UUID target(String source){return db.queryForObject("SELECT target_id FROM scene_asset_links WHERE tenant_id=? AND source_id=? AND active",UUID.class,tenant,source);}
 boolean readable(UUID actor,UUID target){return db.queryForObject("SELECT scene_asset_readable(?,?)",Boolean.class,actor,target);}
 @Test void routesSeparateSalaryDividendAndKnowledgeWithoutGrantingSourceAccess() throws Exception {
  scene.routes(admin,tenant,new SceneRouting.Change(0,List.of(route("salary",space,admin,reader),route("dividend",space,admin),route("other-store",second,admin),route("document",second,reader))));
  scene.synchronize(admin,tenant,false);
  assertTrue(readable(reader,target("salary")));assertFalse(readable(reader,target("dividend")));assertFalse(readable(reader,target("other-store")));
  assertTrue(db.queryForObject("SELECT file_dataset_readable(?,?)",Boolean.class,reader,target("salary")));
  assertFalse(db.queryForObject("SELECT file_dataset_readable(?,?)",Boolean.class,reader,target("dividend")));
  assertTrue(readable(reader,target("knowledge-a")));assertFalse(readable(reader,target("document"))); // local list cannot override source
  assertEquals(second,db.queryForObject("SELECT workspace_id FROM business_datasets WHERE id=?",UUID.class,target("other-store")));
  assertEquals(second,db.queryForObject("SELECT workspace_id FROM materials WHERE id=?",UUID.class,target("document")));
  assertTrue(SceneService.sameMetadata(bridge.call(tenant,"x","GET","/scene-export",null).path("assets").get(0),db.queryForObject("SELECT metadata::text FROM scene_asset_links WHERE target_id=?",String.class,target("salary"))));
  var connection=db.queryForObject("SELECT connection_id FROM scene_bindings WHERE tenant_id=?",UUID.class,tenant);
  var collected=adapter.collect(new com.dreamcore.workspace.collection.CollectionAdapter.Request("1.0",tenant,connection,UUID.randomUUID(),List.of(new com.dreamcore.workspace.collection.CollectionAdapter.Dataset(target("salary"),"salary",List.of("amount")))));
  assertEquals(List.of(List.of("100")),collected.snapshots().getFirst().rows());
  var id=target("salary");scene.synchronize(admin,tenant,false);assertEquals(id,target("salary"));
 }
 @Test void changingRouteRevokesImmediatelyMovesAllKindsAndOmitsUnknownSources(){
  scene.routes(admin,tenant,new SceneRouting.Change(0,List.of(route("salary",space,admin,reader),route("document",space,admin))));
  scene.synchronize(admin,tenant,false);UUID old=target("salary"),oldKnowledge=target("knowledge-a"),oldDoc=target("document");
  scene.routes(admin,tenant,new SceneRouting.Change(1,List.of(route("salary",second,admin),route("document",second,admin))));
  assertFalse(readable(reader,old));assertFalse(readable(admin,old));
  scene.synchronize(admin,tenant,false);
  assertNotEquals(old,target("salary"));assertNotEquals(oldKnowledge,target("knowledge-a"));assertNotEquals(oldDoc,target("document"));
  assertFalse(readable(admin,old));assertFalse(readable(reader,target("salary")));assertTrue(readable(admin,target("salary")));
  assertEquals(0,db.queryForObject("SELECT count(*) FROM scene_asset_links WHERE tenant_id=? AND source_id IN ('dividend','other-store') AND active",Integer.class,tenant));
  assertEquals(second,db.queryForObject("SELECT workspace_id FROM materials WHERE id=?",UUID.class,target("knowledge-a")));
  // Claim only this publication's document; unrelated fixtures share the parser queue.
  db.update("UPDATE knowledge_runs SET status='FAILED',finished_at=now(),lease_token=NULL,lease_until=NULL WHERE status IN ('QUEUED','RUNNING') AND material_id<>?",target("document"));
  var job=knowledge.claim();assertNotNull(job);assertEquals(target("document"),job.material());
  assertNotNull(knowledge.input(job));
  knowledge.finish(job,new com.dreamcore.workspace.knowledge.DocumentParser.Result("test","READY",List.of(),List.of(new com.dreamcore.workspace.knowledge.DocumentParser.Fragment("1","合成规则","TEXT"))));
  assertEquals("READY",db.queryForObject("SELECT status FROM knowledge_runs WHERE id=?",String.class,job.id()));

  scene.routes(admin,tenant,new SceneRouting.Change(2,List.of()));scene.synchronize(admin,tenant,false);
  assertEquals(0,db.queryForObject("SELECT count(*) FROM scene_asset_links WHERE tenant_id=? AND active",Integer.class,tenant));
 }
 @Test void moreThanTwoHundredSourcesReachCollectionAndKeepPermissions() throws Exception {
  var export=(tools.jackson.databind.node.ObjectNode)bridge.call(tenant,"x","GET","/scene-export",null).deepCopy();
  var prototype=export.path("assets").get(0);var assets=json.createArrayNode();var routes=new ArrayList<SceneRouting.Route>();
  for(int i=0;i<201;i++){
   var a=(tools.jackson.databind.node.ObjectNode)prototype.deepCopy();a.put("id","bulk-"+i);
   a.set("governance",json.readTree("{\"sourceVersion\":1,\"allowedActors\":[\"%s\"]}".formatted(admin)));
   assets.add(a);routes.add(route("bulk-"+i,space,admin,reader));
  }
  export.set("assets",assets);
  when(bridge.call(eq(tenant),anyString(),eq("GET"),eq("/scene-export"),any())).thenReturn(export);
  when(bridge.call(eq(tenant),anyString(),eq("GET"),eq("/scene-knowledge"),any())).thenReturn(json.readTree("{\"scopeRevision\":\"empty\",\"items\":[]}"));
  scene.routes(admin,tenant,new SceneRouting.Change(0,routes));scene.synchronize(admin,tenant,false);completeProjection();
  assertEquals(201,db.queryForObject("SELECT count(*) FROM scene_asset_links WHERE tenant_id=? AND kind='TABLE' AND active",Integer.class,tenant));
  assertEquals(List.of(List.of("100")),processing.read(admin,tenant,"dataset-"+target("bulk-200"),0,20,null).records());
  assertThrows(IdentityException.class,()->processing.read(reader,tenant,"dataset-"+target("bulk-200"),0,20,null));
  // Whole-list permission checks must stay bounded with hundreds of routed sources.
  new org.springframework.transaction.support.TransactionTemplate(
    new org.springframework.jdbc.datasource.DataSourceTransactionManager(db.getDataSource())).execute(status->{
   db.execute("SET LOCAL statement_timeout='2s'");
   assertEquals(201,db.queryForObject("SELECT count(*) FROM scene_asset_links WHERE tenant_id=? AND active AND scene_asset_readable(?,target_id)",Integer.class,tenant,admin));
   assertEquals(0,db.queryForObject("SELECT count(*) FROM scene_asset_links WHERE tenant_id=? AND active AND scene_asset_readable(?,target_id)",Integer.class,tenant,reader));
   return null;
  });
 }
 @Test void optimizedPermissionMatchesV154AcrossRoutingMembershipAndExpiry() throws Exception {
  try(var input=getClass().getResourceAsStream("/db/migration-common/V154__scene_resource_routing.sql")){
   String original=new String(Objects.requireNonNull(input).readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
   db.execute(original.substring(original.indexOf("CREATE OR REPLACE FUNCTION")).replace("FUNCTION scene_asset_readable(","FUNCTION test_scene_asset_readable_v154("));
  }
  scene.routes(admin,tenant,new SceneRouting.Change(0,List.of(route("salary",space,admin,reader),route("dividend",space,admin),route("document",second,reader))));
  scene.synchronize(admin,tenant,false);
  var targets=new ArrayList<>(db.queryForList("SELECT target_id FROM scene_asset_revisions WHERE tenant_id=?",UUID.class,tenant));targets.add(UUID.randomUUID());
  var actors=List.of(admin,reader,UUID.randomUUID());
  for(int phase=0;phase<4;phase++){
   for(var actor:actors)for(var id:targets)
    assertEquals(db.queryForObject("SELECT test_scene_asset_readable_v154(?,?)",Boolean.class,actor,id),readable(actor,id),"phase "+phase);
   if(phase==0)db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,reader);
   if(phase==1)db.update("UPDATE scene_bindings SET governance_valid_until=now()-interval '1 second' WHERE tenant_id=?",tenant);
   if(phase==2)db.update("UPDATE scene_asset_links SET active=false WHERE tenant_id=?",tenant);
  }
 }
 @Test void expandedRoutesRetainSourceAclAndRejectOverflowAtomically(){
  var routes=new ArrayList<SceneRouting.Route>();
  for(int i=0;i<1023;i++)routes.add(route("unlisted-"+i,space,admin));
  routes.add(route("dividend",space,reader));
  scene.routes(admin,tenant,new SceneRouting.Change(0,routes));
  assertEquals(1024,routing.snapshot(tenant).path("routes").size());
  var overflow=new ArrayList<>(routes);overflow.add(route("overflow",space,admin));
  assertThrows(IdentityException.class,()->scene.routes(admin,tenant,new SceneRouting.Change(1,overflow)));
  assertEquals(1,routing.snapshot(tenant).path("revision").asInt());
  assertEquals(1024,routing.snapshot(tenant).path("routes").size());
  scene.synchronize(admin,tenant,false);
  assertFalse(readable(admin,target("dividend")));
  assertTrue(readable(reader,target("dividend")));
  verify(bridge).call(eq(tenant),anyString(),eq("GET"),eq("/scene-export"),argThat(body->body!=null&&json.valueToTree(body).path("restrictedSourceIds").size()==1024));
 }
 @Test void staleForeignAndNonAdminConfigurationsFailWithoutChangingPolicy(){
  var change=new SceneRouting.Change(0,List.of(route("salary",space,admin)));
  assertThrows(IdentityException.class,()->scene.routes(reader,tenant,change));
  assertThrows(IdentityException.class,()->scene.routes(admin,tenant,new SceneRouting.Change(0,List.of(route("salary",personal,admin)))));
  assertThrows(IdentityException.class,()->scene.routes(admin,tenant,new SceneRouting.Change(0,List.of(route("salary",space,UUID.randomUUID())))));
  scene.routes(admin,tenant,change);
  assertThrows(IdentityException.class,()->scene.routes(admin,tenant,change));
  routing.replace(admin,tenant,new SceneRouting.Change(1,change.routes())); // identical replay does not change revision
  assertEquals(1,routing.snapshot(tenant).path("revision").asInt());
 }
 @Test void publicationDoesNotGrantOrdinaryMaintenanceAndRevocationStopsSync(){
  db.update("UPDATE workspace_members SET can_maintain=false WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,second,admin);
  assertThrows(IdentityException.class,()->scene.routes(admin,tenant,new SceneRouting.Change(0,List.of(route("document",second,admin)))));
  scene.publication(admin,tenant,new ScenePublication.Change(0,List.of(second)));
  scene.routes(admin,tenant,new SceneRouting.Change(0,List.of(route("document",second,admin),route("salary",second,admin))));
  scene.synchronize(admin,tenant,false);
  assertEquals(second,db.queryForObject("SELECT workspace_id FROM materials WHERE id=?",UUID.class,target("document")));
  assertEquals(second,db.queryForObject("SELECT workspace_id FROM materials WHERE id=?",UUID.class,target("knowledge-a")));
  // Claim only this publication's document; unrelated fixtures share the parser queue.
  db.update("UPDATE knowledge_runs SET status='FAILED',finished_at=now(),lease_token=NULL,lease_until=NULL WHERE status IN ('QUEUED','RUNNING') AND material_id<>?",target("document"));
  var job=knowledge.claim();assertNotNull(job);assertEquals(target("document"),job.material());
  assertNotNull(knowledge.input(job));
  knowledge.finish(job,new com.dreamcore.workspace.knowledge.DocumentParser.Result("test","READY",List.of(),List.of(new com.dreamcore.workspace.knowledge.DocumentParser.Fragment("1","合成规则","TEXT"))));
  assertEquals("READY",db.queryForObject("SELECT status FROM knowledge_runs WHERE id=?",String.class,job.id()));

  assertThrows(IdentityException.class,()->materialService.createFolder(admin,tenant,second,null,"not allowed",UUID.randomUUID()));
  assertFalse(db.queryForObject("SELECT can_maintain FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",Boolean.class,tenant,second,admin));
  assertThrows(IdentityException.class,()->scene.publication(reader,tenant,new ScenePublication.Change(1,List.of(second))));
  assertThrows(IdentityException.class,()->scene.publication(admin,tenant,new ScenePublication.Change(1,List.of(personal))));
  scene.publication(admin,tenant,new ScenePublication.Change(1,List.of()));
  assertFalse(readable(admin,target("document")));
  var connection=db.queryForObject("SELECT connection_id FROM scene_bindings WHERE tenant_id=?",UUID.class,tenant);
  assertThrows(IdentityException.class,()->adapter.collect(new com.dreamcore.workspace.collection.CollectionAdapter.Request("1.0",tenant,connection,UUID.randomUUID(),List.of(new com.dreamcore.workspace.collection.CollectionAdapter.Dataset(target("salary"),"salary",List.of("amount"))))));
  assertThrows(IdentityException.class,()->scene.synchronize(admin,tenant,false));
  assertThrows(IdentityException.class,()->scene.publication(admin,tenant,new ScenePublication.Change(1,List.of(second))));
 }
 @Autowired com.dreamcore.workspace.collection.CollectionService collection;
 @Autowired FoundationProcessingService processing;
 tools.jackson.databind.JsonNode projected(String version) throws Exception {
  var root=java.nio.file.Path.of(System.getProperty("user.dir")).toAbsolutePath();
  while(!java.nio.file.Files.exists(root.resolve("tests/ninepop/scene_fixture.py"))) {
   root=root.getParent();if(root==null)throw new IllegalStateException("Repository fixture missing");
  }
  var process=new ProcessBuilder("python3",root.resolve("tests/ninepop/scene_fixture.py").toString(),tenant.toString(),admin.toString(),reader.toString(),version).redirectError(ProcessBuilder.Redirect.INHERIT).start();
  String output=new String(process.getInputStream().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
  assertEquals(0,process.waitFor());return json.readTree(output);
 }
 void useProjection(String version) throws Exception {
  var export=projected(version);
  assertEquals("history-unknown",export.path("isolated").get(0).path("sourceId").asText());
  assertEquals(3,export.path("assets").size());
  when(bridge.call(eq(tenant),anyString(),eq("GET"),eq("/scene-export"),any())).thenReturn(export);
  when(bridge.call(eq(tenant),anyString(),eq("GET"),eq("/scene-knowledge"),any())).thenReturn(json.readTree("{\"scopeRevision\":\"empty\",\"items\":[]}"));
 }
 void completeProjection() throws Exception {
  var connection=db.queryForObject("SELECT connection_id FROM scene_bindings WHERE tenant_id=?",UUID.class,tenant);
  var claim=collection.claim(tenant,connection,java.time.Instant.now());assertNotNull(claim);
  var defs=db.queryForList("SELECT id,dataset_key,column_names::text AS cols FROM business_datasets WHERE connection_id=? AND status='ACTIVE' ORDER BY dataset_key",connection).stream().map(d->{
   var cols=new ArrayList<String>();for(var c:json.readTree(d.get("cols").toString()))cols.add(c.asText());
   return new com.dreamcore.workspace.collection.CollectionAdapter.Dataset((UUID)d.get("id"),d.get("dataset_key").toString(),cols);
  }).toList();
  var result=adapter.collect(new com.dreamcore.workspace.collection.CollectionAdapter.Request("1.0",tenant,connection,claim.runId(),defs));
  assertTrue(collection.complete(claim,result,java.time.Instant.now()));
 }
 @Test void reviewedLocalProjectionRegistersReadsInvalidatesAndRevokes() throws Exception {
  useProjection("1");
  scene.routes(admin,tenant,new SceneRouting.Change(0,List.of(route("salary-a",space,admin,reader),route("salary-b",second,admin,reader),route("dividend-a",space,admin,reader))));
  scene.synchronize(admin,tenant,false);completeProjection();
  UUID salary=target("salary-a"),dividend=target("dividend-a"),other=target("salary-b");
  var first=processing.read(reader,tenant,"dataset-"+salary,0,20,null);
  assertEquals(List.of(List.of("a","100")),first.records());
  assertThrows(IdentityException.class,()->processing.read(reader,tenant,"dataset-"+dividend,0,20,null));
  assertThrows(IdentityException.class,()->processing.read(reader,tenant,"dataset-"+other,0,20,null));
  assertEquals(0,db.queryForObject("SELECT count(*) FROM scene_asset_links WHERE tenant_id=? AND source_id='history-unknown'",Integer.class,tenant));
  scene.synchronize(admin,tenant,false);assertEquals(salary,target("salary-a")); // idempotent replay
  useProjection("2");
  var connection=db.queryForObject("SELECT connection_id FROM scene_bindings WHERE tenant_id=?",UUID.class,tenant);
  assertThrows(IllegalStateException.class,()->adapter.collect(new com.dreamcore.workspace.collection.CollectionAdapter.Request("1.0",tenant,connection,UUID.randomUUID(),List.of(new com.dreamcore.workspace.collection.CollectionAdapter.Dataset(salary,"salary-a",List.of("id","amount"))))));
  scene.synchronize(admin,tenant,false);completeProjection();
  UUID updated=target("salary-a");
  assertEquals(List.of(List.of("a","200")),processing.read(reader,tenant,"dataset-"+updated,0,20,null).records());
  assertThrows(IdentityException.class,()->processing.read(reader,tenant,"dataset-"+salary,0,20,first.revision()));
  useProjection("revoked");scene.synchronize(admin,tenant,false);completeProjection();
  assertThrows(IdentityException.class,()->processing.read(reader,tenant,"dataset-"+target("salary-a"),0,20,null));
  assertEquals(List.of(List.of("a","200")),processing.read(admin,tenant,"dataset-"+target("salary-a"),0,20,null).records());
 }
 @AfterEach void cleanup(){db.update("UPDATE collection_runs SET status='INTERRUPTED',reason='TEST_FINISHED',finished_at=now(),lease_token=NULL,lease_until=NULL WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);}
}
