package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.material.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.knowledge.enabled=true","dreamcore.tasks.enabled=true"})
class NativeConversationIntegrationTest {
 @Autowired NativeConversationService nativeSessions;@Autowired MaterialService materials;@Autowired ConversationService conversations;@Autowired JdbcTemplate db;
 @org.springframework.boot.test.web.server.LocalServerPort int port;
 UUID tenant,owner,other,space,target,personal;
 @BeforeEach void setup(){
  tenant=UUID.randomUUID();owner=UUID.randomUUID();other=UUID.randomUUID();space=UUID.randomUUID();target=UUID.randomUUID();personal=UUID.randomUUID();
  db.update("INSERT INTO tenants(id,name) VALUES (?,'合成原生会话')",tenant);
  for(UUID a:List.of(owner,other)) {db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,'not-used')",a,a+"@native.test","合成员工");db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,a);}
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'来源','SHARED'),(?,?,?,'目标','SHARED'),(?,?,?,'私人','PERSONAL')",space,tenant,owner,target,tenant,owner,personal,tenant,owner);
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true),(?,?,?,true),(?,?,?,false)",tenant,space,owner,tenant,target,owner,tenant,target,other);
 }
 NativeConversationService.Session open(){return nativeSessions.open(owner,tenant,new NativeConversationService.Open(UUID.randomUUID(),space,null));}
 NativeConversationService.Save save(UUID key,String text){return new NativeConversationService.Save(key,"draft.txt",Base64.getEncoder().encodeToString(text.getBytes()));}
 void denied(Runnable fn){assertThrows(IdentityException.class,fn::run);}
 @Test void ownerTenantAndCurrentMembershipGuardEveryEntry(){var s=open();denied(()->nativeSessions.grant(other,tenant,s.id()));denied(()->nativeSessions.grant(owner,UUID.randomUUID(),s.id()));var g=nativeSessions.grant(owner,tenant,s.id());assertEquals(s,nativeSessions.check(s.id(),g.token()));db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,owner);denied(()->nativeSessions.check(s.id(),g.token()));denied(()->nativeSessions.artifacts(owner,tenant,s.id()));}
 @Test void idempotentEntryCannotSwapScopeAndStopRevokesExistingRuntime(){UUID key=UUID.randomUUID();var input=new NativeConversationService.Open(key,space,null);var s=nativeSessions.open(owner,tenant,input);assertEquals(s,nativeSessions.open(owner,tenant,input));denied(()->nativeSessions.open(owner,tenant,new NativeConversationService.Open(key,personal,null)));var g=nativeSessions.grant(owner,tenant,s.id());nativeSessions.stop(owner,tenant,s.id());denied(()->nativeSessions.check(s.id(),g.token()));denied(()->nativeSessions.grant(owner,tenant,s.id()));}
 @Test void savingIsPrivateAndPublishingNeedsAcknowledgementAndHasIdempotentReceipt(){var s=open();var g=nativeSessions.grant(owner,tenant,s.id());UUID key=UUID.randomUUID();var a=nativeSessions.save(s.id(),g.token(),save(key,"合成结果"));assertEquals(a,nativeSessions.save(s.id(),g.token(),save(key,"合成结果")));denied(()->nativeSessions.save(s.id(),g.token(),save(key,"改写")));denied(()->nativeSessions.download(other,tenant,s.id(),a.id()));assertEquals(0,materials.list(other,tenant,target,null,"",0,20).items().size());denied(()->nativeSessions.publish(owner,tenant,s.id(),new NativeConversationService.Publish(UUID.randomUUID(),a.id(),target,false)));var publish=new NativeConversationService.Publish(UUID.randomUUID(),a.id(),target,true);var receipt=nativeSessions.publish(owner,tenant,s.id(),publish);assertEquals(receipt,nativeSessions.publish(owner,tenant,s.id(),publish));assertEquals(1,materials.list(other,tenant,target,null,"",0,20).items().size());}
 @Test void nativeReadKeepsSourcePermissionsAndDoesNotExpandPublishAudience(){var s=open();var g=nativeSessions.grant(owner,tenant,s.id());var file=materials.upload(owner,tenant,space,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","source.txt","text/plain","source-private".getBytes()));UUID version=materials.detail(owner,tenant,space,file.id(),0,20).versions().getFirst().id();assertArrayEquals("source-private".getBytes(),nativeSessions.read(s.id(),g.token(),file.id(),version).bytes());var a=nativeSessions.save(s.id(),g.token(),save(UUID.randomUUID(),"derived"));denied(()->nativeSessions.publish(owner,tenant,s.id(),new NativeConversationService.Publish(UUID.randomUUID(),a.id(),target,true)));db.update("INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state) VALUES (?,?,'MATERIAL',?,'TRASHED')",tenant,space,file.id());denied(()->nativeSessions.check(s.id(),g.token()));denied(()->nativeSessions.download(owner,tenant,s.id(),a.id()));}
 @Test void oldConversationContinuesAsMarkedContextAndNeverInventsNativeHistory(){
  var legacy=conversations.submit(owner,tenant,null,space,UUID.randomUUID(),"合成历史问题","SOURCE_LOOKUP");UUID cid=legacy.conversation().id();
  db.update("UPDATE conversation_tasks SET status='SUCCEEDED',reply='合成历史答复' WHERE conversation_id=?",cid);
  var s=nativeSessions.open(owner,tenant,new NativeConversationService.Open(UUID.randomUUID(),space,cid));var g=nativeSessions.grant(owner,tenant,s.id());
  String context=nativeSessions.history(s.id(),g.token());assertTrue(context.contains("旧执行现场未恢复"));assertTrue(context.contains("合成历史答复"));
  denied(()->nativeSessions.open(other,tenant,new NativeConversationService.Open(UUID.randomUUID(),target,cid)));
  db.update("UPDATE conversation_tasks SET revision=revision+1 WHERE conversation_id=?",cid);denied(()->nativeSessions.history(s.id(),g.token()));
 }
 @Test void fullOfficialHarnessCallsPlatformToolsAndSavesExactlyOnce()throws Exception{
  var s=open();var g=nativeSessions.grant(owner,tenant,s.id());
  var file=materials.upload(owner,tenant,space,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","native.txt","text/plain","native synthetic business evidence".getBytes()));
  UUID version=materials.detail(owner,tenant,space,file.id(),0,20).versions().getFirst().id();
  java.nio.file.Path root=java.nio.file.Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();
  var process=new ProcessBuilder("node",root.resolve("engine/tests/fixtures/native-enterprise-run.mjs").toString(),"http://127.0.0.1:"+port,s.id().toString(),g.token(),file.id().toString(),version.toString()).redirectErrorStream(true).start();
  try{assertTrue(process.waitFor(50,java.util.concurrent.TimeUnit.SECONDS));String log=new String(process.getInputStream().readAllBytes());assertEquals(0,process.exitValue(),log);assertTrue(log.contains("5 real platform callbacks passed"));}finally{process.destroyForcibly();}
  assertEquals(1,nativeSessions.artifacts(owner,tenant,s.id()).size());
  assertEquals(0,db.queryForObject("SELECT count(*) FROM native_conversation_publications WHERE session_id=?",Integer.class,s.id()));
 }

 @Test void expiredAndCrossRootCapabilitiesFailAtActualHttpBoundary()throws Exception{
  var s=open();var otherSession=open();var g=nativeSessions.grant(owner,tenant,s.id());var client=java.net.http.HttpClient.newHttpClient();
  java.util.function.BiFunction<UUID,String,Integer> status=(id,token)->{try{return client.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://127.0.0.1:"+port+"/internal/v1/native-conversations/"+id+"/check")).header("Authorization","Bearer "+token).POST(java.net.http.HttpRequest.BodyPublishers.noBody()).build(),java.net.http.HttpResponse.BodyHandlers.discarding()).statusCode();}catch(Exception e){throw new RuntimeException(e);}};
  assertEquals(200,status.apply(s.id(),g.token()));assertEquals(403,status.apply(otherSession.id(),g.token()));assertEquals(403,status.apply(s.id(),"invalid"));
  db.update("UPDATE native_conversation_grants SET expires_at=now()-interval '1 minute' WHERE session_id=?",s.id());assertEquals(403,status.apply(s.id(),g.token()));
 }
 @Test void resumeRetainsRootIdentityAndDoesNotReviveOldCapability(){var s=open();var g=nativeSessions.grant(owner,tenant,s.id());nativeSessions.stop(owner,tenant,s.id());assertEquals(s.id(),nativeSessions.resume(owner,tenant,s.id()).id());denied(()->nativeSessions.check(s.id(),g.token()));var fresh=nativeSessions.grant(owner,tenant,s.id());assertEquals(s.id(),nativeSessions.check(s.id(),fresh.token()).id());}
 @Test void simultaneousSaveRetriesCreateOnlyOneArtifact()throws Exception{var s=open();var g=nativeSessions.grant(owner,tenant,s.id());var input=save(UUID.randomUUID(),"same bytes");try(var pool=java.util.concurrent.Executors.newFixedThreadPool(2)){var a=pool.submit(()->nativeSessions.save(s.id(),g.token(),input));var b=pool.submit(()->nativeSessions.save(s.id(),g.token(),input));assertEquals(a.get(10,java.util.concurrent.TimeUnit.SECONDS),b.get(10,java.util.concurrent.TimeUnit.SECONDS));}assertEquals(1,nativeSessions.artifacts(owner,tenant,s.id()).size());}

}
