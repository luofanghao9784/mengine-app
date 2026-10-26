package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class NativeConversationStreamIntegrationTest extends NativeConversationIntegrationTest {
 @Autowired NativeConversationStream stream;
 @Autowired NativeConversationInteractionController controller;
 @Autowired NativeConversationFeedback feedback;
 @MockitoBean NativeRuntimeClient runtime;
 Map<String,Object> event(String type,UUID id){return Map.of("type",type,"sessionId",id.toString(),"time","2026-10-26T12:00:00Z","data",Map.of("text","synthetic"));}
 UsernamePasswordAuthenticationToken auth(UUID actor){return new UsernamePasswordAuthenticationToken(actor.toString(),null,List.of());}
 @Test void durableReplayAndPaginationPreserveCursorAndRejectOtherIdentities(){
  var s=open();var g=nativeSessions.grant(owner,tenant,s.id());var e=new NativeConversationStream.Ingest("root:0",event("assistant/message",s.id()));
  assertEquals(1L,((Number)stream.append(s.id(),g.token(),e).get("seq")).longValue());assertEquals(1,stream.history(owner,tenant,s.id(),0,10).size());
  assertEquals(1L,((Number)stream.append(s.id(),g.token(),e).get("seq")).longValue());
  stream.append(s.id(),g.token(),new NativeConversationStream.Ingest("root:1",event("turn/end",s.id())));
  assertEquals(1,stream.history(owner,tenant,s.id(),1,10).size());assertTrue(stream.history(owner,tenant,s.id(),2,10).isEmpty());
  denied(()->stream.history(other,tenant,s.id(),0,10));denied(()->stream.status(owner,UUID.randomUUID(),s.id()));
  nativeSessions.stop(owner,tenant,s.id());assertEquals(2,stream.history(owner,tenant,s.id(),0,10).size());verifyNoInteractions(runtime);
 }
 @Test void duplicateConcurrentEventsReceiveOneSequence()throws Exception{
  var s=open();var g=nativeSessions.grant(owner,tenant,s.id());var e=new NativeConversationStream.Ingest("root:0",event("assistant/message",s.id()));
  try(var pool=java.util.concurrent.Executors.newFixedThreadPool(2)){
   var a=pool.submit(()->stream.append(s.id(),g.token(),e));var b=pool.submit(()->stream.append(s.id(),g.token(),e));assertEquals(a.get(),b.get());
  }
  assertEquals(1,stream.history(owner,tenant,s.id(),0,10).size());
 }
 @Test void dispatchDeduplicatesAndUnknownOutcomesNeverRetry(){
  var s=open();var key=UUID.randomUUID();var body=Map.<String,Object>of("requestId",key.toString(),"text","hello","materials",List.of());
  when(runtime.command(eq(s.id()),anyString(),eq("messages"),anyMap())).thenReturn(Map.of("accepted",true,"messageId","native-id"));
  assertEquals(controller.message(auth(owner),tenant,s.id(),body),controller.message(auth(owner),tenant,s.id(),body));verify(runtime,times(1)).command(eq(s.id()),anyString(),eq("messages"),anyMap());
  denied(()->controller.message(auth(other),tenant,s.id(),body));
  var changed=new HashMap<>(body);changed.put("text","different");denied(()->controller.message(auth(owner),tenant,s.id(),changed));
  var unknown=new HashMap<>(body);unknown.put("requestId",UUID.randomUUID().toString());
  when(runtime.command(eq(s.id()),anyString(),eq("messages"),anyMap())).thenThrow(new IdentityException(502,"NATIVE_RUNTIME_UNAVAILABLE"));
  denied(()->controller.message(auth(owner),tenant,s.id(),unknown));denied(()->controller.message(auth(owner),tenant,s.id(),unknown));verify(runtime,times(2)).command(eq(s.id()),anyString(),eq("messages"),anyMap());
 }
 @Test void sourceBindingRejectsWrongMaterialAndRevocationBlocksHistory(){
  var s=open();var file=materials.upload(owner,tenant,space,null,null,null,UUID.randomUUID(),new org.springframework.mock.web.MockMultipartFile("file","source.txt","text/plain","synthetic".getBytes()));
  var version=materials.detail(owner,tenant,space,file.id(),0,20).versions().getFirst().id();
  denied(()->nativeSessions.references(owner,tenant,s.id(),List.of(new NativeConversationService.Reference(UUID.randomUUID(),version))));
  nativeSessions.references(owner,tenant,s.id(),List.of(new NativeConversationService.Reference(file.id(),version)));
  db.update("INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state) VALUES (?,?,'MATERIAL',?,'TRASHED')",tenant,space,file.id());
  denied(()->stream.history(owner,tenant,s.id(),0,10));denied(()->controller.stop(auth(owner),tenant,s.id(),Map.of("requestId",UUID.randomUUID().toString())));verifyNoInteractions(runtime);
 }
 @Test void budgetUnknownAndStaleAreNotFakeZeroAndSystemInstructionsAreRedacted(){
  var s=open();assertEquals(false,stream.status(owner,tenant,s.id()).get("available"));assertFalse(stream.status(owner,tenant,s.id()).containsKey("budget"));var g=nativeSessions.grant(owner,tenant,s.id());
  stream.append(s.id(),g.token(),new NativeConversationStream.Ingest("status",Map.of("type","status","time",java.time.Instant.now().toString(),"data",Map.of("running",true,"budget",Map.of("usedYuan",1.23,"softYuan",2,"hardYuan",5)))));
  assertEquals(true,stream.status(owner,tenant,s.id()).get("available"));db.update("UPDATE native_conversation_events SET event=jsonb_set(event,'{time}',to_jsonb((now()-interval '1 minute')::text)) WHERE session_id=?",s.id());assertEquals(false,stream.status(owner,tenant,s.id()).get("available"));
  stream.append(s.id(),g.token(),new NativeConversationStream.Ingest("system",event("system/message",s.id())));assertEquals(Map.of("redacted",true),stream.history(owner,tenant,s.id(),1,10).getFirst().get("data"));
 }
 @Test void feedbackUsesSharedVersionedLedgerAndExactServerMessage(){
  var s=open();var g=nativeSessions.grant(owner,tenant,s.id());stream.append(s.id(),g.token(),new NativeConversationStream.Ingest("reply",event("assistant/message",s.id())));
  UUID key=UUID.randomUUID();var first=feedback.rate(owner,tenant,s.id(),key,"1","up");assertEquals(first,feedback.rate(owner,tenant,s.id(),key,"1","up"));
  assertEquals(1,db.queryForObject("SELECT count(*) FROM feedback_entries WHERE native_session_id=?",Integer.class,s.id()));
  feedback.rate(owner,tenant,s.id(),UUID.randomUUID(),"1","down");assertEquals(2,db.queryForObject("SELECT revision FROM feedback_entries WHERE native_session_id=?",Integer.class,s.id()));
  denied(()->feedback.rate(other,tenant,s.id(),UUID.randomUUID(),"1","up"));denied(()->feedback.rate(owner,tenant,s.id(),UUID.randomUUID(),"999","up"));
 }
 @Autowired org.springframework.security.crypto.password.PasswordEncoder passwords;
 @Test void actualHttpSseResumesWithLastEventIdAndRequiresLogin()throws Exception{
  var s=open();var g=nativeSessions.grant(owner,tenant,s.id());
  stream.append(s.id(),g.token(),new NativeConversationStream.Ingest("first",event("user/message",s.id())));
  stream.append(s.id(),g.token(),new NativeConversationStream.Ingest("second",event("assistant/message",s.id())));
  String password="Synthetic-stream-12345";db.update("UPDATE accounts SET password_hash=? WHERE id=?",passwords.encode(password),owner);
  var http=java.net.http.HttpClient.newBuilder().cookieHandler(new java.net.CookieManager(null,java.net.CookiePolicy.ACCEPT_ALL)).build();
  String base="http://127.0.0.1:"+port,path="/api/v1/tenants/"+tenant+"/native-conversations/"+s.id();var json=new tools.jackson.databind.json.JsonMapper();
  java.util.function.Function<String,java.net.http.HttpRequest.Builder> request=p->java.net.http.HttpRequest.newBuilder(java.net.URI.create(base+p));
  assertEquals(401,http.send(request.apply(path+"/history").GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
  var forged=request.apply("/internal/v1/native-conversations/"+s.id()+"/events-write").header("Authorization","Bearer "+g.token()).header("Content-Type","application/json").POST(java.net.http.HttpRequest.BodyPublishers.ofString(json.writeValueAsString(new NativeConversationStream.Ingest("forged",event("assistant/message",s.id()))))).build();
  assertEquals(403,http.send(forged,java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
  var csrf=json.readTree(http.send(request.apply("/api/v1/auth/csrf").GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString()).body());
  var login=request.apply("/api/v1/auth/login").header(csrf.get("headerName").asString(),csrf.get("token").asString()).header("Content-Type","application/json").POST(java.net.http.HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("email",owner+"@native.test","password",password)))).build();
  assertEquals(200,http.send(login,java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
  var response=http.send(request.apply(path+"/events?after=0").header("Last-Event-ID","1").GET().build(),java.net.http.HttpResponse.BodyHandlers.ofInputStream());assertEquals(200,response.statusCode());
  try(var reader=new java.io.BufferedReader(new java.io.InputStreamReader(response.body()))){String text="",line;while((line=reader.readLine())!=null){text+=line+"\n";if(line.isEmpty()&&text.contains("data:"))break;}assertTrue(text.contains("id:2"),text);assertFalse(text.contains("id:1"));assertTrue(text.contains("assistant/message"));}
  assertEquals(400,http.send(request.apply(path+"/history?after=-1").GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
 }

}
