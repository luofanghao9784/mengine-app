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

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.initial-delay-ms=3600000","dreamcore.knowledge.enabled=true","dreamcore.knowledge.initial-delay-ms=3600000"})
class ConversationIntegrationTest {
    @DynamicPropertySource static void paths(DynamicPropertyRegistry r){Path root=Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();String parser=root.resolve("workers/parser").toString();r.add("dreamcore.knowledge.parser-root",()->parser);}
    @Autowired ConversationManagement management;@Autowired JdbcTemplate db;@Autowired ConversationService conversations;@Autowired KnowledgeService knowledge;@Autowired MaterialService materials;@Autowired DocumentParser parser;@Autowired PasswordEncoder passwords;
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
    ConversationService.Detail send(UUID actor,UUID location){return conversations.submit(actor,tenant,null,location,UUID.randomUUID(),"梦核进度","SOURCE_LOOKUP");}
    ConversationService.Task task(ConversationService.Detail d){return d.tasks().getLast();}
    ConversationService.Detail detail(UUID id){return conversations.detail(owner,tenant,id,0,20);}
    TaskRuntime.Result result(ConversationService.Job job,List<UUID> sources){return new TaskRuntime.Result("1.0","local-test",job.id(),job.token(),"SOURCE_LOOKUP",sources.isEmpty()?"NO_SOURCES":"SOURCES_FOUND",sources);}
    UUID source(UUID location){
        materials.upload(owner,tenant,location,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","计划.md","text/plain","梦核进度：验证私人会话\n合成内容".getBytes(StandardCharsets.UTF_8)));
        var job=knowledge.claim();assertNotNull(job);var input=knowledge.input(job);knowledge.finish(job,parser.parse(input.filename(),input.bytes()));return knowledge.search(owner,tenant,location,"梦核进度",0,10).items().getFirst().id();
    }
    @Test void sourceLookupCompletesAndHistoryPreservesVersionAndOrderedEvents(){
        UUID citation=source(personal);var first=send(owner,personal);UUID id=first.conversation().id();assertEquals("QUEUED",task(first).status());
        var job=conversations.claim();assertEquals(List.of(citation),conversations.sources(job));conversations.finish(job,result(job,List.of(citation)));conversations.finish(job,result(job,List.of(citation)));
        var done=detail(id);assertEquals("SUCCEEDED",task(done).status());assertEquals("计划.md",task(done).sources().getFirst().filename());assertEquals(1,task(done).sources().size());
        var events=conversations.events(owner,tenant,id,0);assertEquals(List.of("QUEUED","RUNNING","SUCCEEDED"),events.items().stream().map(ConversationService.Event::kind).toList());assertTrue(conversations.events(owner,tenant,id,events.cursor()).items().isEmpty());assertEquals(events.cursor(),done.cursor());
    }
    @Test void sharedReadAccessAllowsTasksButNeverSharesConversationWithColleagueOrAdmin(){
        var d=send(reader,space);UUID id=d.conversation().id();assertEquals(1,conversations.list(reader,tenant,0,20).items().size());assertTrue(conversations.list(owner,tenant,0,20).items().isEmpty());
        denied(404,()->conversations.detail(owner,tenant,id,0,20));denied(404,()->conversations.events(admin,tenant,id,0));denied(404,()->conversations.action(owner,tenant,id,task(d).id(),UUID.randomUUID(),0,"CANCEL"));denied(403,()->conversations.detail(reader,other,id,0,20));denied(404,()->send(reader,personal));denied(404,()->send(admin,space));
    }
    @Test void sendingWithSameKeyIsIdempotentAndOnlyOneTaskRunsPerConversation(){
        UUID key=UUID.randomUUID();var one=conversations.submit(owner,tenant,null,personal,key,"梦核进度","SOURCE_LOOKUP");var two=conversations.submit(owner,tenant,null,personal,key,"梦核进度","SOURCE_LOOKUP");assertEquals(one,two);
        denied(409,()->conversations.submit(owner,tenant,null,personal,key,"别的内容","SOURCE_LOOKUP"));
        denied(409,()->conversations.submit(owner,tenant,one.conversation().id(),personal,UUID.randomUUID(),"另一次","SOURCE_LOOKUP"));
        assertEquals(1,db.queryForObject("SELECT count(*) FROM conversation_tasks WHERE tenant_id=?",Integer.class,tenant));
    }
    @Test void concurrentSameKeyHasOneConversationAndTask() throws Exception {
        UUID key=UUID.randomUUID();try(var pool=Executors.newFixedThreadPool(2)){var start=new CountDownLatch(1);Callable<ConversationService.Detail> work=()->{start.await();return conversations.submit(owner,tenant,null,personal,key,"并发关键词","SOURCE_LOOKUP");};var a=pool.submit(work);var b=pool.submit(work);start.countDown();assertEquals(a.get(10,TimeUnit.SECONDS),b.get(10,TimeUnit.SECONDS));}
        assertEquals(1,db.queryForObject("SELECT count(*) FROM conversations WHERE tenant_id=?",Integer.class,tenant));
    }
    @Test void cancelRunningFencesLateResultAndExplicitRetryUsesNewAttempt(){
        var d=send(owner,personal);UUID c=d.conversation().id();var first=conversations.claim();UUID key=UUID.randomUUID();var cancelled=conversations.action(owner,tenant,c,first.id(),key,1,"CANCEL");assertEquals("CANCELLED",task(cancelled).status());
        conversations.finish(first,result(first,List.of()));conversations.fail(first,"TASK_RUNTIME_UNAVAILABLE");assertEquals("CANCELLED",task(detail(c)).status());assertEquals(cancelled,conversations.action(owner,tenant,c,first.id(),key,1,"CANCEL"));
        denied(409,()->conversations.action(owner,tenant,c,first.id(),UUID.randomUUID(),1,"RETRY"));
        var retried=conversations.action(owner,tenant,c,first.id(),UUID.randomUUID(),2,"RETRY");assertEquals("QUEUED",task(retried).status());var second=conversations.claim();assertNotEquals(first.token(),second.token());conversations.finish(first,result(first,List.of()));assertEquals("RUNNING",task(detail(c)).status());conversations.finish(second,result(second,List.of()));assertEquals(2,task(detail(c)).attempt());
    }
    @Test void queuedCancellationAndExpiredLeaseNeverAutoReplay(){
        var d=send(owner,personal);UUID c=d.conversation().id();conversations.action(owner,tenant,c,task(d).id(),UUID.randomUUID(),0,"CANCEL");assertNull(conversations.claim());
        conversations.action(owner,tenant,c,task(d).id(),UUID.randomUUID(),1,"RETRY");var job=conversations.claim();db.update("UPDATE conversation_tasks SET lease_until=now()-interval '1 second' WHERE id=?",job.id());conversations.fail(job,"TASK_RUNTIME_UNAVAILABLE");assertEquals("RUNNING",task(detail(c)).status());assertNull(conversations.claim());assertEquals("INTERRUPTED",task(detail(c)).status());conversations.finish(job,result(job,List.of()));assertEquals("INTERRUPTED",task(detail(c)).status());
    }
    @Test void revokeWhileRunningPreventsResultAndHidesTitleHistoryAndEvents(){
        UUID source=source(space);var d=send(owner,space);var job=conversations.claim();assertEquals(List.of(source),conversations.sources(job));db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);
        denied(404,()->conversations.finish(job,result(job,List.of(source))));conversations.fail(job,"TASK_SOURCE_UNAVAILABLE");assertTrue(conversations.list(owner,tenant,0,20).items().isEmpty());denied(404,()->detail(d.conversation().id()));denied(404,()->conversations.events(owner,tenant,d.conversation().id(),0));assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_sources WHERE task_id=?",Integer.class,job.id()));
    }
    @Test void completedCitationsRemainSubjectToCurrentPermissions(){
        UUID source=source(space);var d=send(owner,space);var job=conversations.claim();conversations.finish(job,result(job,List.of(source)));assertEquals(1,task(detail(d.conversation().id())).sources().size());db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);denied(404,()->detail(d.conversation().id()));
    }
    @Test void suspendedTenantOrDisabledAccountStopsExecutionAndHistory(){
        var d=send(owner,personal);var job=conversations.claim();db.update("UPDATE tenants SET status='SUSPENDED' WHERE id=?",tenant);denied(403,()->conversations.sources(job));denied(403,()->detail(d.conversation().id()));db.update("UPDATE tenants SET status='ACTIVE' WHERE id=?",tenant);db.update("UPDATE accounts SET status='DISABLED' WHERE id=?",owner);denied(401,()->conversations.sources(job));denied(401,()->detail(d.conversation().id()));
    }
    @Test void staleOrCrossSpaceEngineResultsCannotPublish(){
        UUID wrongSource=source(space);var d=send(owner,personal);var job=conversations.claim();denied(403,()->conversations.finish(job,result(job,List.of(wrongSource))));
        denied(502,()->conversations.finish(job,new TaskRuntime.Result("1.0","test",UUID.randomUUID(),job.token(),"SOURCE_LOOKUP","NO_SOURCES",List.of())));assertEquals("RUNNING",task(detail(d.conversation().id())).status());assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_sources WHERE task_id=?",Integer.class,job.id()));
    }
    @Test void defaultConfigurationSavesWaitingAgentWithoutInventingReply(){var d=conversations.submit(owner,tenant,null,personal,UUID.randomUUID(),"hello","AGENT");assertEquals("WAITING_CAPABILITY",task(d).status());assertNull(task(d).reply());assertNull(task(d).executionClass());assertNull(conversations.claim());assertEquals(0,task(d).attempt());var paused=conversations.action(owner,tenant,d.conversation().id(),task(d).id(),UUID.randomUUID(),0,"PAUSE");assertEquals("PAUSED",task(paused).status());var resumed=conversations.action(owner,tenant,d.conversation().id(),task(d).id(),UUID.randomUUID(),1,"RESUME");assertEquals("WAITING_CAPABILITY",task(resumed).status());assertEquals(0,task(resumed).attempt());assertNull(conversations.claim());conversations.action(owner,tenant,d.conversation().id(),task(d).id(),UUID.randomUUID(),2,"CANCEL");assertEquals("CANCELLED",task(detail(d.conversation().id())).status());}
    @Test void invalidModeAndQueriesAreNotPretendedToBeAiReplies(){
        for(String prompt:List.of(""," ","a b c d e f g h i","x".repeat(201)))denied(400,()->conversations.submit(owner,tenant,null,personal,UUID.randomUUID(),prompt,"SOURCE_LOOKUP"));denied(400,()->conversations.submit(owner,tenant,null,personal,UUID.randomUUID(),"hello","AI_CHAT"));assertTrue(conversations.list(owner,tenant,0,20).items().isEmpty());
    }
    @Test void httpRequiresSessionCsrfAndPrivateNoStore() throws Exception {
        var d=send(owner,personal);String root="http://127.0.0.1:"+port,path="/api/v1/tenants/"+tenant+"/conversations/"+d.conversation().id();var http=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();var json=new JsonMapper();assertEquals(401,http.send(HttpRequest.newBuilder(URI.create(root+path)).GET().build(),HttpResponse.BodyHandlers.ofString()).statusCode());
        var csrf=json.readTree(http.send(HttpRequest.newBuilder(URI.create(root+"/api/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());
        assertEquals(200,http.send(HttpRequest.newBuilder(URI.create(root+"/api/v1/auth/login")).header(csrf.get("headerName").asString(),csrf.get("token").asString()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("email",owner+"@example.test","password","synthetic-conversation-password")))).build(),HttpResponse.BodyHandlers.ofString()).statusCode());
        var read=http.send(HttpRequest.newBuilder(URI.create(root+path)).GET().build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,read.statusCode());assertTrue(read.headers().firstValue("cache-control").orElseThrow().contains("no-store"));assertTrue(read.body().contains("SOURCE_LOOKUP"));
        assertEquals(403,http.send(HttpRequest.newBuilder(URI.create(root+path+"/tasks")).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString("{}")).build(),HttpResponse.BodyHandlers.ofString()).statusCode());
        String body=json.writeValueAsString(Map.of("requestId",UUID.randomUUID(),"expectedRevision",0,"action","TRASH","stopRunning",true));
        assertEquals(403,http.send(HttpRequest.newBuilder(URI.create(root+path+"/management")).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString()).statusCode());
        csrf=json.readTree(http.send(HttpRequest.newBuilder(URI.create(root+"/api/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());
        assertEquals(200,http.send(HttpRequest.newBuilder(URI.create(root+path+"/management")).header(csrf.get("headerName").asString(),csrf.get("token").asString()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(body)).build(),HttpResponse.BodyHandlers.ofString()).statusCode());
        assertEquals(404,http.send(HttpRequest.newBuilder(URI.create(root+path)).GET().build(),HttpResponse.BodyHandlers.ofString()).statusCode());
        var trash=http.send(HttpRequest.newBuilder(URI.create(root+"/api/v1/tenants/"+tenant+"/conversations/trash")).GET().build(),HttpResponse.BodyHandlers.ofString());
        assertEquals(200,trash.statusCode());assertTrue(trash.body().contains(d.conversation().id().toString()));assertTrue(trash.headers().firstValue("cache-control").orElseThrow().contains("no-store"));

    }
    @Test void defaultPlatformDoesNotExposePublicWebOrAcceptExternalQuery(){
        assertFalse(conversations.list(owner,tenant,0,20).publicWebEnabled());
        denied(403,()->conversations.submit(owner,tenant,null,personal,UUID.randomUUID(),"研究","AGENT","公开主题"));
    }

    @Test void unreadTracksNewAcceptedRepliesAndReadReceiptsAreMonotonic() {
        var d=send(owner,personal);UUID id=d.conversation().id(),task=task(d).id();
        assertTrue(detail(id).conversation().running());assertFalse(detail(id).conversation().unread());
        db.update("UPDATE conversations SET title='仅更新标题' WHERE id=?",id);
        assertFalse(detail(id).conversation().unread());
        db.update("UPDATE conversation_tasks SET status='SUCCEEDED',reply='合成第一回复',attempt=1 WHERE id=?",task);
        assertTrue(detail(id).conversation().unread());assertFalse(detail(id).conversation().running());
        assertEquals(1,detail(id).conversation().replyRevision());
        db.update("UPDATE conversation_tasks SET status='SUCCEEDED',reply='合成第一回复' WHERE id=?",task);
        assertEquals(1,detail(id).conversation().replyRevision());
        denied(404,()->management.read(reader,tenant,id,1));denied(404,()->management.read(admin,tenant,id,1));
        denied(409,()->management.read(owner,tenant,id,2));
        management.read(owner,tenant,id,1);assertFalse(detail(id).conversation().unread());
        db.update("UPDATE conversation_tasks SET reply='合成第二回复' WHERE id=?",task);
        management.read(owner,tenant,id,1);assertTrue(detail(id).conversation().unread());
        assertEquals(2,management.read(owner,tenant,id,2).readReplyRevision());
        assertEquals(2,management.read(owner,tenant,id,0).readReplyRevision());assertFalse(detail(id).conversation().unread());
    }
    @Test void trashStopsRunningFencesLateWritesAndRestoreDoesNotRestart() {
        var d=send(owner,personal);UUID id=d.conversation().id();var job=conversations.claim();assertNotNull(job);
        denied(409,()->management.action(owner,tenant,id,UUID.randomUUID(),0,"TRASH",false));
        assertEquals("RUNNING",task(detail(id)).status());
        var removed=management.action(owner,tenant,id,UUID.randomUUID(),0,"TRASH",true);
        assertNotNull(removed.trashedAt());assertEquals(1,removed.revision());
        assertTrue(conversations.list(owner,tenant,0,20).items().isEmpty());
        assertEquals(1,conversations.list(owner,tenant,0,20,true).items().size());
        denied(404,()->detail(id));denied(404,()->conversations.events(owner,tenant,id,0));
        denied(404,()->conversations.finish(job,result(job,List.of())));
        denied(404,()->conversations.submit(owner,tenant,id,personal,UUID.randomUUID(),"新任务","SOURCE_LOOKUP"));
        management.action(owner,tenant,id,UUID.randomUUID(),1,"RESTORE",false);
        assertEquals("CANCELLED",task(detail(id)).status());assertNull(conversations.claim());
        conversations.finish(job,result(job,List.of()));assertEquals("CANCELLED",task(detail(id)).status());
        assertTrue(conversations.list(owner,tenant,0,20,true).items().isEmpty());assertFalse(detail(id).conversation().running());
    }
    @Test void trashRestoreAreOwnerOnlyAndOldIdempotentDeleteNeverDeletesRestoredHistory() {
        var d=send(owner,personal);UUID id=d.conversation().id(),key=UUID.randomUUID();
        denied(404,()->management.action(reader,tenant,id,UUID.randomUUID(),0,"TRASH",true));
        denied(404,()->management.action(admin,tenant,id,UUID.randomUUID(),0,"TRASH",true));
        denied(403,()->management.action(owner,other,id,UUID.randomUUID(),0,"TRASH",true));
        var removed=management.action(owner,tenant,id,key,0,"TRASH",true);
        assertEquals(removed,management.action(owner,tenant,id,key,0,"TRASH",true));
        denied(409,()->management.action(owner,tenant,id,key,0,"RESTORE",true));
        denied(409,()->management.action(owner,tenant,id,UUID.randomUUID(),0,"RESTORE",false));
        var restored=management.action(owner,tenant,id,UUID.randomUUID(),1,"RESTORE",false);
        assertEquals(restored,management.action(owner,tenant,id,key,0,"TRASH",true));
        assertNull(detail(id).conversation().trashedAt());assertEquals(1,conversations.list(owner,tenant,0,20).items().size());
    }
    @Test void trashPreservesIndependentSourceMaterialsAndCurrentWorkspaceAccessStillApplies() {
        UUID citation=source(space);var d=send(owner,space);UUID id=d.conversation().id();var job=conversations.claim();
        conversations.finish(job,result(job,List.of(citation)));
        management.action(owner,tenant,id,UUID.randomUUID(),0,"TRASH",false);
        assertEquals(citation,knowledge.citation(owner,tenant,citation).id());
        db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);
        assertTrue(conversations.list(owner,tenant,0,20,true).items().isEmpty());
        denied(404,()->management.action(owner,tenant,id,UUID.randomUUID(),1,"RESTORE",false));
    }

}
