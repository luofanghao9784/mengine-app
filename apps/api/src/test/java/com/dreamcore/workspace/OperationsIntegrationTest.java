package com.dreamcore.workspace;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.material.MaterialService;
import java.net.*;
import java.net.http.*;
import java.sql.Connection;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.initial-delay-ms=3600000","dreamcore.knowledge.initial-delay-ms=3600000"})
class OperationsIntegrationTest {
    @Autowired OperationsService operations; @Autowired ConversationService conversations; @Autowired MaterialService materials;
    @Autowired JdbcTemplate db; @Autowired PasswordEncoder passwords; @LocalServerPort int port;
    UUID tenant,other,admin,member,operator,space,foreign;
    static final String PASSWORD="synthetic-operations-password",SECRET="private-content-never-project";
    @BeforeEach void fixture(){
        tenant=UUID.randomUUID();other=UUID.randomUUID();admin=UUID.randomUUID();member=UUID.randomUUID();operator=UUID.randomUUID();space=UUID.randomUUID();foreign=UUID.randomUUID();
        for(UUID id:List.of(admin,member,operator)) db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",id,id+"@example.test",SECRET,passwords.encode(PASSWORD));
        db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",operator);
        db.update("INSERT INTO tenants(id,name) VALUES (?,?),(?,?)",tenant,SECRET,other,SECRET);
        for(UUID id:List.of(admin,member)) db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,id,id.equals(admin)?"TENANT_ADMIN":"MEMBER");
        db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",other,member);
        db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,?,'PERSONAL'),(?,?,?,?,'PERSONAL')",space,tenant,member,SECRET,foreign,other,member,SECRET);
    }
    @AfterEach void clean(){
        db.update("DELETE FROM platform_roles WHERE account_id=?",operator);
        db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id IN (?,?) AND status IN ('QUEUED','RUNNING')",tenant,other);
        db.update("UPDATE knowledge_runs SET status='CANCELLED' WHERE tenant_id IN (?,?) AND status IN ('QUEUED','RUNNING')",tenant,other);
    }
    UUID row(UUID t,UUID s,String status,String mode,String execution,String error,int attempt,int age,String usage){
        UUID c=UUID.randomUUID(),id=UUID.randomUUID();
        db.update("INSERT INTO conversations(id,tenant_id,workspace_id,owner_id,title) VALUES (?,?,?,?,?)",c,t,s,member,SECRET);
        db.update("""
            INSERT INTO conversation_tasks(id,tenant_id,workspace_id,conversation_id,requested_by,prompt,mode,execution_class,status,attempt,
            error_code,created_at,finished_at,reply,model_name,model_calls,token_usage)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,now()-make_interval(days=>?),now(),?,?,3,CAST(? AS jsonb))
            """,id,t,s,c,member,SECRET,mode,execution,status,attempt,error,age,SECRET,SECRET,usage);
        return id;
    }
    UUID task(String status){return row(tenant,space,status,"SOURCE_LOOKUP",null,null,status.equals("QUEUED")?0:1,0,null);}
    void denied(int status,Runnable work){assertEquals(status,assertThrows(IdentityException.class,work::run).status);}
    @Test void emptySnapshotKeepsUnknownModelUsageDistinctFromZero(){
        var r=operations.tenant(admin,tenant,7);assertEquals(0,r.tasks().total());assertEquals(0,r.storage().originalBytes());assertTrue(r.models().isEmpty());assertTrue(r.errors().isEmpty());assertEquals(7*86400,r.checkedAt().getEpochSecond()-r.from().getEpochSecond());
    }
    @Test void windowCountsCurrentTasksOnceAndSeparatesVerificationFromLive(){
        task("SUCCEEDED");task("QUEUED");task("RUNNING");task("CANCELLED");
        row(tenant,space,"FAILED","AGENT","live","TASK_MODEL_FAILED",3,0,null);
        row(tenant,space,"INTERRUPTED","AGENT","verification","TASK_INTERRUPTED",1,0,null);
        row(tenant,space,"SUCCEEDED","AGENT","live",null,2,1,"{\"inputTokens\":80,\"outputTokens\":20}");
        row(tenant,space,"SUCCEEDED","AGENT","live",null,1,1,"null");
        row(tenant,space,"SUCCEEDED","AGENT","verification",null,1,1,"{\"inputTokens\":30,\"outputTokens\":15}");
        row(tenant,space,"SUCCEEDED","AGENT","live",null,1,8,"{\"inputTokens\":900,\"outputTokens\":1}");
        row(tenant,space,"FAILED","AGENT","live","TASK_LIMIT",1,31,null);
        row(other,foreign,"FAILED","AGENT","live","TASK_TOOL_FAILED",1,0,null);
        UUID future=task("SUCCEEDED");db.update("UPDATE conversation_tasks SET created_at=now()+interval '1 hour' WHERE id=?",future);
        var r=operations.tenant(admin,tenant,7);assertEquals(9,r.tasks().total());assertEquals(4,r.tasks().succeeded());assertEquals(1,r.tasks().failed());assertEquals(1,r.tasks().interrupted());assertEquals(3,r.tasks().retryStarts());assertEquals(2,r.errors().size());
        var live=r.models().stream().filter(m->m.executionClass().equals("live")).findFirst().orElseThrow();assertEquals(2,live.succeededTasks());assertEquals(1,live.reportedTasks());assertEquals(6,live.modelCalls());assertEquals(80,live.inputTokens());
        assertEquals(10,operations.tenant(admin,tenant,30).tasks().total());
        assertEquals(r.tasks(),operations.platform(operator,tenant,7).tasks());
    }
    @Test void allControlStatesStayDistinctInTaskAndAttemptTotals(){
        for(String status:List.of("PAUSED","WAITING_INPUT","WAITING_CAPABILITY","PARTIAL","RESULT_UNKNOWN")) {
            UUID id=row(tenant,space,status,"AGENT","verification",status.equals("RESULT_UNKNOWN")?"TASK_RESULT_UNKNOWN":null,1,0,null);
            db.update("INSERT INTO agent_attempt_usage(attempt_id,task_id,tenant_id,workspace_id,execution_class,attempt_number,status) VALUES (?,?,?,?,'verification',1,?)",UUID.randomUUID(),id,tenant,space,status);
        }
        var r=operations.tenant(admin,tenant,7);assertEquals(5,r.tasks().total());assertEquals(0,r.tasks().succeeded());assertEquals(0,r.tasks().failed());assertEquals(1,r.tasks().paused());assertEquals(1,r.tasks().waitingInput());assertEquals(1,r.tasks().waitingCapability());assertEquals(1,r.tasks().partial());assertEquals(1,r.tasks().resultUnknown());
        var a=r.attemptUsage().getFirst();assertEquals(5,a.attempts());assertEquals(1,a.paused());assertEquals(1,a.waitingInput());assertEquals(1,a.waitingCapability());assertEquals(1,a.partial());assertEquals(1,a.resultUnknown());assertEquals(0,a.requests());assertNull(a.inputTokens());assertEquals("TASK_RESULT_UNKNOWN",r.errors().getFirst().code());
        assertFalse(new JsonMapper().writeValueAsString(r).contains(SECRET));
    }
    @Test void missingUsageAndZeroReportedTokensStayDifferent(){
        row(tenant,space,"SUCCEEDED","AGENT","live",null,1,0,"null");row(tenant,space,"SUCCEEDED","AGENT","verification",null,1,0,"{\"inputTokens\":0,\"outputTokens\":0}");
        var m=operations.tenant(admin,tenant,7).models();assertNull(m.getFirst().inputTokens());assertEquals(0,m.getFirst().reportedTasks());assertEquals(0,m.getLast().inputTokens());assertEquals(1,m.getLast().reportedTasks());
    }
    @Test void storageCountsHistoricalVersionsAndIdempotentUploadsButNoPrivateNames(){
        UUID key=UUID.randomUUID();var file=new MockMultipartFile("file",SECRET+".txt","text/plain","12345".getBytes());
        var first=materials.upload(member,tenant,space,null,null,null,key,file);materials.upload(member,tenant,space,null,null,null,key,file);
        materials.upload(member,tenant,space,null,first.id(),1,UUID.randomUUID(),new MockMultipartFile("file",SECRET+".txt","text/plain","1234567".getBytes()));
        materials.upload(member,other,foreign,null,null,null,UUID.randomUUID(),file);
        var r=operations.tenant(admin,tenant,7);assertEquals(new OperationsService.Storage(1,2,12),r.storage());assertEquals(r.storage(),operations.tenant(admin,tenant,30).storage());
        assertFalse(new JsonMapper().writeValueAsString(r).contains(SECRET));denied(404,()->materials.detail(admin,tenant,space,first.id(),0,20));
    }
    @Test void failureCodesAreAllowlistedAndNeverPassThroughRawDiagnostics(){
        row(tenant,space,"FAILED","SOURCE_LOOKUP",null,SECRET,1,0,null);row(tenant,space,"FAILED","SOURCE_LOOKUP",null,null,1,0,null);
        var r=operations.platform(operator,tenant,7);assertEquals(1,r.errors().size());assertEquals("OTHER",r.errors().getFirst().code());assertEquals(2,r.errors().getFirst().tasks());assertFalse(new JsonMapper().writeValueAsString(r).contains(SECRET));
    }
    @Test void actualRetryAndDuplicateSubmissionKeepOneTaskAndRemoveResolvedError(){
        UUID key=UUID.randomUUID();var first=conversations.submit(member,tenant,null,space,key,SECRET,"SOURCE_LOOKUP");conversations.submit(member,tenant,null,space,key,SECRET,"SOURCE_LOOKUP");
        var j=conversations.claim();assertEquals(tenant,j.tenant());conversations.fail(j,"TASK_RUNTIME_UNAVAILABLE");assertEquals(1,operations.tenant(admin,tenant,7).tasks().failed());
        var failed=conversations.detail(member,tenant,first.conversation().id(),0,20).tasks().getFirst();UUID retry=UUID.randomUUID();
        conversations.action(member,tenant,first.conversation().id(),j.id(),retry,failed.revision(),"RETRY");conversations.action(member,tenant,first.conversation().id(),j.id(),retry,failed.revision(),"RETRY");
        assertEquals(1,operations.tenant(admin,tenant,7).tasks().total());assertTrue(operations.tenant(admin,tenant,7).errors().isEmpty());
        var next=conversations.claim();conversations.finish(next,new TaskRuntime.Result("1.0","test",next.id(),next.token(),"SOURCE_LOOKUP","NO_SOURCES",List.of()));
        conversations.action(member,tenant,first.conversation().id(),j.id(),retry,failed.revision(),"RETRY");
        var done=operations.tenant(admin,tenant,7);assertEquals(1,done.tasks().total());assertEquals(1,done.tasks().succeeded());assertEquals(1,done.tasks().retryStarts());assertTrue(done.models().isEmpty());
    }
    @Test void roleTenantAccountAndSuspensionChecksApplyOnEveryRead(){
        denied(403,()->operations.tenant(member,tenant,7));denied(403,()->operations.tenant(admin,other,7));denied(403,()->operations.tenant(operator,tenant,7));denied(403,()->operations.platform(admin,null,7));denied(404,()->operations.platform(operator,UUID.randomUUID(),7));
        for(int days:List.of(-1,0,1,8,31,365))denied(400,()->operations.tenant(admin,tenant,days));
        db.update("UPDATE tenant_memberships SET role='MEMBER' WHERE tenant_id=? AND account_id=?",tenant,admin);denied(403,()->operations.tenant(admin,tenant,7));
        db.update("UPDATE tenant_memberships SET role='TENANT_ADMIN',status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,admin);denied(403,()->operations.tenant(admin,tenant,7));
        db.update("UPDATE tenant_memberships SET status='ACTIVE' WHERE tenant_id=? AND account_id=?",tenant,admin);
        task("FAILED");db.update("UPDATE tenants SET status='SUSPENDED' WHERE id=?",tenant);denied(403,()->operations.tenant(admin,tenant,7));assertEquals(1,operations.platform(operator,tenant,7).tasks().total());
        db.update("DELETE FROM platform_roles WHERE account_id=?",operator);denied(403,()->operations.platform(operator,tenant,7));
        db.update("UPDATE accounts SET status='DISABLED' WHERE id=?",admin);denied(401,()->operations.tenant(admin,tenant,7));
    }
    @Test void waitingAdminCannotReadAfterRoleRevocation() throws Exception {
        try(var pool=Executors.newSingleThreadExecutor();Connection writer=Objects.requireNonNull(db.getDataSource()).getConnection()){
            writer.setAutoCommit(false);try(var s=writer.prepareStatement("SELECT id FROM tenants WHERE id=? FOR UPDATE")){s.setObject(1,tenant);s.executeQuery();}
            var pending=pool.submit(()->assertThrows(IdentityException.class,()->operations.tenant(admin,tenant,7)));
            long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
            while(db.queryForObject("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT id FROM tenants%FOR SHARE%'",Integer.class)==0 && System.nanoTime()<deadline)Thread.sleep(10);
            assertTrue(db.queryForObject("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT id FROM tenants%FOR SHARE%'",Integer.class)>0);
            try(var s=writer.prepareStatement("UPDATE tenant_memberships SET role='MEMBER' WHERE tenant_id=? AND account_id=?")){s.setObject(1,tenant);s.setObject(2,admin);s.executeUpdate();}
            writer.commit();assertEquals(403,pending.get(5,TimeUnit.SECONDS).status);
        }
    }
    @Test void globalTotalsEqualCommittedTenantsAndDoNotMultiplyByVersions(){
        var before=operations.platform(operator,null,7);task("SUCCEEDED");row(other,foreign,"FAILED","SOURCE_LOOKUP",null,"TASK_LIMIT",1,0,null);
        var after=operations.platform(operator,null,7);assertNull(after.tenantId());assertEquals(before.tasks().total()+2,after.tasks().total());assertEquals(before.tasks().failed()+1,after.tasks().failed());
    }
    @Test void httpRequiresLoginAndReturnsOnlyNoStoreAggregates() throws Exception {
        // Other HTTP suites intentionally exhaust the shared loopback login bucket in this disposable DB.
        db.update("DELETE FROM login_attempts");
        task("FAILED");var json=new JsonMapper();String base="http://127.0.0.1:"+port,path="/api/tenant-admin/v1/tenants/"+tenant+"/operations";
        var http=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();
        assertEquals(401,http.send(HttpRequest.newBuilder(URI.create(base+path)).GET().build(),HttpResponse.BodyHandlers.ofString()).statusCode());
        var csrf=json.readTree(http.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());
        var login=HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/login")).header(csrf.get("headerName").asString(),csrf.get("token").asString()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("email",admin+"@example.test","password",PASSWORD)))).build();assertEquals(200,http.send(login,HttpResponse.BodyHandlers.ofString()).statusCode());
        var r=http.send(HttpRequest.newBuilder(URI.create(base+path)).GET().build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,r.statusCode());assertEquals("private, no-store",r.headers().firstValue("Cache-Control").orElseThrow());
        for(String secret:List.of(SECRET,member.toString(),space.toString(),"prompt","filename","conversationId","modelName","@example.test"))assertFalse(r.body().contains(secret));
        assertEquals(400,http.send(HttpRequest.newBuilder(URI.create(base+path+"?days=8")).GET().build(),HttpResponse.BodyHandlers.ofString()).statusCode());
        assertEquals(403,http.send(HttpRequest.newBuilder(URI.create(base+"/api/platform-admin/v1/operations")).GET().build(),HttpResponse.BodyHandlers.ofString()).statusCode());
    }
}
