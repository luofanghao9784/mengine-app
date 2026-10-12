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

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=verification","dreamcore.tasks.initial-delay-ms=3600000","dreamcore.knowledge.enabled=true","dreamcore.knowledge.initial-delay-ms=3600000"})
class WikiInsightIntegrationTest {
    @DynamicPropertySource static void paths(DynamicPropertyRegistry registry) {
        Path root=Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();
        String parser=root.resolve("workers/parser").toString();registry.add("dreamcore.knowledge.parser-root",()->parser);
    }
    @Autowired JdbcTemplate db;@Autowired MaterialService materials;@Autowired KnowledgeService knowledge;@Autowired DocumentParser parser;@Autowired PasswordEncoder passwords;
    @LocalServerPort int port;
    @Autowired com.dreamcore.workspace.material.LibraryPermissionService permissions; @Autowired WikiLearningService wiki; @Autowired ConversationService conversations; @Autowired AgentTaskService agents; @Autowired AgentUsageLedger usage;
    @Autowired WikiInsightService insights;
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

    File source(){var f=upload(space,"合成交付资料.txt","合成交付必须核对原件");finish(f);return f;}
    WikiInsightService.Start request(String mode,File... files){return new WikiInsightService.Start(UUID.randomUUID(),mode,Arrays.stream(files).map(f->new WikiInsightService.Selection(f.material(),f.version(),1)).toList());}
    WikiInsightService.Evidence evidence(WikiInsightService.Document d){return new WikiInsightService.Evidence(d.id(),d.fragments().getFirst().id(),"合成交付必须核对原件");}
    WikiInsightService.Point point(WikiInsightService.Document d){return new WikiInsightService.Point("依据资料核对交付",List.of(evidence(d)));}
    String report(WikiInsightService.Context c){var a=c.documents().getFirst();var b=c.documents().getLast();if(c.mode().equals("RECOMMEND"))return new JsonMapper().writeValueAsString(new WikiInsightService.Report(List.of(),null,List.of(),c.documents().stream().filter(d->!d.anchor()).limit(4).map(d->new WikiInsightService.Recommendation(d.id(),a.id(),"共同核对交付",List.of(evidence(a),evidence(d)))).toList()));return new JsonMapper().writeValueAsString(new WikiInsightService.Report(c.mode().equals("ANALYZE")?c.documents().stream().map(d->new WikiInsightService.Node(d.id(),point(d),List.of(point(d)))).toList():List.of(),c.mode().equals("ANALYZE")?new WikiInsightService.Point("仅根据合成片段综合判断",c.documents().stream().map(this::evidence).toList()):null,c.documents().size()>1?List.of(new WikiInsightService.Relation(a.id(),b.id(),"topic","共同核对交付",List.of(evidence(a),evidence(b)))):List.of(),List.of()));}
    void complete(WikiInsightService.Item item){var job=conversations.claim();assertEquals(item.taskId(),job.id());var check=agents.check(job.id(),job.token());assertFalse(check.containsKey("contextVersion"));var c=(WikiInsightService.Context)check.get("wikiInsight");assertNotNull(c);agents.openExecution(job.id(),job.token(),new AgentTaskService.ExecutionOpen("1.5",List.of()));agents.openUsage(job.id(),job.token());agents.startUsage(job.id(),job.token(),new AgentUsageLedger.Start(1,2048));usage.finish(job.id(),job.token(),new AgentUsageLedger.Receipt(1,"RETURNED",20L,10L));agents.finish(job,new AgentResult("1.5","0.19.0",job.id(),job.token(),"AGENT","verification","fixture",report(c),List.of(),List.of(),List.of(),1,new AgentResult.Usage(20,10),List.of(),List.of(),List.of(),"COMPLETE",null));}
    @Test void analysisHasEachSourceAndSynthesisAndPrivateMeteredTask(){var a=source();var b=source();var body=request("ANALYZE",a,b);var i=insights.start(owner,tenant,body);assertEquals(i.id(),insights.start(owner,tenant,body).id());denied(409,()->insights.start(owner,tenant,request("GRAPH",a)));denied(404,()->insights.detail(reader,tenant,i.id()));denied(403,()->insights.detail(owner,other,i.id()));denied(404,()->insights.start(admin,tenant,request("ANALYZE",a)));complete(i);var r=insights.detail(owner,tenant,i.id());assertEquals("SUCCEEDED",r.status());assertEquals(2,r.report().nodes().size());assertEquals(2,r.report().synthesis().evidence().size());assertEquals(1,r.report().relations().size());}
    @Test void recommendationsExcludeAnchorsAndRespectCandidateLimitAndRevocation(){var a=source();for(int n=0;n<13;n++)source();var i=insights.start(owner,tenant,request("RECOMMEND",a));assertEquals(13,i.documents().size());assertEquals(12,i.documents().stream().filter(d->!d.anchor()).count());assertEquals(13,db.queryForObject("SELECT count(*) FROM conversation_originals WHERE task_id=?",Integer.class,i.taskId()));complete(i);assertEquals(4,insights.detail(owner,tenant,i.id()).report().recommendations().size());db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);assertTrue(insights.list(owner,tenant,0).items().isEmpty());denied(404,()->insights.detail(owner,tenant,i.id()));assertTrue(conversations.taskDetail(owner,tenant,i.conversationId(),i.taskId()).tasks().getFirst().sourcesUnavailable());}
    @Test void sourceReparseBlocksRunningAndHidesOriginalConversation(){var a=source();var i=insights.start(owner,tenant,request("GRAPH",a));var job=conversations.claim();agents.check(job.id(),job.token());knowledge.request(owner,tenant,space,a.material(),a.version(),UUID.randomUUID(),1);assertThrows(IdentityException.class,()->agents.check(job.id(),job.token()));var r=insights.detail(owner,tenant,i.id());assertEquals("SOURCE_CHANGED",r.status());assertNull(r.report());assertTrue(r.documents().isEmpty());assertTrue(conversations.taskDetail(owner,tenant,i.conversationId(),i.taskId()).tasks().getFirst().sourcesUnavailable());}
    @Test void rejectsFakeCrossSourceEvidenceMissingSynthesisAndExtraFields(){var a=source();var b=source();var i=insights.start(owner,tenant,request("ANALYZE",a,b));var job=conversations.claim();var c=(WikiInsightService.Context)agents.check(job.id(),job.token()).get("wikiInsight");String raw=report(c);assertNotNull(insights.validate(raw,c));denied(502,()->insights.validate(raw.replace("合成交付必须核对原件","不在原资料中的编造内容"),c));denied(502,()->insights.validate(raw.replace(b.material().toString(),a.material().toString()),c));denied(502,()->insights.validate(raw.replace("\"reason\":","\"extra\":true,\"reason\":"),c));var r=insights.validate(raw,c);denied(502,()->insights.validate(new JsonMapper().writeValueAsString(new WikiInsightService.Report(r.nodes(),null,r.relations(),List.of())),c));}
    @Test void noCandidateReturnsEmptyRecommendationAndInputsRemainBounded(){var f=source();var i=insights.start(owner,tenant,request("RECOMMEND",f));complete(i);assertTrue(insights.detail(owner,tenant,i.id()).report().recommendations().isEmpty());var large=upload(space,"长资料.txt","合成交付必须核对原件"+"a".repeat(7000));finish(large);var g=insights.start(owner,tenant,request("GRAPH",large));assertTrue(g.documents().getFirst().fragments().stream().mapToInt(x->x.content().length()).sum()<=3000);}
    @Test void independentFileReadWorksWithoutParentAndCannotExpandOtherTenant(){var f=source();db.update("INSERT INTO library_permission_rollouts VALUES (?,true)",tenant);db.update("UPDATE workspaces SET responsibility_confirmed=true WHERE id=?",space);permissions.save(admin,tenant,"MATERIAL",f.material(),new LibraryPermissionService.Change(UUID.randomUUID(),permissions.policy(admin,tenant,"MATERIAL",f.material()).revision(),false,List.of(new LibraryPermissionService.Grant("ACCOUNT",owner,"READ","DENY",false,null))));db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);var i=insights.start(owner,tenant,request("ANALYZE",f));complete(i);assertEquals("SUCCEEDED",insights.detail(owner,tenant,i.id()).status());permissions.save(admin,tenant,"MATERIAL",f.material(),new LibraryPermissionService.Change(UUID.randomUUID(),permissions.policy(admin,tenant,"MATERIAL",f.material()).revision(),false,List.of()));denied(404,()->insights.detail(owner,tenant,i.id()));}

    @Test void httpSourceInsightCheckIsIsolatedAndWritesRequireCsrf() throws Exception {
      var f=source();var body=request("GRAPH",f);var i=insights.start(owner,tenant,body);var job=conversations.claim();var http=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();var json=new JsonMapper();String base="http://127.0.0.1:"+port;String path="/api/v1/tenants/"+tenant+"/wiki-insights";
      var check=http.send(HttpRequest.newBuilder(URI.create(base+"/internal/v1/agent-access/"+job.id()+"/check")).header("Authorization","Bearer "+job.token()).POST(HttpRequest.BodyPublishers.noBody()).build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,check.statusCode());assertTrue(json.readTree(check.body()).has("wikiInsight"));assertFalse(json.readTree(check.body()).has("datasetCompositionVersion"));
      assertEquals(401,http.send(HttpRequest.newBuilder(URI.create(base+path+"/"+i.id())).GET().build(),HttpResponse.BodyHandlers.ofString()).statusCode());var csrf=json.readTree(http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());var login=HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/login")).header(csrf.get("headerName").asString(),csrf.get("token").asString()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("email",owner+"@example.test","password","synthetic-knowledge-password")))).build();assertEquals(200,http.send(login,HttpResponse.BodyHandlers.ofString()).statusCode());var result=http.send(HttpRequest.newBuilder(URI.create(base+path+"/"+i.id())).GET().build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,result.statusCode());assertTrue(result.headers().firstValue("cache-control").orElseThrow().contains("no-store"));var post=HttpRequest.newBuilder(URI.create(base+path)).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));assertEquals(403,http.send(post.build(),HttpResponse.BodyHandlers.ofString()).statusCode());var fresh=json.readTree(http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());post.header(fresh.get("headerName").asString(),fresh.get("token").asString());assertEquals(200,http.send(post.build(),HttpResponse.BodyHandlers.ofString()).statusCode());
    }
}
