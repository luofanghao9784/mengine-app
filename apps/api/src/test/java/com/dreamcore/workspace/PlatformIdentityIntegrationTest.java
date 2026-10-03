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
 properties={"dreamcore.auth.ip-attempts=1000","dreamcore.auth.email-attempts=1000"})
class PlatformIdentityIntegrationTest {
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
    @Test void separateCredentialsCookiesCsrfRevocationAndLogout() throws Exception {
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
        assertEquals(403,browser.send("POST",PLATFORM+"/login",Map.of("username",login,"password",platformPassword),browser.csrf(CUSTOMER)).statusCode());
        var signedIn=browser.post(PLATFORM,"/login",Map.of("username",login,"password",platformPassword));
        assertEquals(200,signedIn.statusCode(),signedIn.body());
        assertEquals(platform.toString(),JSON.readTree(signedIn.body()).get("account").get("id").asString());
        assertEquals(0,JSON.readTree(signedIn.body()).get("memberships").size());
        assertEquals(200,browser.get("/api/platform-admin/v1/overview"));
        assertEquals(customer.toString(),JSON.readTree(browser.send("GET","/api/v1/me",null,null).body()).get("account").get("id").asString());
        // Parallel tabs can request CSRF without invalidating each other's next action.
        String first=browser.csrf(PLATFORM); assertEquals(first,browser.csrf(PLATFORM));
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
        assertEquals(401,browser.get(PLATFORM+"/me"),"Role restoration must not resurrect revoked sessions");
        // No platform session or principal can be reused for a customer login.
        assertEquals(401,browser.post(CUSTOMER,"/login",Map.of("email",login,"password",platformPassword)).statusCode());
    }
}
