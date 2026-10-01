package com.dreamcore.workspace;
import com.dreamcore.workspace.document.*;
import com.dreamcore.workspace.material.*;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.conversation.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import static org.junit.jupiter.api.Assertions.*;
@SpringBootTest(properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=verification","dreamcore.tasks.initial-delay-ms=3600000","dreamcore.knowledge.initial-delay-ms=3600000"})
class DocumentPublicationIntegrationTest {
 @Autowired com.dreamcore.workspace.lifecycle.MaterialLifecycleService lifecycle;@Autowired com.dreamcore.workspace.lifecycle.MaterialCleanupService cleanup;@Autowired com.dreamcore.workspace.activity.ActivityService activity;@Autowired DocumentPublicationService publications;@Autowired DocumentService documents;@Autowired MaterialService materials;@Autowired ConversationService conversations;@Autowired AgentTaskService agents;@Autowired JdbcTemplate db;@Autowired PasswordEncoder passwords;
 UUID tenant,other,owner,reader,admin,source,destination,personal,folder,document;
 @BeforeEach void fixture(){
  tenant=UUID.randomUUID();other=UUID.randomUUID();owner=UUID.randomUUID();reader=UUID.randomUUID();admin=UUID.randomUUID();source=UUID.randomUUID();destination=UUID.randomUUID();personal=UUID.randomUUID();
  for(UUID actor:List.of(owner,reader,admin))db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",actor,actor+"@example.test","合成发布测试",passwords.encode("synthetic-publication-password"));
  db.update("INSERT INTO tenants(id,name) VALUES (?,'文稿共享测试'),(?,'另一企业')",tenant,other);
  for(UUID actor:List.of(owner,reader,admin))db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,actor,actor.equals(admin)?"TENANT_ADMIN":"MEMBER");
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'财务来源','SHARED'),(?,?,?,'项目成果','SHARED'),(?,?,?,'个人空间','PERSONAL')",source,tenant,admin,destination,tenant,admin,personal,tenant,owner);
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,false),(?,?,?,true),(?,?,?,false)",tenant,source,owner,tenant,destination,owner,tenant,destination,reader);
  folder=materials.createFolder(owner,tenant,destination,null,"正式成果",UUID.randomUUID()).id();
  var submitted=conversations.submit(owner,tenant,null,source,UUID.randomUUID(),"私人提示不公开","AGENT");var job=conversations.claim();assertNotNull(job);
  agents.finish(job,new AgentResult("1.4","0.8.0",job.id(),job.token(),"AGENT","verification","local-verification","可以发布的合成正文",List.of(),List.of(),List.of(),1,null,List.of(),List.of(),List.of()));
  document=documents.create(owner,tenant,submitted.conversation().id(),job.id(),null,UUID.randomUUID()).document().id();documents.save(owner,tenant,document,UUID.randomUUID(),1,"项目报告","正式成果内容");
 }
 void denied(int status,Runnable action){assertEquals(status,assertThrows(IdentityException.class,action::run).status);}
 DocumentPublicationService.Publication publish(UUID key){return publications.publish(owner,tenant,document,2,key,destination,folder,null,null,"docx",true);}
 @Test void sharedCopySurvivesSourceRevocationAndPublisherDeactivation(){
  var result=publish(UUID.randomUUID());assertEquals(folder,result.folderId());byte[] bytes=materials.download(reader,tenant,destination,result.materialId(),result.materialVersionId()).bytes();
  assertEquals(result.sha256(),ObjectStore.sha256(bytes));assertEquals("DOCUMENT_PUBLICATION",materials.detail(reader,tenant,destination,result.materialId(),0,20).versions().getFirst().origin());
  var events=activity.list(reader,tenant,null,null,20).items();assertEquals(1,events.size());assertEquals("DOCUMENT_PUBLISHED",events.getFirst().kind());assertEquals(result.materialVersionId(),events.getFirst().id());
  denied(404,()->documents.detail(reader,tenant,document,null));denied(404,()->publications.list(reader,tenant,document,0,20));
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",source,owner);
  denied(404,()->documents.detail(owner,tenant,document,null));assertArrayEquals(bytes,materials.download(reader,tenant,destination,result.materialId(),result.materialVersionId()).bytes());
  db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,owner);
  assertArrayEquals(bytes,materials.download(reader,tenant,destination,result.materialId(),result.materialVersionId()).bytes());assertEquals(1,activity.list(reader,tenant,null,null,20).items().size());
  db.update("UPDATE accounts SET status='DISABLED' WHERE id=?",owner);assertEquals(1,materials.detail(reader,tenant,destination,result.materialId(),0,20).document().version());
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",destination,reader);denied(404,()->materials.download(reader,tenant,destination,result.materialId(),result.materialVersionId()));
 }
 @Test void idempotencyAndSourceVersionDeduplicationDoNotRepublishOrExposeOtherTargets(){
  UUID key=UUID.randomUUID();var first=publish(key);assertEquals(first,publish(key));assertEquals(first,publish(UUID.randomUUID()));
  assertEquals(1,activity.list(reader,tenant,null,null,20).items().size());assertEquals(1,publications.list(owner,tenant,document,0,20).items().size());assertEquals(1,materials.detail(owner,tenant,destination,first.materialId(),0,20).versions().size());
  denied(409,()->publications.publish(owner,tenant,document,1,key,destination,folder,null,null,"docx",true));
  db.update("UPDATE workspace_members SET can_maintain=false WHERE workspace_id=? AND account_id=?",destination,owner);denied(403,()->publish(key));
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",destination,owner);assertTrue(publications.list(owner,tenant,document,0,20).items().isEmpty());
 }
 @Test void updatesUseExplicitTargetVersionAndKeepOldCopies(){
  var first=publish(UUID.randomUUID());byte[] old=materials.download(reader,tenant,destination,first.materialId(),first.materialVersionId()).bytes();
  documents.save(owner,tenant,document,UUID.randomUUID(),2,"项目报告修订","用户修改的第二次发布");assertEquals(1,materials.detail(reader,tenant,destination,first.materialId(),0,20).document().version());
  var second=publications.publish(owner,tenant,document,3,UUID.randomUUID(),destination,null,first.materialId(),1,"pdf",true);
  assertEquals(first.materialId(),second.materialId());assertEquals(folder,second.folderId());assertEquals(2,second.materialVersion());assertEquals("DOCUMENT_UPDATED",activity.list(reader,tenant,null,null,20).items().getFirst().kind());assertArrayEquals(old,materials.download(reader,tenant,destination,first.materialId(),first.materialVersionId()).bytes());
  documents.save(owner,tenant,document,UUID.randomUUID(),3,"后续草稿","尚未共享");
  denied(409,()->publications.publish(owner,tenant,document,4,UUID.randomUUID(),destination,null,first.materialId(),1,"docx",true));
  assertEquals(2,materials.detail(reader,tenant,destination,first.materialId(),0,20).versions().size());
  assertEquals(0,db.queryForObject("SELECT count(*) FROM document_publications WHERE document_id=? AND document_version=4",Integer.class,document));
 }
 @Test void currentSourceAndDestinationRightsAreBothRequiredForPublication(){
  denied(400,()->publications.publish(owner,tenant,document,2,UUID.randomUUID(),personal,null,null,null,"docx",true));
  denied(400,()->publications.publish(owner,tenant,document,2,UUID.randomUUID(),destination,folder,null,null,"docx",false));
  denied(403,()->publications.publish(owner,other,document,2,UUID.randomUUID(),destination,null,null,null,"pdf",true));
  denied(404,()->publications.publish(admin,tenant,document,2,UUID.randomUUID(),destination,null,null,null,"docx",true));
  denied(404,()->publications.publish(owner,tenant,document,2,UUID.randomUUID(),destination,UUID.randomUUID(),null,null,"docx",true));
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",source,owner);denied(404,()->publish(UUID.randomUUID()));
  assertEquals(0,db.queryForObject("SELECT count(*) FROM materials WHERE tenant_id=?",Integer.class,tenant));
 }
 @Test void concurrentDifferentRequestKeysPublishOnlyOnce()throws Exception{
  var start=new java.util.concurrent.CountDownLatch(1);
  try(var pool=java.util.concurrent.Executors.newFixedThreadPool(2)){var futures=new ArrayList<java.util.concurrent.Future<DocumentPublicationService.Publication>>();for(int i=0;i<2;i++)futures.add(pool.submit(()->{start.await();return publish(UUID.randomUUID());}));start.countDown();assertEquals(futures.get(0).get(10,java.util.concurrent.TimeUnit.SECONDS),futures.get(1).get(10,java.util.concurrent.TimeUnit.SECONDS));}
  assertEquals(1,db.queryForObject("SELECT count(*) FROM material_versions WHERE tenant_id=?",Integer.class,tenant));
 }

 @Test void sourcePurgeClearsPrivateDerivativesButKeepsPublishedIndependentCopy(){
  db.update("UPDATE workspace_members SET can_maintain=true WHERE workspace_id=? AND account_id=?",source,owner);
  var original=materials.upload(owner,tenant,source,null,null,null,UUID.randomUUID(),new org.springframework.mock.web.MockMultipartFile("file","source.txt","text/plain","private underlying facts".getBytes()));UUID originalVersion=materials.detail(owner,tenant,source,original.id(),0,20).versions().getFirst().id();
  var submitted=conversations.submit(owner,tenant,null,source,UUID.randomUUID(),"本任务明确选定资料","AGENT",null,List.of(new TaskOriginals.Selection(original.id(),originalVersion)));var job=conversations.claim();
  agents.finish(job,new AgentResult("1.4","0.8.0",job.id(),job.token(),"AGENT","verification","local-verification","受来源约束的私人正文",List.of(),List.of(),List.of(),1,null,List.of(),List.of(),List.of()));
  var derived=documents.create(owner,tenant,submitted.conversation().id(),job.id(),null,UUID.randomUUID());var d=derived.document();documents.export(owner,tenant,d.id(),1,"docx");
  var published=publications.publish(owner,tenant,d.id(),1,UUID.randomUUID(),destination,folder,null,null,"docx",true);byte[] independent=materials.download(reader,tenant,destination,published.materialId(),published.materialVersionId()).bytes();
  lifecycle.act(owner,tenant,source,"MATERIAL",original.id(),UUID.randomUUID(),0,"TRASH");denied(404,()->documents.detail(owner,tenant,d.id(),null));denied(404,()->documents.export(owner,tenant,d.id(),1,"docx"));assertTrue(documents.list(owner,tenant,0,20).items().stream().noneMatch(x->x.id().equals(d.id())));
  db.update("INSERT INTO governance_capabilities(tenant_id,account_id,workspace_id,capability,granted_by) VALUES (?,?,?,'LIFECYCLE_PURGE',?)",tenant,owner,source,admin);
  lifecycle.act(owner,tenant,source,"MATERIAL",original.id(),UUID.randomUUID(),1,"PURGE");var removal=cleanup.claim();for(UUID object:cleanup.pending(removal)){cleanup.remove(object);cleanup.removed(removal,object);}cleanup.finish(removal);
  assertEquals("",db.queryForObject("SELECT body FROM private_document_versions WHERE document_id=?",String.class,d.id()));assertEquals(0,db.queryForObject("SELECT count(*) FROM private_document_exports WHERE document_id=?",Integer.class,d.id()));assertNull(db.queryForObject("SELECT reply FROM conversation_tasks WHERE id=?",String.class,job.id()));assertArrayEquals(independent,materials.download(reader,tenant,destination,published.materialId(),published.materialVersionId()).bytes());
 }
}
