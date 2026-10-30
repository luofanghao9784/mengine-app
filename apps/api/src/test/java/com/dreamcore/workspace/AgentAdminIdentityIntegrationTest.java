package com.dreamcore.workspace;

import com.dreamcore.workspace.identity.*;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
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
 properties={"dreamcore.auth.ip-attempts=1000","dreamcore.auth.email-attempts=1000"})
class AgentAdminIdentityIntegrationTest {
    @org.springframework.test.context.DynamicPropertySource
    static void isolatedDatabase(org.springframework.test.context.DynamicPropertyRegistry registry) {
        IsolatedTestDatabase.register(registry);
    }
    private static final JsonMapper JSON=new JsonMapper();
    private static final String AGENT="/api/agent-admin/v1/auth", PLATFORM="/api/platform-admin/v1/auth", CUSTOMER="/api/v1/auth";
    private static final String PASSWORD="synthetic-only-password-035";
    @LocalServerPort int port;
    @Autowired JdbcTemplate db;
    @Autowired PasswordEncoder passwords;
    @Autowired IdentityService identities;
    record Fixture(UUID id,String login) {}
    Fixture fixture(String role) {
        UUID id=UUID.randomUUID(); String login="synthetic-"+id+"@example.test";
        db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",id,login,"合成账号",passwords.encode(PASSWORD));
        if(role!=null) {
            String table=role.equals("AGENT_ADMIN")?"agent_platform_accounts":"platform_accounts";
            db.update("INSERT INTO "+table+"(account_id,login_name,password_hash) VALUES (?,?,?)",id,login,passwords.encode(PASSWORD));
            db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,?)",id,role);
        }
        return new Fixture(id,login);
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
        HttpResponse<String> login(String realm,Fixture fixture,String password) throws Exception {
            String key=realm.equals(CUSTOMER)?"email":"username";
            return send("POST",realm+"/login",Map.of(key,fixture.login(),"password",password),csrf(realm));
        }
        String cookie(String name) {
            return cookies.getCookieStore().getCookies().stream().filter(c->c.getName().equals(name)).findFirst().orElseThrow().getValue();
        }
        HttpResponse<String> me(String realm) throws Exception { return send("GET",realm+"/me",null,null); }
    }
    HttpResponse<String> explicitCookieGet(String path,String name,String value) throws Exception {
        return HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path))
            .header("Cookie",name+"="+value).GET().build(),HttpResponse.BodyHandlers.ofString());
    }
    @Test void agentAdmin_loginWithCustomerAccount_rejected() throws Exception {
        var customer=fixture(null); var browser=new Browser();
        assertEquals(200,browser.login(CUSTOMER,customer,PASSWORD).statusCode());
        assertEquals(401,browser.login(AGENT,customer,PASSWORD).statusCode());
        assertEquals(401,browser.me(AGENT).statusCode());
        assertEquals(0,db.queryForObject("SELECT count(*) FROM agent_platform_sessions WHERE account_id=?",Integer.class,customer.id()));
        assertNull(db.queryForObject("SELECT account_id FROM agent_platform_sessions WHERE token_hash=?",UUID.class,IdentityService.hash(browser.cookie("DREAMCORE_AGENT"))));
    }
    @Test void agentAdmin_platformCookie_401() throws Exception {
        var browser=new Browser(); var platform=fixture("PLATFORM_ADMIN");
        assertEquals(200,browser.login(PLATFORM,platform,PASSWORD).statusCode());
        var response=explicitCookieGet(AGENT+"/me","DREAMCORE_PLATFORM",browser.cookie("DREAMCORE_PLATFORM"));
        assertEquals(401,response.statusCode());
        assertFalse(response.body().contains(platform.id().toString()));
        assertEquals("还没有登录，请先登录后再试",JSON.readTree(response.body()).get("message").asString());
    }
    @Test void platformAdmin_agentCookie_401() throws Exception {
        var browser=new Browser(); var agent=fixture("AGENT_ADMIN");
        assertEquals(200,browser.login(AGENT,agent,PASSWORD).statusCode());
        assertEquals(401,explicitCookieGet(PLATFORM+"/me","DREAMCORE_AGENT",browser.cookie("DREAMCORE_AGENT")).statusCode());
        // Even relabeling the token cannot turn it into a platform session.
        assertEquals(401,explicitCookieGet(PLATFORM+"/me","DREAMCORE_PLATFORM",browser.cookie("DREAMCORE_AGENT")).statusCode());
    }
    @Test void agentAdmin_loginSuccess_cookieAndCsrfBoundToSession() throws Exception {
        var fixture=fixture("AGENT_ADMIN"); var browser=new Browser();
        assertEquals(403,browser.send("POST",AGENT+"/login",Map.of("username",fixture.login(),"password",PASSWORD),null).statusCode());
        String before=browser.csrf(AGENT),oldCookie=browser.cookie("DREAMCORE_AGENT");
        var result=browser.login(AGENT,fixture,PASSWORD); assertEquals(200,result.statusCode(),result.body());
        var cookie=result.headers().firstValue("Set-Cookie").orElseThrow();
        for(String attribute:List.of("DREAMCORE_AGENT=","HttpOnly","SameSite=Strict","Path=/api/agent-admin/")) assertTrue(cookie.contains(attribute),cookie);
        assertFalse(cookie.contains("Secure"));
        assertNotEquals(oldCookie,browser.cookie("DREAMCORE_AGENT"));
        assertEquals(401,explicitCookieGet(AGENT+"/me","DREAMCORE_AGENT",oldCookie).statusCode());
        assertEquals(200,browser.me(AGENT).statusCode());
        assertFalse(result.body().contains("tenantId"));
        assertEquals(403,browser.send("POST",AGENT+"/logout",null,before).statusCode());
        assertEquals(403,browser.send("POST",AGENT+"/logout",null,new Browser().csrf(AGENT)).statusCode());
        assertEquals(200,browser.me(AGENT).statusCode());
    }
    @Test void agentAdmin_loginUnknownField_rejected() throws Exception {
        var fixture=fixture("AGENT_ADMIN"); var browser=new Browser();
        var result=browser.send("POST",AGENT+"/login",Map.of("username",fixture.login(),"password",PASSWORD,"tenantId",UUID.randomUUID()),browser.csrf(AGENT));
        assertEquals(400,result.statusCode(),result.body());
        assertEquals(401,browser.me(AGENT).statusCode());
    }
    @Test void agentAdmin_wrongCredentials_humanMessage() throws Exception {
        var browser=new Browser(); var fixture=fixture("AGENT_ADMIN");
        var result=browser.login(AGENT,fixture,"incorrect-synthetic-password");
        assertEquals(401,result.statusCode());
        assertEquals("账号或密码不对，请重新输入",JSON.readTree(result.body()).get("message").asString());
        assertEquals(4,JSON.readTree(result.body()).size());
        for(String forbidden:List.of("Exception","at com.","SQL")) assertFalse(result.body().contains(forbidden));
        assertEquals(401,browser.me(AGENT).statusCode());
    }
    @Test void agentAdmin_logout_onlyClearsOwnRealm() throws Exception {
        var browser=new Browser(); var platformBrowser=new Browser();
        var platform=fixture("PLATFORM_ADMIN");
        assertEquals(200,browser.login(CUSTOMER,fixture(null),PASSWORD).statusCode());
        assertEquals(200,browser.login(PLATFORM,platform,PASSWORD).statusCode());
        assertEquals(200,platformBrowser.login(PLATFORM,platform,PASSWORD).statusCode());
        assertEquals(200,browser.login(AGENT,fixture("AGENT_ADMIN"),PASSWORD).statusCode());
        String token=browser.cookie("DREAMCORE_AGENT");
        var result=browser.send("POST",AGENT+"/logout",null,browser.csrf(AGENT));
        assertEquals(204,result.statusCode());
        var cookies=result.headers().allValues("Set-Cookie"); assertEquals(1,cookies.size());
        assertTrue(cookies.getFirst().startsWith("DREAMCORE_AGENT=")); assertTrue(cookies.getFirst().contains("Max-Age=0"));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM agent_platform_sessions WHERE token_hash=?",Integer.class,IdentityService.hash(token)));
        assertEquals(401,browser.me(AGENT).statusCode());
        assertEquals(200,browser.me(PLATFORM).statusCode()); assertEquals(200,platformBrowser.me(PLATFORM).statusCode());
        assertEquals(200,browser.send("GET","/api/v1/me",null,null).statusCode());
    }
    @Test void agentAdmin_roles_doNotImplyEachOther() throws Exception {
        assertEquals(401,new Browser().login(AGENT,fixture("PLATFORM_ADMIN"),PASSWORD).statusCode());
        assertEquals(401,new Browser().login(PLATFORM,fixture("AGENT_ADMIN"),PASSWORD).statusCode());
    }
    @Test void agentAdmin_otherTenantResource_notVisible() throws Exception {
        var customer=fixture(null); var browser=new Browser();
        UUID first=UUID.randomUUID(),other=UUID.randomUUID(); String otherName="另一家合成企业-"+other;
        db.update("INSERT INTO tenants(id,name) VALUES (?,?),(?,?)",first,"第一家合成企业",other,otherName);
        for(UUID tenant:List.of(first,other)) db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,customer.id());
        // Real existing tenant read route; prove the fixtures can be read with customer credentials.
        assertEquals(200,browser.login(CUSTOMER,customer,PASSWORD).statusCode());
        String path="/api/v1/tenants/"+other+"/context";
        var customerRead=browser.send("GET",path,null,null); assertEquals(200,customerRead.statusCode(),customerRead.body()); assertTrue(customerRead.body().contains(otherName));
        var agent=new Browser(); assertEquals(200,agent.login(AGENT,fixture("AGENT_ADMIN"),PASSWORD).statusCode());
        for(UUID tenant:List.of(first,other)) {
            var response=explicitCookieGet("/api/v1/tenants/"+tenant+"/context","DREAMCORE_AGENT",agent.cookie("DREAMCORE_AGENT"));
            assertEquals(401,response.statusCode()); assertFalse(response.body().contains(otherName));
        }
        assertFalse(agent.me(AGENT).body().contains("tenantId"));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='agent_platform_sessions' AND column_name='tenant_id'",Integer.class));
    }
    @Test void agentAdmin_revocations_doNotResurrectSessions() throws Exception {
        var fixture=fixture("AGENT_ADMIN"); var browser=new Browser();
        for(String mutation:List.of("role","credential","status")) {
            assertEquals(200,browser.login(AGENT,fixture,PASSWORD).statusCode());
            String token=browser.cookie("DREAMCORE_AGENT");
            switch(mutation) {
                case "role" -> { db.update("DELETE FROM platform_roles WHERE account_id=? AND role='AGENT_ADMIN'",fixture.id()); db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'AGENT_ADMIN')",fixture.id()); }
                case "credential" -> db.update("UPDATE agent_platform_accounts SET credential_version=credential_version+1 WHERE account_id=?",fixture.id());
                case "status" -> { db.update("UPDATE accounts SET status='DISABLED' WHERE id=?",fixture.id()); db.update("UPDATE accounts SET status='ACTIVE' WHERE id=?",fixture.id()); }
            }
            assertEquals(401,browser.me(AGENT).statusCode());
            assertEquals(0,db.queryForObject("SELECT count(*) FROM agent_platform_sessions WHERE token_hash=?",Integer.class,IdentityService.hash(token)));
        }
    }
    @Test void agentAdmin_cookieNames_startupRejectsEveryCollision() {
        for(String[] names:List.of(new String[]{"SAME","SAME","CUSTOMER"},new String[]{"SAME","PLATFORM","SAME"},new String[]{"AGENT","SAME","SAME"},new String[]{"bad;name","PLATFORM","CUSTOMER"})) {
            assertThrows(IllegalArgumentException.class,()->new AgentAdminIdentity(db,passwords,null,null,names[0],names[1],names[2]));
            assertThrows(IllegalArgumentException.class,()->new PlatformIdentity(db,passwords,identities,null,null,names[1],names[2],names[0]));
        }
    }
    @Test void agentAdmin_cookieSecure_onlyOnSecureRequest() {
        var identity=new AgentAdminIdentity(db,passwords,null,null,"DREAMCORE_AGENT","DREAMCORE_PLATFORM","DREAMCORE_SESSION");
        for(boolean secure:List.of(false,true)) {
            var request=new org.springframework.mock.web.MockHttpServletRequest(); request.setSecure(secure);
            var response=new org.springframework.mock.web.MockHttpServletResponse(); identity.csrf(request,response);
            assertEquals(secure,response.getHeader("Set-Cookie").contains("Secure"));
        }
    }
    @Test void agentAdmin_curl_localHttpSmoke() throws Exception {
        var fixture=fixture("AGENT_ADMIN"); var browser=new Browser(); String csrf=browser.csrf(AGENT);
        String cookie="DREAMCORE_AGENT="+browser.cookie("DREAMCORE_AGENT");
        assertEquals(200,curl("GET",AGENT+"/csrf",null,null,null));
        assertEquals(403,curl("POST",AGENT+"/login","{}",null,null));
        assertEquals(401,curl("POST",AGENT+"/login",JSON.writeValueAsString(Map.of("username",fixture.login(),"password","incorrect")),cookie,csrf));
        assertEquals(200,curl("POST",AGENT+"/login",JSON.writeValueAsString(Map.of("username",fixture.login(),"password",PASSWORD)),cookie,csrf));
        assertEquals(401,curl("GET",AGENT+"/me",null,null,null));
        assertEquals(501,curl("POST","/api/agent-admin/v1/capabilities","{}",null,null));
    }
    int curl(String method,String path,String body,String cookie,String csrf) throws Exception {
        var command=new ArrayList<>(List.of("curl","-sS","--max-time","20","-o","/dev/null","-w","%{http_code}","-X",method,"http://127.0.0.1:"+port+path));
        if(body!=null) command.addAll(List.of("-H","Content-Type: application/json","--data",body));
        if(cookie!=null) command.addAll(List.of("-H","Cookie: "+cookie));
        if(csrf!=null) command.addAll(List.of("-H","X-CSRF-TOKEN: "+csrf));
        var process=new ProcessBuilder(command).start(); String status=new String(process.getInputStream().readAllBytes()).trim();
        assertEquals(0,process.waitFor());
        System.out.println("curl "+method+" "+path+" -> "+status);
        return Integer.parseInt(status);
    }
}
