package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.knowledge.*;
import com.dreamcore.workspace.material.*;
import com.dreamcore.workspace.identity.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.net.*;
import java.net.http.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.*;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=verification","dreamcore.tasks.public-web-enabled=true","dreamcore.tasks.candidate-trials-enabled=true","dreamcore.tasks.initial-delay-ms=3600000","dreamcore.knowledge.enabled=true","dreamcore.knowledge.initial-delay-ms=3600000"})
class AgentIntegrationTest {
    @DynamicPropertySource static void paths(DynamicPropertyRegistry r){IsolatedTestDatabase.register(r);Path root=Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();String parser=root.resolve("workers/parser").toString();r.add("dreamcore.knowledge.parser-root",()->parser);}
    @Autowired AgentTaskService agents;@Autowired JdbcTemplate db;@Autowired ConversationService conversations;@Autowired KnowledgeService knowledge;@Autowired MaterialService materials;@Autowired DocumentParser parser;@Autowired PasswordEncoder passwords;
    @LocalServerPort int port;
    UUID tenant,other,owner,reader,admin,space,personal;
    @BeforeEach void fixture(){
        tenant=UUID.randomUUID();other=UUID.randomUUID();owner=UUID.randomUUID();reader=UUID.randomUUID();admin=UUID.randomUUID();space=UUID.randomUUID();personal=UUID.randomUUID();
        for(UUID id:List.of(owner,reader,admin))db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",id,id+"@example.test","合成会话测试",passwords.encode("synthetic-conversation-password"));
        db.update("INSERT INTO tenants(id,name) VALUES (?,'会话测试'),(?,'外部企业')",tenant,other);
        for(UUID id:List.of(owner,reader,admin))db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,id,id.equals(admin)?"TENANT_ADMIN":"MEMBER");
        db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'共享资料','SHARED'),(?,?,?,'个人资料','PERSONAL')",space,tenant,admin,personal,tenant,owner);
        db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true),(?,?,?,false)",tenant,space,owner,tenant,space,reader);
    }
    @AfterEach void cleanup(){db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);db.update("UPDATE knowledge_runs SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);}
    void denied(int status,Runnable action){assertEquals(status,assertThrows(IdentityException.class,action::run).status);}
    ConversationService.Detail send(UUID actor,UUID location){return conversations.submit(actor,tenant,null,location,UUID.randomUUID(),"梦核进度","AGENT");}
    ConversationService.Task task(ConversationService.Detail d){return d.tasks().getLast();}
    ConversationService.Detail detail(UUID id){return conversations.detail(owner,tenant,id,0,20);}
    TaskRuntime.Result result(ConversationService.Job job,List<UUID> sources){return new TaskRuntime.Result("1.0","local-test",job.id(),job.token(),"SOURCE_LOOKUP",sources.isEmpty()?"NO_SOURCES":"SOURCES_FOUND",sources);}
    UUID source(UUID location){
        materials.upload(owner,tenant,location,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","计划.md","text/plain","梦核进度：验证私人会话\n合成内容".getBytes(StandardCharsets.UTF_8)));
        var job=knowledge.claim();assertNotNull(job);var input=knowledge.input(job);knowledge.finish(job,new DocumentParser.Result("synthetic-fixture","READY",List.of(),List.of(new DocumentParser.Fragment("L1","梦核进度 amount=1001 amount=999","TEXT"))));return knowledge.search(owner,tenant,location,"梦核进度",0,10).items().getFirst().id();
    }
    AgentResult done(ConversationService.Job j,List<UUID> sources,List<AgentResult.Artifact> files){return new AgentResult("1.4","0.3.0",j.id(),j.token(),"AGENT","verification","local-verification","合成回复",sources,List.of(new AgentResult.Tool("search","search_sources","succeeded"),new AgentResult.Tool("code","run_javascript","succeeded")),files,3,new AgentResult.Usage(30,15),List.of(),List.of(),List.of());}
    AgentResult.Artifact file(){try{byte[] bytes="{\"totalCents\":\"2000\"}".getBytes(StandardCharsets.UTF_8);return new AgentResult.Artifact("summary.json",HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes)),Base64.getEncoder().encodeToString(bytes));}catch(Exception e){throw new RuntimeException(e);}}
    @Test void realGrantsFinishAndArtifactRemainPrivateAndRevocable(){
        UUID source=source(space);var d=send(owner,space);var j=conversations.claim();assertEquals("verification",agents.check(j.id(),j.token()).get("executionClass"));
        assertEquals(List.of(source),agents.search(j.id(),j.token(),"amount").stream().map(AgentTaskService.Input::id).toList());
        agents.finish(j,done(j,List.of(source),List.of(file())));var result=task(detail(d.conversation().id()));assertEquals("SUCCEEDED",result.status());assertEquals("合成回复",result.reply());assertEquals("verification",result.executionClass());
        UUID artifact=result.artifacts().getFirst().id();assertEquals(file().sha256(),agents.download(owner,tenant,d.conversation().id(),j.id(),artifact).sha256());
        denied(404,()->agents.download(reader,tenant,d.conversation().id(),j.id(),artifact));denied(404,()->agents.download(admin,tenant,d.conversation().id(),j.id(),artifact));denied(403,()->agents.download(owner,other,d.conversation().id(),j.id(),artifact));
        denied(403,()->agents.check(j.id(),j.token()));db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);denied(404,()->agents.download(owner,tenant,d.conversation().id(),j.id(),artifact));denied(404,()->detail(d.conversation().id()));
    }
    @Test void presentationIsOffByDefaultAndCannotBeRegisteredByTheEngine(){
        send(owner,personal);var j=conversations.claim();assertEquals("",agents.check(j.id(),j.token()).get("presentationRendererVersion"));
        denied(403,()->agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("render_presentation"))));
    }
    @Test void grantSearchCannotEscapeTaskSpaceEvenWhenOwnerHasOtherAccess(){
        source(space);var d=send(owner,personal);var j=conversations.claim();assertTrue(agents.search(j.id(),j.token(),"amount").isEmpty());assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_agent_grants WHERE task_id=?",Integer.class,j.id()));
    }
    @Test void invalidResultCannotPartiallyPublishArtifactsOrSources(){
        UUID source=source(personal);var d=send(owner,personal);var j=conversations.claim();agents.search(j.id(),j.token(),"amount");
        denied(502,()->agents.finish(j,done(j,List.of(UUID.randomUUID()),List.of(file()))));
        var bad=new AgentResult.Artifact("summary.json","0".repeat(64),file().contentBase64());denied(502,()->agents.finish(j,done(j,List.of(source),List.of(file(),bad))));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_artifacts WHERE task_id=?",Integer.class,j.id()));assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_sources WHERE task_id=?",Integer.class,j.id()));assertEquals("RUNNING",task(detail(d.conversation().id())).status());
    }
    @Test void cancelledAndExpiredCapabilitiesNeverContinueOrPublish(){
        var d=send(owner,personal);var old=conversations.claim();conversations.action(owner,tenant,d.conversation().id(),old.id(),UUID.randomUUID(),1,"CANCEL");assertFalse(agents.active(old));denied(403,()->agents.finish(old,done(old,List.of(),List.of())));
        conversations.action(owner,tenant,d.conversation().id(),old.id(),UUID.randomUUID(),2,"RETRY");var fresh=conversations.claim();assertNotEquals(old.token(),fresh.token());denied(403,()->agents.check(old.id(),old.token()));assertTrue(agents.active(fresh));
        db.update("UPDATE conversation_tasks SET lease_until=now()-interval '1 second' WHERE id=?",fresh.id());assertFalse(agents.active(fresh));denied(403,()->agents.search(fresh.id(),fresh.token(),"amount"));
    }
    @Test void tenantAndMembershipRevocationAreRecheckedBeforeEveryUse(){
        var d=send(owner,space);var j=conversations.claim();db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);denied(404,()->agents.check(j.id(),j.token()));assertFalse(agents.active(j));
        db.update("UPDATE tenants SET status='SUSPENDED' WHERE id=?",tenant);denied(403,()->agents.search(j.id(),j.token(),"amount"));assertEquals("RUNNING",db.queryForObject("SELECT status FROM conversation_tasks WHERE id=?",String.class,j.id()));
    }
    @Test void changedExecutionClassCannotBeRetriedAsAnotherMode(){
        var d=send(owner,personal);UUID id=task(d).id();conversations.action(owner,tenant,d.conversation().id(),id,UUID.randomUUID(),0,"CANCEL");db.update("UPDATE conversation_tasks SET execution_class='live' WHERE id=?",id);denied(409,()->conversations.action(owner,tenant,d.conversation().id(),id,UUID.randomUUID(),1,"RETRY"));
    }
    @Test void callbackRequiresExactActiveCapabilityAndNeverUserSuppliedIdentity() throws Exception {
        var d=send(owner,personal);var j=conversations.claim();var http=HttpClient.newHttpClient();String path="http://127.0.0.1:"+port+"/internal/v1/agent-access/"+j.id()+"/check";
        for(String token:List.of("",UUID.randomUUID().toString(),j.token().toString())){var b=HttpRequest.newBuilder(URI.create(path)).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString("{}"));if(!token.isEmpty())b.header("Authorization","Bearer "+token);var r=http.send(b.build(),HttpResponse.BodyHandlers.ofString());assertEquals(token.equals(j.token().toString())?200:403,r.statusCode());if(r.statusCode()==200)assertTrue(r.headers().firstValue("cache-control").orElseThrow().contains("no-store"));}
        var body="{\"query\":\"amount\",\"tenantId\":\""+other+"\"}";var r=http.send(HttpRequest.newBuilder(URI.create(path.replace("/check","/search"))).header("Authorization","Bearer "+j.token()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString());assertEquals(400,r.statusCode());
        assertFalse(new JsonMapper().writeValueAsString(detail(d.conversation().id())).contains(j.token().toString()));
    }
    @Test void leaseExpiringDuringRowLockWaitCannotAuthorizeAfterRelease() throws Exception {
        send(owner,personal);var j=conversations.claim();
        db.update("UPDATE conversation_tasks SET lease_until=clock_timestamp()+interval '1 second' WHERE id=?",j.id());
        try(var lock=db.getDataSource().getConnection();var pool=Executors.newSingleThreadExecutor()){
            lock.setAutoCommit(false);try(var statement=lock.prepareStatement("SELECT id FROM conversation_tasks WHERE id=? FOR UPDATE")){statement.setObject(1,j.id());statement.executeQuery().close();}
            var check=pool.submit(()->agents.check(j.id(),j.token()));
            try {
                long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);boolean waiting=false;
                while(System.nanoTime()<deadline){waiting=db.queryForObject("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%conversation_tasks%FOR UPDATE%')",Boolean.class);if(waiting)break;Thread.sleep(10);}
                assertTrue(waiting,"authorization must actually wait on the task row");
                Thread.sleep(1100);
            } finally {lock.rollback();}
            var error=assertThrows(ExecutionException.class,()->check.get(3,TimeUnit.SECONDS));assertInstanceOf(IdentityException.class,error.getCause());assertEquals(403,((IdentityException)error.getCause()).status);
        }
    }

    AgentResult research(ConversationService.Job j,List<AgentResult.WebSource> sources,List<AgentResult.Skill> skills){
        return new AgentResult("1.4","0.4.0",j.id(),j.token(),"AGENT","verification","local-verification","研究结果",List.of(),List.of(new AgentResult.Tool("activate","activate_skill","succeeded"),new AgentResult.Tool("search","public_search","succeeded"),new AgentResult.Tool("read","read_public_page","succeeded")),List.of(),4,null,sources,skills,List.of());
    }
    AgentResult.WebSource webSource(String url,String hash){return new AgentResult.WebSource(UUID.randomUUID(),url,"公开来源","合成网页",hash,java.time.Instant.now(),"PAGE",false);}
    @Test void publicQueryIsExplicitImmutableAndIncludedInIdempotency(){
        UUID key=UUID.randomUUID();var d=conversations.submit(owner,tenant,null,personal,key,"私有要求","AGENT","公开主题");
        assertEquals("公开主题",task(d).publicQuery());assertTrue(conversations.list(owner,tenant,0,20).publicWebEnabled());
        assertEquals(d.conversation().id(),conversations.submit(owner,tenant,null,personal,key,"私有要求","AGENT","公开主题").conversation().id());
        denied(409,()->conversations.submit(owner,tenant,null,personal,key,"私有要求","AGENT","另一个主题"));
        denied(400,()->conversations.submit(owner,tenant,null,personal,UUID.randomUUID(),"x","SOURCE_LOOKUP","公开主题"));
        denied(400,()->conversations.submit(owner,tenant,null,personal,UUID.randomUUID(),"x","AGENT","x".repeat(201)));
        var j=conversations.claim();assertEquals("公开主题",agents.check(j.id(),j.token()).get("publicQuery"));
        var longUrl="HTTPS://example.com/"+"a".repeat(300);var urlTask=conversations.submit(owner,tenant,null,personal,UUID.randomUUID(),"阅读网址","AGENT",longUrl);assertEquals(longUrl,task(urlTask).publicQuery());
    }
    @Test void publicSnapshotsAreTransactionalPrivateAndRevocable(){
        var d=conversations.submit(owner,tenant,null,space,UUID.randomUUID(),"研究","AGENT","公开主题");var j=conversations.claim();
        var source=webSource("https://example.com/article",IdentityService.hash("合成网页"));var skill=new AgentResult.Skill("public-research","1.1.0","0".repeat(64));
        denied(502,()->agents.finish(j,research(j,List.of(webSource("https://example.com/","bad")),List.of(skill))));
        denied(502,()->agents.finish(j,research(j,List.of(webSource("javascript:alert(1)",IdentityService.hash("合成网页"))),List.of(skill))));
        denied(502,()->agents.finish(j,research(j,List.of(source),List.of())));
        assertTrue(task(detail(d.conversation().id())).webSources().isEmpty());
        agents.finish(j,research(j,List.of(source),List.of(skill)));var saved=task(detail(d.conversation().id()));assertEquals("SUCCEEDED",saved.status());assertEquals(source,saved.webSources().getFirst());assertEquals(skill,saved.skills().getFirst());
        denied(404,()->conversations.detail(reader,tenant,d.conversation().id(),0,20));denied(404,()->conversations.detail(admin,tenant,d.conversation().id(),0,20));
        db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);denied(404,()->detail(d.conversation().id()));
    }
    @Test void webReceiptsWithoutUserQueryCannotPublish(){
        var d=send(owner,personal);var j=conversations.claim();assertEquals("",agents.check(j.id(),j.token()).get("publicQuery"));
        denied(502,()->agents.finish(j,research(j,List.of(),List.of(new AgentResult.Skill("public-research","1.0.0","0".repeat(64))))));
        assertEquals("RUNNING",task(detail(d.conversation().id())).status());
    }
    @Test void publicQueryCannotCollideWithPromptSuffixForSameRequestId(){
        UUID key=UUID.randomUUID();conversations.submit(owner,tenant,null,personal,key,"hello\npublic:x","AGENT");
        denied(409,()->conversations.submit(owner,tenant,null,personal,key,"hello","AGENT","x"));
    }


    AgentResult candidateResult(ConversationService.Job j,boolean guide){return new AgentResult("1.4","0.5.0",j.id(),j.token(),"AGENT","verification","local-verification","候选试验",List.of(),List.of(new AgentResult.Tool("activate","activate_skill","succeeded"),new AgentResult.Tool("trial","candidate_tool","succeeded")),List.of(file()),3,null,List.of(),guide?List.of(new AgentResult.Skill("candidate-trials","1.0.0","0".repeat(64))):List.of(),List.of());}
    @Test void candidateReceiptsRequireExplicitQueryAndActivatedGuide(){
        var absent=send(owner,personal);var first=conversations.claim();assertEquals(false,agents.check(first.id(),first.token()).get("candidateTrialsAllowed"));
        denied(502,()->agents.finish(first,candidateResult(first,true)));
        conversations.action(owner,tenant,absent.conversation().id(),first.id(),UUID.randomUUID(),1,"CANCEL");
        var d=conversations.submit(owner,tenant,null,personal,UUID.randomUUID(),"试验","AGENT","ini");var j=conversations.claim();
        assertEquals(true,agents.check(j.id(),j.token()).get("candidateTrialsAllowed"));
        denied(502,()->agents.finish(j,candidateResult(j,false)));
        assertTrue(task(detail(d.conversation().id())).artifacts().isEmpty());
        agents.finish(j,candidateResult(j,true));var saved=task(detail(d.conversation().id()));assertEquals("SUCCEEDED",saved.status());
        denied(404,()->agents.download(admin,tenant,d.conversation().id(),j.id(),saved.artifacts().getFirst().id()));
    }
    @Test void candidateSwitchCannotEnableLiveOrNonPublicExecution(){
        for(String mode:List.of("off","live"))assertThrows(IllegalArgumentException.class,()->new AgentSettings(mode,true,true));
        assertThrows(IllegalArgumentException.class,()->new AgentSettings("verification",false,true));
        assertFalse(new AgentSettings("verification",true,false).candidateTrialsEnabled());
    }

    TaskOriginals.Selection original(UUID location,String name,byte[] bytes){
        var doc=materials.upload(owner,tenant,location,null,null,null,UUID.randomUUID(),new MockMultipartFile("file",name,"application/octet-stream",bytes));
        return new TaskOriginals.Selection(doc.id(),materials.detail(owner,tenant,location,doc.id(),0,20).versions().getFirst().id());
    }
    ConversationService.Detail sendOriginal(UUID actor,UUID location,UUID key,List<TaskOriginals.Selection> files){return conversations.submit(actor,tenant,null,location,key,"处理指定原件","AGENT",null,files);}
    AgentResult originalResult(ConversationService.Job j,List<UUID> ids){return new AgentResult("1.4","0.7.0",j.id(),j.token(),"AGENT","verification","local-verification","合成原件结果",List.of(),List.of(new AgentResult.Tool("load","read_original","succeeded"),new AgentResult.Tool("code","run_javascript","succeeded")),List.of(file()),3,null,List.of(),List.of(),ids);}
    @Test void originalVersionPinnedAcrossNewUploadsCancellationAndRetry(){
        var selected=original(personal,"数据.bin",new byte[]{0,1,2,(byte)255});UUID key=UUID.randomUUID();
        var d=sendOriginal(owner,personal,key,List.of(selected));assertFalse(task(d).originals().getFirst().read());
        assertEquals(d.conversation().id(),sendOriginal(owner,personal,key,List.of(selected)).conversation().id());
        materials.upload(owner,tenant,personal,null,selected.materialId(),1,UUID.randomUUID(),new MockMultipartFile("file","新数据.bin","application/octet-stream",new byte[]{9}));
        var newer=new TaskOriginals.Selection(selected.materialId(),materials.detail(owner,tenant,personal,selected.materialId(),0,20).versions().getFirst().id());
        denied(409,()->sendOriginal(owner,personal,key,List.of(newer)));
        var j=conversations.claim();assertEquals(1,agents.originals(j.id(),j.token()).getFirst().version());
        assertArrayEquals(new byte[]{0,1,2,(byte)255},Base64.getDecoder().decode(agents.readOriginal(j.id(),j.token(),selected.versionId()).contentBase64()));
        assertTrue(task(detail(d.conversation().id())).originals().getFirst().read());
        conversations.action(owner,tenant,d.conversation().id(),j.id(),UUID.randomUUID(),1,"CANCEL");
        denied(403,()->agents.readOriginal(j.id(),j.token(),selected.versionId()));
        conversations.action(owner,tenant,d.conversation().id(),j.id(),UUID.randomUUID(),2,"RETRY");assertFalse(task(detail(d.conversation().id())).originals().getFirst().read());var fresh=conversations.claim();
        assertFalse(agents.originals(fresh.id(),fresh.token()).getFirst().read());
        denied(403,()->agents.readOriginal(j.id(),j.token(),selected.versionId()));
        assertArrayEquals(new byte[]{0,1,2,(byte)255},Base64.getDecoder().decode(agents.readOriginal(fresh.id(),fresh.token(),selected.versionId()).contentBase64()));
        assertEquals(2,db.queryForObject("SELECT count(*) FROM conversation_original_reads WHERE task_id=?",Integer.class,j.id()));
    }
    @Test void onlyExplicitOriginalSelectionWithinTaskScopeCanBeRead(){
        var chosen=original(personal,"chosen.txt",new byte[]{1});var otherFile=original(personal,"other.txt",new byte[]{2});var shared=original(space,"shared.txt",new byte[]{3});
        var d=sendOriginal(owner,personal,UUID.randomUUID(),List.of(chosen));var j=conversations.claim();
        for(UUID id:List.of(otherFile.versionId(),shared.versionId(),UUID.randomUUID()))denied(403,()->agents.readOriginal(j.id(),j.token(),id));
        denied(404,()->sendOriginal(owner,personal,UUID.randomUUID(),List.of(shared)));
        denied(404,()->sendOriginal(owner,space,UUID.randomUUID(),List.of(chosen)));
        denied(404,()->sendOriginal(owner,personal,UUID.randomUUID(),List.of(new TaskOriginals.Selection(otherFile.materialId(),chosen.versionId()))));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_original_reads WHERE task_id=?",Integer.class,j.id()));
        assertFalse(new JsonMapper().writeValueAsString(detail(d.conversation().id())).contains("object_id"));
    }
    @Test void originalGrantsUseReadPermissionAndResultReceiptsCannotBeInvented(){
        var selected=original(space,"readonly.bin",new byte[]{0,1});var d=sendOriginal(reader,space,UUID.randomUUID(),List.of(selected));var j=conversations.claim();
        denied(502,()->agents.finish(j,originalResult(j,List.of(selected.versionId()))));
        agents.readOriginal(j.id(),j.token(),selected.versionId());agents.readOriginal(j.id(),j.token(),selected.versionId());
        assertEquals(1,db.queryForObject("SELECT count(*) FROM conversation_original_reads WHERE task_id=?",Integer.class,j.id()));
        denied(502,()->agents.finish(j,originalResult(j,List.of())));
        denied(502,()->agents.finish(j,originalResult(j,List.of(UUID.randomUUID()))));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_artifacts WHERE task_id=?",Integer.class,j.id()));
        agents.finish(j,originalResult(j,List.of(selected.versionId())));
        var result=task(conversations.detail(reader,tenant,d.conversation().id(),0,20));assertTrue(result.originals().getFirst().read());
        var artifact=result.artifacts().getFirst().id();assertNotNull(agents.download(reader,tenant,d.conversation().id(),j.id(),artifact));
        denied(404,()->agents.download(owner,tenant,d.conversation().id(),j.id(),artifact));denied(404,()->agents.download(admin,tenant,d.conversation().id(),j.id(),artifact));
        db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,reader);
        denied(404,()->agents.download(reader,tenant,d.conversation().id(),j.id(),artifact));
        denied(404,()->conversations.detail(reader,tenant,d.conversation().id(),0,20));
    }
    @Test void originalSelectionLimitsFailAtomicallyAndLocalLookupCannotLoadFiles(){
        var small=original(personal,"small.txt",new byte[]{1});var big=original(personal,"big.bin",new byte[262145]);
        int before=db.queryForObject("SELECT count(*) FROM conversation_tasks WHERE tenant_id=?",Integer.class,tenant);
        denied(413,()->sendOriginal(owner,personal,UUID.randomUUID(),List.of(big)));
        denied(400,()->sendOriginal(owner,personal,UUID.randomUUID(),List.of(small,small)));
        denied(403,()->conversations.submit(owner,tenant,null,personal,UUID.randomUUID(),"x","SOURCE_LOOKUP",null,List.of(small)));
        var a=original(personal,"a.bin",new byte[262144]);var b=original(personal,"b.bin",new byte[262144]);
        denied(413,()->sendOriginal(owner,personal,UUID.randomUUID(),List.of(a,b,small)));
        assertEquals(before,db.queryForObject("SELECT count(*) FROM conversation_tasks WHERE tenant_id=?",Integer.class,tenant));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_originals WHERE tenant_id=?",Integer.class,tenant));
    }
    @Test void originalCallbackIsAttemptBoundedNoStoreAndRejectsForgedParameters() throws Exception {
        var selected=original(personal,"raw.bin",new byte[]{0,1});sendOriginal(owner,personal,UUID.randomUUID(),List.of(selected));var j=conversations.claim();
        var http=HttpClient.newHttpClient();String path="http://127.0.0.1:"+port+"/internal/v1/agent-access/"+j.id()+"/read-original";
        for(UUID token:List.of(UUID.randomUUID(),j.token())){
            var request=HttpRequest.newBuilder(URI.create(path)).header("Authorization","Bearer "+token).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(new JsonMapper().writeValueAsString(Map.of("versionId",selected.versionId())))).build();
            var response=http.send(request,HttpResponse.BodyHandlers.ofString());assertEquals(token.equals(j.token())?200:403,response.statusCode());
            if(response.statusCode()==200)assertTrue(response.headers().firstValue("cache-control").orElseThrow().contains("no-store"));
        }
        var forged=HttpRequest.newBuilder(URI.create(path)).header("Authorization","Bearer "+j.token()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(new JsonMapper().writeValueAsString(Map.of("versionId",selected.versionId(),"path","/etc/private")))).build();
        assertEquals(400,http.send(forged,HttpResponse.BodyHandlers.ofString()).statusCode());
        db.update("UPDATE tenants SET status='SUSPENDED' WHERE id=?",tenant);assertFalse(agents.active(j));denied(403,()->agents.readOriginal(j.id(),j.token(),selected.versionId()));
    }

    @Test void selectedOriginalAlsoNarrowsExcerptSearchToItsExactHistoricalVersion(){
        var old=original(personal,"scoped.md","amount=1".getBytes(StandardCharsets.UTF_8));
        var parse=knowledge.claim();knowledge.finish(parse,new DocumentParser.Result("fixture","READY",List.of(),List.of(new DocumentParser.Fragment("L1","amount=1","TEXT"))));
        materials.upload(owner,tenant,personal,null,old.materialId(),1,UUID.randomUUID(),new MockMultipartFile("file","scoped.md","text/plain","amount=999".getBytes(StandardCharsets.UTF_8)));
        parse=knowledge.claim();knowledge.finish(parse,new DocumentParser.Result("fixture","READY",List.of(),List.of(new DocumentParser.Fragment("L1","amount=999","TEXT"))));
        original(personal,"unselected.md","amount=444".getBytes(StandardCharsets.UTF_8));
        parse=knowledge.claim();knowledge.finish(parse,new DocumentParser.Result("fixture","READY",List.of(),List.of(new DocumentParser.Fragment("L1","amount=444","TEXT"))));
        assertEquals(2,knowledge.search(owner,tenant,personal,"amount",0,10).items().size());
        assertEquals("amount=1",knowledge.search(owner,tenant,personal,"amount",0,10,List.of(old.versionId())).items().getFirst().content());
        sendOriginal(owner,personal,UUID.randomUUID(),List.of(old));var job=conversations.claim();
        var items=agents.search(job.id(),job.token(),"amount");assertEquals(1,items.size());assertEquals(1,items.getFirst().version());assertEquals("amount=1",items.getFirst().content());
        assertTrue(agents.active(job));
    }

    AgentResult recipeResult(ConversationService.Job j,UUID version,boolean guide){return new AgentResult("1.4","0.8.0",j.id(),j.token(),"AGENT","verification","local-verification","配方结果",List.of(),List.of(new AgentResult.Tool("guide","activate_skill","succeeded"),new AgentResult.Tool("read","read_original","succeeded"),new AgentResult.Tool("recipe","process_original","succeeded")),List.of(file()),4,null,List.of(),guide?List.of(new AgentResult.Skill("file-processing","1.0.0","0".repeat(64))):List.of(),List.of(version));}
    @Test void recipeResultsRequireActualOriginalReadAndActivatedCapability(){
        var selected=original(personal,"table.csv","amount\n0.1".getBytes(StandardCharsets.UTF_8));
        var d=sendOriginal(owner,personal,UUID.randomUUID(),List.of(selected));var j=conversations.claim();
        denied(502,()->agents.finish(j,recipeResult(j,selected.versionId(),true)));
        agents.readOriginal(j.id(),j.token(),selected.versionId());
        denied(502,()->agents.finish(j,recipeResult(j,selected.versionId(),false)));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_artifacts WHERE task_id=?",Integer.class,j.id()));
        agents.finish(j,recipeResult(j,selected.versionId(),true));var saved=task(detail(d.conversation().id()));
        assertEquals("SUCCEEDED",saved.status());assertEquals("file-processing",saved.skills().getFirst().id());
        denied(404,()->agents.download(admin,tenant,d.conversation().id(),j.id(),saved.artifacts().getFirst().id()));
    }
    @Test void recipeFailureCodesPersistWithoutSuccessfulArtifacts(){
        for(String suffix:List.of("UNSUPPORTED","ENCODING","INVALID","LIMIT","DATA")){
            var d=send(owner,personal);var j=conversations.claim();conversations.fail(j,"TASK_FILE_"+suffix);
            var result=task(detail(d.conversation().id()));assertEquals("FAILED",result.status());assertEquals("TASK_FILE_"+suffix,result.errorCode());assertTrue(result.artifacts().isEmpty());
        }
    }

}
