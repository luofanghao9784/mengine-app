package com.dreamcore.workspace;
import com.dreamcore.workspace.knowledge.*;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.material.*;
import com.dreamcore.workspace.identity.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.net.*;
import java.net.http.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.lifecycle.enabled=false","dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=verification","dreamcore.tasks.initial-delay-ms=3600000","dreamcore.knowledge.enabled=true","dreamcore.knowledge.initial-delay-ms=3600000"})
class WikiArticleIntegrationTest {
    @DynamicPropertySource static void paths(DynamicPropertyRegistry registry) {
        Path root=Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();
        String parser=root.resolve("workers/parser").toString();registry.add("dreamcore.knowledge.parser-root",()->parser);
    }
    @Autowired JdbcTemplate db;@Autowired MaterialService materials;@Autowired KnowledgeService knowledge;@Autowired DocumentParser parser;@Autowired PasswordEncoder passwords;
    @LocalServerPort int port;
    @Autowired com.dreamcore.workspace.material.LibraryPermissionService permissions; @Autowired WikiLearningService wiki; @Autowired ConversationService conversations; @Autowired AgentTaskService agents; @Autowired AgentUsageLedger usage;
    @Autowired WikiArticleService articles; @Autowired com.dreamcore.workspace.lifecycle.MaterialLifecycleService lifecycle; @Autowired com.dreamcore.workspace.lifecycle.MaterialCleanupService cleanup;
    UUID tenant,other,owner,reader,admin,space,personal;
    @BeforeEach void fixture() {
        tenant=UUID.randomUUID();other=UUID.randomUUID();owner=UUID.randomUUID();reader=UUID.randomUUID();admin=UUID.randomUUID();space=UUID.randomUUID();personal=UUID.randomUUID();
        for(UUID id:List.of(owner,reader,admin))db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",id,id+"@example.test","合成解析测试",passwords.encode("synthetic-knowledge-password"));
        db.update("INSERT INTO tenants(id,name) VALUES (?,'解析测试'),(?,'外部企业')",tenant,other);
        for(UUID id:List.of(owner,reader,admin))db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,id,id.equals(admin)?"TENANT_ADMIN":"MEMBER");
        db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'共享资料','SHARED'),(?,?,?,'个人资料','PERSONAL')",space,tenant,admin,personal,tenant,owner);
        db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true),(?,?,?,false)",tenant,space,owner,tenant,space,reader);
    }
    record File(UUID material,UUID version) {}
    File upload(UUID location,String filename,String text) {
        var result=materials.upload(owner,tenant,location,null,null,null,UUID.randomUUID(),new MockMultipartFile("file",filename,"application/octet-stream",text.getBytes(StandardCharsets.UTF_8)));
        return new File(result.id(),materials.detail(owner,tenant,location,result.id(),0,20).versions().getFirst().id());
    }
    KnowledgeService.Job claim(File file) {var job=knowledge.claim();assertNotNull(job);assertEquals(file.version(),job.version());return job;}
    void finish(File file) {var job=claim(file);var input=knowledge.input(job);knowledge.finish(job,parser.parse(input.filename(),input.bytes()));}
    KnowledgeService.Analysis analysis(UUID who,UUID location,File file) {return knowledge.analysis(who,tenant,location,file.material(),file.version(),0,20);}
    void denied(int status,Runnable action) {var error=assertThrows(IdentityException.class,action::run);assertEquals(status,error.status);}
    @AfterEach void clearJobs() {db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('RUNNING','QUEUED')",tenant);db.update("UPDATE knowledge_runs SET status='CANCELLED' WHERE tenant_id=? AND status IN ('RUNNING','QUEUED')",tenant);}

    WikiLearningService.Start request(File file){return new WikiLearningService.Start(UUID.randomUUID(),file.version(),1);}
    String article(WikiLearningService.Source source,String quote){return new JsonMapper().writeValueAsString(new WikiLearningService.Article("合成知识","依据资料的摘要","仅涵盖可见片段，请核对原件。",List.of(new WikiLearningService.Evidence(source.fragments().getFirst().id(),quote))));}
    AgentResult result(ConversationService.Job job,WikiLearningService.Source source,String text){return new AgentResult("1.5","0.19.0",job.id(),job.token(),"AGENT","verification","fixture",text,source.fragments().stream().map(WikiLearningService.Fragment::id).toList(),List.of(),List.of(),1,new AgentResult.Usage(20,10),List.of(),List.of(),List.of(),"COMPLETE",null);}

    record Seed(File file,WikiLearningService.Draft draft) {}
    Seed seed(){
      var file=upload(space,"共享知识来源.txt","合成交付必须核对原件");finish(file);return new Seed(file,learn(owner,file));
    }
    WikiLearningService.Draft learn(UUID actor,File file){
      var draft=wiki.start(actor,tenant,file.material(),request(file));var job=conversations.claim();assertEquals(draft.taskId(),job.id());
      var source=(WikiLearningService.Source)agents.check(job.id(),job.token()).get("wikiLearning");agents.openExecution(job.id(),job.token(),new AgentTaskService.ExecutionOpen("1.5",List.of()));agents.openUsage(job.id(),job.token());agents.startUsage(job.id(),job.token(),new AgentUsageLedger.Start(1,2048));usage.finish(job.id(),job.token(),new AgentUsageLedger.Receipt(1,"RETURNED",20L,10L));
      agents.finish(job,result(job,source,article(source,"合成交付必须核对原件")));return wiki.detail(actor,tenant,draft.id());
    }
    WikiArticleService.Publish publish(int revision){return new WikiArticleService.Publish(UUID.randomUUID(),revision,true,"合成共享知识","合成摘要","依据原文核对交付事项。");}
    WikiArticleService.Change action(int revision,String action){return new WikiArticleService.Change(UUID.randomUUID(),revision,action,null,null,null);}
    @Test void explicitPublicationIsIdempotentAndPrivateDraftNeverBecomesPublic(){
      var s=seed();assertTrue(articles.list(reader,tenant,false,0).items().isEmpty());var body=publish(0);
      denied(400,()->articles.publish(owner,tenant,s.draft().id(),new WikiArticleService.Publish(UUID.randomUUID(),0,false,"t","i","c")));
      var item=articles.publish(owner,tenant,s.draft().id(),body);assertEquals(item.id(),articles.publish(owner,tenant,s.draft().id(),body).id());assertEquals(1,articles.detail(reader,tenant,item.id()).revision());assertFalse(articles.detail(reader,tenant,item.id()).canMaintain());
      denied(404,()->wiki.detail(reader,tenant,s.draft().id()));denied(404,()->articles.detail(admin,tenant,item.id()));denied(403,()->articles.detail(owner,other,item.id()));
      String output=new JsonMapper().writeValueAsString(articles.detail(reader,tenant,item.id()));assertFalse(output.contains(s.draft().taskId().toString()));assertFalse(output.contains(s.draft().conversationId().toString()));assertFalse(output.contains(s.draft().id().toString()));
      assertEquals("verification",item.executionClass());assertEquals(s.draft().article().evidence(),item.article().evidence());
    }
    @Test void readPermissionDoesNotAuthorizePublicationOrMaintenance(){
      var s=seed();db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'reader personal','PERSONAL')",UUID.randomUUID(),tenant,reader);var draft=learn(reader,s.file());
      assertFalse(articles.prepare(reader,tenant,draft.id()).canPublish());denied(403,()->articles.publish(reader,tenant,draft.id(),publish(0)));
      var item=articles.publish(owner,tenant,s.draft().id(),publish(0));denied(403,()->articles.change(reader,tenant,item.id(),action(1,"ARCHIVE")));denied(403,()->articles.history(reader,tenant,item.id(),0));
    }
    @Test void editsArchiveRestoreHaveRevisionsEvidenceAndOptimisticConflicts(){
      var s=seed();var a=articles.publish(owner,tenant,s.draft().id(),publish(0));var edited=articles.change(owner,tenant,a.id(),new WikiArticleService.Change(UUID.randomUUID(),1,"EDIT","校订后知识","新导语","已核对原文。"));assertEquals(2,edited.revision());assertEquals(a.article().evidence(),edited.article().evidence());
      denied(409,()->articles.change(owner,tenant,a.id(),action(1,"ARCHIVE")));var request=action(2,"ARCHIVE");var archived=articles.change(owner,tenant,a.id(),request);assertEquals(3,archived.revision());assertEquals(3,articles.change(owner,tenant,a.id(),request).revision());assertTrue(articles.list(reader,tenant,false,0).items().isEmpty());denied(404,()->articles.detail(reader,tenant,a.id()));assertEquals(1,articles.list(owner,tenant,true,0).items().size());
      var restored=articles.change(owner,tenant,a.id(),action(3,"RESTORE"));assertFalse(restored.archived());assertEquals(4,restored.revision());assertEquals("校订后知识",articles.detail(reader,tenant,a.id()).article().title());assertEquals(List.of("RESTORE","ARCHIVE","EDIT","PUBLISH"),articles.history(owner,tenant,a.id(),0).items().stream().map(WikiArticleService.History::action).toList());
    }
    @Test void sourceChangesHideAllBodiesAndCannotBeRestoredOrEdited(){
      var s=seed();var a=articles.publish(owner,tenant,s.draft().id(),publish(0));knowledge.request(owner,tenant,space,s.file().material(),s.file().version(),UUID.randomUUID(),1);
      var current=articles.detail(reader,tenant,a.id());assertTrue(current.sourceChanged());assertNull(current.article());assertNull(articles.history(owner,tenant,a.id(),0).items().getFirst().article());
      denied(409,()->articles.change(owner,tenant,a.id(),new WikiArticleService.Change(UUID.randomUUID(),1,"EDIT","t","i","c")));assertTrue(articles.change(owner,tenant,a.id(),action(1,"ARCHIVE")).archived());denied(409,()->articles.change(owner,tenant,a.id(),action(2,"RESTORE")));
    }
    @Test void fileSpecificRightsAndRevocationApplyToEveryProjection(){
      var s=seed();db.update("INSERT INTO library_permission_rollouts VALUES (?,true)",tenant);db.update("UPDATE workspaces SET responsibility_confirmed=true WHERE id=?",space);
      permissions.save(admin,tenant,"MATERIAL",s.file().material(),new LibraryPermissionService.Change(UUID.randomUUID(),permissions.policy(admin,tenant,"MATERIAL",s.file().material()).revision(),false,List.of(new LibraryPermissionService.Grant("ACCOUNT",owner,"EDIT","DENY",false,null),new LibraryPermissionService.Grant("ACCOUNT",reader,"READ","DENY",false,null))));
      db.update("DELETE FROM workspace_members WHERE workspace_id=?",space);
      var item=articles.publish(owner,tenant,s.draft().id(),publish(0));assertNotNull(articles.detail(reader,tenant,item.id()).article());
      permissions.save(admin,tenant,"MATERIAL",s.file().material(),new LibraryPermissionService.Change(UUID.randomUUID(),permissions.policy(admin,tenant,"MATERIAL",s.file().material()).revision(),false,List.of(new LibraryPermissionService.Grant("ACCOUNT",owner,"EDIT","DENY",false,null))));
      denied(404,()->articles.detail(reader,tenant,item.id()));assertTrue(articles.list(reader,tenant,false,0).items().isEmpty());denied(404,()->articles.detail(admin,tenant,item.id()));
    }
    @Test void concurrentPublishCannotSilentlyOverwriteAnotherVersion() throws Exception {
      var s=seed();var pool=java.util.concurrent.Executors.newFixedThreadPool(2);var gate=new java.util.concurrent.CountDownLatch(1);
      try{var results=new ArrayList<java.util.concurrent.Future<String>>();for(int i=0;i<2;i++)results.add(pool.submit(()->{gate.await();try{return "ok:"+articles.publish(owner,tenant,s.draft().id(),publish(0)).revision();}catch(IdentityException e){return e.code;}}));gate.countDown();var values=new ArrayList<String>();for(var f:results)values.add(f.get(15,java.util.concurrent.TimeUnit.SECONDS));assertTrue(values.contains("ok:1"));assertTrue(values.contains("WIKI_REVISION_CONFLICT"));assertEquals(1,db.queryForObject("SELECT count(*) FROM wiki_articles WHERE tenant_id=?",Integer.class,tenant));}finally{pool.shutdownNow();}
    }
    @Test void sourcePurgeScrubsEveryPublishedAndArchivedRevision(){
      var s=seed();var a=articles.publish(owner,tenant,s.draft().id(),publish(0));articles.change(owner,tenant,a.id(),action(1,"ARCHIVE"));
      db.update("INSERT INTO governance_capabilities(tenant_id,account_id,workspace_id,capability,granted_by) VALUES (?,?,?,'LIFECYCLE_PURGE',?)",tenant,owner,space,admin);
      var item=lifecycle.preview(owner,tenant,space,"MATERIAL",s.file().material()).item();lifecycle.act(owner,tenant,space,"MATERIAL",s.file().material(),UUID.randomUUID(),item.revision(),"TRASH");
      item=lifecycle.preview(owner,tenant,space,"MATERIAL",s.file().material()).item();lifecycle.act(owner,tenant,space,"MATERIAL",s.file().material(),UUID.randomUUID(),item.revision(),"PURGE");
      var job=cleanup.claim();for(UUID blob:cleanup.pending(job)){cleanup.remove(blob);cleanup.removed(job,blob);}cleanup.finish(job);
      assertEquals(0,db.queryForObject("SELECT count(*) FROM wiki_article_versions WHERE article_id=? AND article IS NOT NULL",Integer.class,a.id()));denied(404,()->articles.detail(owner,tenant,a.id()));assertTrue(articles.list(owner,tenant,true,0).items().isEmpty());
    }

    @Test void httpIsAuthenticatedNoStoreAndCsrfProtected() throws Exception {
      var s=seed();var article=articles.publish(owner,tenant,s.draft().id(),publish(0));var http=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();var json=new JsonMapper();String base="http://127.0.0.1:"+port;String path="/api/v1/tenants/"+tenant+"/wiki-articles/"+article.id();
      assertEquals(401,http.send(HttpRequest.newBuilder(URI.create(base+path)).GET().build(),HttpResponse.BodyHandlers.ofString()).statusCode());
      var csrf=json.readTree(http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());
      var login=HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/login")).header(csrf.get("headerName").asString(),csrf.get("token").asString()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("email",reader+"@example.test","password","synthetic-knowledge-password")))).build();assertEquals(200,http.send(login,HttpResponse.BodyHandlers.ofString()).statusCode());
      var result=http.send(HttpRequest.newBuilder(URI.create(base+path)).GET().build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,result.statusCode());assertTrue(result.headers().firstValue("cache-control").orElseThrow().contains("no-store"));assertEquals("nosniff",result.headers().firstValue("x-content-type-options").orElseThrow());assertFalse(result.body().contains(s.draft().id().toString()));
      var post=HttpRequest.newBuilder(URI.create(base+path)).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(action(1,"ARCHIVE"))));assertEquals(403,http.send(post.build(),HttpResponse.BodyHandlers.ofString()).statusCode());
      var fresh=json.readTree(http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());post.header(fresh.get("headerName").asString(),fresh.get("token").asString());assertEquals(403,http.send(post.build(),HttpResponse.BodyHandlers.ofString()).statusCode());
    }
}
