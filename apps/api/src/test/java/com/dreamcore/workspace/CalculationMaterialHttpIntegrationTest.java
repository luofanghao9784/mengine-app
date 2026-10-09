package com.dreamcore.workspace;

import java.net.*;
import java.net.http.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.TestPropertySource;
import static org.junit.jupiter.api.Assertions.*;

@TestPropertySource(properties={"dreamcore.analysis.material-api-enabled=true"})
class CalculationMaterialHttpIntegrationTest extends CalculationMaterialIntegrationTest {
    @Autowired PasswordEncoder passwords;
    class Browser {
        final HttpClient client=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();
        String csrf;
        HttpResponse<String> call(String method,String path,Object body,boolean withCsrf) throws Exception {
            var builder=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+path)).header("Content-Type","application/json");
            if(withCsrf) builder.header("X-CSRF-TOKEN",csrf);
            return client.send(builder.method(method,body==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build(),HttpResponse.BodyHandlers.ofString());
        }
        Browser(UUID actor) throws Exception {
            db.update("UPDATE accounts SET password_hash=? WHERE id=?",passwords.encode("synthetic-pool-password"),actor);
            csrf=json.readTree(call("GET","/api/v1/auth/csrf",null,false).body()).path("token").asString();
            String email=db.queryForObject("SELECT email FROM accounts WHERE id=?",String.class,actor);
            assertEquals(200,call("POST","/api/v1/auth/login",Map.of("email",email,"password","synthetic-pool-password"),true).statusCode());
            csrf=json.readTree(call("GET","/api/v1/auth/csrf",null,false).body()).path("token").asString();
        }
    }
    @Test void actualHttpRequiresCsrfAndOwnerAndDoesNotCachePrivateEvidence() throws Exception {
        var c=calculate(true);UUID material=UUID.randomUUID();var ownerBrowser=new Browser(owner);
        String root="/api/v1/tenants/"+tenant+"/analysis-materials";
        var body=Map.of("artifactId",c.artifact(),"materialId",material,"expectedVersion",0,"validUntil",Instant.now().plusSeconds(300).toString());
        assertEquals(403,ownerBrowser.call("POST",root,body,false).statusCode());
        var saved=ownerBrowser.call("POST",root,body,true);assertEquals(200,saved.statusCode(),saved.body());
        String path=root+"/"+material+"/versions/1";
        var read=ownerBrowser.call("GET",path,null,false);assertEquals(200,read.statusCode(),read.body());
        assertTrue(read.headers().firstValue("Cache-Control").orElse("").contains("no-store"));
        var colleague=new Browser(peer());var denied=colleague.call("GET",path,null,false);
        assertEquals(404,denied.statusCode());assertFalse(denied.body().contains(dataset.toString()));
        assertEquals(404,colleague.call("POST",root,body,true).statusCode());
        var invalid=new HashMap<String,Object>(body);invalid.remove("validUntil");
        assertEquals(400,ownerBrowser.call("POST",root,invalid,true).statusCode());
    }
}
