package com.dreamcore.workspace;
import com.dreamcore.workspace.knowledge.*;
import com.dreamcore.workspace.material.*;
import com.dreamcore.workspace.collection.*;
import com.dreamcore.workspace.scene.*;
import com.dreamcore.workspace.identity.*;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.knowledge.enabled=true","dreamcore.knowledge.initial-delay-ms=3600000","dreamcore.collection.enabled=false","dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=verification","dreamcore.tasks.initial-delay-ms=3600000"})
class FileTableIntegrationTest {
 @DynamicPropertySource static void parserRoot(DynamicPropertyRegistry r){Path p=Path.of("").toAbsolutePath();if(p.endsWith("api"))p=p.getParent().getParent();String root=p.resolve("workers/parser").toString();r.add("dreamcore.knowledge.parser-root",()->root);}
 @Autowired JdbcTemplate db;@Autowired MaterialService materials;@Autowired KnowledgeService knowledge;@Autowired DocumentParser parser;@Autowired CollectionService collection;@Autowired FileTableSceneService scene;@Autowired DatasetLifecycleService lifecycle;
 @Autowired com.dreamcore.workspace.context.TaskContextService contexts;
 @Autowired com.dreamcore.workspace.conversation.ConversationService conversations;
 @Autowired PlatformDataOperationsService operations;
 UUID tenant,owner,reader,space,personal;
 @BeforeEach void fixture(){
  tenant=UUID.randomUUID();owner=UUID.randomUUID();reader=UUID.randomUUID();space=UUID.randomUUID();personal=UUID.randomUUID();
  db.update("INSERT INTO tenants(id,name) VALUES (?,'合成文件表格企业')",tenant);
  for(UUID actor:List.of(owner,reader)){db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,'not-a-login-hash')",actor,actor+"@file.test","合成文件测试");db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,actor);}
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'合成共享','SHARED'),(?,?,?,'合成私人','PERSONAL')",space,tenant,owner,personal,tenant,owner);
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true),(?,?,?,false)",tenant,space,owner,tenant,space,reader);
 }
 @AfterEach void clear(){db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('RUNNING','QUEUED')",tenant);db.update("UPDATE knowledge_runs SET status='CANCELLED',lease_token=NULL,lease_until=NULL WHERE tenant_id=? AND status IN ('RUNNING','QUEUED')",tenant);}
 MaterialService.Entry upload(UUID where,UUID id,Integer version,String body){return materials.upload(owner,tenant,where,null,id,version,UUID.randomUUID(),new MockMultipartFile("file","合成.csv","text/csv",body.getBytes(java.nio.charset.StandardCharsets.UTF_8)));}
 KnowledgeService.Job finish(){var j=knowledge.claim();assertNotNull(j);assertEquals(tenant,j.tenant());var input=knowledge.input(j);var result=parser.parse(input.filename(),input.bytes());knowledge.finish(j,result);return j;}
 UUID dataset(){return collection.datasets(reader,tenant,"",0,20).items().getFirst().id();}
 @Test void completeOriginalBecomesExactDatasetAndReparseIsIdempotent(){
  var m=upload(space,null,null,"编号,金额,说明\n001,0.1000,\n001,0.1000,\n");var j=finish();UUID d=dataset();
  assertEquals(List.of(List.of("001","0.1000",""),List.of("001","0.1000","")),collection.preview(reader,tenant,d,0,20).rows());
  assertEquals("text",collection.preview(reader,tenant,d,0,20).dataset().fieldDefinitions().getFirst().type());
  var detail=scene.detail(reader,tenant,false,"file-"+m.id());assertTrue(detail.path("asset").path("available").asBoolean());assertEquals("table",detail.path("asset").path("kind").asText());
  knowledge.finish(j,new DocumentParser.Result("synthetic","FAILED",List.of(),List.of()));assertEquals(d,dataset());
  knowledge.request(owner,tenant,space,m.id(),j.version(),UUID.randomUUID(),1);
  assertEquals(0,collection.datasets(reader,tenant,"",0,20).items().size());finish();assertEquals(d,dataset());
  assertEquals(1,db.queryForObject("SELECT count(*) FROM dataset_snapshots WHERE dataset_id=?",Integer.class,d));
 }
 @Test void replacementBlocksOldTableBeforeNewParsingAndInvalidReplacementNeverRevivesIt(){
  var m=upload(space,null,null,"门店,金额\n甲,2\n");finish();UUID old=dataset();
  UUID operator=UUID.randomUUID();db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,'not-a-login-hash')",operator,operator+"@file.test","合成监测员");db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",operator);db.update("INSERT INTO platform_accounts(account_id,login_name,password_hash) VALUES (?,?,'not-a-login-hash')",operator,operator+"@file.test");
  assertEquals(1,operations.detail(operator,tenant,"CONNECTIONS","ALL",0).counts().ready());
  upload(space,m.id(),1,"门店,金额\n甲\n");
  var monitor=operations.detail(operator,tenant,"CONNECTIONS","ALL",0);assertEquals(1,monitor.counts().attention());assertEquals(0,monitor.items().getFirst().rowCount());
  assertThrows(IdentityException.class,()->collection.preview(reader,tenant,old,0,20));finish();
  assertEquals(0,collection.datasets(reader,tenant,"",0,20).items().size());assertEquals("FILE_TABLE_NON_RECTANGULAR",db.queryForObject("SELECT reason FROM file_table_sources WHERE material_id=? ORDER BY checked_at DESC LIMIT 1",String.class,m.id()));
  upload(space,m.id(),2,"门店,金额\n甲,7\n");finish();assertNotEquals(old,dataset());assertEquals("7",collection.preview(reader,tenant,dataset(),0,20).rows().getFirst().get(1));
 }
 @Test void materialAclRevocationAndRemovalBlockRowsEvenWithWorkspaceAccess(){
  var m=upload(space,null,null,"门店,金额\n甲,2\n");finish();UUID d=dataset();
  assertThrows(IdentityException.class,()->lifecycle.get(owner,tenant,d));
  db.update("INSERT INTO library_permission_rollouts(tenant_id,enabled) VALUES (?,true)",tenant);
  db.update("INSERT INTO library_policies(tenant_id,object_kind,object_id,workspace_id,inherit) VALUES (?,'MATERIAL',?,?,false)",tenant,m.id(),space);
  db.update("INSERT INTO library_grants(tenant_id,object_kind,object_id,principal_kind,principal_id,content,download) VALUES (?,'MATERIAL',?,'ACCOUNT',?,'EDIT','ALLOW')",tenant,m.id(),owner);
  assertThrows(IdentityException.class,()->collection.preview(reader,tenant,d,0,20));assertThrows(IdentityException.class,()->scene.detail(reader,tenant,false,"file-"+m.id()));
  assertEquals(1,collection.preview(owner,tenant,d,0,20).rows().size());
  db.update("UPDATE materials SET in_library=false WHERE id=?",m.id());assertThrows(IdentityException.class,()->collection.preview(owner,tenant,d,0,20));
 }
 @Test void privateUploadsAndOtherTenantsDoNotBecomeSharedTables(){
  var p=upload(personal,null,null,"门店,金额\n甲,2\n");finish();assertEquals("FILE_TABLE_PRIVATE_SCOPE",db.queryForObject("SELECT reason FROM file_table_sources WHERE material_id=?",String.class,p.id()));
  assertEquals(0,collection.datasets(owner,tenant,"",0,20).items().size());
  upload(space,null,null,"门店,金额\n甲,2\n");finish();UUID d=dataset();UUID other=UUID.randomUUID();db.update("INSERT INTO tenants(id,name) VALUES (?,'合成外企')",other);db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",other,reader);
  assertThrows(IdentityException.class,()->collection.preview(reader,other,d,0,20));
 }
 @Test void documentChunkLimitsDoNotTruncateStructuredTable(){
  upload(space,null,null,"门店,金额\n"+"甲,1\n".repeat(600));finish();assertEquals(600,collection.preview(reader,tenant,dataset(),0,20).dataset().rowCount());
 }
 @Test void lateCompletionCannotPublishOldVersionAndErasureRemovesStructuredCopy(){
  var m=upload(space,null,null,"门店,金额\n甲,2\n");var old=knowledge.claim();var input=knowledge.input(old);
  upload(space,m.id(),1,"门店,金额\n乙,3\n");knowledge.finish(old,parser.parse(input.filename(),input.bytes()));
  assertEquals(0,collection.datasets(reader,tenant,"",0,20).items().size());finish();UUID d=dataset();
  db.queryForList("SELECT scrub_file_tables(?)",m.id());
  assertThrows(IdentityException.class,()->collection.preview(reader,tenant,d,0,20));
  assertEquals("[]",db.queryForObject("SELECT data_rows::text FROM dataset_snapshots WHERE dataset_id=?",String.class,d));
  assertTrue(db.queryForObject("SELECT scrubbed FROM business_datasets WHERE id=?",Boolean.class,d));
 }
 @Test void failedPublicationRollsBackKnowledgeAndDatasetTogether(){
  upload(space,null,null,"门店,金额\n甲,2\n");var j=knowledge.claim();var input=knowledge.input(j);var parsed=parser.parse(input.filename(),input.bytes());
  var invalid=new DocumentParser.Structured("READY","FILE_TABLE_VALIDATED",List.of("重复","重复"),List.of(List.of("1","2")),List.of("number","number"));
  assertThrows(IllegalArgumentException.class,()->knowledge.finish(j,new DocumentParser.Result(parsed.parserVersion(),parsed.status(),parsed.warnings(),parsed.chunks(),invalid)));
  assertEquals(0,db.queryForObject("SELECT count(*) FROM knowledge_chunks WHERE run_id=?",Integer.class,j.id()));
  assertEquals(0,db.queryForObject("SELECT count(*) FROM file_table_sources WHERE tenant_id=?",Integer.class,tenant));
  knowledge.finish(j,parsed);assertEquals(1,collection.preview(reader,tenant,dataset(),0,20).rows().size());
 }
 @Test void modelContextUsesCompleteTableAndRechecksCurrentVersion(){
  var m=upload(space,null,null,"门店,金额\n甲,2\n");finish();UUID d=dataset();
  conversations.submit(owner,tenant,null,personal,UUID.randomUUID(),"分析合成门店数据","AGENT");var task=conversations.claim();assertNotNull(task);
  db.update("UPDATE conversation_tasks SET source_scope='AUTHORIZED_LIBRARY' WHERE id=?",task.id());
  var request=new com.dreamcore.workspace.context.TaskContextService.Request("dataset_search",null,null,0,null,null,null,null,null,null,null);
  String context=new tools.jackson.databind.json.JsonMapper().writeValueAsString(contexts.context(task.id(),task.token(),request));assertTrue(context.contains(d.toString()));
  assertTrue(db.queryForObject("SELECT task_datasets_readable(?)",Boolean.class,task.id()));
  upload(space,m.id(),1,"门店,金额\n乙,5\n");
  assertFalse(db.queryForObject("SELECT task_datasets_readable(?)",Boolean.class,task.id()));
 }
}
