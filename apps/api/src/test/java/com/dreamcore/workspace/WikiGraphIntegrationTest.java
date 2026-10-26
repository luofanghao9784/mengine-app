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
class WikiGraphIntegrationTest {
    @DynamicPropertySource static void paths(DynamicPropertyRegistry registry) {
        IsolatedTestDatabase.register(registry);
        Path root=Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();
        String parser=root.resolve("workers/parser").toString();registry.add("dreamcore.knowledge.parser-root",()->parser);
    }
    @Autowired JdbcTemplate db;@Autowired MaterialService materials;@Autowired KnowledgeService knowledge;@Autowired DocumentParser parser;@Autowired PasswordEncoder passwords;
    @LocalServerPort int port;
    @Autowired com.dreamcore.workspace.material.LibraryPermissionService permissions; @Autowired WikiLearningService wiki; @Autowired ConversationService conversations; @Autowired AgentTaskService agents; @Autowired AgentUsageLedger usage;
    @Autowired WikiArticleService articles; @Autowired com.dreamcore.workspace.lifecycle.MaterialLifecycleService lifecycle; @Autowired com.dreamcore.workspace.lifecycle.MaterialCleanupService cleanup;
    @Autowired WikiGraphService graphs;
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

    WikiArticleService.Item published(){var s=seed();return articles.publish(owner,tenant,s.draft().id(),publish(0));}
    WikiGraphService.Start graphRequest(WikiArticleService.Item... a){return new WikiGraphService.Start(UUID.randomUUID(),Arrays.stream(a).map(i->new WikiGraphService.Selection(i.id(),i.revision())).toList());}
    String graphText(WikiGraphService.Context c){var a=c.documents().getFirst();var b=c.documents().getLast();return new JsonMapper().writeValueAsString(new WikiGraphService.Graph(c.documents().stream().map(WikiGraphService.Node::id).toList(),c.documents().size()==1?List.of():List.of(new WikiGraphService.Relation(a.id(),b.id(),"topic","共同关注交付核对",List.of(new WikiGraphService.Evidence(a.id(),"依据原文核对交付事项"),new WikiGraphService.Evidence(b.id(),"依据原文核对交付事项"))))));}
    void complete(WikiGraphService.Item g){var job=conversations.claim();assertEquals(g.taskId(),job.id());var check=agents.check(job.id(),job.token());assertFalse(check.containsKey("contextVersion"));var c=(WikiGraphService.Context)check.get("wikiGraph");assertNotNull(c);
      denied(403,()->agents.openExecution(job.id(),job.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("task_context"))));
      agents.openExecution(job.id(),job.token(),new AgentTaskService.ExecutionOpen("1.5",List.of()));agents.openUsage(job.id(),job.token());agents.startUsage(job.id(),job.token(),new AgentUsageLedger.Start(1,2048));usage.finish(job.id(),job.token(),new AgentUsageLedger.Receipt(1,"RETURNED",20L,10L));
      agents.finish(job,new AgentResult("1.5","0.19.0",job.id(),job.token(),"AGENT","verification","fixture",graphText(c),List.of(),List.of(),List.of(),1,new AgentResult.Usage(20,10),List.of(),List.of(),List.of(),"COMPLETE",null));
    }
    @Test void privateGraphUsesMeteredTaskAndIdempotentRequest(){
      var a=published();var b=published();var body=graphRequest(a,b);var g=graphs.start(owner,tenant,body);assertEquals(g.id(),graphs.start(owner,tenant,body).id());denied(409,()->graphs.start(owner,tenant,graphRequest(a)));
      denied(404,()->graphs.detail(reader,tenant,g.id()));denied(404,()->graphs.detail(admin,tenant,g.id()));denied(403,()->graphs.detail(owner,other,g.id()));
      complete(g);var result=graphs.detail(owner,tenant,g.id());assertEquals("SUCCEEDED",result.status());assertEquals(1,result.graph().relations().size());assertEquals(2,result.documents().size());assertEquals(1,graphs.list(owner,tenant,0).items().size());
    }
    @Test void editsHideGraphAndOriginalTaskAndBlockInFlight(){
      var a=published();var g=graphs.start(owner,tenant,graphRequest(a));complete(g);
      var dependent=conversations.submitClient(owner,tenant,null,personal,UUID.randomUUID(),"请核对历史知识关系。","AGENT",null,List.of(new TaskOriginals.Selection(a.materialId(),a.sourceVersionId())),"SELECTED");var depJob=conversations.claim();assertEquals(dependent.tasks().getFirst().id(),depJob.id());
      db.update("INSERT INTO task_context_reads(task_id,attempt_number,kind,reference_id,version_key,content_hash) SELECT id,attempt,'HISTORY',?,'1',? FROM conversation_tasks WHERE id=?",g.taskId(),"0".repeat(64),depJob.id());assertTrue(db.queryForObject("SELECT wiki_graph_current(?)",Boolean.class,depJob.id()));
      articles.change(owner,tenant,a.id(),new WikiArticleService.Change(UUID.randomUUID(),1,"EDIT","校订新标题","新摘要","更新知识正文内容"));
      var hidden=graphs.detail(owner,tenant,g.id());assertEquals("SOURCE_CHANGED",hidden.status());assertNull(hidden.graph());assertTrue(hidden.documents().isEmpty());
      var t=conversations.taskDetail(owner,tenant,g.conversationId(),g.taskId()).tasks().getFirst();assertTrue(t.sourcesUnavailable());assertNull(t.reply());
      assertFalse(db.queryForObject("SELECT wiki_graph_current(?)",Boolean.class,depJob.id()));assertTrue(conversations.taskDetail(owner,tenant,depJob.conversation(),depJob.id()).tasks().getFirst().sourcesUnavailable());db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE id=?",depJob.id());
      var fresh=articles.detail(owner,tenant,a.id());var next=graphs.start(owner,tenant,graphRequest(fresh));var job=conversations.claim();assertNotNull(agents.check(job.id(),job.token()).get("wikiGraph"));articles.change(owner,tenant,a.id(),action(2,"ARCHIVE"));
      var error=assertThrows(IdentityException.class,()->agents.check(job.id(),job.token()));assertTrue(Set.of(403,409).contains(error.status));assertNull(graphs.detail(owner,tenant,next.id()).graph());
    }
    @Test void revokeAnyInputHidesEverythingAndAdminCannotAnalyze(){
      var a=published();var b=published();var g=graphs.start(owner,tenant,graphRequest(a,b));complete(g);
      denied(404,()->graphs.start(admin,tenant,graphRequest(a)));
      db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);
      denied(404,()->graphs.detail(owner,tenant,g.id()));assertTrue(graphs.list(owner,tenant,0).items().isEmpty());assertTrue(conversations.taskDetail(owner,tenant,g.conversationId(),g.taskId()).tasks().getFirst().sourcesUnavailable());
    }
    @Test void validatesBothEndsQuotesPairsSelectedAndEmptyRelations(){
      var a=published();var b=published();var g=graphs.start(owner,tenant,graphRequest(a,b));var job=conversations.claim();var c=(WikiGraphService.Context)agents.check(job.id(),job.token()).get("wikiGraph");String valid=graphText(c);assertEquals(1,graphs.validate(valid,c).relations().size());
      denied(502,()->graphs.validate(valid.replace("依据原文核对交付事项","凭空编造不存在的内容"),c));
      denied(502,()->graphs.validate(valid.replace(b.id().toString(),a.id().toString()),c));
      denied(502,()->graphs.validate(valid.replace("topic","invented"),c));
      denied(502,()->graphs.validate(valid.replace(a.id().toString(),UUID.randomUUID().toString()),c));
      var parsed=graphs.validate(valid,c);var relation=parsed.relations().getFirst();
      denied(502,()->graphs.validate(new JsonMapper().writeValueAsString(new WikiGraphService.Graph(parsed.selected(),List.of(relation,relation))),c));
      var one=new WikiGraphService.Context(List.of(c.documents().getFirst()));assertTrue(graphs.validate(graphText(one),one).relations().isEmpty());
    }
    @Test void sourceReparseAndArchiveRestoreNeverResurrectGraph(){
      var a=published();var g=graphs.start(owner,tenant,graphRequest(a));complete(g);articles.change(owner,tenant,a.id(),action(1,"ARCHIVE"));articles.change(owner,tenant,a.id(),action(2,"RESTORE"));assertEquals("SOURCE_CHANGED",graphs.detail(owner,tenant,g.id()).status());
      var fresh=articles.detail(owner,tenant,a.id());var n=graphs.start(owner,tenant,graphRequest(fresh));complete(n);
      knowledge.request(owner,tenant,space,a.materialId(),a.sourceVersionId(),UUID.randomUUID(),1);
      assertEquals("SOURCE_CHANGED",graphs.detail(owner,tenant,n.id()).status());assertTrue(conversations.taskDetail(owner,tenant,n.conversationId(),n.taskId()).tasks().getFirst().sourcesUnavailable());
    }
    @Test void readOnlyFileGrantCanAnalyzeWithoutParentOrMaintain(){
      var a=published();db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'reader personal','PERSONAL')",UUID.randomUUID(),tenant,reader);
      db.update("INSERT INTO library_permission_rollouts VALUES (?,true)",tenant);db.update("UPDATE workspaces SET responsibility_confirmed=true WHERE id=?",space);
      permissions.save(admin,tenant,"MATERIAL",a.materialId(),new LibraryPermissionService.Change(UUID.randomUUID(),permissions.policy(admin,tenant,"MATERIAL",a.materialId()).revision(),false,List.of(new LibraryPermissionService.Grant("ACCOUNT",reader,"READ","DENY",false,null))));
      db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,reader);
      var g=graphs.start(reader,tenant,graphRequest(a));complete(g);assertEquals("SUCCEEDED",graphs.detail(reader,tenant,g.id()).status());denied(403,()->articles.change(reader,tenant,a.id(),action(1,"ARCHIVE")));
      permissions.save(admin,tenant,"MATERIAL",a.materialId(),new LibraryPermissionService.Change(UUID.randomUUID(),permissions.policy(admin,tenant,"MATERIAL",a.materialId()).revision(),false,List.of()));
      denied(404,()->graphs.detail(reader,tenant,g.id()));assertTrue(graphs.list(reader,tenant,0).items().isEmpty());
    }

    @Test void concurrentStartsAndUncertainResultsDoNotDuplicateCalls() throws Exception {
      var a=published();var pool=java.util.concurrent.Executors.newFixedThreadPool(2);var gate=new java.util.concurrent.CountDownLatch(1);
      try {var futures=new ArrayList<java.util.concurrent.Future<String>>();for(int i=0;i<2;i++)futures.add(pool.submit(()->{gate.await();try{return graphs.start(owner,tenant,graphRequest(a)).status();}catch(IdentityException e){return e.code;}}));gate.countDown();var values=new ArrayList<String>();for(var f:futures)values.add(f.get(15,java.util.concurrent.TimeUnit.SECONDS));assertTrue(values.contains("QUEUED"));assertTrue(values.contains("WIKI_LEARNING_BUSY"));}finally{pool.shutdownNow();}
      var g=graphs.list(owner,tenant,0).items().getFirst();db.update("UPDATE conversation_tasks SET status='RESULT_UNKNOWN',reconciliation_required=true WHERE id=?",g.taskId());denied(409,()->graphs.start(owner,tenant,graphRequest(a)));assertEquals(1,graphs.list(owner,tenant,0).items().size());
    }
    @Test void sourcePurgeScrubsPrivateGraphTaskOutput(){
      var a=published();var g=graphs.start(owner,tenant,graphRequest(a));complete(g);
      db.update("INSERT INTO governance_capabilities(tenant_id,account_id,workspace_id,capability,granted_by) VALUES (?,?,?,'LIFECYCLE_PURGE',?)",tenant,owner,space,admin);
      var item=lifecycle.preview(owner,tenant,space,"MATERIAL",a.materialId()).item();lifecycle.act(owner,tenant,space,"MATERIAL",a.materialId(),UUID.randomUUID(),item.revision(),"TRASH");
      item=lifecycle.preview(owner,tenant,space,"MATERIAL",a.materialId()).item();lifecycle.act(owner,tenant,space,"MATERIAL",a.materialId(),UUID.randomUUID(),item.revision(),"PURGE");
      var job=cleanup.claim();for(UUID blob:cleanup.pending(job)){cleanup.remove(blob);cleanup.removed(job,blob);}cleanup.finish(job);
      assertNull(db.queryForObject("SELECT reply FROM conversation_tasks WHERE id=?",String.class,g.taskId()));denied(404,()->graphs.detail(owner,tenant,g.id()));assertTrue(graphs.list(owner,tenant,0).items().isEmpty());
    }
    @Test void httpGraphHasPrivateHeadersAndRequiresLoginOwnerAndCsrf() throws Exception {
      var a=published();var body=graphRequest(a);var g=graphs.start(owner,tenant,body);var job=conversations.claim();var http=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();var json=new JsonMapper();String base="http://127.0.0.1:"+port;String path="/api/v1/tenants/"+tenant+"/wiki-graphs";
      var internal=http.send(HttpRequest.newBuilder(URI.create(base+"/internal/v1/agent-access/"+job.id()+"/check")).header("Authorization","Bearer "+job.token()).POST(HttpRequest.BodyPublishers.noBody()).build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,internal.statusCode());assertTrue(json.readTree(internal.body()).has("wikiGraph"));assertFalse(json.readTree(internal.body()).has("datasetCompositionVersion"));
      assertEquals(401,http.send(HttpRequest.newBuilder(URI.create(base+path+"/"+g.id())).GET().build(),HttpResponse.BodyHandlers.ofString()).statusCode());
      var csrf=json.readTree(http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());
      var login=HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/login")).header(csrf.get("headerName").asString(),csrf.get("token").asString()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("email",owner+"@example.test","password","synthetic-knowledge-password")))).build();assertEquals(200,http.send(login,HttpResponse.BodyHandlers.ofString()).statusCode());
      var result=http.send(HttpRequest.newBuilder(URI.create(base+path+"/"+g.id())).GET().build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,result.statusCode());assertTrue(result.headers().firstValue("cache-control").orElseThrow().contains("no-store"));assertEquals("nosniff",result.headers().firstValue("x-content-type-options").orElseThrow());
      var post=HttpRequest.newBuilder(URI.create(base+path)).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));assertEquals(403,http.send(post.build(),HttpResponse.BodyHandlers.ofString()).statusCode());
      var fresh=json.readTree(http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());post.header(fresh.get("headerName").asString(),fresh.get("token").asString());var retry=http.send(post.build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,retry.statusCode());assertEquals(g.id().toString(),json.readTree(retry.body()).get("id").asString());
    }

    @Test void automaticCandidatesAreAuthorizedBoundedAndPinnedBeyondNormalThreeFileLimit(){
      var all=new ArrayList<WikiArticleService.Item>();for(int i=0;i<13;i++)all.add(published());UUID key=UUID.randomUUID();var g=graphs.automatic(owner,tenant,key);assertEquals(12,g.documents().size());assertEquals(g.id(),graphs.automatic(owner,tenant,key).id());assertFalse(g.documents().stream().anyMatch(n->n.id().equals(all.getFirst().id())));assertEquals(12,db.queryForObject("SELECT count(*) FROM conversation_originals WHERE task_id=?",Integer.class,g.taskId()));
      var job=conversations.claim();var c=(WikiGraphService.Context)agents.check(job.id(),job.token()).get("wikiGraph");assertEquals(12,c.documents().size());var selected=new WikiGraphService.Context(c.documents().subList(0,6));var nodeIds=selected.documents().stream().map(WikiGraphService.Node::id).toList();String raw=new JsonMapper().writeValueAsString(new WikiGraphService.Graph(nodeIds,List.of()));assertEquals(6,graphs.validate(raw,c).selected().size());
      denied(409,()->graphs.automatic(admin,tenant,UUID.randomUUID()));
      var a=all.getLast();articles.change(owner,tenant,a.id(),new WikiArticleService.Change(UUID.randomUUID(),1,"EDIT","新版知识","更新导语","当前知识正文已更新"));assertTrue(graphs.detail(owner,tenant,g.id()).documents().isEmpty());assertThrows(IdentityException.class,()->agents.check(job.id(),job.token()));
    }
}
