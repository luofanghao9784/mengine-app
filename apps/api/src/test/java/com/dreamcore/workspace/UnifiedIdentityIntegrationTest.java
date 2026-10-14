package com.dreamcore.workspace;

import com.dreamcore.workspace.identity.IdentityService;
import java.net.*;
import java.net.http.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,
 properties={"dreamcore.phone.delivery=local","dreamcore.phone.local-preview=true","dreamcore.phone.outbox=${INVITATION_OUTBOX}/phone","dreamcore.auth.ip-attempts=1000","dreamcore.auth.email-attempts=1000"})
class UnifiedIdentityIntegrationTest {
    @LocalServerPort int port;
    @Autowired JdbcTemplate db;
    @Autowired PasswordEncoder passwords;
    @Autowired IdentityService identities;
    static final JsonMapper JSON=new JsonMapper();
    final List<UUID> provisioned = new ArrayList<>();
    @org.junit.jupiter.api.AfterEach void cleanup() {
        for(UUID id:provisioned){
            db.update("DELETE FROM platform_sessions WHERE account_id=?",id);
            db.update("DELETE FROM platform_roles WHERE account_id=?",id);
            db.update("DELETE FROM platform_accounts WHERE account_id=?",id);
        }
    }
    record Fixture(UUID id,String phone,String login,UUID tenant,UUID foreignTenant) {}
    Fixture fixture(boolean credentials) {
        UUID id=UUID.randomUUID(),tenant=UUID.randomUUID(),foreign=UUID.randomUUID();
        provisioned.add(id);
        String phone="+86199"+String.format("%08d",Math.abs(id.getLeastSignificantBits()%100000000L));
        String login="operator-"+UUID.randomUUID();
        db.update("INSERT INTO accounts(id,phone,phone_verified_at,display_name,password_hash) VALUES (?,?,now(),'合成统一用户',?)",id,phone,passwords.encode("unified-pass"));
        if(credentials)db.update("INSERT INTO platform_accounts(account_id,login_name,password_hash) VALUES (?,?,?)",id,login,passwords.encode("dedicated-pass"));
        db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",id);
        db.update("INSERT INTO tenants(id,name) VALUES (?,'本人企业'),(?,'无权企业')",tenant,foreign);
        db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'TENANT_ADMIN')",tenant,id);
        return new Fixture(id,phone,login,tenant,foreign);
    }
    class Browser {
        CookieManager cookies=new CookieManager(null,CookiePolicy.ACCEPT_ALL);
        HttpClient http=HttpClient.newBuilder().cookieHandler(cookies).build();
        HttpResponse<String> send(String method,String path,Object body,String csrf)throws Exception {
            var request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).header("Content-Type","application/json");
            if(csrf!=null)request.header("X-CSRF-TOKEN",csrf);
            return http.send(request.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body))).build(),HttpResponse.BodyHandlers.ofString());
        }
        HttpResponse<String> get(String path)throws Exception{return send("GET",path,null,null);}
        String csrf()throws Exception{return JSON.readTree(get("/api/v1/auth/csrf").body()).get("token").asString();}
        HttpResponse<String> post(String path,Object body)throws Exception{return send("POST",path,body,path.startsWith("/api/platform-admin/")?JSON.readTree(get("/api/platform-admin/v1/auth/csrf").body()).get("token").asString():csrf());}
        void login(Fixture f,boolean platform)throws Exception {
            var result=platform?post("/api/platform-admin/v1/auth/login",Map.of("username",f.login(),"password","dedicated-pass")):
                post("/api/v1/auth/login",Map.of("phone",f.phone(),"password","unified-pass"));
            assertEquals(200,result.statusCode(),result.body());
            assertEquals(f.id().toString(),JSON.readTree(result.body()).get("account").get("id").asString());
        }
    }
    @Test void sameAccountStillRequiresIndependentRealmLogins()throws Exception {
        var f=fixture(true);
        for(boolean dedicated:List.of(false,true)) {
            var b=new Browser();b.login(f,dedicated);
            assertEquals(dedicated?401:200,b.get("/api/v1/me").statusCode());
            assertEquals(dedicated?200:401,b.get("/api/platform-admin/v1/auth/me").statusCode());
            b.login(f,!dedicated);
            assertEquals(f.id().toString(),JSON.readTree(b.get("/api/v1/me").body()).get("account").get("id").asString());
            assertEquals(200,b.get("/api/platform-admin/v1/auth/me").statusCode());
            assertEquals(200,b.get("/api/v1/tenants/"+f.tenant()+"/context").statusCode());
            assertEquals(403,b.get("/api/v1/tenants/"+f.foreignTenant()+"/context").statusCode());
        }
    }
    @Test void dedicatedCredentialsAreOptionalAndRevokingRoleKeepsCustomerSession()throws Exception {
        var f=fixture(false);var b=new Browser();b.login(f,false);
        assertEquals(200,b.post("/api/platform-admin/v1/auth/login",Map.of("username",f.phone(),"password","unified-pass")).statusCode());
        assertEquals(200,b.get("/api/platform-admin/v1/auth/me").statusCode());
        db.update("DELETE FROM platform_roles WHERE account_id=?",f.id());
        assertEquals(401,b.get("/api/platform-admin/v1/auth/me").statusCode());
        assertEquals(200,b.get("/api/v1/tenants/"+f.tenant()+"/context").statusCode());
        assertFalse(JSON.readTree(b.get("/api/v1/me").body()).get("platformAdmin").asBoolean());
    }
    @Test void passwordsAreNotInterchangeableAndCsrfIsRequired()throws Exception {
        var f=fixture(true);var b=new Browser();
        assertEquals(401,b.post("/api/v1/auth/login",Map.of("phone",f.phone(),"password","dedicated-pass")).statusCode());
        assertEquals(401,b.post("/api/platform-admin/v1/auth/login",Map.of("username",f.login(),"password","unified-pass")).statusCode());
        assertEquals(403,b.send("POST","/api/platform-admin/v1/auth/login",Map.of("username",f.login(),"password","dedicated-pass"),null).statusCode());
        b.login(f,false);
        assertEquals(403,b.send("POST","/api/platform-admin/v1/auth/logout",null,null).statusCode());
        assertEquals(200,b.get("/api/v1/me").statusCode());
    }
    @Test void logoutOnlyInvalidatesItsOwnRealm()throws Exception {
        var f=fixture(true);
        for(String path:List.of("/api/v1/auth/logout","/api/platform-admin/v1/auth/logout")) {
            var b=new Browser();b.login(f,false);b.login(f,true);
            assertEquals(204,b.post(path,null).statusCode());
            assertEquals(path.startsWith("/api/platform-admin/")?200:401,b.get("/api/v1/me").statusCode());
            assertEquals(path.startsWith("/api/platform-admin/")?401:200,b.get("/api/platform-admin/v1/auth/me").statusCode());
        }
    }
    @Test void changingDedicatedPasswordExpiresAllBrowsersButPreservesUnifiedPassword()throws Exception {
        var f=fixture(true);var a=new Browser();var b=new Browser();a.login(f,true);b.login(f,false);
        var result=a.post("/api/platform-admin/v1/auth/password",Map.of("currentPassword","dedicated-pass","password","new-dedicated-pass"));
        assertEquals(204,result.statusCode(),result.body());
        assertEquals(401,a.get("/api/v1/me").statusCode());assertEquals(401,b.get("/api/v1/me").statusCode());
        b.login(f,false);
        assertEquals(200,a.post("/api/platform-admin/v1/auth/login",Map.of("username",f.login(),"password","new-dedicated-pass")).statusCode());
    }
    @Test void globalDisableExpiresAllAccessAndOldCookieDoesNotReviveOnEnable()throws Exception {
        var f=fixture(true);var b=new Browser();b.login(f,false);
        db.update("UPDATE accounts SET status='DISABLED',credential_version=credential_version+1 WHERE id=?",f.id());
        assertEquals(401,b.get("/api/platform-admin/v1/auth/me").statusCode());
        db.update("UPDATE accounts SET status='ACTIVE' WHERE id=?",f.id());
        assertEquals(401,b.get("/api/v1/me").statusCode());
    }
    @Autowired org.springframework.core.env.Environment environment;
    @Test void openingRequiresExplicitOwnerAndActivatesAtomically()throws Exception {
        var f=fixture(true);var b=new Browser();b.login(f,false);b.login(f,true);
        UUID request=UUID.randomUUID();
        var body=Map.of("requestId",request,"name","待开通合成企业","adminPhone",f.phone());
        var created=b.post("/api/platform-admin/v1/tenants",body);
        assertEquals(201,created.statusCode(),created.body());
        var data=JSON.readTree(created.body());UUID tenant=UUID.fromString(data.get("tenant").get("id").asString());
        assertEquals("PENDING",data.get("tenant").get("status").asString());
        UUID invite=UUID.fromString(data.get("invitation").get("id").asString());
        String token=JSON.readTree(java.nio.file.Files.readString(java.nio.file.Path.of(environment.getRequiredProperty("dreamcore.invitation.outbox"),invite+".json"))).get("token").asString();
        assertEquals(403,b.get("/api/v1/tenants/"+tenant+"/context").statusCode());
        assertEquals(409,b.post("/api/platform-admin/v1/tenants/"+tenant+"/status",Map.of("requestId",UUID.randomUUID(),"expectedVersion",0,"status","ACTIVE","internalReason","合成","publicReason","合成")).statusCode());
        var accept=new HashMap<String,Object>();accept.put("token",token);accept.put("requestId",UUID.randomUUID());accept.put("acceptResponsibility",false);
        assertEquals(400,b.post("/api/v1/auth/phone/accept",accept).statusCode());
        assertEquals(0,db.queryForObject("SELECT count(*) FROM tenant_memberships WHERE tenant_id=?",Integer.class,tenant));
        accept.put("acceptResponsibility",true);
        var joined=b.post("/api/v1/auth/phone/accept",accept);assertEquals(200,joined.statusCode(),joined.body());
        assertEquals(f.id(),db.queryForObject("SELECT owner_id FROM tenant_governance WHERE tenant_id=?",UUID.class,tenant));
        assertEquals("ACTIVE",db.queryForObject("SELECT status FROM tenants WHERE id=?",String.class,tenant));
        assertEquals(200,b.post("/api/v1/auth/phone/accept",accept).statusCode());
        assertEquals(1,db.queryForObject("SELECT count(*) FROM tenant_memberships WHERE tenant_id=?",Integer.class,tenant));
        assertEquals(1,db.queryForObject("SELECT count(*) FROM workspaces WHERE tenant_id=?",Integer.class,tenant));
        var retry=b.post("/api/platform-admin/v1/tenants",body);assertEquals(201,retry.statusCode());
        assertEquals("ACTIVE",JSON.readTree(retry.body()).get("tenant").get("status").asString());
    }

    @Test void unifiedUserCanSetDedicatedCredentialsWithoutCreatingAnotherAccount()throws Exception {
        var f=fixture(false);var b=new Browser();b.login(f,false);
        assertEquals(200,b.post("/api/platform-admin/v1/auth/login",Map.of("username",f.phone(),"password","unified-pass")).statusCode());
        var configured=b.post("/api/platform-admin/v1/auth/credentials",Map.of("username",f.login(),"currentPassword","unified-pass","password","dedicated-pass"));
        assertEquals(204,configured.statusCode(),configured.body());
        assertEquals(401,b.get("/api/v1/me").statusCode());
        assertEquals(f.id(),db.queryForObject("SELECT account_id FROM platform_accounts WHERE login_name=?",UUID.class,f.login()));
        b.login(f,true);assertEquals(401,b.get("/api/v1/me").statusCode());b.login(f,false);assertEquals(1,JSON.readTree(b.get("/api/v1/me").body()).get("memberships").size());
        var other=new Browser();other.login(f,false);
    }
    @Test void platformInvitationVerifiesPhoneAndReusesUnifiedIdentity()throws Exception {
        var inviter=fixture(true);var b=new Browser();b.login(inviter,true);
        String phone="+8619900112233";
        var invitation=b.post("/api/platform-admin/v1/staff/invitations",Map.of("requestId",UUID.randomUUID(),"phone",phone));
        assertEquals(200,invitation.statusCode(),invitation.body());
        String id=JSON.readTree(invitation.body()).get("id").asString();
        String token=JSON.readTree(java.nio.file.Files.readString(java.nio.file.Path.of(environment.getRequiredProperty("dreamcore.invitation.outbox"),id+".json"))).get("token").asString();
        var recipient=new Browser();
        var body=new HashMap<String,Object>();body.put("token",token);body.put("username",phone);body.put("password","staff-unified-pass");body.put("displayName","合成受邀人");
        assertEquals(400,recipient.post("/api/platform-admin/v1/auth/invitation/accept",body).statusCode());
        var challenge=recipient.post("/api/platform-admin/v1/auth/invitation/challenge",Map.of("token",token));assertEquals(200,challenge.statusCode(),challenge.body());
        String challengeId=JSON.readTree(challenge.body()).get("id").asString();
        String code=JSON.readTree(recipient.get("/api/v1/auth/phone/local-code/"+challengeId).body()).get("code").asString();
        body.put("challengeId",challengeId);body.put("code",code);
        var accepted=recipient.post("/api/platform-admin/v1/auth/invitation/accept",body);assertEquals(200,accepted.statusCode(),accepted.body());
        UUID account=UUID.fromString(JSON.readTree(accepted.body()).get("account").get("id").asString());provisioned.add(account);
        assertEquals(0,db.queryForObject("SELECT count(*) FROM platform_accounts WHERE account_id=?",Integer.class,account));
        assertEquals(200,new Browser().post("/api/v1/auth/login",Map.of("phone",phone,"password","staff-unified-pass")).statusCode());
        assertEquals(401,recipient.get("/api/v1/me").statusCode());
        assertTrue(JSON.readTree(recipient.get("/api/platform-admin/v1/auth/me").body()).get("platformAdmin").asBoolean());
        assertEquals(200,recipient.post("/api/platform-admin/v1/auth/invitation/accept",body).statusCode(),"Accepted proof retry must not duplicate the account");
    }

    @Test void verifiedLegacyLinkPreservesHistoryAndRequiresBothPasswords()throws Exception {
        var legacy=fixture(true);var customer=fixture(false);
        db.update("DELETE FROM tenant_memberships WHERE account_id=?",legacy.id());
        db.update("DELETE FROM platform_roles WHERE account_id=?",customer.id());
        var b=new Browser();b.login(legacy,true);
        var body=new HashMap<String,Object>();body.put("phone",customer.phone());body.put("customerPassword","unified-pass");body.put("currentPassword","incorrect");
        assertEquals(400,b.post("/api/platform-admin/v1/auth/link-customer",body).statusCode());
        assertEquals(0,db.queryForObject("SELECT count(*) FROM unified_identity_links WHERE source_id=?",Integer.class,legacy.id()));
        body.put("currentPassword","dedicated-pass");
        assertEquals(204,b.post("/api/platform-admin/v1/auth/link-customer",body).statusCode());
        assertEquals(401,b.get("/api/v1/me").statusCode());
        assertEquals(customer.id(),db.queryForObject("SELECT account_id FROM platform_accounts WHERE login_name=?",UUID.class,legacy.login()));
        assertEquals("DISABLED",db.queryForObject("SELECT status FROM accounts WHERE id=?",String.class,legacy.id()));
        assertEquals(1,db.queryForObject("SELECT count(*) FROM identity_audit WHERE actor_id=? AND action='UNIFIED_IDENTITY_LINK' AND target_id=?",Integer.class,legacy.id(),customer.id()));
        var result=b.post("/api/platform-admin/v1/auth/login",Map.of("username",legacy.login(),"password","dedicated-pass"));
        assertEquals(200,result.statusCode());assertEquals(customer.id().toString(),JSON.readTree(result.body()).get("account").get("id").asString());
        b.login(customer,false);
        assertEquals(1,JSON.readTree(b.get("/api/v1/me").body()).get("memberships").size());
    }
    @Autowired com.dreamcore.workspace.identity.InvitationWorkspaceAccess initialSpaces;
    @Test void invitedSpacesAreReadOnlyAndRetryDoesNotRestoreRevokedGrant()throws Exception {
        var manager=fixture(false);var member=fixture(false);UUID space=UUID.randomUUID();
        db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'合成共享空间','SHARED')",space,manager.tenant(),manager.id());
        var invitation=initialSpaces.create(manager.id(),manager.tenant(),UUID.randomUUID(),member.phone(),List.of(space));
        String token=JSON.readTree(java.nio.file.Files.readString(java.nio.file.Path.of(environment.getRequiredProperty("dreamcore.invitation.outbox"),invitation.id()+".json"))).get("token").asString();
        var b=new Browser();b.login(member,false);
        var body=Map.of("token",token,"requestId",UUID.randomUUID(),"acceptResponsibility",false);
        var result=b.post("/api/v1/auth/phone/accept",body);assertEquals(200,result.statusCode(),result.body());
        assertFalse(db.queryForObject("SELECT can_maintain FROM workspace_members WHERE workspace_id=? AND account_id=?",Boolean.class,space,member.id()));
        db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,member.id());
        assertEquals(200,b.post("/api/v1/auth/phone/accept",body).statusCode());
        assertEquals(0,db.queryForObject("SELECT count(*) FROM workspace_members WHERE workspace_id=? AND account_id=?",Integer.class,space,member.id()));
    }

    @Test void platformCookieCannotAuthenticateCustomerBindingRequests()throws Exception {
        var f=fixture(true);var b=new Browser();b.login(f,true);
        assertEquals(401,b.get("/api/v1/me").statusCode());
        assertEquals(401,b.post("/api/v1/auth/phone/bind",Map.of("phone",f.phone(),"password","dedicated-pass","challengeId",UUID.randomUUID(),"code","123456")).statusCode());
        assertEquals(200,b.get("/api/platform-admin/v1/auth/me").statusCode());
    }

    @Test void simultaneousOwnerActivationCreatesOneMembershipAndPersonalSpace()throws Exception {
        var f=fixture(false);var opening=identities.requestOpening(f.id(),UUID.randomUUID(),"合成并发开通",f.phone());
        String token=JSON.readTree(java.nio.file.Files.readString(java.nio.file.Path.of(environment.getRequiredProperty("dreamcore.invitation.outbox"),opening.invitation().id()+".json"))).get("token").asString();
        var a=new Browser();var b=new Browser();a.login(f,false);b.login(f,false);
        try(var pool=java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var gate=new java.util.concurrent.CountDownLatch(1);
            java.util.concurrent.Callable<HttpResponse<String>> first=()->{gate.await();return a.post("/api/v1/auth/phone/accept",Map.of("token",token,"requestId",UUID.randomUUID(),"acceptResponsibility",true));};
            java.util.concurrent.Callable<HttpResponse<String>> second=()->{gate.await();return b.post("/api/v1/auth/phone/accept",Map.of("token",token,"requestId",UUID.randomUUID(),"acceptResponsibility",true));};
            var fa=pool.submit(first);var fb=pool.submit(second);gate.countDown();
            for(var future:List.of(fa,fb)){var result=future.get(20,java.util.concurrent.TimeUnit.SECONDS);assertEquals(200,result.statusCode(),result.body());}
        }
        UUID tenant=opening.tenant().id();
        assertEquals(f.id(),db.queryForObject("SELECT owner_id FROM tenant_governance WHERE tenant_id=?",UUID.class,tenant));
        assertEquals(1,db.queryForObject("SELECT count(*) FROM tenant_memberships WHERE tenant_id=?",Integer.class,tenant));
        assertEquals(1,db.queryForObject("SELECT count(*) FROM workspaces WHERE tenant_id=?",Integer.class,tenant));
    }
    @Test void initialSpacePlanFailureRollsBackMembershipAndInvitationAcceptance()throws Exception {
        var manager=fixture(false);var member=fixture(false);UUID space=UUID.randomUUID();
        db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'合成共享空间','SHARED')",space,manager.tenant(),manager.id());
        var invitation=initialSpaces.create(manager.id(),manager.tenant(),UUID.randomUUID(),member.phone(),List.of(space));
        String token=JSON.readTree(java.nio.file.Files.readString(java.nio.file.Path.of(environment.getRequiredProperty("dreamcore.invitation.outbox"),invitation.id()+".json"))).get("token").asString();
        db.update("UPDATE tenant_memberships SET role='MEMBER' WHERE tenant_id=? AND account_id=?",manager.tenant(),manager.id());
        var b=new Browser();b.login(member,false);
        assertEquals(403,b.post("/api/v1/auth/phone/accept",Map.of("token",token,"requestId",UUID.randomUUID(),"acceptResponsibility",false)).statusCode());
        assertEquals("PENDING",db.queryForObject("SELECT status FROM invitations WHERE id=?",String.class,invitation.id()));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM tenant_memberships WHERE tenant_id=? AND account_id=?",Integer.class,manager.tenant(),member.id()));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM workspaces WHERE tenant_id=? AND owner_id=?",Integer.class,manager.tenant(),member.id()));
    }

}
