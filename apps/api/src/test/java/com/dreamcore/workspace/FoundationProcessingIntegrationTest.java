package com.dreamcore.workspace;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.*;
import com.dreamcore.workspace.knowledge.*;
import com.dreamcore.workspace.scene.*;
import java.util.*;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(properties={"dreamcore.knowledge.enabled=true"})
class FoundationProcessingIntegrationTest {
 @Autowired JdbcTemplate db;@Autowired MaterialService materials;@Autowired KnowledgeService knowledge;
 @Autowired FoundationProcessingService processing;@Autowired SceneService scenes;
 @Autowired NativeFoundationService foundation;
 UUID tenant,owner,reader,admin,space;
 @BeforeEach void setup(){
  tenant=UUID.randomUUID();owner=UUID.randomUUID();reader=UUID.randomUUID();admin=UUID.randomUUID();space=UUID.randomUUID();
  db.update("INSERT INTO tenants(id,name) VALUES (?,'合成结构化测试')",tenant);
  for(UUID actor:List.of(owner,reader,admin)){
   db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成人员','unused')",actor,actor+"@processing.test");
   db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,actor,actor.equals(admin)?"TENANT_ADMIN":"MEMBER");
  }
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'合成资料空间','SHARED')",space,tenant,owner);
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true),(?,?,?,false)",tenant,space,owner,tenant,space,reader);
 }
 @AfterEach void stopFixtureJobs(){db.update("UPDATE knowledge_runs SET status='CANCELLED' WHERE tenant_id=? AND status IN('QUEUED','RUNNING')",tenant);}
 @Test void nativeDatasetGroupsUseRegisteredConnectionsAndPreserveReadScope(){
  UUID connection=UUID.randomUUID(),dataset=UUID.randomUUID();
  db.update("INSERT INTO data_connections(id,tenant_id,name,route_label,access_summary,status,time_zone) VALUES (?,?,'合成租赁系统','只读快照','合成空间','READY','Asia/Shanghai')",connection,tenant);
  db.update("INSERT INTO business_datasets(id,tenant_id,connection_id,workspace_id,dataset_key,name,column_names) VALUES (?,?,?,?,'synthetic_finance','财务-合成表','[\"编号\"]'::jsonb)",dataset,tenant,connection,space);
  var snapshot=foundation.snapshot(reader,tenant);
  assertEquals(1,snapshot.path("items").size());
  assertEquals("合成租赁系统",snapshot.path("items").get(0).path("source").asText());
  assertEquals("财务-合成表",snapshot.path("items").get(0).path("title").asText());
  assertTrue(snapshot.path("auditValid").isNull());
  assertTrue(snapshot.path("items").get(0).path("quality").isNull());
  assertEquals(0,foundation.snapshot(admin,tenant).path("items").size());
  db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,reader);
  assertEquals(0,foundation.snapshot(reader,tenant).path("items").size());
 }
 UUID upload(){return materials.upload(owner,tenant,space,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","流程.txt","text/plain","合成流程说明".getBytes(StandardCharsets.UTF_8))).id();}
 void finish(){var job=knowledge.claim();assertNotNull(job);assertEquals(tenant,job.tenant());knowledge.finish(job,new DocumentParser.Result("synthetic-parser","READY",List.of(),List.of(new DocumentParser.Fragment("第 1 行","预约后核对宠物档案","TEXT"),new DocumentParser.Fragment("第 2 行","完成后记录服务结果","TEXT"))));}
 @Test void documentShowsStoredRecordsFieldOriginsAndVersionBoundHistory(){
  UUID material=upload();var waiting=processing.read(reader,tenant,"material-"+material,0,20,null);
  assertEquals(0,waiting.fields().size());assertEquals("QUEUED",waiting.stages().get(1).state());
  finish();var result=processing.read(reader,tenant,"material-"+material,0,1,null);
  assertEquals("DOCUMENT_CHUNKS",result.recordKind());assertEquals(2,result.recordCount());assertTrue(result.hasMore());
  assertEquals(List.of("id","ordinal","locator","method","content","material_id","version_id","run_id"),result.fields().stream().map(FoundationProcessingService.Field::name).toList());
  assertEquals("PARSER_OUTPUT",result.fields().get(4).origin());assertEquals("SOURCE_METADATA",result.fields().get(6).origin());
  assertEquals("预约后核对宠物档案",result.records().getFirst().get(4));assertEquals("0",result.records().getFirst().get(1));
  assertEquals("完成后记录服务结果",processing.read(reader,tenant,"material-"+material,1,1,result.revision()).records().getFirst().get(4));
  assertEquals("WAITING",result.stages().get(3).state());assertEquals("NOT_PUBLISHED",result.stages().get(5).state());
  assertEquals("READY",result.history().getFirst().state());assertNotNull(result.history().getFirst().finishedAt());
  assertEquals(8,scenes.dispatch(reader,tenant,false,"GET","/scene-foundation/material-"+material,null).path("asset").path("fieldCount").asInt());
  UUID version=materials.detail(owner,tenant,space,material,0,1).versions().getFirst().id();knowledge.request(owner,tenant,space,material,version,UUID.randomUUID(),1);
  assertEquals("FOUNDATION_VERSION_CHANGED",assertThrows(IdentityException.class,()->processing.read(reader,tenant,"material-"+material,1,1,result.revision())).code);
  assertTrue(processing.read(reader,tenant,"material-"+material,0,20,null).records().isEmpty());
 }
 @Test void managersWithoutContentRightsAndRevokedReadersCannotReadProducts(){
  UUID material=upload();finish();
  assertThrows(IdentityException.class,()->processing.read(admin,tenant,"material-"+material,0,20,null));
  assertThrows(IdentityException.class,()->processing.read(reader,UUID.randomUUID(),"material-"+material,0,20,null));
  assertThrows(IdentityException.class,()->processing.read(reader,tenant,"material-not-a-uuid",0,20,null));
  assertThrows(IdentityException.class,()->processing.read(reader,tenant,"material-"+material,0,21,null));
  db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,reader);
  assertThrows(IdentityException.class,()->processing.read(reader,tenant,"material-"+material,0,20,null));
 }
 @Test void admittedFileShowsWholeTableAndOriginalFileVersion(){
  var uploaded=materials.upload(owner,tenant,space,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","预约.csv","text/csv","预约号,服务\n001,美容".getBytes(StandardCharsets.UTF_8)));
  var structured=new DocumentParser.Structured("READY","FILE_TABLE_VALIDATED",List.of("预约号","服务"),List.of(List.of("001","美容")),List.of("text","text"));
  var first=knowledge.claim();assertNotNull(first);knowledge.finish(first,new DocumentParser.Result("synthetic-parser","READY",List.of(),List.of(new DocumentParser.Fragment("数据表","预约号 服务 001 美容","TABLE")),structured));
  var result=processing.read(reader,tenant,"file-"+uploaded.id(),0,20,null);
  assertEquals("DATASET_ROWS",result.recordKind());assertEquals(List.of(List.of("001","美容")),result.records());
  assertTrue(result.history().stream().anyMatch(h->h.stage().equals("原件解析")));
  materials.upload(owner,tenant,space,null,uploaded.id(),1,UUID.randomUUID(),new MockMultipartFile("file","预约.csv","text/csv","预约号,服务\n001,美容".getBytes(StandardCharsets.UTF_8)));
  var second=knowledge.claim();assertNotNull(second);knowledge.finish(second,new DocumentParser.Result("synthetic-parser","READY",List.of(),List.of(new DocumentParser.Fragment("数据表","预约号 服务 001 美容","TABLE")),structured));
  assertEquals(2,processing.read(reader,tenant,"file-"+uploaded.id(),0,20,null).version());
  assertEquals("FOUNDATION_VERSION_CHANGED",assertThrows(IdentityException.class,()->processing.read(reader,tenant,"file-"+uploaded.id(),0,20,result.revision())).code);
 }
}
