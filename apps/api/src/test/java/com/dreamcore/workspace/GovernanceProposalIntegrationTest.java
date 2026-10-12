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
class GovernanceProposalIntegrationTest {
    @DynamicPropertySource static void paths(DynamicPropertyRegistry registry) {
        Path root=Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();
        String parser=root.resolve("workers/parser").toString();registry.add("dreamcore.knowledge.parser-root",()->parser);
    }
    @Autowired JdbcTemplate db;@Autowired MaterialService materials;@Autowired KnowledgeService knowledge;@Autowired DocumentParser parser;@Autowired PasswordEncoder passwords;
    @LocalServerPort int port;
    @Autowired com.dreamcore.workspace.material.LibraryPermissionService permissions; @Autowired WikiLearningService wiki; @Autowired ConversationService conversations; @Autowired AgentTaskService agents; @Autowired AgentUsageLedger usage;
    @Autowired WikiArticleService articles; @Autowired com.dreamcore.workspace.lifecycle.MaterialLifecycleService lifecycle; @Autowired com.dreamcore.workspace.lifecycle.MaterialCleanupService cleanup;
    @Autowired GovernanceProposalService proposals; @Autowired MaterialGovernanceService governance;
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

    GovernanceProposalService.Create tags(File f,int revision){return new GovernanceProposalService.Create(UUID.randomUUID(),f.version(),revision,"TAGS",List.of("合成交付"),null,null,"补充交付分类，保持资料权限");}
    GovernanceProposalService.Create summary(Seed s,int revision){return new GovernanceProposalService.Create(UUID.randomUUID(),s.file().version(),revision,"SUMMARY",null,s.draft().article().content(),s.draft().id(),"依据来源核对摘要");}
    @Test void tagsRequireExplicitMaintainerApprovalAndAreIdempotent(){
      var s=seed();var body=tags(s.file(),0);var p=proposals.create(owner,tenant,s.file().material(),body);assertEquals(p.id(),proposals.create(owner,tenant,s.file().material(),body).id());assertTrue(governance.detail(owner,tenant,s.file().material()).tags().isEmpty());
      denied(403,()->proposals.create(reader,tenant,s.file().material(),body));denied(403,()->proposals.detail(reader,tenant,p.id()));denied(404,()->proposals.detail(admin,tenant,p.id()));denied(403,()->proposals.detail(owner,other,p.id()));
      var resolve=new GovernanceProposalService.Resolve(UUID.randomUUID(),"APPROVE");assertEquals("APPLIED",proposals.resolve(owner,tenant,p.id(),resolve).status());assertEquals("APPLIED",proposals.resolve(owner,tenant,p.id(),resolve).status());assertEquals(List.of("合成交付"),governance.detail(reader,tenant,s.file().material()).tags());assertEquals(1,governance.detail(owner,tenant,s.file().material()).revision());assertEquals(1,proposals.list(owner,tenant,"APPLIED",0).items().size());assertTrue(proposals.list(reader,tenant,"ALL",0).items().isEmpty());
    }
    @Test void summarySharesOnlyExplicitProposalAndKeepsEvidenceAndSimulationLabel(){
      var s=seed();var p=proposals.create(owner,tenant,s.file().material(),summary(s,0));assertEquals("verification",p.patch().executionClass());assertEquals(s.draft().article().evidence(),p.patch().evidence());assertNull(proposals.prepare(reader,tenant,s.file().material()).summary());String wire=new JsonMapper().writeValueAsString(p);assertFalse(wire.contains(s.draft().id().toString()));assertFalse(wire.contains(s.draft().conversationId().toString()));
      proposals.resolve(owner,tenant,p.id(),new GovernanceProposalService.Resolve(UUID.randomUUID(),"APPROVE"));assertEquals(s.draft().article().content(),proposals.prepare(reader,tenant,s.file().material()).summary());denied(404,()->wiki.detail(reader,tenant,s.draft().id()));
      knowledge.request(owner,tenant,space,s.file().material(),s.file().version(),UUID.randomUUID(),1);assertNull(proposals.prepare(reader,tenant,s.file().material()).summary());assertTrue(proposals.detail(owner,tenant,p.id()).stale());assertNull(proposals.detail(owner,tenant,p.id()).patch());
    }
    @Test void staleSuggestionsCannotOverwriteNewerMetadataAndMayBeRejected(){
      var s=seed();var a=proposals.create(owner,tenant,s.file().material(),tags(s.file(),0));var b=proposals.create(owner,tenant,s.file().material(),tags(s.file(),0));proposals.resolve(owner,tenant,a.id(),new GovernanceProposalService.Resolve(UUID.randomUUID(),"APPROVE"));assertTrue(proposals.detail(owner,tenant,b.id()).stale());denied(409,()->proposals.resolve(owner,tenant,b.id(),new GovernanceProposalService.Resolve(UUID.randomUUID(),"APPROVE")));assertEquals("REJECTED",proposals.resolve(owner,tenant,b.id(),new GovernanceProposalService.Resolve(UUID.randomUUID(),"REJECT")).status());assertEquals(1,governance.detail(owner,tenant,s.file().material()).revision());
    }
    @Test void sourceRevocationRemovesPendingProposalAndSummary(){
      var s=seed();var p=proposals.create(owner,tenant,s.file().material(),summary(s,0));db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);denied(404,()->proposals.detail(owner,tenant,p.id()));denied(404,()->proposals.resolve(owner,tenant,p.id(),new GovernanceProposalService.Resolve(UUID.randomUUID(),"APPROVE")));assertTrue(proposals.list(owner,tenant,"PENDING",0).items().isEmpty());
    }
    @Test void rejectsWrongDraftScopeUnknownActionsAndUnversionedInputs(){
      var a=seed();var b=seed();denied(409,()->proposals.create(owner,tenant,b.file().material(),new GovernanceProposalService.Create(UUID.randomUUID(),b.file().version(),0,"SUMMARY",null,"人工核对的摘要",a.draft().id(),"核对")));
      denied(400,()->proposals.create(owner,tenant,a.file().material(),new GovernanceProposalService.Create(UUID.randomUUID(),a.file().version(),0,"PERMISSIONS",List.of("公开"),null,null,"不允许权限提案")));
      denied(409,()->proposals.create(owner,tenant,a.file().material(),tags(a.file(),9)));
    }
    @Test void concurrentApprovalsApplyOnlyOnce() throws Exception {
      var s=seed();var p=proposals.create(owner,tenant,s.file().material(),tags(s.file(),0));var pool=java.util.concurrent.Executors.newFixedThreadPool(2);var gate=new java.util.concurrent.CountDownLatch(1);
      try{var futures=new ArrayList<java.util.concurrent.Future<String>>();for(int i=0;i<2;i++)futures.add(pool.submit(()->{gate.await();try{return proposals.resolve(owner,tenant,p.id(),new GovernanceProposalService.Resolve(UUID.randomUUID(),"APPROVE")).status();}catch(IdentityException e){return e.code;}}));gate.countDown();var values=new ArrayList<String>();for(var f:futures)values.add(f.get(15,java.util.concurrent.TimeUnit.SECONDS));assertTrue(values.contains("APPLIED"));assertTrue(values.contains("GOVERNANCE_PROPOSAL_CHANGED"));assertEquals(1,governance.detail(owner,tenant,s.file().material()).revision());}finally{pool.shutdownNow();}
    }
    @Test void sourceCleanupErasesProposalAndPublishedSummary(){
      var s=seed();var p=proposals.create(owner,tenant,s.file().material(),summary(s,0));proposals.resolve(owner,tenant,p.id(),new GovernanceProposalService.Resolve(UUID.randomUUID(),"APPROVE"));
      db.update("INSERT INTO governance_capabilities(tenant_id,account_id,workspace_id,capability,granted_by) VALUES (?,?,?,'LIFECYCLE_PURGE',?)",tenant,owner,space,admin);
      var item=lifecycle.preview(owner,tenant,space,"MATERIAL",s.file().material()).item();lifecycle.act(owner,tenant,space,"MATERIAL",s.file().material(),UUID.randomUUID(),item.revision(),"TRASH");item=lifecycle.preview(owner,tenant,space,"MATERIAL",s.file().material()).item();lifecycle.act(owner,tenant,space,"MATERIAL",s.file().material(),UUID.randomUUID(),item.revision(),"PURGE");
      var job=cleanup.claim();for(UUID blob:cleanup.pending(job)){cleanup.remove(blob);cleanup.removed(job,blob);}cleanup.finish(job);assertNull(db.queryForObject("SELECT patch::text FROM material_governance_proposals WHERE id=?",String.class,p.id()));assertNull(db.queryForObject("SELECT summary FROM material_summary_versions WHERE proposal_id=?",String.class,p.id()));assertTrue(proposals.list(owner,tenant,"ALL",0).items().isEmpty());
    }

    @Test void httpSubmissionAndResolutionUseLoginCsrfAndCurrentAuthority() throws Exception {
      var s=seed();var p=proposals.create(owner,tenant,s.file().material(),tags(s.file(),0));var http=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();var json=new JsonMapper();String base="http://127.0.0.1:"+port;String path="/api/v1/tenants/"+tenant+"/governance-proposals/"+p.id();
      assertEquals(401,http.send(HttpRequest.newBuilder(URI.create(base+path)).GET().build(),HttpResponse.BodyHandlers.ofString()).statusCode());
      var csrf=json.readTree(http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());
      var login=HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/login")).header(csrf.get("headerName").asString(),csrf.get("token").asString()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("email",owner+"@example.test","password","synthetic-knowledge-password")))).build();assertEquals(200,http.send(login,HttpResponse.BodyHandlers.ofString()).statusCode());
      var result=http.send(HttpRequest.newBuilder(URI.create(base+path)).GET().build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,result.statusCode());assertTrue(result.headers().firstValue("cache-control").orElseThrow().contains("no-store"));
      var post=HttpRequest.newBuilder(URI.create(base+path+"/resolve")).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(new GovernanceProposalService.Resolve(UUID.randomUUID(),"APPROVE"))));assertEquals(403,http.send(post.build(),HttpResponse.BodyHandlers.ofString()).statusCode());
      var fresh=json.readTree(http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());post.header(fresh.get("headerName").asString(),fresh.get("token").asString());assertEquals(200,http.send(post.build(),HttpResponse.BodyHandlers.ofString()).statusCode());
      db.update("UPDATE workspace_members SET can_maintain=false WHERE workspace_id=? AND account_id=?",space,owner);assertEquals(403,http.send(HttpRequest.newBuilder(URI.create(base+path)).GET().build(),HttpResponse.BodyHandlers.ofString()).statusCode());
    }
}
