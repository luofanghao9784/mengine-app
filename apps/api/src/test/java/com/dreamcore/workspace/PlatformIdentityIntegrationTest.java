package com.dreamcore.workspace;

import com.dreamcore.workspace.identity.IdentityService;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,
 properties={"dreamcore.auth.ip-attempts=1000","dreamcore.auth.email-attempts=1000","dreamcore.platform.cookie-name=DREAMCORE_PLATFORM_SYNTHETIC"})
class PlatformIdentityIntegrationTest {
    @org.springframework.test.context.DynamicPropertySource
    static void isolatedDatabase(org.springframework.test.context.DynamicPropertyRegistry registry) {
        IsolatedTestDatabase.register(registry);
    }
    private static final JsonMapper JSON=new JsonMapper();
    private static final String PLATFORM="/api/platform-admin/v1/auth";
    private static final String CUSTOMER="/api/v1/auth";
    @LocalServerPort int port;
    @Autowired JdbcTemplate db;
    @Autowired IdentityService identities;
    @Autowired PasswordEncoder passwords;
    UUID provisionedPlatform;
    @org.junit.jupiter.api.AfterEach void cleanupPlatformFixture() {
        if(provisionedPlatform==null) return;
        db.update("DELETE FROM platform_sessions WHERE account_id=?",provisionedPlatform);
        db.update("DELETE FROM platform_accounts WHERE account_id=?",provisionedPlatform);
        db.update("DELETE FROM platform_roles WHERE account_id=?",provisionedPlatform);
    }
    final class Browser {
        final CookieManager cookies=new CookieManager(null,CookiePolicy.ACCEPT_ALL);
        final HttpClient http=HttpClient.newBuilder().cookieHandler(cookies).build();
        HttpResponse<String> send(String method,String path,Object body,String csrf) throws Exception {
            var request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).header("Content-Type","application/json");
            if(csrf!=null) request.header("X-CSRF-TOKEN",csrf);
            request.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body)));
            return http.send(request.build(),HttpResponse.BodyHandlers.ofString());
        }
        String csrf(String realm) throws Exception {
            var response=send("GET",realm+"/csrf",null,null); assertEquals(200,response.statusCode(),response.body());
            return JSON.readTree(response.body()).get("token").asString();
        }
        HttpResponse<String> post(String realm,String action,Object body) throws Exception { return send("POST",realm+action,body,csrf(realm)); }
        int get(String path) throws Exception { return send("GET",path,null,null).statusCode(); }
    }
    @Test void bootstrapWithLegacyCustomerRoleCreatesIndependentOperatorWithoutChangingCustomer() throws Exception {
        String login="legacy-"+UUID.randomUUID()+"@example.test";
        String customerPassword="synthetic-customer-legacy",platformPassword="synthetic-platform-new";
        UUID customer=UUID.randomUUID();String before=passwords.encode(customerPassword);
        db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",customer,login,"旧企业账号",before);
        db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",customer);
        provisionedPlatform=identities.bootstrap(login,"独立总台账号",platformPassword);
        assertNotEquals(customer,provisionedPlatform);
        assertEquals(before,db.queryForObject("SELECT password_hash FROM accounts WHERE id=?",String.class,customer));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM tenant_memberships WHERE account_id=?",Integer.class,provisionedPlatform));
        var browser=new Browser();
        assertEquals(200,browser.post(CUSTOMER,"/login",Map.of("email",login,"password",customerPassword)).statusCode());
        assertEquals(401,browser.get(PLATFORM+"/me"));
        assertEquals(401,browser.post(PLATFORM,"/login",Map.of("username",login,"password",customerPassword)).statusCode());
        assertEquals(200,browser.post(PLATFORM,"/login",Map.of("username",login,"password",platformPassword)).statusCode());
        assertEquals(customer.toString(),JSON.readTree(browser.send("GET","/api/v1/me",null,null).body()).get("account").get("id").asString());
        db.update("DELETE FROM platform_roles WHERE account_id=?",customer);
    }
    @Test void pendingEnterpriseStatusUsesPlatformRealmWithoutExpiringItsSession() throws Exception {
        String login="pending-"+UUID.randomUUID()+"@example.test",password="synthetic-platform-status";
        provisionedPlatform=identities.bootstrap(login,"合成总台管理员",password);
        var platform=new Browser();
        assertEquals(200,platform.post(PLATFORM,"/login",Map.of("username",login,"password",password)).statusCode());
        var created=platform.send("POST","/api/platform-admin/v1/tenants",Map.of("requestId",UUID.randomUUID(),"name","待邀请合成企业","adminPhone","+8619900999001","designateAuthorizationOwner",true),platform.csrf(PLATFORM));
        assertEquals(201,created.statusCode());
        String tenant=JSON.readTree(created.body()).get("tenant").get("id").asString();
        assertEquals(200,platform.get("/api/platform-admin/v1/tenants/"+tenant));
        String statusPath="/api/platform-admin/v1/tenants/"+tenant+"/departure-status";
        var status=platform.send("GET",statusPath,null,null);
        assertEquals(200,status.statusCode());
        var payload=JSON.readTree(status.body());
        assertFalse(payload.get("businessEnabled").asBoolean());
        assertFalse(payload.get("canExport").asBoolean());
        assertEquals(200,platform.get(PLATFORM+"/me"));
        // The customer realm must not grant platform status access, even with a valid login.
        String customerLogin="customer-"+UUID.randomUUID()+"@example.test";
        db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",UUID.randomUUID(),customerLogin,"合成客户",passwords.encode("synthetic-customer-status"));
        var customer=new Browser();
        assertEquals(200,customer.post(CUSTOMER,"/login",Map.of("email",customerLogin,"password","synthetic-customer-status")).statusCode());
        assertEquals(401,customer.get(statusPath));
        assertEquals(401,platform.get("/api/v1/platform/tenants/"+tenant+"/departure-status"));
        assertEquals(200,platform.get(PLATFORM+"/me"));
    }
    @Test void deploymentCannotConfigureInvalidOrSharedCustomerCookieName() {
        assertThrows(IllegalArgumentException.class,()->new com.dreamcore.workspace.identity.PlatformIdentity(db,passwords,identities,null,null,"bad;name","CUSTOMER"));
        assertThrows(IllegalArgumentException.class,()->new com.dreamcore.workspace.identity.PlatformIdentity(db,passwords,identities,null,null,"SAME","SAME"));
    }
    @Test void platformAndSharedCustomerSessionsCoexistAndLogoutIndependently() throws Exception {
        String login="platform-"+UUID.randomUUID()+"@example.test";
        String customerPassword="customer-synthetic-123",platformPassword="platform-synthetic-456";
        UUID customer=UUID.randomUUID();
        db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",customer,login,"企业用户",passwords.encode(customerPassword));
        // Same visible login identifier, two independent credential records and actor IDs.
        UUID platform=UUID.randomUUID(); provisionedPlatform=platform;
        db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",platform,"platform-"+platform+"@identity.invalid","总台管理员",passwords.encode(UUID.randomUUID().toString()));
        db.update("INSERT INTO platform_accounts(account_id,login_name,password_hash) VALUES (?,?,?)",platform,login,passwords.encode(platformPassword));
        db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",platform);
        assertNotEquals(customer,platform);
        var browser=new Browser();
        assertEquals(200,browser.post(CUSTOMER,"/login",Map.of("email",login,"password",customerPassword)).statusCode());
        assertEquals(200,browser.get("/api/v1/me"));
        assertEquals(401,browser.get("/api/platform-admin/v1/overview"));
        assertEquals(401,browser.post(PLATFORM,"/login",Map.of("username",login,"password",customerPassword)).statusCode());
        assertEquals(403,browser.send("POST",PLATFORM+"/login",Map.of("username",login,"password",platformPassword),new Browser().csrf(CUSTOMER)).statusCode());
        var signedIn=browser.post(PLATFORM,"/login",Map.of("username",login,"password",platformPassword));
        assertEquals(200,signedIn.statusCode(),signedIn.body());
        String issuedCookie=signedIn.headers().allValues("set-cookie").stream().filter(c->c.startsWith("DREAMCORE_PLATFORM_SYNTHETIC=")).findFirst().orElseThrow();
        assertTrue(issuedCookie.startsWith("DREAMCORE_PLATFORM_SYNTHETIC="));
        assertTrue(issuedCookie.contains("Path=/api/platform-admin/"));
        assertTrue(issuedCookie.contains("HttpOnly"));
        assertTrue(issuedCookie.contains("SameSite="));
        assertEquals(platform.toString(),JSON.readTree(signedIn.body()).get("account").get("id").asString());
        assertEquals(0,JSON.readTree(signedIn.body()).get("memberships").size());
        assertEquals(200,browser.get("/api/platform-admin/v1/overview"));
        assertEquals(customer.toString(),JSON.readTree(browser.send("GET","/api/v1/me",null,null).body()).get("account").get("id").asString());
        // Parallel tabs can request CSRF without invalidating each other's next action.
        String first=browser.csrf(PLATFORM); assertNotNull(first); assertNotNull(browser.csrf(PLATFORM));
        assertEquals(204,browser.post(PLATFORM,"/logout",null).statusCode());
        assertEquals(401,browser.get(PLATFORM+"/me")); assertEquals(200,browser.get("/api/v1/me"));
        assertEquals(200,browser.post(PLATFORM,"/login",Map.of("username",login,"password",platformPassword)).statusCode());
        assertEquals(204,browser.post(CUSTOMER,"/logout",null).statusCode());
        assertEquals(401,browser.get("/api/v1/me")); assertEquals(200,browser.get(PLATFORM+"/me"));
        db.update("UPDATE platform_accounts SET credential_version=credential_version+1 WHERE account_id=?",platform);
        assertEquals(401,browser.get(PLATFORM+"/me"));
        assertEquals(200,browser.post(CUSTOMER,"/login",Map.of("email",login,"password",customerPassword)).statusCode());
        assertEquals(200,browser.post(PLATFORM,"/login",Map.of("username",login,"password",platformPassword)).statusCode());
        db.update("UPDATE accounts SET credential_version=credential_version+1 WHERE id=?",customer);
        assertEquals(401,browser.get("/api/v1/me")); assertEquals(200,browser.get(PLATFORM+"/me"));
        db.update("DELETE FROM platform_roles WHERE account_id=?",platform);
        assertEquals(401,browser.get(PLATFORM+"/me"));
        db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",platform);
        assertEquals(401,browser.get(PLATFORM+"/me"),"Revoked platform cookies must not revive when a role is regranted");
        // No platform session or principal can be reused for a customer login.
        assertEquals(401,browser.post(CUSTOMER,"/login",Map.of("email",login,"password",platformPassword)).statusCode());
    }
    private UUID platform(String login,String password) {
        UUID id=UUID.randomUUID();provisionedPlatform=id;
        db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",id,"platform-"+id+"@identity.invalid","合成管理人员",passwords.encode(UUID.randomUUID().toString()));
        db.update("INSERT INTO platform_accounts(account_id,login_name,password_hash) VALUES (?,?,?)",id,login,passwords.encode(password));
        db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",id);return id;
    }
    @Test void passwordRequiresDedicatedCredentialAndPreservesUnrelatedUsers() throws Exception {
        String login="password-"+UUID.randomUUID()+"@example.test",old="old-platform-synthetic",next="new-platform-synthetic";
        UUID actor=platform(login,old),customer=UUID.randomUUID();
        db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",customer,login,"客户",passwords.encode("customer-only"));
        Browser first=new Browser(),second=new Browser(),customerOnly=new Browser();
        for(Browser b:java.util.List.of(first,customerOnly)) assertEquals(200,b.post(CUSTOMER,"/login",Map.of("email",login,"password","customer-only")).statusCode());
        assertEquals(401,customerOnly.post(PLATFORM,"/password",Map.of("currentPassword",old,"password",next)).statusCode());
        for(Browser b:java.util.List.of(first,second)) assertEquals(200,b.post(PLATFORM,"/login",Map.of("username",login,"password",old)).statusCode());
        assertEquals(403,first.send("POST",PLATFORM+"/password",Map.of("currentPassword",old,"password",next),new Browser().csrf(CUSTOMER)).statusCode());
        assertEquals(400,first.post(PLATFORM,"/password",Map.of("currentPassword","incorrect","password",next)).statusCode());
        assertEquals(400,first.post(PLATFORM,"/password",Map.of("currentPassword",old,"password",old)).statusCode());
        assertEquals(400,first.post(PLATFORM,"/password",Map.of("currentPassword",old,"password","short")).statusCode());
        assertEquals(200,second.get(PLATFORM+"/me"));
        assertEquals(204,first.post(PLATFORM,"/password",Map.of("currentPassword",old,"password",next)).statusCode());
        assertEquals(401,first.get(PLATFORM+"/me"));assertEquals(401,second.get(PLATFORM+"/me"));
        assertEquals(200,first.get("/api/v1/me"));assertEquals(200,customerOnly.get("/api/v1/me"));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM platform_sessions WHERE account_id=?",Integer.class,actor));
        assertEquals(1,db.queryForObject("SELECT count(*) FROM identity_audit WHERE actor_id=? AND action='PLATFORM_PASSWORD_CHANGE'",Integer.class,actor));
        assertEquals(1,db.queryForObject("SELECT count(*) FROM identity_audit WHERE actor_id=? AND action='PLATFORM_PASSWORD_CHANGE_FAILED'",Integer.class,actor));
        assertEquals(401,first.post(PLATFORM,"/login",Map.of("username",login,"password",old)).statusCode());
        assertEquals(200,first.post(PLATFORM,"/login",Map.of("username",login,"password",next)).statusCode());
        assertEquals(200,first.get("/api/v1/me"));
    }
    @Test void concurrentPasswordChangesOnlyOneCanUseTheOldSession() throws Exception {
        String login="concurrent-"+UUID.randomUUID()+"@example.test",old="old-synthetic-password";UUID actor=platform(login,old);
        Browser a=new Browser(),b=new Browser();
        for(Browser browser:java.util.List.of(a,b))assertEquals(200,browser.post(PLATFORM,"/login",Map.of("username",login,"password",old)).statusCode());
        String ca=a.csrf(PLATFORM),cb=b.csrf(PLATFORM);
        try(var executor=java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var gate=new java.util.concurrent.CountDownLatch(1);
            var one=executor.submit(()->{gate.await();return a.send("POST",PLATFORM+"/password",Map.of("currentPassword",old,"password","new-synthetic-one"),ca).statusCode();});
            var two=executor.submit(()->{gate.await();return b.send("POST",PLATFORM+"/password",Map.of("currentPassword",old,"password","new-synthetic-two"),cb).statusCode();});
            gate.countDown();var statuses=new java.util.ArrayList<>(java.util.List.of(one.get(),two.get()));java.util.Collections.sort(statuses);
            assertEquals(java.util.List.of(204,401),statuses);
        }
        assertEquals(1,db.queryForObject("SELECT count(*) FROM identity_audit WHERE actor_id=? AND action='PLATFORM_PASSWORD_CHANGE'",Integer.class,actor));
    }
    @Test void globalRecordsAllowlistFiltersAndPaginationNeverProjectCustomerActivity() throws Exception {
        String login="records-"+UUID.randomUUID()+"@example.test";UUID actor=platform(login,"synthetic-password"),tenant=UUID.randomUUID(),target=UUID.randomUUID();
        db.update("INSERT INTO tenants(id,name) VALUES (?,?)",tenant,"合成企业");
        Browser browser=new Browser(),customer=new Browser();
        assertEquals(401,customer.get("/api/platform-admin/v1/records"));
        assertEquals(200,browser.post(PLATFORM,"/login",Map.of("username",login,"password","synthetic-password")).statusCode());
        long min=db.queryForObject("SELECT coalesce(max(id),0) FROM identity_audit",Long.class);
        for(String action:java.util.List.of("TENANT_CREATE","CUSTOMER_ACCOUNT_DISABLE","PLATFORM_STAFF_INVITE","PLATFORM_PASSWORD_CHANGE_FAILED","CONVERSATION_READ","INVITATION_ACCEPT","LOGIN"))
            db.update("INSERT INTO identity_audit(actor_id,tenant_id,action,target_id,outcome) VALUES (?,?,?,?,?)",actor,tenant,action,target,action.equals("PLATFORM_PASSWORD_CHANGE_FAILED")?"DENIED":"SUCCESS");
        var response=browser.send("GET","/api/platform-admin/v1/records",null,null);assertEquals(200,response.statusCode(),response.body());
        var rows=JSON.readTree(response.body());int count=0;
        for(var row:rows) if(row.get("id").asLong()>min){count++;assertFalse(java.util.List.of("CONVERSATION_READ","INVITATION_ACCEPT","LOGIN").contains(row.get("action").asString()));}
        assertEquals(4,count);assertFalse(response.body().contains("password_hash"));
        var denied=JSON.readTree(browser.send("GET","/api/platform-admin/v1/records?category=SECURITY&outcome=DENIED&limit=1",null,null).body());
        assertEquals("PLATFORM_PASSWORD_CHANGE_FAILED",denied.get(0).get("action").asString());
        var page1=JSON.readTree(browser.send("GET","/api/platform-admin/v1/records?limit=1",null,null).body());
        var page2=JSON.readTree(browser.send("GET","/api/platform-admin/v1/records?limit=1&offset=1",null,null).body());
        assertNotEquals(page1.get(0).get("id").asLong(),page2.get(0).get("id").asLong());
        assertEquals(400,browser.get("/api/platform-admin/v1/records?category=CONVERSATION"));
        assertEquals(400,browser.get("/api/platform-admin/v1/records?limit=101"));
        assertEquals(400,browser.get("/api/platform-admin/v1/records?offset=-1"));
    }

}
