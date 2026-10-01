package com.dreamcore.workspace;

import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.material.MaterialService;
import com.dreamcore.workspace.source.SourceService;
import java.net.*;
import java.net.http.*;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
class SourceIntegrationTest {
    @Autowired JdbcTemplate db;
    @Autowired SourceService sources;
    @Autowired MaterialService materials;
    @Autowired PasswordEncoder passwords;
    @LocalServerPort int port;
    UUID tenant,other,owner,reader,admin,alien,space,personal,otherSpace,version;
    final LocalDate first=LocalDate.of(2026,9,1),last=LocalDate.of(2026,9,30);
    final JsonMapper json=new JsonMapper();
    final String password="synthetic-source-test-password";
    String email(UUID id){return "source-"+id+"@example.test";}
    @BeforeEach void fixture(){
        tenant=UUID.randomUUID();other=UUID.randomUUID();owner=UUID.randomUUID();reader=UUID.randomUUID();admin=UUID.randomUUID();alien=UUID.randomUUID();space=UUID.randomUUID();personal=UUID.randomUUID();otherSpace=UUID.randomUUID();
        for(UUID t:List.of(tenant,other))db.update("INSERT INTO tenants(id,name) VALUES (?,?)",t,"合成来源企业");
        for(UUID a:List.of(owner,reader,admin,alien))db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",a,email(a),"合成账号",passwords.encode(password));
        for(UUID a:List.of(owner,reader,admin))db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,a,a.equals(admin)?"TENANT_ADMIN":"MEMBER");
        db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'TENANT_ADMIN')",other,alien);
        db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'资料','SHARED')",space,tenant,owner);
        db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'私人','PERSONAL')",personal,tenant,owner);
        db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'其他企业','PERSONAL')",otherSpace,other,alien);
        db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true),(?,?,?,false)",tenant,space,owner,tenant,space,reader);
        version=upload(owner,tenant,space);
    }
    UUID upload(UUID actor,UUID t,UUID w){
        var file=materials.upload(actor,t,w,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","monthly.csv","text/csv","day,value\n2026-09-01,12".getBytes()));
        return materials.detail(actor,t,w,file.id(),0,50).versions().getFirst().id();
    }
    SourceService.Settings settings(String status){return new SourceService.Settings("月度业务表","人工导出后补交；只是声明覆盖",owner,24,first,last,status);}
    SourceService.Source create(){return sources.create(owner,tenant,space,UUID.randomUUID(),settings("ACTIVE"));}
    SourceService.Submission submit(UUID id,UUID key,LocalDate from,LocalDate through){return sources.submit(owner,tenant,space,id,key,from,through,"人工声明",List.of(version));}

    @Test void declarationTracksMissingGapsAndWithdrawalWithoutClaimingParsedBusinessCompleteness(){
        var source=create();assertEquals("MISSING",source.coverageState());
        var one=submit(source.id(),UUID.randomUUID(),first,first.plusDays(8));
        assertEquals("GAP",sources.get(owner,tenant,space,source.id()).coverageState());
        var two=submit(source.id(),UUID.randomUUID(),first.plusDays(10),last);
        assertEquals("GAP",sources.get(owner,tenant,space,source.id()).coverageState());
        var gap=submit(source.id(),UUID.randomUUID(),first.plusDays(9),first.plusDays(9));
        assertEquals("DECLARED",sources.get(reader,tenant,space,source.id()).coverageState());
        assertEquals(version,one.versions().getFirst().versionId());
        assertEquals(1,two.versions().getFirst().number());
        UUID request=UUID.randomUUID();
        var withdrawn=sources.withdraw(owner,tenant,space,source.id(),gap.id(),request,0);
        assertEquals("WITHDRAWN",withdrawn.status());
        assertEquals(withdrawn,sources.withdraw(owner,tenant,space,source.id(),gap.id(),request,0));
        assertEquals("GAP",sources.get(owner,tenant,space,source.id()).coverageState());
        assertEquals(3,sources.submissions(owner,tenant,space,source.id(),0,50).items().size());
    }

    @Test void scopeChecksPreventAdminPrivateReadForeignVersionAndReadOnlyWrite(){
        var s=create();
        for(UUID actor:List.of(admin,alien))assertThrows(IdentityException.class,()->sources.get(actor,tenant,space,s.id()));
        assertFalse(sources.get(reader,tenant,space,s.id()).canMaintain());
        assertEquals(403,assertThrows(IdentityException.class,()->sources.submit(reader,tenant,space,s.id(),UUID.randomUUID(),first,last,"",List.of(version))).status);
        UUID foreign=upload(alien,other,otherSpace),privateVersion=upload(owner,tenant,personal);
        for(UUID v:List.of(foreign,privateVersion))assertEquals("SOURCE_VERSION_UNAVAILABLE",assertThrows(IdentityException.class,()->sources.submit(owner,tenant,space,s.id(),UUID.randomUUID(),first,last,"",List.of(v))).code);
        var badContact=new SourceService.Settings("私人联系人","",alien,24,first,last,"ACTIVE");
        assertThrows(IdentityException.class,()->sources.create(owner,tenant,space,UUID.randomUUID(),badContact));
        db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,reader);
        assertThrows(IdentityException.class,()->sources.submissions(reader,tenant,space,s.id(),0,50));
    }

    @Test void replayIsExactConcurrentSafeAndReauthorized(){
        var source=create();UUID key=UUID.randomUUID();
        try(var executor=Executors.newFixedThreadPool(2)){
            var futures=executor.invokeAll(List.<Callable<SourceService.Submission>>of(()->submit(source.id(),key,first,last),()->submit(source.id(),key,first,last)));
            var a=futures.get(0).get();assertEquals(a,futures.get(1).get());
            assertEquals(1,db.queryForObject("SELECT count(*) FROM business_source_submissions WHERE source_id=?",Integer.class,source.id()));
            assertEquals("IDEMPOTENCY_CONFLICT",assertThrows(IdentityException.class,()->submit(source.id(),key,first.plusDays(1),last)).code);
            db.update("UPDATE workspace_members SET can_maintain=false WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,owner);
            assertEquals(403,assertThrows(IdentityException.class,()->submit(source.id(),key,first,last)).status);
        }catch(Exception e){throw new AssertionError(e);}
    }

    @Test void staleUpdatesCannotOverwriteAndReadsDoNotResetDueTime(){
        var s=create();db.update("UPDATE business_sources SET due_anchor_at=now()-interval '2 days' WHERE id=?",s.id());
        var overdue=sources.get(owner,tenant,space,s.id());assertTrue(overdue.overdue());
        assertEquals(overdue.dueAt(),sources.get(owner,tenant,space,s.id()).dueAt());
        submit(s.id(),UUID.randomUUID(),first.minusMonths(1),first.minusDays(1));
        var stillDue=sources.get(owner,tenant,space,s.id());assertTrue(stillDue.overdue());assertEquals(overdue.dueAt(),stillDue.dueAt());
        var paused=sources.update(owner,tenant,space,s.id(),UUID.randomUUID(),stillDue.revision(),settings("PAUSED"));
        assertFalse(paused.overdue());assertEquals(overdue.dueAt(),paused.dueAt());
        assertEquals("SOURCE_PAUSED",assertThrows(IdentityException.class,()->submit(s.id(),UUID.randomUUID(),first,last)).code);
        assertEquals("SOURCE_STATE_CHANGED",assertThrows(IdentityException.class,()->sources.update(owner,tenant,space,s.id(),UUID.randomUUID(),0,settings("ACTIVE"))).code);
        var active=sources.update(owner,tenant,space,s.id(),UUID.randomUUID(),paused.revision(),settings("ACTIVE"));
        submit(s.id(),UUID.randomUUID(),first,last);
        var fresh=sources.get(owner,tenant,space,s.id());assertFalse(fresh.overdue());assertNotNull(fresh.lastSubmittedAt());assertTrue(fresh.revision()>active.revision());
    }

    @Test void departedContactDoesNotPreventPauseOrReplayAndOriginalConfigurationIsTraceable(){
        var s=sources.create(owner,tenant,space,UUID.randomUUID(),new SourceService.Settings("补交来源","",reader,24,first,last,"ACTIVE"));
        db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,reader);
        UUID key=UUID.randomUUID();var pausedSettings=new SourceService.Settings("补交来源","",reader,24,first,last,"PAUSED");
        var paused=sources.update(owner,tenant,space,s.id(),key,0,pausedSettings);
        assertEquals("PAUSED",paused.status());assertEquals(paused,sources.update(owner,tenant,space,s.id(),key,0,pausedSettings));
        var next=new SourceService.Settings("新周期","",owner,48,first.plusMonths(1),last.plusMonths(1),"ACTIVE");
        sources.update(owner,tenant,space,s.id(),UUID.randomUUID(),paused.revision(),next);
        var history=sources.history(owner,tenant,space,s.id(),0,50);
        assertEquals(3,history.items().size());
        assertEquals(first,history.items().getLast().settings().expectedFrom());
        assertEquals(reader,history.items().getLast().settings().responsibleId());
        assertEquals(first.plusMonths(1),history.items().getFirst().settings().expectedFrom());
        assertThrows(IdentityException.class,()->sources.history(admin,tenant,space,s.id(),0,50));
    }

    final class Client {
        final HttpClient http=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();
        HttpResponse<String> send(String method,String path,Object body,boolean csrf) throws Exception {
            var request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).header("Content-Type","application/json");
            if(csrf){JsonNode token=json.readTree(send("GET","/api/v1/auth/csrf",null,false).body());request.header(token.get("headerName").asString(),token.get("token").asString());}
            return http.send(request.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build(),HttpResponse.BodyHandlers.ofString());
        }
    }
    @Test void actualHttpEnforcesAuthenticationCsrfNoStoreAndPersistence() throws Exception {
        Client client=new Client();String path="/api/v1/tenants/"+tenant+"/workspaces/"+space+"/sources";
        assertEquals(401,client.send("GET",path,null,false).statusCode());
        assertEquals(200,client.send("POST","/api/v1/auth/login",Map.of("email",email(owner),"password",password),true).statusCode());
        var body=Map.of("requestId",UUID.randomUUID(),"settings",settings("ACTIVE"));
        assertEquals(403,client.send("POST",path,body,false).statusCode());
        var result=client.send("POST",path,body,true);assertEquals(201,result.statusCode(),result.body());
        assertTrue(result.headers().firstValue("cache-control").orElse("").contains("no-store"));
        UUID id=UUID.fromString(json.readTree(result.body()).get("id").asString());
        assertEquals(200,client.send("GET",path+"/"+id,null,false).statusCode());
        assertEquals(id,sources.get(owner,tenant,space,id).id());
        assertEquals(1,json.readTree(client.send("GET",path,null,false).body()).get("items").size());
    }
}
