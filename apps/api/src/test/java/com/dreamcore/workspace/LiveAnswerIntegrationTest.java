package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import java.net.*;
import java.net.http.*;
import java.io.*;
import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=verification","dreamcore.tasks.initial-delay-ms=3600000"})
class LiveAnswerIntegrationTest {
 @Autowired LiveAnswerService live;@Autowired ConversationService conversations;@Autowired JdbcTemplate db;@Autowired PasswordEncoder passwords;@LocalServerPort int port;
 UUID tenant,actor,other,space,conversation;ConversationService.Job job;JsonMapper json=new JsonMapper();
 @BeforeEach void setup(){tenant=UUID.randomUUID();actor=UUID.randomUUID();other=UUID.randomUUID();space=UUID.randomUUID();
  db.update("INSERT INTO tenants(id,name) VALUES (?,'合成流式企业')",tenant);
  for(UUID id:List.of(actor,other)){db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成流式用户',?)",id,id+"@example.test",passwords.encode("synthetic-stream-password"));db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,id);}
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'个人','PERSONAL')",space,tenant,actor);
  var detail=conversations.submitClient(actor,tenant,null,space,UUID.randomUUID(),"合成流式回答","AGENT",null,List.of(),"AUTHORIZED_LIBRARY");conversation=detail.conversation().id();job=conversations.claim();assertNotNull(job);
 }
 @AfterEach void cleanup(){db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('RUNNING','QUEUED')",tenant);}
 void publish(int version,String text){live.publish(job.id(),job.token(),new LiveAnswerService.Update(1,version,text,"STREAMING"));}
 @Test void snapshotsFenceAttemptVersionOwnerAndStopWithoutLosingVisibleText(){
  publish(1,"你");publish(1,"你");publish(2,"你好");
  assertEquals("你好",live.snapshot(actor,tenant,conversation).getFirst().text());
  assertThrows(IdentityException.class,()->publish(1,"过期"));assertThrows(IdentityException.class,()->publish(3,"替换已显示内容"));
  assertThrows(IdentityException.class,()->live.publish(job.id(),UUID.randomUUID(),new LiveAnswerService.Update(1,3,"你好啊","STREAMING")));
  assertThrows(IdentityException.class,()->live.snapshot(other,tenant,conversation));assertThrows(IdentityException.class,()->live.snapshot(actor,UUID.randomUUID(),conversation));
  int revision=db.queryForObject("SELECT revision FROM conversation_tasks WHERE id=?",Integer.class,job.id());
  conversations.action(actor,tenant,conversation,job.id(),UUID.randomUUID(),revision,"PAUSE");
  assertEquals("你好",live.snapshot(actor,tenant,conversation).getFirst().text());assertEquals("INTERRUPTED",live.snapshot(actor,tenant,conversation).getFirst().state());
  assertThrows(IdentityException.class,()->publish(3,"你好啊"));
  revision=db.queryForObject("SELECT revision FROM conversation_tasks WHERE id=?",Integer.class,job.id());
  conversations.action(actor,tenant,conversation,job.id(),UUID.randomUUID(),revision,"RESUME");
  var next=conversations.claim();assertNotEquals(job.token(),next.token());assertTrue(live.snapshot(actor,tenant,conversation).isEmpty());
  assertThrows(IdentityException.class,()->publish(4,"旧轮次不能串入"));
 }
 @Test void finalReplyReplacesProvisionalTextAndRevokedSourcesAreNotReturned(){
  publish(1,"尚未校验的文字");db.update("UPDATE conversation_tasks SET status='SUCCEEDED',reply='经过校验的最终回复',lease_token=NULL WHERE id=?",job.id());
  assertEquals("经过校验的最终回复",live.snapshot(actor,tenant,conversation).getFirst().text());assertEquals("COMPLETE",live.snapshot(actor,tenant,conversation).getFirst().state());
  db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,actor);
  assertThrows(IdentityException.class,()->live.snapshot(actor,tenant,conversation));
 }
 HttpClient login()throws Exception{
  var client=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();String base="http://127.0.0.1:"+port;
  var csrf=json.readTree(client.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body());
  var result=client.send(HttpRequest.newBuilder(URI.create(base+"/api/v1/auth/login")).header(csrf.get("headerName").asString(),csrf.get("token").asString()).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("email",actor+"@example.test","password","synthetic-stream-password")))).build(),HttpResponse.BodyHandlers.ofString());assertEquals(200,result.statusCode());return client;
 }
 String event(BufferedReader reader)throws Exception{StringBuilder out=new StringBuilder();for(String line;(line=reader.readLine())!=null;){if(line.isEmpty()&&!out.isEmpty())break;out.append(line).append('\n');}return out.toString();}
 @Test @Timeout(15) void authenticatedSseDeliversSnapshotsAndReconnectsThenRevokes()throws Exception{
  String url="http://127.0.0.1:"+port+"/api/v1/tenants/"+tenant+"/conversations/"+conversation+"/answer-stream";
  assertEquals(401,HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create(url)).GET().build(),HttpResponse.BodyHandlers.ofString()).statusCode());
  publish(1,"第一段");var client=login();
  for(int round=0;round<2;round++){
   var response=client.send(HttpRequest.newBuilder(URI.create(url)).GET().build(),HttpResponse.BodyHandlers.ofInputStream());assertEquals(200,response.statusCode());assertTrue(response.headers().firstValue("content-type").orElseThrow().contains("text/event-stream"));
   try(var reader=new BufferedReader(new InputStreamReader(response.body(),java.nio.charset.StandardCharsets.UTF_8))){
    assertTrue(event(reader).contains(round==0?"第一段":"第一段第二段"));
    if(round==0)publish(2,"第一段第二段");
    else{db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,actor);assertTrue(event(reader).contains("denied"));}
   }
  }
 }
}
