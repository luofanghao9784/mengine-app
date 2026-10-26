package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.knowledge.*;
import com.dreamcore.workspace.material.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import static org.junit.jupiter.api.Assertions.*;
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=verification","dreamcore.tasks.initial-delay-ms=3600000","dreamcore.knowledge.enabled=true","dreamcore.knowledge.initial-delay-ms=3600000"})
class ClientInputIntegrationTest {
 @org.springframework.test.context.DynamicPropertySource
 static void isolateQueue(org.springframework.test.context.DynamicPropertyRegistry registry){IsolatedTestDatabase.register(registry);}
 @Autowired JdbcTemplate db;@Autowired MaterialService materials;@Autowired KnowledgeService knowledge;@Autowired ConversationAttachments attachments;@Autowired ConversationService conversations;@Autowired AgentTaskService agents;@Autowired LiveAnswerService live;
 UUID tenant,actor,reader,personal,shared;
 @BeforeEach void setup(){tenant=UUID.randomUUID();actor=UUID.randomUUID();reader=UUID.randomUUID();personal=UUID.randomUUID();shared=UUID.randomUUID();
  db.update("INSERT INTO tenants(id,name) VALUES (?,'合成客户端输入')",tenant);
  for(UUID id:List.of(actor,reader)){db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成用户','unused')",id,id+"@example.test");db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,id);}
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'个人','PERSONAL'),(?,?,?,'共享','SHARED')",personal,tenant,actor,shared,tenant,actor);
  for(UUID id:List.of(actor,reader))db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",tenant,shared,id);
 }
 @AfterEach void cleanup(){db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);db.update("UPDATE knowledge_runs SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);}
 MockMultipartFile file(String content){return new MockMultipartFile("file","input.txt","text/plain",content.getBytes(StandardCharsets.UTF_8));}
 MaterialService.UploadReceipt upload(UUID space,String text){var f=materials.uploadReceipt(actor,tenant,space,null,null,null,UUID.randomUUID(),file(text));parse(f.acceptedVersion().id(),text);return f;}
 void parse(UUID version,String text){var j=knowledge.claim();assertEquals(version,j.version());knowledge.finish(j,new DocumentParser.Result("synthetic","READY",List.of(),List.of(new DocumentParser.Fragment("L1",text,"TEXT"))));}
 ConversationService.Job task(UUID conversation,List<TaskOriginals.Selection> selected,String scope){var d=conversations.submitClient(actor,tenant,conversation,personal,UUID.randomUUID(),"检索合成标记","AGENT",null,selected,scope);var j=conversations.claim();assertEquals(d.tasks().getLast().id(),j.id());return j;}
 @Test void attachmentsArePrivateIdempotentAndNotTasksOrLibraryUntilSaved(){
  UUID draft=UUID.randomUUID(),request=UUID.randomUUID();var first=attachments.upload(actor,tenant,null,draft,request,file("marker private"));parse(first.file().acceptedVersion().id(),"marker private");
  var replay=attachments.upload(actor,tenant,null,draft,request,file("marker private"));assertEquals(first.file().acceptedVersion(),replay.file().acceptedVersion());
  assertTrue(conversations.detail(actor,tenant,first.conversation().id(),0,20).tasks().isEmpty());
  assertFalse(materials.detail(actor,tenant,personal,first.file().id(),0,1).inLibrary());assertTrue(materials.list(actor,tenant,personal,null,"",0,24).items().isEmpty());assertTrue(knowledge.search(actor,tenant,personal,"marker",0,20).items().isEmpty());
  assertThrows(IdentityException.class,()->attachments.list(reader,tenant,first.conversation().id()));
  var elsewhere=task(null,List.of(),"AUTHORIZED_LIBRARY");assertTrue(agents.search(elsewhere.id(),elsewhere.token(),"marker").isEmpty());
  var own=task(first.conversation().id(),List.of(),"AUTHORIZED_LIBRARY");assertEquals(1,agents.search(own.id(),own.token(),"marker").size());
  UUID save=UUID.randomUUID();assertTrue(attachments.save(actor,tenant,first.conversation().id(),first.file().id(),save).inLibrary());attachments.save(actor,tenant,first.conversation().id(),first.file().id(),save);attachments.upload(actor,tenant,null,draft,request,file("marker private"));assertEquals(1,materials.list(actor,tenant,personal,null,"marker",0,24).items().size());
 }
 @Test void attachmentDraftUsesSelectedWorkspaceAndKeepsFilesPrivate(){
  UUID draft=UUID.randomUUID(),request=UUID.randomUUID();
  var receipt=attachments.upload(actor,tenant,null,draft,request,file("shared draft"),shared);
  assertEquals(shared,receipt.conversation().workspaceId());
  assertEquals(personal,db.queryForObject("SELECT workspace_id FROM materials WHERE id=?",UUID.class,receipt.file().id()));
  assertEquals(receipt.conversation().id(),attachments.upload(actor,tenant,null,draft,request,file("shared draft"),shared).conversation().id());
  assertThrows(IdentityException.class,()->attachments.list(reader,tenant,receipt.conversation().id()));
  assertThrows(IdentityException.class,()->attachments.upload(actor,tenant,receipt.conversation().id(),draft,UUID.randomUUID(),file("wrong workspace"),personal));
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",shared,actor);
  assertThrows(IdentityException.class,()->attachments.upload(actor,tenant,null,UUID.randomUUID(),UUID.randomUUID(),file("revoked"),shared));
 }
 @Test void crossWorkspaceReadingKeepsSelectedVersionAndRevocationRechecks(){
  var sharedFile=upload(shared,"marker old");var next=materials.uploadReceipt(actor,tenant,shared,null,sharedFile.id(),1,UUID.randomUUID(),file("marker new"));parse(next.acceptedVersion().id(),"marker new");var mine=upload(personal,"marker personal");
  var selected=List.of(new TaskOriginals.Selection(sharedFile.id(),sharedFile.acceptedVersion().id()));
  var j=task(null,selected,"AUTHORIZED_LIBRARY");var found=agents.search(j.id(),j.token(),"marker");assertEquals(2,found.size());assertTrue(found.stream().anyMatch(x->x.content().equals("marker old")));assertFalse(found.stream().anyMatch(x->x.content().equals("marker new")));
  var restricted=task(null,selected,"SELECTED");assertEquals(1,agents.search(restricted.id(),restricted.token(),"marker").size());assertEquals("marker old",agents.search(restricted.id(),restricted.token(),"").getFirst().content());
  UUID liveConversation=db.queryForObject("SELECT conversation_id FROM conversation_tasks WHERE id=?",UUID.class,j.id());
  live.publish(j.id(),j.token(),new LiveAnswerService.Update(1,1,"合成资料中的文字","STREAMING"));
  assertEquals(1,live.snapshot(actor,tenant,liveConversation).size());
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",shared,actor);
  assertTrue(live.snapshot(actor,tenant,liveConversation).isEmpty());
  assertThrows(IdentityException.class,()->live.publish(j.id(),j.token(),new LiveAnswerService.Update(1,2,"合成资料中的文字后续","STREAMING")));
  assertThrows(IdentityException.class,()->agents.search(j.id(),j.token(),"marker"));assertThrows(IdentityException.class,()->agents.search(restricted.id(),restricted.token(),"marker"));
 }
 @Test void fileOnlyGrantSupportsAiSourcesWithoutParentMembershipAndRevocationHidesHistory(){
  var file=upload(shared,"marker cross department");
  db.update("INSERT INTO library_permission_rollouts VALUES (?,true)",tenant);
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",shared,actor);
  db.update("INSERT INTO library_policies(tenant_id,object_kind,object_id,workspace_id) VALUES (?,'MATERIAL',?,?)",tenant,file.id(),shared);
  db.update("INSERT INTO library_grants(tenant_id,object_kind,object_id,principal_kind,principal_id,content,download) VALUES (?,'MATERIAL',?,'ACCOUNT',?,'READ','DENY')",tenant,file.id(),actor);
  var j=task(null,List.of(new TaskOriginals.Selection(file.id(),file.acceptedVersion().id())),"SELECTED");
  assertEquals(1,agents.search(j.id(),j.token(),"marker").size());
  assertEquals(1,db.queryForObject("SELECT count(*) FROM readable_source_tasks WHERE id=?",Integer.class,j.id()));
  assertThrows(IdentityException.class,()->materials.download(actor,tenant,shared,file.id(),file.acceptedVersion().id()));
  db.update("DELETE FROM library_grants WHERE tenant_id=? AND object_id=?",tenant,file.id());
  assertEquals(0,db.queryForObject("SELECT count(*) FROM readable_source_tasks WHERE id=?",Integer.class,j.id()));
  assertThrows(IdentityException.class,()->agents.search(j.id(),j.token(),"marker"));
 }

 @Test void promptRestrictionAndUnknownSelectionsCannotEscape(){
  var one=upload(personal,"marker selected");upload(shared,"marker outside");
  var d=conversations.submitClient(actor,tenant,null,personal,UUID.randomUUID(),"只用所选资料查找 marker","AGENT",null,List.of(new TaskOriginals.Selection(one.id(),one.acceptedVersion().id())),"AUTHORIZED_LIBRARY");var j=conversations.claim();assertEquals(d.tasks().getLast().id(),j.id());assertEquals(1,agents.search(j.id(),j.token(),"marker").size());
  var e=assertThrows(IdentityException.class,()->task(null,List.of(new TaskOriginals.Selection(UUID.randomUUID(),UUID.randomUUID())),"SELECTED"));assertEquals(404,e.status);
 }

 @Test void unifiedSearchIncludesDescendantsAndBodyOnceBeforePaging(){
  var root=materials.createFolder(actor,tenant,personal,null,"销售",UUID.randomUUID());var child=materials.createFolder(actor,tenant,personal,root.id(),"月报",UUID.randomUUID());
  for(UUID folder:List.of(root.id(),child.id())){var f=materials.uploadReceipt(actor,tenant,personal,folder,null,null,UUID.randomUUID(),file("uniquebody 两段相同命中 uniquebody"));parse(f.acceptedVersion().id(),"uniquebody 两段相同命中 uniquebody");}
  upload(personal,"uniquebody 根目录应被排除");
  var first=materials.list(actor,tenant,personal,root.id(),"uniquebody",0,1);assertEquals(1,first.items().size());assertTrue(first.hasMore());
  var second=materials.list(actor,tenant,personal,root.id(),"uniquebody",1,1);assertEquals(1,second.items().size());assertFalse(second.hasMore());assertNotEquals(first.items().getFirst().id(),second.items().getFirst().id());
  assertEquals(1,materials.list(actor,tenant,personal,child.id(),"uniquebody",0,20).items().size());
 }

 @Test void supplementRestartsSameTaskAndRejectsOldLeaseWithIdempotentReplay(){
  var j=task(null,List.of(),"AUTHORIZED_LIBRARY");
  UUID conversation=db.queryForObject("SELECT conversation_id FROM conversation_tasks WHERE id=?",UUID.class,j.id());
  int revision=db.queryForObject("SELECT revision FROM conversation_tasks WHERE id=?",Integer.class,j.id());
  UUID key=UUID.randomUUID();
  var updated=conversations.action(actor,tenant,conversation,j.id(),key,revision,"SUPPLEMENT","请重点核对合成数据",null);
  assertEquals("QUEUED",updated.tasks().getLast().status());
  assertEquals("PAUSED",db.queryForObject("SELECT status FROM conversation_attempts WHERE task_id=? AND attempt_number=1",String.class,j.id()));
  assertThrows(IdentityException.class,()->agents.search(j.id(),j.token(),"marker"));
  var replay=conversations.action(actor,tenant,conversation,j.id(),key,revision,"SUPPLEMENT","请重点核对合成数据",null);
  assertEquals(updated.tasks().getLast().revision(),replay.tasks().getLast().revision());
  assertThrows(IdentityException.class,()->conversations.action(actor,tenant,conversation,j.id(),UUID.randomUUID(),revision,"SUPPLEMENT","旧版本",null));
  var next=conversations.claim();assertEquals(j.id(),next.id());
  assertTrue(db.queryForObject("SELECT input FROM conversation_attempts WHERE task_id=? AND attempt_number=2",String.class,j.id()).contains("请重点核对合成数据"));
 }
 @Test void waitingTaskAcceptsAuthorizedSupplementFilesAndDoesNotBlockNewTopic(){
  var f=upload(shared,"marker 补充文件");var j=task(null,List.of(),"AUTHORIZED_LIBRARY");
  UUID conversation=db.queryForObject("SELECT conversation_id FROM conversation_tasks WHERE id=?",UUID.class,j.id());
  db.update("UPDATE conversation_tasks SET status='WAITING_INPUT',required_input='请补充资料',lease_token=NULL WHERE id=?",j.id());
  int revision=db.queryForObject("SELECT revision FROM conversation_tasks WHERE id=?",Integer.class,j.id());
  var added=List.of(new TaskOriginals.Selection(f.id(),f.acceptedVersion().id()));
  assertThrows(IdentityException.class,()->conversations.action(reader,tenant,conversation,j.id(),UUID.randomUUID(),revision,"RESUME","补资料",added));
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",shared,actor);
  assertThrows(IdentityException.class,()->conversations.action(actor,tenant,conversation,j.id(),UUID.randomUUID(),revision,"RESUME","补资料",added));
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",tenant,shared,actor);
  var newer=conversations.submitClient(actor,tenant,conversation,personal,UUID.randomUUID(),"一个新的话题","AGENT",null,List.of(),"AUTHORIZED_LIBRARY");
  assertEquals(2,newer.tasks().size());
  assertThrows(IdentityException.class,()->conversations.action(actor,tenant,conversation,j.id(),UUID.randomUUID(),revision,"RESUME","补资料",added));
  assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_originals WHERE task_id=?",Integer.class,j.id()));
  var other=newer.tasks().stream().filter(t->!t.id().equals(j.id())).findFirst().orElseThrow();
  conversations.action(actor,tenant,conversation,other.id(),UUID.randomUUID(),other.revision(),"CANCEL");
  UUID key=UUID.randomUUID();
  conversations.action(actor,tenant,conversation,j.id(),key,revision,"RESUME","补资料",added);
  conversations.action(actor,tenant,conversation,j.id(),key,revision,"RESUME","补资料",added);
  assertEquals(1,db.queryForObject("SELECT count(*) FROM conversation_originals WHERE task_id=?",Integer.class,j.id()));
  var next=conversations.claim();assertEquals(j.id(),next.id());assertEquals(1,agents.search(next.id(),next.token(),"marker").size());
 }
}
