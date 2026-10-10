package com.dreamcore.workspace;

import com.dreamcore.workspace.identity.*;
import java.net.*;
import java.net.http.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={
    "dreamcore.phone.delivery=local","dreamcore.phone.local-preview=true",
    "dreamcore.phone.outbox=${INVITATION_OUTBOX}/phone","dreamcore.auth.ip-attempts=1000"})
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class PhoneIdentityIntegrationTest {
    static final String PASSWORD="123456";
    static final JsonMapper JSON=new JsonMapper();
    static final AtomicInteger NEXT=new AtomicInteger(1000);
    @LocalServerPort int port;
    @Autowired JdbcTemplate db;
    @Autowired IdentityService identities;
    @Autowired PasswordEncoder passwords;
    @Autowired Environment env;
    UUID platform;
    String phone(){return "+86199"+String.format(Locale.ROOT,"%08d",NEXT.incrementAndGet());}
    final class Client {
        final CookieManager cookies=new CookieManager(null,CookiePolicy.ACCEPT_ALL);
        final HttpClient http=HttpClient.newBuilder().cookieHandler(cookies).build();
        HttpResponse<String> send(String method,String path,Object body,boolean csrf)throws Exception{
            var req=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).timeout(java.time.Duration.ofSeconds(15));
            if(csrf){var token=JSON.readTree(send("GET",path.startsWith("/api/platform-admin/")?"/api/platform-admin/v1/auth/csrf":"/api/v1/auth/csrf",null,false).body());req.header(token.get("headerName").asString(),token.get("token").asString());}
            req.header("Content-Type","application/json");req.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body)));
            return http.send(req.build(),HttpResponse.BodyHandlers.ofString());
        }
        JsonNode call(String method,String path,Object body,int expected)throws Exception{
            var response=send(method,path,body,!"GET".equals(method));assertEquals(expected,response.statusCode(),response.body());
            return response.body().isEmpty()?null:JSON.readTree(response.body());
        }
        JsonNode post(String path,Object body,int expected)throws Exception{return call("POST","/api/v1/auth/phone"+path,body,expected);}
        JsonNode login(String phone,String password)throws Exception{return call("POST","/api/v1/auth/login",Map.of("phone",phone,"password",password),200);}
        JsonNode me()throws Exception{return call("GET","/api/v1/me",null,200);}
        JsonNode challenge(String purpose,String phone,String token)throws Exception{
            var body=new HashMap<String,Object>();body.put("purpose",purpose);if(phone!=null)body.put("phone",phone);if(token!=null)body.put("token",token);
            return post("/challenges",body,200);
        }
        String code(JsonNode challenge)throws Exception{return call("GET","/api/v1/auth/phone/local-code/"+challenge.get("id").asString(),null,200).get("code").asString();}
    }
    record Invite(UUID id,UUID tenant,String phone,String token){}
    Invite invite(boolean owner)throws Exception{
        String p=phone();var created=identities.createTenant(platform,UUID.randomUUID(),"合成手机号企业",p,owner);
        var file=Path.of(env.getRequiredProperty("dreamcore.invitation.outbox"),created.invitation().id()+".json");
        return new Invite(created.invitation().id(),created.tenant().id(),p,JSON.readTree(Files.readString(file)).get("token").asString());
    }
    Map<String,Object> acceptance(Invite i,JsonNode challenge,String code,boolean owner){
        var body=new HashMap<String,Object>();body.put("requestId",UUID.randomUUID().toString());body.put("token",i.token());body.put("displayName","合成员工");body.put("password",PASSWORD);body.put("acceptResponsibility",owner);
        if(challenge!=null){body.put("challengeId",challenge.get("id").asString());body.put("code",code);}return body;
    }
    Client join(Invite i)throws Exception{var c=new Client();var challenge=c.challenge("JOIN",null,i.token());c.post("/accept",acceptance(i,challenge,c.code(challenge),false),200);return c;}
    void cooldown(String phone){db.update("UPDATE phone_challenges SET created_at=now()-interval '2 minutes' WHERE phone=?",phone);}
    @BeforeAll void setup(){
        platform=UUID.randomUUID();db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",platform,platform+"@phone.test","合成平台",passwords.encode(PASSWORD));
        db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",platform);
    }
    @AfterAll void cleanupPlatformRole(){db.update("DELETE FROM platform_roles WHERE account_id=?",platform);}
    @Test void sixCharactersCreateAnAuthenticatedAccountAndAcceptExplicitResponsibility()throws Exception{
        var i=invite(true);var c=new Client();
        var preview=c.post("/invitation",Map.of("token",i.token()),200);assertEquals("CREATE",preview.get("action").asString());assertTrue(preview.get("designatedOwner").asBoolean());
        assertEquals(i.phone(),c.post("/invitation",Map.of(),200).get("phone").asString()); // Refresh restores server-side invitation intent.
        var challenge=c.challenge("JOIN",null,i.token());String code=c.code(challenge);String before=c.cookies.getCookieStore().getCookies().getFirst().getValue();
        var body=acceptance(i,challenge,code,true);body.put("password","12345");c.post("/accept",body,400);
        assertEquals(0,db.queryForObject("SELECT count(*) FROM accounts WHERE phone=?",Integer.class,i.phone()));
        body.put("password",PASSWORD);var result=c.post("/accept",body,200);UUID account=UUID.fromString(result.get("identity").get("account").get("id").asString());
        assertEquals(i.phone(),c.me().get("account").get("phone").asString());assertTrue(c.me().get("account").get("email").isNull());
        assertFalse(c.me().get("account").has("credentialVersion"));
        assertNotEquals(before,c.cookies.getCookieStore().getCookies().getFirst().getValue());
        assertEquals(account,db.queryForObject("SELECT owner_id FROM tenant_governance WHERE tenant_id=?",UUID.class,i.tenant()));
        c.post("/accept",body,200); // Lost-response retry observes the same membership.
        assertEquals(1,db.queryForObject("SELECT count(*) FROM workspaces WHERE tenant_id=? AND owner_id=?",Integer.class,i.tenant(),account));
        assertEquals(1,db.queryForObject("SELECT count(*) FROM identity_audit WHERE action='INVITATION_ACCEPT' AND target_id=?",Integer.class,i.id()));
    }
    @Test void phoneCanonicalizationAndCsrfProtectNormalLogin()throws Exception{
        var i=invite(false);var c=join(i);UUID account=UUID.fromString(c.me().get("account").get("id").asString());var other=new Client();
        other.call("GET","/api/v1/auth/csrf",null,200);
        assertEquals(403,other.send("POST","/api/v1/auth/login",Map.of("phone",i.phone(),"password",PASSWORD),false).statusCode());
        assertEquals(account.toString(),other.login(i.phone().substring(3),PASSWORD).get("account").get("id").asString());
        other.call("POST","/api/v1/auth/login",Map.of("phone",i.phone(),"password","000000"),401);
        other.call("POST","/api/v1/auth/login",Map.of("phone","138","password",PASSWORD),400);
        other.call("POST","/api/v1/auth/login",Map.of("phone",i.phone(),"email","extra@test.invalid","password",PASSWORD),400);
    }
    @Test void existingAccountJoinsWithPasswordWithoutChangingNameOrPassword()throws Exception{
        var original=invite(false);var existing=join(original);String account=existing.me().get("account").get("id").asString();
        var created=identities.createTenant(platform,UUID.randomUUID(),"另一合成企业",original.phone());
        String token=JSON.readTree(Files.readString(Path.of(env.getRequiredProperty("dreamcore.invitation.outbox"),created.invitation().id()+".json"))).get("token").asString();
        var target=new Invite(created.invitation().id(),created.tenant().id(),original.phone(),token);var c=new Client();
        assertEquals("LOGIN",c.post("/invitation",Map.of("token",token),200).get("action").asString());
        c.post("/challenges",Map.of("purpose","JOIN","token",token),409);
        var body=acceptance(target,null,null,false);body.put("password","000000");c.post("/accept",body,401);
        body.put("password",PASSWORD);body.put("displayName","不得覆盖原姓名");c.post("/accept",body,200);
        assertEquals(account,c.me().get("account").get("id").asString());assertEquals("合成员工",c.me().get("account").get("displayName").asString());assertEquals(2,c.me().get("memberships").size());
        c.call("POST","/api/v1/auth/invitations/accept",Map.of("token",token,"displayName","攻击","password","000000"),409);
    }
    @Test void wrongAccountAndRevokedInvitationsCannotAddMembership()throws Exception{
        var a=invite(false);var c=join(a);var b=invite(false);
        assertEquals("SWITCH",c.post("/invitation",Map.of("token",b.token()),200).get("action").asString());
        c.post("/accept",acceptance(b,null,null,false),403);
        assertEquals(1,c.me().get("memberships").size());
        var waiting=new Client();var challenge=waiting.challenge("JOIN",null,b.token());String code=waiting.code(challenge);
        db.update("UPDATE invitations SET status='REVOKED' WHERE id=?",b.id());waiting.post("/accept",acceptance(b,challenge,code,false),409);
        assertEquals(0,db.queryForObject("SELECT count(*) FROM accounts WHERE phone=?",Integer.class,b.phone()));
    }
    @Test void codesAreBrowserBoundExpireAndPersistFailedAttempts()throws Exception{
        var i=invite(false);var c=new Client();var challenge=c.challenge("JOIN",null,i.token());String code=c.code(challenge);var other=new Client();
        other.call("GET","/api/v1/auth/phone/local-code/"+challenge.get("id").asString(),null,404);
        other.post("/accept",acceptance(i,challenge,code,false),400);
        c.post("/challenges",Map.of("purpose","JOIN","token",i.token()),429);
        String wrong="000000".equals(code)?"000001":"000000";
        for(int n=0;n<5;n++)c.post("/accept",acceptance(i,challenge,wrong,false),400);
        c.post("/accept",acceptance(i,challenge,code,false),429);
        assertEquals(5,db.queryForObject("SELECT attempts FROM phone_challenges WHERE id=?",Integer.class,UUID.fromString(challenge.get("id").asString())));
        cooldown(i.phone());var fresh=c.challenge("JOIN",null,i.token());String freshCode=c.code(fresh);
        db.update("UPDATE phone_challenges SET expires_at=now()-interval '1 second' WHERE id=?",UUID.fromString(fresh.get("id").asString()));
        c.post("/accept",acceptance(i,fresh,freshCode,false),400);
    }
    @Test void legacyBindingPreservesAccountMembershipAndSpaceAndDisablesEmailLogin()throws Exception{
        String email=UUID.randomUUID()+"@legacy.test";var created=identities.createTenant(platform,UUID.randomUUID(),"合成旧企业",email);
        String token=JSON.readTree(Files.readString(Path.of(env.getRequiredProperty("dreamcore.invitation.outbox"),created.invitation().id()+".json"))).get("token").asString();
        var c=new Client();c.call("POST","/api/v1/auth/invitations/accept",Map.of("token",token,"displayName","原账号","password",PASSWORD),200);
        var old=c.call("POST","/api/v1/auth/login",Map.of("email",email,"password",PASSWORD),200);String id=old.get("account").get("id").asString();
        var second=new Client();second.call("POST","/api/v1/auth/login",Map.of("email",email,"password",PASSWORD),200);
        UUID space=db.queryForObject("SELECT id FROM workspaces WHERE owner_id=?",UUID.class,UUID.fromString(id));String p=phone();var challenge=c.challenge("BIND",p,null);String code=c.code(challenge);
        var body=new HashMap<String,Object>(Map.of("phone",p,"password","000000","challengeId",challenge.get("id").asString(),"code",code));c.post("/bind",body,401);
        body.put("password",PASSWORD);var bound=c.post("/bind",body,200);assertEquals(id,bound.get("account").get("id").asString());assertEquals(1,c.me().get("memberships").size());
        assertEquals(space,db.queryForObject("SELECT id FROM workspaces WHERE owner_id=?",UUID.class,UUID.fromString(id)));
        second.call("GET","/api/v1/me",null,401);
        new Client().call("POST","/api/v1/auth/login",Map.of("email",email,"password",PASSWORD),401);
        assertEquals(id,new Client().login(p,PASSWORD).get("account").get("id").asString());
        c.post("/challenges",Map.of("purpose","BIND","phone",phone()),409);
    }
    @Test void passwordResetConsumesProofAndRevokesAllSessions()throws Exception{
        var i=invite(false);var c=join(i);var second=new Client();second.login(i.phone(),PASSWORD);var recovery=new Client();cooldown(i.phone());
        var challenge=recovery.challenge("RESET",i.phone(),null);String code=recovery.code(challenge);
        var body=Map.of("phone",i.phone(),"password","654321","challengeId",challenge.get("id").asString(),"code",code);
        recovery.post("/reset",body,204);recovery.call("GET","/api/v1/me",null,401);c.call("GET","/api/v1/me",null,401);second.call("GET","/api/v1/me",null,401);
        new Client().call("POST","/api/v1/auth/login",Map.of("phone",i.phone(),"password",PASSWORD),401);
        assertEquals(i.phone(),new Client().login(i.phone(),"654321").get("account").get("phone").asString());
        recovery.post("/reset",body,400);
    }
    @Test void resetChallengesDoNotCreateAccountsOrRevealExistence()throws Exception{
        String p=phone();var c=new Client();var receipt=c.challenge("RESET",p,null);assertEquals("LOCAL",receipt.get("delivery").asString());assertFalse(receipt.has("code"));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM accounts WHERE phone=?",Integer.class,p));
        c.post("/reset",Map.of("phone",p,"password",PASSWORD,"challengeId",receipt.get("id").asString(),"code","000000"),400);
    }
    @Test void passwordChangeUsesSixCharacterRuleAndSignsOut()throws Exception{
        var i=invite(false);var c=join(i);c.post("/password",Map.of("currentPassword",PASSWORD,"password","12345"),400);
        c.post("/password",Map.of("currentPassword",PASSWORD,"password","abcdef"),204);c.call("GET","/api/v1/me",null,401);
        new Client().login(i.phone(),"abcdef");
    }
    @Test void aLateSessionSaveCannotRestoreAccessAfterPasswordChange()throws Exception{
        var i=invite(false);var c=join(i);String account=c.me().get("account").get("id").asString();
        String cookie=c.cookies.getCookieStore().getCookies().stream().map(value->value.getName()+"="+value.getValue()).collect(java.util.stream.Collectors.joining("; "));
        var session=db.queryForMap("SELECT * FROM spring_session WHERE principal_name=?",account);
        var attributes=db.queryForList("SELECT * FROM spring_session_attributes WHERE session_primary_id=?",session.get("primary_id"));
        c.post("/password",Map.of("currentPassword",PASSWORD,"password","abcdef"),204);
        // Simulate an in-flight request writing its pre-change session snapshot after revocation.
        db.update("INSERT INTO spring_session(primary_id,session_id,creation_time,last_access_time,max_inactive_interval,expiry_time,principal_name) VALUES (?,?,?,?,?,?,?)",
            session.get("primary_id"),session.get("session_id"),session.get("creation_time"),session.get("last_access_time"),session.get("max_inactive_interval"),session.get("expiry_time"),session.get("principal_name"));
        for(var attribute:attributes) db.update("INSERT INTO spring_session_attributes(session_primary_id,attribute_name,attribute_bytes) VALUES (?,?,?)",attribute.get("session_primary_id"),attribute.get("attribute_name"),attribute.get("attribute_bytes"));
        var response=HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/v1/me")).timeout(java.time.Duration.ofSeconds(15)).header("Cookie",cookie).GET().build(),HttpResponse.BodyHandlers.ofString());
        assertEquals(401,response.statusCode(),response.body());
        assertFalse(identities.validSession(UUID.fromString(account),0));
        new Client().login(i.phone(),"abcdef");
    }
    @Test void localInvitationPreviewRequiresCurrentManagementRights()throws Exception{
        var i=invite(false);var c=join(i);var target=invite(false);
        new Client().call("GET","/api/v1/auth/phone/local-invitation/"+target.id(),null,401);
        c.call("GET","/api/v1/auth/phone/local-invitation/"+target.id(),null,403);
        db.update("INSERT INTO platform_accounts(account_id,login_name,password_hash) VALUES (?,?,?)",platform,platform+"@phone.test",passwords.encode(PASSWORD));
        var admin=new Client();admin.call("POST","/api/platform-admin/v1/auth/login",Map.of("username",platform+"@phone.test","password",PASSWORD),200);
        var link=admin.call("GET","/api/platform-admin/v1/local-invitations/"+target.id(),null,200);assertTrue(link.get("path").asString().startsWith("/workspace/#invite="));
        db.update("DELETE FROM platform_sessions WHERE account_id=?",platform);
        db.update("DELETE FROM platform_accounts WHERE account_id=?",platform);
    }
    @Test void noContentPermissionsAreGrantedByJoiningOrBecomingOwner()throws Exception{
        var i=invite(true);var c=join(i);UUID account=UUID.fromString(c.me().get("account").get("id").asString());
        assertEquals(0,db.queryForObject("SELECT count(*) FROM tenant_governance WHERE tenant_id=? AND owner_id IS NOT NULL",Integer.class,i.tenant()));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM workspace_members WHERE account_id=?",Integer.class,account));
        assertEquals(403,c.send("GET","/api/platform-admin/v1/tenants",null,false).statusCode());
    }
    @Test void disabledOrSuspendedIdentityCannotBeRecoveredViaInvitation()throws Exception{
        var i=invite(false);var c=join(i);var old=c.me();UUID account=UUID.fromString(old.get("account").get("id").asString());
        db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",i.tenant(),account);
        c.post("/accept",acceptance(i,null,null,false),403);
        assertEquals(0,c.me().get("memberships").size());
        db.update("UPDATE accounts SET status='DISABLED' WHERE id=?",account);new Client().call("POST","/api/v1/auth/login",Map.of("phone",i.phone(),"password",PASSWORD),401);
    }
    @Test void concurrentJoinCreatesOneAccountAndMembership()throws Exception{
        var i=invite(false);var a=new Client();var b=new Client();var ca=a.challenge("JOIN",null,i.token());String codeA=a.code(ca);
        cooldown(i.phone());var cb=b.challenge("JOIN",null,i.token());String codeB=b.code(cb);
        try(var pool=java.util.concurrent.Executors.newFixedThreadPool(2)){
            var one=pool.submit(()->a.post("/accept",acceptance(i,ca,codeA,false),200));
            var two=pool.submit(()->b.post("/accept",acceptance(i,cb,codeB,false),200));
            assertEquals(one.get(20,java.util.concurrent.TimeUnit.SECONDS).get("identity").get("account").get("id"),two.get(20,java.util.concurrent.TimeUnit.SECONDS).get("identity").get("account").get("id"));
        }
        assertEquals(1,db.queryForObject("SELECT count(*) FROM accounts WHERE phone=?",Integer.class,i.phone()));
        assertEquals(1,db.queryForObject("SELECT count(*) FROM tenant_memberships WHERE tenant_id=?",Integer.class,i.tenant()));
    }
    @Test void localDeliveryCannotRunInProductionOrExposeCodesToNonLoopbackAddresses(){
        var production=new org.springframework.mock.env.MockEnvironment();
        var disabled=new LocalPhoneDelivery(production,"local",true,"unused");
        assertEquals("DISABLED",disabled.mode());assertThrows(IdentityException.class,disabled::requireEnabled);
        var local=new org.springframework.mock.env.MockEnvironment();local.setActiveProfiles("local");
        var delivery=new LocalPhoneDelivery(local,"local",true,"unused");
        assertTrue(delivery.previewEnabled("127.0.0.1"));assertFalse(delivery.previewEnabled("192.168.1.2"));
        assertFalse(new LocalPhoneDelivery(local,"local",false,"unused").previewEnabled("127.0.0.1"));
    }
}
