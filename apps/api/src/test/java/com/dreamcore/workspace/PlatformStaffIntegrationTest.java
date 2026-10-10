package com.dreamcore.workspace;

import com.dreamcore.workspace.identity.*;
import java.net.*;
import java.net.http.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,
 properties={"dreamcore.auth.ip-attempts=1000","dreamcore.auth.email-attempts=1000"})
class PlatformStaffIntegrationTest {
    @Autowired PlatformStaffService staff;
    @Autowired PlatformDirectoryService directory;
    @Autowired IdentityService identities;
    @Autowired LocalInvitationDelivery delivery;
    @Autowired JdbcTemplate db;
    @Autowired PasswordEncoder passwords;
    @LocalServerPort int port;
    static final String BASE="/api/platform-admin/v1",PWD="synthetic-platform-123";
    static final JsonMapper JSON=new JsonMapper();
    UUID actor;String login,phone;
    final List<UUID> fixtures=new ArrayList<>();
    @BeforeEach void setup() {
        actor=UUID.randomUUID();fixtures.add(actor);login=actor+"@staff.test";
        phone="+86139"+String.format("%08d",new java.security.SecureRandom().nextInt(100_000_000));
        db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",actor,"platform-"+actor+"@identity.invalid","合成管理员",passwords.encode(UUID.randomUUID().toString()));
        db.update("INSERT INTO platform_accounts(account_id,login_name,password_hash) VALUES (?,?,?)",actor,login,passwords.encode(PWD));
        db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",actor);
    }
    @AfterEach void cleanup() {
        for(UUID id:fixtures)db.update("DELETE FROM platform_staff_invitations WHERE invited_by=? OR accepted_by=?",id,id);
        for(UUID id:fixtures) {
            db.update("DELETE FROM platform_sessions WHERE account_id=?",id);
            db.update("DELETE FROM platform_roles WHERE account_id=?",id);
            db.update("DELETE FROM platform_accounts WHERE account_id=?",id);
        }
    }
    UUID accepted(String number) {
        var invite=staff.invite(actor,UUID.randomUUID(),number);
        staff.accept(delivery.localToken(invite.id()),number,PWD,"合成受邀人","127.0.0.1");
        UUID id=db.queryForObject("SELECT account_id FROM platform_accounts WHERE login_name=?",UUID.class,number);fixtures.add(id);return id;
    }
    @Test void exactRecipientIndependentCredentialsAndRetryCannotRestoreRevokedQualification() {
        UUID customer=UUID.randomUUID();
        db.update("INSERT INTO accounts(id,email,phone,display_name,password_hash,phone_verified_at) VALUES (?,?,?,?,?,now())",customer,customer+"@staff.test",phone,"合成客户",passwords.encode("customer-other-password"));
        UUID request=UUID.randomUUID();var invite=staff.invite(actor,request,phone);
        assertEquals(invite.id(),staff.invite(actor,request,phone).id());
        assertThrows(IdentityException.class,()->staff.invite(actor,UUID.randomUUID(),phone));
        String token=delivery.localToken(invite.id());assertFalse(staff.preview(token).existingAccount());
        assertEquals(403,assertThrows(IdentityException.class,()->staff.accept(token,"+8613800000000",PWD,"不能接受","127.0.0.1")).status);
        staff.accept(token,phone,PWD,"独立总台账号","127.0.0.1");
        UUID invited=db.queryForObject("SELECT account_id FROM platform_accounts WHERE login_name=?",UUID.class,phone);fixtures.add(invited);
        assertNotEquals(customer,invited);assertTrue(identities.validSession(customer,0));
        staff.accept(token,phone,PWD,"重复不会覆盖姓名","127.0.0.1");
        assertEquals("独立总台账号",identities.account(invited).displayName());
        var next=staff.invite(invited,UUID.randomUUID(),"+8613800000001");
        UUID revoke=UUID.randomUUID();staff.revoke(actor,invited,revoke,1);staff.revoke(actor,invited,revoke,1);
        assertEquals("REVOKED",staff.list(actor).stream().filter(i->i.id().equals(next.id())).findFirst().orElseThrow().status());
        assertThrows(IdentityException.class,()->staff.accept(token,phone,PWD,"重放","127.0.0.1"));
        assertTrue(identities.validSession(customer,0));assertEquals("ACTIVE",directory.detail(actor,customer).account().status());
        var reinvite=staff.invite(actor,UUID.randomUUID(),phone);String renewed=delivery.localToken(reinvite.id());
        assertTrue(staff.preview(renewed).existingAccount());
        assertThrows(IdentityException.class,()->staff.accept(renewed,phone,"customer-other-password","不覆盖","127.0.0.1"));
        staff.accept(renewed,phone,PWD,"不覆盖","127.0.0.1");
        assertEquals("STALE_MANAGEMENT_VERSION",assertThrows(IdentityException.class,()->staff.revoke(actor,invited,UUID.randomUUID(),1)).code);assertEquals("独立总台账号",identities.account(invited).displayName());
    }
    @Test void expiredAndRevokedInvitationsNeverGrantQualification() {
        var invite=staff.invite(actor,UUID.randomUUID(),phone);String token=delivery.localToken(invite.id());
        db.update("UPDATE platform_staff_invitations SET expires_at=now()-interval '1 second' WHERE id=?",invite.id());
        assertThrows(IdentityException.class,()->staff.preview(token));
        assertThrows(IdentityException.class,()->staff.accept(token,phone,PWD,"合成人员","127.0.0.1"));
        var replacement=staff.invite(actor,UUID.randomUUID(),phone);UUID request=UUID.randomUUID();
        staff.revokeInvite(actor,replacement.id(),request);staff.revokeInvite(actor,replacement.id(),request);
        assertThrows(IdentityException.class,()->staff.accept(delivery.localToken(replacement.id()),phone,PWD,"合成人员","127.0.0.1"));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM platform_accounts WHERE login_name=?",Integer.class,phone));
    }
    @Test void concurrentMutualRevocationRetainsOneActiveAdministrator() throws Exception {
        UUID other=accepted(phone);
        assertEquals(2,db.queryForObject("SELECT count(*) FROM platform_accounts p JOIN platform_roles r ON r.account_id=p.account_id JOIN accounts a ON a.id=p.account_id WHERE a.status='ACTIVE'",Integer.class));
        try(var executor=java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
            var one=executor.submit(()->{try {staff.revoke(actor,other,UUID.randomUUID(),1);return true;}catch(IdentityException denied){return false;}});
            var two=executor.submit(()->{try {staff.revoke(other,actor,UUID.randomUUID(),0);return true;}catch(IdentityException denied){return false;}});
            assertNotEquals(one.get(),two.get());
        }
        UUID remaining=db.queryForObject("SELECT p.account_id FROM platform_accounts p JOIN platform_roles r ON r.account_id=p.account_id",UUID.class);
        assertEquals("LAST_PLATFORM_ADMIN",assertThrows(IdentityException.class,()->staff.revoke(remaining,remaining,UUID.randomUUID(),remaining.equals(actor)?0:1)).code);
    }
    final class Browser {
        final HttpClient client=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();
        HttpResponse<String> send(String method,String path,Object body,String csrf) throws Exception {
            var builder=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).header("Content-Type","application/json");
            if(csrf!=null)builder.header("X-CSRF-TOKEN",csrf);
            return client.send(builder.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body))).build(),HttpResponse.BodyHandlers.ofString());
        }
        HttpResponse<String> post(String path,Object body) throws Exception {
            String csrf=JSON.readTree(send("GET",BASE+"/auth/csrf",null,null).body()).get("token").asString();
            return send("POST",BASE+path,body,csrf);
        }
    }
    @Test void httpRequiresPlatformSessionAndCsrfButAllowsIndependentInviteAcceptance() throws Exception {
        var browser=new Browser();
        assertEquals(401,browser.send("GET",BASE+"/staff",null,null).statusCode());
        assertEquals(200,browser.post("/auth/login",Map.of("username",login,"password",PWD)).statusCode());
        assertEquals(403,browser.send("POST",BASE+"/staff/invitations",Map.of("requestId",UUID.randomUUID(),"phone",phone),null).statusCode());
        var response=browser.post("/staff/invitations",Map.of("requestId",UUID.randomUUID(),"phone",phone));
        assertEquals(200,response.statusCode(),response.body());assertFalse(response.body().contains("token"));
        UUID invite=UUID.fromString(JSON.readTree(response.body()).get("id").asString());String token=delivery.localToken(invite);
        UUID existingUnified=UUID.randomUUID();
        db.update("INSERT INTO accounts(id,phone,phone_verified_at,display_name,password_hash) VALUES (?,?,now(),'已有统一账号',?)",existingUnified,phone,passwords.encode(PWD));
        var recipient=new Browser();
        assertEquals(200,recipient.post("/auth/invitation/preview",Map.of("token",token)).statusCode());
        var accepted=recipient.post("/auth/invitation/accept",Map.of("token",token,"username",phone,"password",PWD,"displayName","新总台人员"));
        assertEquals(200,accepted.statusCode(),accepted.body());
        UUID id=UUID.fromString(JSON.readTree(accepted.body()).get("account").get("id").asString());fixtures.add(id);
        assertEquals(200,recipient.send("GET",BASE+"/staff",null,null).statusCode());
        assertEquals(200,recipient.send("GET","/api/v1/me",null,null).statusCode());
        assertEquals(204,browser.post("/staff/"+id+"/revoke",Map.of("requestId",UUID.randomUUID(),"expectedVersion",1)).statusCode());
        assertEquals(403,recipient.send("GET",BASE+"/staff",null,null).statusCode());
    }
}
