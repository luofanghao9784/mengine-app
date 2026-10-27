package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import static org.junit.jupiter.api.Assertions.*;
class NativeMetadataIntegrationTest extends NativeConversationIntegrationTest {
 @Autowired NativeConversationMetadata metadata; @Autowired NativeConversationStream stream; @Autowired NativeConversationController api;
 void emit(UUID root,String token,String type,Map<String,Object> data){stream.append(root,token,new NativeConversationStream.Ingest(UUID.randomUUID().toString(),Map.of("sessionId",root.toString(),"type",type,"time","2026-10-27T00:00:00Z","data",data)));}
 Map<String,Object> message(String text){return Map.of("source",Map.of("kind","user"),"content",List.of(Map.of("type","text","text",text)));}
 @Test void titlePinSearchAndPendingAreIncrementalAndPrivate(){
  var s=open();var g=nativeSessions.grant(owner,tenant,s.id());
  emit(s.id(),g.token(),"user/message",message("首句标题\n搜索内容needle"));
  assertEquals("首句标题",metadata.describe(owner,tenant,s.id(),"NEEDLE").get("title"));
  emit(s.id(),g.token(),"session/title",Map.of("title","自动标题"));
  assertEquals("自动标题",metadata.describe(owner,tenant,s.id(),null).get("title"));
  metadata.update(owner,tenant,s.id(),Map.of("title","人工标题","pinned",true));
  emit(s.id(),g.token(),"session/title",Map.of("title","新的自动标题"));
  assertEquals("人工标题",metadata.describe(owner,tenant,s.id(),null).get("title"));
  var reset=new HashMap<String,Object>();reset.put("title",null);assertEquals("新的自动标题",metadata.update(owner,tenant,s.id(),reset).get("title"));
  emit(s.id(),g.token(),"approval/asked",Map.of("id","a"));
  emit(s.id(),g.token(),"question/asked",Map.of("callId","q","questions",List.of()));
  emit(s.id(),g.token(),"question/asked",Map.of("callId","p","questions",List.of(Map.of("intent",Map.of("kind","plan-review")))));
  assertEquals(List.of("approval","plan","question"),metadata.describe(owner,tenant,s.id(),null).get("pending"));
  emit(s.id(),g.token(),"question/closed",Map.of("callId","q","outcome","ASK_TIMED_OUT"));
  emit(s.id(),g.token(),"turn/end",Map.of("reason",Map.of("kind","aborted")));
  assertEquals(List.of("question"),metadata.describe(owner,tenant,s.id(),null).get("pending"));
  emit(s.id(),g.token(),"user/message",Map.of("source",Map.of("kind","user-question-reply","callId","q")));
  assertEquals(List.of(),metadata.describe(owner,tenant,s.id(),null).get("pending"));
  denied(()->metadata.describe(other,tenant,s.id(),null));denied(()->metadata.update(owner,UUID.randomUUID(),s.id(),Map.of("pinned",false)));
  assertNull(metadata.describe(owner,tenant,s.id(),"absent"));
 }
 @Test @SuppressWarnings("unchecked") void revokedSourcesAreOmittedEvenIfCachedAndOldPinnedConversationsAreKept(){
  var first=open();metadata.update(owner,tenant,first.id(),Map.of("pinned",true,"title","old-pinned"));
  // No previous 100-session cut-off before sorting/searching.
  for(int i=0;i<101;i++)open();
  var auth=new UsernamePasswordAuthenticationToken(owner.toString(),null,List.of());
  var rows=(List<Map<String,Object>>)api.list(auth,tenant,space,"");assertEquals(102,rows.size());assertEquals("old-pinned",rows.getFirst().get("title"));
  assertEquals(1,((List<?>)api.list(auth,tenant,space,"old-pinned")).size());
  var f=materials.upload(owner,tenant,space,null,null,null,UUID.randomUUID(),new org.springframework.mock.web.MockMultipartFile("file","private.txt","text/plain","private".getBytes()));
  var version=materials.detail(owner,tenant,space,f.id(),0,20).versions().getFirst().id();nativeSessions.references(owner,tenant,first.id(),List.of(new NativeConversationService.Reference(f.id(),version)));
  db.update("INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state) VALUES (?,?,'MATERIAL',?,'TRASHED')",tenant,space,f.id());
  assertTrue(((List<?>)api.list(auth,tenant,space,"old-pinned")).isEmpty());
 }
 @Test void childTextCannotSetTitleOrMatchSearch(){
  var s=open();var g=nativeSessions.grant(owner,tenant,s.id());
  stream.append(s.id(),g.token(),new NativeConversationStream.Ingest("child",Map.of("sessionId",UUID.randomUUID().toString(),"type","user/message","time",1,"data",message("child-secret"))));
  assertEquals("新会话",metadata.describe(owner,tenant,s.id(),null).get("title"));assertNull(metadata.describe(owner,tenant,s.id(),"child-secret"));
 }
}
