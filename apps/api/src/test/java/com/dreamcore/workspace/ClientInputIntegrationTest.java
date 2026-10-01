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
 @Autowired JdbcTemplate db;@Autowired MaterialService materials;@Autowired KnowledgeService knowledge;@Autowired ConversationAttachments attachments;@Autowired ConversationService conversations;@Autowired AgentTaskService agents;
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
 @Test void crossWorkspaceReadingKeepsSelectedVersionAndRevocationRechecks(){
  var sharedFile=upload(shared,"marker old");var next=materials.uploadReceipt(actor,tenant,shared,null,sharedFile.id(),1,UUID.randomUUID(),file("marker new"));parse(next.acceptedVersion().id(),"marker new");var mine=upload(personal,"marker personal");
  var selected=List.of(new TaskOriginals.Selection(sharedFile.id(),sharedFile.acceptedVersion().id()));
  var j=task(null,selected,"AUTHORIZED_LIBRARY");var found=agents.search(j.id(),j.token(),"marker");assertEquals(2,found.size());assertTrue(found.stream().anyMatch(x->x.content().equals("marker old")));assertFalse(found.stream().anyMatch(x->x.content().equals("marker new")));
  var restricted=task(null,selected,"SELECTED");assertEquals(1,agents.search(restricted.id(),restricted.token(),"marker").size());assertEquals("marker old",agents.search(restricted.id(),restricted.token(),"").getFirst().content());
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",shared,actor);assertThrows(IdentityException.class,()->agents.search(j.id(),j.token(),"marker"));assertThrows(IdentityException.class,()->agents.search(restricted.id(),restricted.token(),"marker"));
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
}
