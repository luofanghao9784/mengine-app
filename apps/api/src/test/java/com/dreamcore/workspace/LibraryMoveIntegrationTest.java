package com.dreamcore.workspace;
import com.dreamcore.workspace.material.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import static org.junit.jupiter.api.Assertions.*;
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.knowledge.enabled=false","dreamcore.lifecycle.enabled=false"})
class LibraryMoveIntegrationTest {
 @Autowired JdbcTemplate db;@Autowired LibraryPermissionService permissions;@Autowired MaterialService materials;@Autowired LibraryMoveService moves;
 @org.springframework.boot.test.web.server.LocalServerPort int port;
 @Autowired org.springframework.security.crypto.password.PasswordEncoder passwords;
 UUID tenant,admin,reader,space,source,target,file;
 @BeforeEach void setup(){
  tenant=UUID.randomUUID();admin=UUID.randomUUID();reader=UUID.randomUUID();space=UUID.randomUUID();
  db.update("INSERT INTO tenants(id,name) VALUES (?,'合成移动测试')",tenant);db.update("INSERT INTO library_permission_rollouts VALUES (?,true)",tenant);
  for(UUID person:List.of(admin,reader)){db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,'not-used')",person,person+"@move.test",person.equals(admin)?"管理员":"读者");db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,person,person.equals(admin)?"TENANT_ADMIN":"MEMBER");}
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind,responsibility_confirmed) VALUES (?,?,?,'共享空间','SHARED',true)",space,tenant,admin);
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true),(?,?,?,false)",tenant,space,admin,tenant,space,reader);
  source=materials.createFolder(admin,tenant,space,null,"开放目录",UUID.randomUUID()).id();target=materials.createFolder(admin,tenant,space,null,"受限目录",UUID.randomUUID()).id();
  file=materials.upload(admin,tenant,space,source,null,null,UUID.randomUUID(),new MockMultipartFile("file","预算.txt","text/plain","synthetic".getBytes())).id();
  save("FOLDER",target,true,List.of(grant(reader,"NONE","DENY")));
 }
 LibraryPermissionService.Grant grant(UUID id,String content,String download){return new LibraryPermissionService.Grant("ACCOUNT",id,content,download,false,null);}
 void save(String kind,UUID id,boolean inherit,List<LibraryPermissionService.Grant> grants){permissions.save(admin,tenant,kind,id,new LibraryPermissionService.Change(UUID.randomUUID(),permissions.policy(admin,tenant,kind,id).revision(),inherit,grants));}
 LibraryMoveService.Preview preview(String kind,UUID object,UUID parent,boolean inherit){return moves.preview(admin,tenant,space,kind,object,new LibraryMoveService.Proposal(parent,inherit));}
 LibraryMoveService.Commit command(LibraryMoveService.Preview p){return new LibraryMoveService.Commit(UUID.randomUUID(),p.fingerprint(),p.destinationFolderId(),p.inheritDestination());}
 @Test void previewDoesNotMutateAndConfirmedMoveKeepsVersionsAndIsIdempotent(){
  var version=materials.detail(admin,tenant,space,file,0,20).versions().getFirst();var p=preview("MATERIAL",file,target,false);
  assertTrue(p.changes().stream().anyMatch(c->c.accountId().equals(reader)&&c.beforeMask()==5&&c.afterMask()==0));
  assertEquals(source,materials.detail(reader,tenant,space,file,0,20).document().folderId());
  var command=command(p);var receipt=moves.move(admin,tenant,space,"MATERIAL",file,command);
  assertEquals(receipt,moves.move(admin,tenant,space,"MATERIAL",file,command));
  var current=materials.detail(admin,tenant,space,file,0,20);assertEquals(target,current.document().folderId());assertEquals(version,current.versions().getFirst());
  assertThrows(IdentityException.class,()->materials.detail(reader,tenant,space,file,0,20));
  assertEquals(1,permissions.events(admin,tenant,"MATERIAL",file,0).stream().filter(e->e.action().equals("MATERIAL_MOVE")).count());
 }
 @Test void independentScopeSurvivesUnlessExplicitlyChanged(){
  save("MATERIAL",file,false,List.of(grant(admin,"EDIT","ALLOW"),grant(reader,"READ","ALLOW")));
  var p=preview("MATERIAL",file,target,false);assertTrue(p.independent());assertTrue(p.changes().isEmpty());
  moves.move(admin,tenant,space,"MATERIAL",file,command(p));assertTrue(permissions.effective(reader,tenant,"MATERIAL",file).canRead());
  p=preview("MATERIAL",file,source,false);moves.move(admin,tenant,space,"MATERIAL",file,command(p));
  p=preview("MATERIAL",file,target,true);assertFalse(p.changes().isEmpty());moves.move(admin,tenant,space,"MATERIAL",file,command(p));
  assertFalse(permissions.effective(reader,tenant,"MATERIAL",file).canRead());assertEquals(2,permissions.policy(admin,tenant,"MATERIAL",file).grants().size());
 }
 @Test void newPolicyAfterPreviewRejectsConfirmationWithoutMoving(){
  var p=preview("MATERIAL",file,target,false);save("MATERIAL",file,true,List.of(grant(reader,"READ","DENY")));
  assertEquals("LIBRARY_MOVE_PREVIEW_STALE",assertThrows(IdentityException.class,()->moves.move(admin,tenant,space,"MATERIAL",file,command(p))).code);
  assertEquals(source,materials.detail(admin,tenant,space,file,0,20).document().folderId());
 }
 @Test void folderCycleAndDeniedDescendantAreRejected(){
  assertEquals("LIBRARY_MOVE_CYCLE",assertThrows(IdentityException.class,()->preview("FOLDER",source,source,false)).code);
  save("MATERIAL",file,true,List.of(grant(admin,"NONE","DENY")));
  assertThrows(IdentityException.class,()->preview("FOLDER",source,target,false));
  assertNull(db.queryForObject("SELECT parent_id FROM material_folders WHERE id=?",UUID.class,source));
 }
 @Test void readersSeeMaintenanceButNotPermissionOrAccessAudit(){
  var p=preview("MATERIAL",file,null,false);moves.move(admin,tenant,space,"MATERIAL",file,command(p));
  UUID version=materials.detail(reader,tenant,space,file,0,20).versions().getFirst().id();materials.download(reader,tenant,space,file,version);
  var events=permissions.events(reader,tenant,"MATERIAL",file,0,false);
  assertTrue(events.stream().anyMatch(e->e.action().equals("MATERIAL_MOVE")));
  assertTrue(events.stream().noneMatch(e->e.action().contains("DOWNLOAD")||e.action().contains("PERMISSION")));
  assertTrue(events.stream().allMatch(e->e.beforeValue()==null&&e.afterValue()==null));
  assertThrows(IdentityException.class,()->permissions.events(reader,tenant,"MATERIAL",file,0,true));
 }
 @Test void foreignDestinationDoesNotMoveOrExposeItsName(){
  UUID other=UUID.randomUUID();db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'另一空间','SHARED')",other,tenant,admin);
  UUID otherFolder=UUID.randomUUID();db.update("INSERT INTO material_folders(id,tenant_id,workspace_id,name,created_by) VALUES (?,?,?,'不可见位置',?)",otherFolder,tenant,other,admin);
  assertThrows(IdentityException.class,()->preview("MATERIAL",file,otherFolder,false));
  assertEquals(source,materials.detail(admin,tenant,space,file,0,20).document().folderId());
 }
 @Test void movingFolderRecordsItsDescendantsAndCannotIncreaseMoverContentRights(){
  var p=preview("FOLDER",source,target,false);
  moves.move(admin,tenant,space,"FOLDER",source,command(p));
  assertEquals(1,permissions.events(admin,tenant,"MATERIAL",file,0,false).stream().filter(e->e.action().equals("MATERIAL_MOVE")).count());
  assertEquals(source,materials.detail(admin,tenant,space,file,0,20).document().folderId());
  save("FOLDER",source,true,List.of(grant(admin,"READ","DENY")));
  p=preview("MATERIAL",file,null,false);var c=command(p);
  assertEquals("LIBRARY_SELF_GRANT_REQUIRES_REVIEW",assertThrows(IdentityException.class,()->moves.move(admin,tenant,space,"MATERIAL",file,c)).code);
  assertEquals(source,materials.detail(admin,tenant,space,file,0,20).document().folderId());
 }
 @Test void httpDownloadDenialLeavesAuditAndReadersCannotReadAccessDetails() throws Exception {
  save("MATERIAL",file,true,List.of(grant(reader,"READ","DENY")));
  UUID version=materials.detail(reader,tenant,space,file,0,20).versions().getFirst().id();
  db.update("UPDATE accounts SET password_hash=? WHERE id=?",passwords.encode("synthetic-move-password"),reader);
  var http=java.net.http.HttpClient.newBuilder().cookieHandler(new java.net.CookieManager(null,java.net.CookiePolicy.ACCEPT_ALL)).build();
  var json=new tools.jackson.databind.json.JsonMapper();String base="http://127.0.0.1:"+port;
  var csrf=json.readTree(http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(base+"/api/v1/auth/csrf")).GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString()).body());
  var login=java.net.http.HttpRequest.newBuilder(java.net.URI.create(base+"/api/v1/auth/login")).header(csrf.get("headerName").asString(),csrf.get("token").asString()).header("Content-Type","application/json").POST(java.net.http.HttpRequest.BodyPublishers.ofString(json.writeValueAsString(Map.of("email",reader+"@move.test","password","synthetic-move-password")))).build();
  assertEquals(200,http.send(login,java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
  String path="/api/v1/tenants/"+tenant+"/workspaces/"+space+"/materials/"+file+"/versions/"+version+"/download";
  assertEquals(403,http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(base+path)).GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
  // afterCompletion runs after sending the response; observe its committed event with a bounded wait.
  long deadline=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(3);
  while(db.queryForObject("SELECT count(*) FROM library_events WHERE object_id=? AND action='REQUEST_DOWNLOAD'",Integer.class,file)==0 && System.nanoTime()<deadline)Thread.sleep(10);
  var event=db.queryForMap("SELECT outcome,http_status,request_id,version_id FROM library_events WHERE object_id=? AND action='REQUEST_DOWNLOAD'",file);
  assertEquals("DENIED",event.get("outcome"));assertEquals(403,event.get("http_status"));assertNotNull(event.get("request_id"));assertEquals(version,event.get("version_id"));
  save("MATERIAL",file,true,List.of(grant(reader,"READ","ALLOW")));
  assertEquals(200,http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(base+path)).GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
  deadline=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(3);
  while(db.queryForObject("SELECT count(*) FROM library_events WHERE object_id=? AND action='REQUEST_DOWNLOAD'",Integer.class,file)<2 && System.nanoTime()<deadline)Thread.sleep(10);
  assertEquals(1,db.queryForObject("SELECT count(*) FROM library_events operation JOIN library_events request ON request.request_id=operation.request_id WHERE operation.object_id=? AND operation.action='MATERIAL_DOWNLOAD' AND operation.version_id=? AND request.action='REQUEST_DOWNLOAD' AND request.outcome='SUCCESS'",Integer.class,file,version));
  String events="/api/v1/tenants/"+tenant+"/library-access/MATERIAL/"+file+"/events";
  var ordinary=http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(base+events)).GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString());
  assertEquals(200,ordinary.statusCode());assertFalse(ordinary.body().contains("REQUEST_DOWNLOAD"));assertFalse(ordinary.body().contains("PERMISSION_CHANGE"));
  assertEquals(403,http.send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(base+events+"?view=AUDIT")).GET().build(),java.net.http.HttpResponse.BodyHandlers.ofString()).statusCode());
 }
}
