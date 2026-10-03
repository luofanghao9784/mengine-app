package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=live","dreamcore.tasks.initial-delay-ms=3600000"})
class ConversationRealtimeIntegrationTest {
    @Autowired ConversationRealtime live;@Autowired ConversationService conversations;@Autowired AgentTaskService agents;@Autowired JdbcTemplate db;@Autowired PasswordEncoder passwords;
    @org.springframework.boot.test.web.server.LocalServerPort int port;
    UUID tenant,owner,other,space;ConversationService.Job job;
    @BeforeEach void setup(){
        tenant=UUID.randomUUID();owner=UUID.randomUUID();other=UUID.randomUUID();space=UUID.randomUUID();
        for(UUID id:List.of(owner,other))db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",id,id+"@example.test","合成实时会话",passwords.encode("synthetic-password"));
        db.update("INSERT INTO tenants(id,name) VALUES (?,'合成实时企业')",tenant);
        for(UUID id:List.of(owner,other))db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,id);
        db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'个人空间','PERSONAL')",space,tenant,owner);
        conversations.submit(owner,tenant,null,space,UUID.randomUUID(),"合成请求","AGENT");job=conversations.claim();
        agents.openExecution(job.id(),job.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("search_sources","ask_user")));
        live.open(job.id(),job.token());
    }
    @AfterEach void cleanup(){db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);}
    ConversationService.Task task(){return conversations.detail(owner,tenant,job.conversation(),0,20).tasks().getFirst();}
    @Test void incrementsReplayAndTerminalIsolation(){
        live.output(job.id(),job.token(),new ConversationRealtime.Output(1,1,"你","STREAMING"));
        live.output(job.id(),job.token(),new ConversationRealtime.Output(1,2,"你好","COMPLETE"));
        live.output(job.id(),job.token(),new ConversationRealtime.Output(1,1,"你","STREAMING"));
        var data=live.snapshot(owner,tenant,job.conversation());assertTrue(data.toString().contains("你好"));
        assertThrows(IdentityException.class,()->live.output(job.id(),job.token(),new ConversationRealtime.Output(1,3,"你好世界","COMPLETE")));
        assertThrows(IdentityException.class,()->live.output(job.id(),UUID.randomUUID(),new ConversationRealtime.Output(2,1,"越权","STREAMING")));
    }
    @Test void supplementIsDurableIdempotentAndAppliedSeparately(){
        UUID id=UUID.randomUUID();var input=new ConversationRealtime.Input(id,1,"采用本期口径",null);
        live.input(owner,tenant,job.conversation(),job.id(),input);live.input(owner,tenant,job.conversation(),job.id(),input);
        assertEquals(1,db.queryForObject("SELECT count(*) FROM conversation_live_inputs WHERE task_id=?",Integer.class,job.id()));
        assertFalse(db.queryForObject("SELECT applied FROM conversation_live_inputs WHERE id=?",Boolean.class,id));
        assertTrue(live.control(job.id(),job.token()).toString().contains("采用本期口径"));
        live.applied(job.id(),job.token(),new ConversationRealtime.Applied(id));live.applied(job.id(),job.token(),new ConversationRealtime.Applied(id));
        assertEquals("采用本期口径",db.queryForObject("SELECT supplemental_input FROM conversation_tasks WHERE id=?",String.class,job.id()));
        assertTrue(db.queryForObject("SELECT applied FROM conversation_live_inputs WHERE id=?",Boolean.class,id));
        assertThrows(IdentityException.class,()->live.input(owner,tenant,job.conversation(),job.id(),new ConversationRealtime.Input(id,1,"另一条",null)));
    }
    @Test void stopRequiresExecutorAckAndBlocksLaterTools(){
        agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(1,"search_sources","STARTED"));
        agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(1,"search_sources","succeeded"));
        conversations.action(owner,tenant,job.conversation(),job.id(),UUID.randomUUID(),task().revision(),"CANCEL");
        assertEquals("RUNNING",task().status());assertEquals(true,live.control(job.id(),job.token()).get("stop"));
        assertThrows(IdentityException.class,()->agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(2,"search_sources","STARTED")));
        assertThrows(IdentityException.class,()->live.input(owner,tenant,job.conversation(),job.id(),new ConversationRealtime.Input(UUID.randomUUID(),1,"迟到补充",null)));
        live.stopped(job.id(),job.token());assertEquals("CANCELLED",task().status());
        assertEquals("succeeded",db.queryForObject("SELECT status FROM conversation_tool_receipts WHERE task_id=?",String.class,job.id()));
        assertThrows(IdentityException.class,()->live.output(job.id(),job.token(),new ConversationRealtime.Output(1,1,"迟到结果","COMPLETE")));
    }
    @Test void lifecycleScrubsProvisionalContentAlongsideAttemptHistory(){
        live.output(job.id(),job.token(),new ConversationRealtime.Output(1,1,"合成临时内容","STREAMING"));
        live.input(owner,tenant,job.conversation(),job.id(),new ConversationRealtime.Input(UUID.randomUUID(),1,"合成补充",null));
        db.update("UPDATE conversation_attempts SET input='内容已按来源生命周期清理',snapshot='{}'::jsonb WHERE task_id=?",job.id());
        assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_live_output WHERE task_id=?",Integer.class,job.id()));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_live_inputs WHERE task_id=?",Integer.class,job.id()));
    }
    @Test void noStopWithoutRequestAndExpiredLeaseCannotPublish(){
        assertThrows(IdentityException.class,()->live.stopped(job.id(),job.token()));
        db.update("UPDATE conversation_tasks SET lease_until=now()-interval '1 second' WHERE id=?",job.id());
        assertThrows(IdentityException.class,()->live.control(job.id(),job.token()));
        assertThrows(IdentityException.class,()->live.applied(job.id(),job.token(),new ConversationRealtime.Applied(UUID.randomUUID())));
    }
    @Test void privateConversationAndRevocationProtectSnapshotAndInput(){
        assertThrows(IdentityException.class,()->live.snapshot(other,tenant,job.conversation()));
        assertThrows(IdentityException.class,()->live.snapshot(owner,UUID.randomUUID(),job.conversation()));
        assertThrows(IdentityException.class,()->live.input(other,tenant,job.conversation(),job.id(),new ConversationRealtime.Input(UUID.randomUUID(),1,"越权",null)));
        db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,owner);
        assertThrows(IdentityException.class,()->live.snapshot(owner,tenant,job.conversation()));
        assertThrows(IdentityException.class,()->live.control(job.id(),job.token()));
    }
    @Test void blockingAnswerResumesSameTaskWithoutKeepingAnExecutionAlive(){
        agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(1,"ask_user","STARTED"));
        UUID q=UUID.randomUUID();live.question(job.id(),job.token(),new ConversationRealtime.Question(q,"选择期间",List.of("本期","上期"),true));
        assertThrows(IdentityException.class,()->live.input(owner,tenant,job.conversation(),job.id(),new ConversationRealtime.Input(UUID.randomUUID(),1,"本期",q)));
        agents.toolReceipt(job.id(),job.token(),new AgentTaskService.ToolReceipt(1,"ask_user","succeeded"));
        agents.finish(job,new AgentResult("1.5","0.15.4",job.id(),job.token(),"AGENT","live","synthetic","选择期间",List.of(),List.of(new AgentResult.Tool("q1","ask_user","succeeded")),List.of(),1,null,List.of(),List.of(),List.of(),"WAITING_INPUT","选择期间"));
        assertEquals("WAITING_INPUT",task().status());
        var body=new ConversationRealtime.Input(UUID.randomUUID(),1,"本期",q);
        live.input(owner,tenant,job.conversation(),job.id(),body);live.input(owner,tenant,job.conversation(),job.id(),body);
        assertEquals("QUEUED",task().status());assertEquals(job.id(),task().id());
        assertThrows(IdentityException.class,()->live.input(owner,tenant,job.conversation(),job.id(),new ConversationRealtime.Input(UUID.randomUUID(),1,"上期",q)));
        var next=conversations.claim();assertEquals(job.id(),next.id());assertNotEquals(job.token(),next.token());assertTrue(next.prompt().contains("本期"));
        assertFalse(db.queryForObject("SELECT applied FROM conversation_live_inputs WHERE id=?",Boolean.class,body.requestId()));
        live.open(next.id(),next.token());live.started(next.id(),next.token());
        assertTrue(db.queryForObject("SELECT applied FROM conversation_live_inputs WHERE id=?",Boolean.class,body.requestId()));
    }
    @Test void realHttpModelHarnessPlatformRoundTripStreamsAndAdoptsInput() throws Exception {
        db.update("UPDATE conversation_tasks SET prompt='SUPPLEMENT' WHERE id=?",job.id());
        var j=new ConversationService.Job(job.id(),job.tenant(),job.space(),job.conversation(),job.actor(),"SUPPLEMENT",job.token(),job.mode());
        // Let the actual engine register its own complete authorized tool set.
        db.update("UPDATE conversation_attempts SET execution_policy=NULL,allowed_tools=NULL WHERE task_id=?",job.id());
        java.nio.file.Path root=java.nio.file.Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();
        var process=new ProcessBuilder("node",root.resolve("engine/tests/helpers/realtime-platform-fixture.mjs").toString(),"http://127.0.0.1:"+port).redirectError(ProcessBuilder.Redirect.INHERIT).start();
        try(var reader=new java.io.BufferedReader(new java.io.InputStreamReader(process.getInputStream()));var executor=java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()){
            String endpoint=reader.readLine();assertTrue(endpoint.startsWith("http://127.0.0.1:"));
            var runtime=new EngineTaskRuntime(endpoint,"synthetic-engine-token-0000000000000000","live",false);
            var execution=executor.submit(()->runtime.executeAgent(j.id(),j.token(),j.prompt(),()->agents.active(j)));
            UUID input=UUID.randomUUID();live.input(owner,tenant,job.conversation(),job.id(),new ConversationRealtime.Input(input,1,"途中合成要求",null));
            long end=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(8);
            while(db.queryForObject("SELECT count(*) FROM conversation_live_output WHERE task_id=? AND text<>''",Integer.class,job.id())==0 && !execution.isDone() && System.nanoTime()<end)Thread.sleep(30);
            assertTrue(live.snapshot(owner,tenant,job.conversation()).toString().contains("合成实时开头"));
            assertFalse(execution.isDone(),"increment arrives before the final result");
            var result=execution.get(10,java.util.concurrent.TimeUnit.SECONDS);agents.finish(j,result);
            assertEquals("SUCCEEDED",task().status());assertTrue(task().reply().contains("采用途中合成要求"));
            assertTrue(db.queryForObject("SELECT applied FROM conversation_live_inputs WHERE id=?",Boolean.class,input));
        }finally{process.destroyForcibly();process.waitFor();}
    }
    @Test void realHttpBlockingQuestionTerminatesAndPersistsWaitingState() throws Exception {
        db.update("UPDATE conversation_tasks SET prompt='QUESTION' WHERE id=?",job.id());
        var j=new ConversationService.Job(job.id(),job.tenant(),job.space(),job.conversation(),job.actor(),"QUESTION",job.token(),job.mode());
        db.update("UPDATE conversation_attempts SET execution_policy=NULL,allowed_tools=NULL WHERE task_id=?",job.id());
        java.nio.file.Path root=java.nio.file.Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();
        var process=new ProcessBuilder("node",root.resolve("engine/tests/helpers/realtime-platform-fixture.mjs").toString(),"http://127.0.0.1:"+port).redirectError(ProcessBuilder.Redirect.INHERIT).start();
        try(var reader=new java.io.BufferedReader(new java.io.InputStreamReader(process.getInputStream()))){
            var runtime=new EngineTaskRuntime(reader.readLine(),"synthetic-engine-token-0000000000000000","live",false);
            agents.finish(j,runtime.executeAgent(j.id(),j.token(),j.prompt(),()->agents.active(j)));
            assertEquals("WAITING_INPUT",task().status());assertEquals("请选择合成期间",task().requiredInput());
            assertNull(db.queryForObject("SELECT lease_token FROM conversation_tasks WHERE id=?",UUID.class,job.id()));
            UUID q=db.queryForObject("SELECT id FROM conversation_live_questions WHERE task_id=?",UUID.class,job.id());
            live.input(owner,tenant,job.conversation(),job.id(),new ConversationRealtime.Input(UUID.randomUUID(),1,"ANSWER 本期",q));
            var resumed=conversations.claim();assertEquals(job.id(),resumed.id());
            assertTrue(live.snapshot(owner,tenant,job.conversation()).toString().contains("resumeAnswer=true"));
            agents.finish(resumed,runtime.executeAgent(resumed.id(),resumed.token(),resumed.prompt(),()->agents.active(resumed)));
            assertEquals("SUCCEEDED",task().status());assertEquals(2,task().attempt());
            assertTrue(db.queryForObject("SELECT applied FROM conversation_live_inputs WHERE question_id=?",Boolean.class,q));
        }finally{process.destroyForcibly();process.waitFor();}
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings={"membership","logout","credential"})
    void sseRechecksSessionScopeAndClosesOnRevocation(String cause) throws Exception {
        var http=java.net.http.HttpClient.newBuilder().cookieHandler(new java.net.CookieManager(null,java.net.CookiePolicy.ACCEPT_ALL)).build();
        String root="http://127.0.0.1:"+port,path=root+"/api/v1/tenants/"+tenant+"/conversations/"+job.conversation()+"/stream";
        var json=new tools.jackson.databind.json.JsonMapper();
        assertEquals(401,http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(path)).GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
        var csrf=json.readTree(http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(root+"/api/v1/auth/csrf")).GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString()).body());
        assertEquals(200,http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(root+"/api/v1/auth/login")).header(csrf.get("headerName").asString(),csrf.get("token").asString()).header("Content-Type","application/json").POST(java.net.http.HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("email",owner+"@example.test","password","synthetic-password")))).build(),java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
        var response=http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(path)).timeout(java.time.Duration.ofSeconds(5)).GET().build(),java.net.http.HttpResponse.BodyHandlers.ofInputStream());
        assertEquals(200,response.statusCode());assertTrue(response.headers().firstValue("Content-Type").orElse("").contains("text/event-stream"));
        try(var reader=new java.io.BufferedReader(new java.io.InputStreamReader(response.body()));var executor=java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()){
            assertTrue(reader.readLine().startsWith("data: "));
            if(cause.equals("membership"))db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,owner);
            else if(cause.equals("logout"))db.update("DELETE FROM spring_session WHERE principal_name=?",owner.toString());
            else db.update("UPDATE accounts SET credential_version=credential_version+1 WHERE id=?",owner);
            assertTrue(executor.submit(()->{String line;while((line=reader.readLine())!=null)if(line.equals("event: unavailable"))return true;return false;}).get(3,java.util.concurrent.TimeUnit.SECONDS));
        }
    }
    @Test void realHttpStopReceivesAckBeforeShowingCancelled() throws Exception {
        db.update("UPDATE conversation_tasks SET prompt='STOP' WHERE id=?",job.id());
        var j=new ConversationService.Job(job.id(),job.tenant(),job.space(),job.conversation(),job.actor(),"STOP",job.token(),job.mode());
        db.update("UPDATE conversation_attempts SET execution_policy=NULL,allowed_tools=NULL WHERE task_id=?",job.id());
        java.nio.file.Path root=java.nio.file.Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();
        var process=new ProcessBuilder("node",root.resolve("engine/tests/helpers/realtime-platform-fixture.mjs").toString(),"http://127.0.0.1:"+port).redirectError(ProcessBuilder.Redirect.INHERIT).start();
        try(var reader=new java.io.BufferedReader(new java.io.InputStreamReader(process.getInputStream()));var executor=java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()){
            var runtime=new EngineTaskRuntime(reader.readLine(),"synthetic-engine-token-0000000000000000","live",false);
            var execution=executor.submit(()->runtime.executeAgent(j.id(),j.token(),j.prompt(),()->agents.active(j)));
            long end=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(8);
            while(db.queryForObject("SELECT count(*) FROM conversation_live_output WHERE task_id=? AND text<>''",Integer.class,job.id())==0 && !execution.isDone() && System.nanoTime()<end)Thread.sleep(30);
            assertFalse(execution.isDone());
            conversations.action(owner,tenant,job.conversation(),job.id(),UUID.randomUUID(),task().revision(),"CANCEL");
            assertThrows(java.util.concurrent.ExecutionException.class,()->execution.get(5,java.util.concurrent.TimeUnit.SECONDS));
            assertEquals("CANCELLED",task().status());
            assertTrue(live.snapshot(owner,tenant,job.conversation()).toString().contains("合成实时开头"));
        }finally{process.destroyForcibly();process.waitFor();}
    }

}
