package com.dreamcore.workspace.scene;

import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import com.dreamcore.workspace.identity.IdentityException;

@Service
public class SceneBridgeClient {
 private final Environment env; private final org.springframework.jdbc.core.JdbcTemplate db; private final JsonMapper json=new JsonMapper();
 private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
 public SceneBridgeClient(Environment env,org.springframework.jdbc.core.JdbcTemplate db){this.env=env;this.db=db;}
 public boolean available(){return env.getProperty("MENGINE_PLATFORM_BRIDGE_KEY","").length()>=32;}
 public JsonNode call(UUID tenant,String actor,String method,String path,Object body){
  if(!available())throw new IdentityException(503,"SCENE_NOT_CONFIGURED");
  try{
   URI uri=URI.create(env.getProperty("MENGINE_PLATFORM_BRIDGE_URL","http://127.0.0.1:4400/api/internal/platform-scene"));
   if(!"https".equals(uri.getScheme())&&!("http".equals(uri.getScheme())&&Set.of("127.0.0.1","localhost","::1").contains(uri.getHost())))throw new IllegalStateException("Insecure bridge");
   var request=new LinkedHashMap<String,Object>();request.put("tenant",tenant.toString());request.put("actor",actor);request.put("method",method);request.put("path",path);request.put("body",body);request.put("at",System.currentTimeMillis());request.put("nonce",UUID.randomUUID().toString());
   if(actor.startsWith("customer:")){UUID account=UUID.fromString(actor.substring(9));var rows=db.queryForList("SELECT a.display_name FROM accounts a JOIN tenant_memberships m ON m.account_id=a.id WHERE a.id=? AND m.tenant_id=? AND a.status='ACTIVE' AND m.status='ACTIVE'",account,tenant);if(rows.size()!=1)throw new IdentityException(403,"SCENE_OPERATION_FORBIDDEN");request.put("identity",Map.of("id",account.toString(),"name",rows.getFirst().get("display_name")));}
   String payload=Base64.getUrlEncoder().withoutPadding().encodeToString(json.writeValueAsBytes(request));
   Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(env.getRequiredProperty("MENGINE_PLATFORM_BRIDGE_KEY").getBytes(StandardCharsets.UTF_8),"HmacSHA256"));
   String signature=HexFormat.of().formatHex(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
   var response=http.send(HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(180)).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("payload",payload,"signature",signature)))).build(),HttpResponse.BodyHandlers.ofString());
   if(response.statusCode()!=200){int status=response.statusCode();throw new IdentityException(Set.of(400,401,403,404,409,410).contains(status)?status:502,switch(status){case 400->"INVALID_REQUEST";case 403->"SCENE_OPERATION_FORBIDDEN";case 404->"SCENE_TENANT_NOT_BOUND";case 409->"SCENE_REVISION_CONFLICT";case 410->"SCENE_READ_ONLY";default->"SCENE_UPSTREAM_FAILED";});}
   return json.readTree(response.body());
  }catch(IdentityException e){throw e;}catch(Exception e){throw new IdentityException(502,"SCENE_UPSTREAM_UNAVAILABLE");}
 }
}
