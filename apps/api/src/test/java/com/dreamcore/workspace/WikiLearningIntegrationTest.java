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
class WikiLearningIntegrationTest {
    @DynamicPropertySource static void paths(DynamicPropertyRegistry registry) {
        Path root=Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();
        String parser=root.resolve("workers/parser").toString();registry.add("dreamcore.knowledge.parser-root",()->parser);
    }
    @Autowired JdbcTemplate db;@Autowired MaterialService materials;@Autowired KnowledgeService knowledge;@Autowired DocumentParser parser;@Autowired PasswordEncoder passwords;
    @LocalServerPort int port;
    @Autowired com.dreamcore.workspace.material.LibraryPermissionService permissions; @Autowired WikiLearningService wiki; @Autowired ConversationService conversations; @Autowired AgentTaskService agents; @Autowired AgentUsageLedger usage;
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
    @Test void learningReusesTaskLedgerAndIsIdempotentPrivateAndRevocable(){
      var file=upload(space,"合成.txt","合成交付必须核对原件");finish(file);var body=request(file);
      var draft=wiki.start(owner,tenant,file.material(),body);assertEquals(draft.id(),wiki.start(owner,tenant,file.material(),body).id());
      assertEquals(1,db.queryForObject("SELECT count(*) FROM wiki_learning_drafts WHERE tenant_id=?",Integer.class,tenant));
      denied(409,()->wiki.start(owner,tenant,file.material(),request(file)));
      denied(404,()->wiki.detail(reader,tenant,draft.id()));denied(404,()->wiki.detail(admin,tenant,draft.id()));denied(403,()->wiki.detail(owner,other,draft.id()));
      var job=conversations.claim();assertEquals(draft.taskId(),job.id());
      var check=agents.check(job.id(),job.token());assertFalse(check.containsKey("expressionPreferences"));assertFalse(check.containsKey("contextVersion"));
      var source=(WikiLearningService.Source)check.get("wikiLearning");
      denied(403,()->agents.openExecution(job.id(),job.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("task_context"))));
      agents.openExecution(job.id(),job.token(),new AgentTaskService.ExecutionOpen("1.5",List.of()));
      agents.openUsage(job.id(),job.token());agents.startUsage(job.id(),job.token(),new AgentUsageLedger.Start(1,2048));usage.finish(job.id(),job.token(),new AgentUsageLedger.Receipt(1,"RETURNED",20L,10L));
      agents.finish(job,result(job,source,article(source,"合成交付必须核对原件")));
      assertEquals("合成知识",wiki.detail(owner,tenant,draft.id()).article().title());assertEquals("verification",wiki.list(owner,tenant,0).items().getFirst().executionClass());
      db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);
      denied(404,()->wiki.detail(owner,tenant,draft.id()));assertTrue(wiki.list(owner,tenant,0).items().isEmpty());
    }
    @Test void sourceUpdateAndReparseBlockInFlightAndHideOldDraft(){
      var file=upload(space,"版本.txt","合成版本内容需要核对");finish(file);var draft=wiki.start(owner,tenant,file.material(),request(file));var job=conversations.claim();agents.check(job.id(),job.token());
      knowledge.request(owner,tenant,space,file.material(),file.version(),UUID.randomUUID(),1);
      denied(409,()->agents.check(job.id(),job.token()));assertEquals("SOURCE_CHANGED",wiki.detail(owner,tenant,draft.id()).status());assertNull(wiki.detail(owner,tenant,draft.id()).article());
    }
    @Test void rejectsFabricatedEvidenceAndWrongSourceWithoutSilentlyClippingInput(){
      var file=upload(space,"边界.txt","a".repeat(7000));finish(file);var draft=wiki.start(owner,tenant,file.material(),request(file));var job=conversations.claim();
      var source=(WikiLearningService.Source)agents.check(job.id(),job.token()).get("wikiLearning");assertTrue(source.fragments().stream().mapToInt(c->c.content().length()).sum()>6000);
      denied(502,()->wiki.validate(article(source,"不存在的原文依据"),source));
      denied(502,()->wiki.validate("```json {} ```",source));
      var privateFile=upload(personal,"私人.txt","私人内容不能进入 Wiki 来源");finish(privateFile);denied(404,()->wiki.start(owner,tenant,privateFile.material(),request(privateFile)));
      denied(409,()->wiki.start(owner,tenant,file.material(),new WikiLearningService.Start(UUID.randomUUID(),file.version(),2)));
    }

    @Test void completeLongSourceCanFinishThroughTheActualTaskReceiptGuard(){
      var file=upload(space,"全量片段.txt",("合成来源需要逐段核对原文。".repeat(100)+"\n\n").repeat(15));finish(file);
      var draft=wiki.start(owner,tenant,file.material(),request(file));var job=conversations.claim();
      var source=(WikiLearningService.Source)agents.check(job.id(),job.token()).get("wikiLearning");
      assertTrue(source.fragments().size()>10);assertTrue(source.fragments().stream().mapToInt(c->c.content().length()).sum()>6000);
      agents.openExecution(job.id(),job.token(),new AgentTaskService.ExecutionOpen("1.5",List.of()));
      agents.openUsage(job.id(),job.token());agents.startUsage(job.id(),job.token(),new AgentUsageLedger.Start(1,2048));usage.finish(job.id(),job.token(),new AgentUsageLedger.Receipt(1,"RETURNED",20L,10L));
      agents.finish(job,result(job,source,article(source,"合成来源需要逐段核对原文。")));
      assertEquals("SUCCEEDED",wiki.detail(owner,tenant,draft.id()).status());
      assertEquals(source.fragments().size(),db.queryForObject("SELECT count(*) FROM conversation_sources WHERE task_id=?",Integer.class,job.id()));
    }

    @Test void oversizedSourcesRequirePartitionInsteadOfPartialSuccess(){
      var file=upload(space,"过长资料.txt","a".repeat(33000));finish(file);
      var error=assertThrows(IdentityException.class,()->wiki.start(owner,tenant,file.material(),request(file)));
      assertEquals("WIKI_SOURCE_PARTITION_REQUIRED",error.code);
      assertEquals(0,db.queryForObject("SELECT count(*) FROM wiki_learning_drafts WHERE tenant_id=?",Integer.class,tenant));
    }

    @Test void explicitFileReadCanLearnWithoutParentAccessAndAdminDoesNotInherit(){
      var file=upload(space,"独立授权.txt","仅文件授权仍可学习合成资料");finish(file);
      db.update("INSERT INTO library_permission_rollouts VALUES (?,true)",tenant);
      db.update("UPDATE workspaces SET responsibility_confirmed=true WHERE id=?",space);
      permissions.save(admin,tenant,"MATERIAL",file.material(),new com.dreamcore.workspace.material.LibraryPermissionService.Change(UUID.randomUUID(),permissions.policy(admin,tenant,"MATERIAL",file.material()).revision(),false,List.of(new com.dreamcore.workspace.material.LibraryPermissionService.Grant("ACCOUNT",owner,"READ","DENY",false,null))));
      db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);
      var draft=wiki.start(owner,tenant,file.material(),request(file));assertEquals("QUEUED",draft.status());
      var job=conversations.claim();assertNotNull(agents.check(job.id(),job.token()).get("wikiLearning"));
      denied(404,()->wiki.start(admin,tenant,file.material(),request(file)));
      permissions.save(admin,tenant,"MATERIAL",file.material(),new com.dreamcore.workspace.material.LibraryPermissionService.Change(UUID.randomUUID(),permissions.policy(admin,tenant,"MATERIAL",file.material()).revision(),false,List.of()));
      denied(404,()->wiki.detail(owner,tenant,draft.id()));assertTrue(wiki.list(owner,tenant,0).items().isEmpty());
    }

    @Test void differentRequestKeysCannotRaceIntoTwoLearningTasks() throws Exception {
      var file=upload(space,"并发.txt","并发学习使用合成来源内容");finish(file);
      var pool=java.util.concurrent.Executors.newFixedThreadPool(2);var gate=new java.util.concurrent.CountDownLatch(1);
      try {
        var results=new ArrayList<java.util.concurrent.Future<String>>();
        for(int i=0;i<2;i++)results.add(pool.submit(()->{gate.await();try{return wiki.start(owner,tenant,file.material(),request(file)).status();}catch(IdentityException e){return e.code;}}));
        gate.countDown();var values=new ArrayList<String>();for(var result:results)values.add(result.get(15,java.util.concurrent.TimeUnit.SECONDS));
        assertTrue(values.contains("QUEUED"));assertTrue(values.contains("WIKI_LEARNING_BUSY"));assertEquals(1,db.queryForObject("SELECT count(*) FROM wiki_learning_drafts WHERE tenant_id=?",Integer.class,tenant));
      }finally{pool.shutdownNow();}
    }

    @Test void uncertainResultMustBeReconciledBeforeNewLearning(){
      var file=upload(space,"待核对.txt","结果不确定不能自动重复调用");finish(file);var draft=wiki.start(owner,tenant,file.material(),request(file));
      db.update("UPDATE conversation_tasks SET status='RESULT_UNKNOWN',reconciliation_required=true WHERE id=?",draft.taskId());
      assertEquals("RESULT_UNKNOWN",wiki.detail(owner,tenant,draft.id()).status());
      denied(409,()->wiki.start(owner,tenant,file.material(),request(file)));
    }
}
