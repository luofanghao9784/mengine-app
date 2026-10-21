package com.dreamcore.workspace;

import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.material.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(properties={"dreamcore.knowledge.enabled=false","dreamcore.lifecycle.enabled=false"})
class LibraryPermissionIntegrationTest {
 @Autowired JdbcTemplate db; @Autowired LibraryPermissionService permissions; @Autowired MaterialService materials; @Autowired com.dreamcore.workspace.knowledge.KnowledgeService knowledge; @Autowired com.dreamcore.workspace.activity.ActivityService activity;
 UUID tenant,admin,editor,reader,external,space,file,folder;
 @BeforeEach void setup(){
  tenant=UUID.randomUUID();admin=UUID.randomUUID();editor=UUID.randomUUID();reader=UUID.randomUUID();external=UUID.randomUUID();space=UUID.randomUUID();
  db.update("INSERT INTO tenants(id,name) VALUES (?,'合成资料权限企业')",tenant);
  db.update("INSERT INTO library_permission_rollouts VALUES (?,true)",tenant);
  for(UUID id:List.of(admin,editor,reader,external)){
   db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,'not-used')",id,id+"@acl.test","合成成员");
   db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,id,id.equals(admin)?"TENANT_ADMIN":"MEMBER");
  }
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind,responsibility_confirmed) VALUES (?,?,?,'财务','SHARED',true)",space,tenant,admin);
  for(UUID id:List.of(editor,reader))db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,?)",tenant,space,id,id.equals(editor));
  folder=materials.createFolder(editor,tenant,space,null,"机密目录",UUID.randomUUID()).id();
  file=materials.upload(editor,tenant,space,folder,null,null,UUID.randomUUID(),new MockMultipartFile("file","budget.txt","text/plain","synthetic only".getBytes())).id();
 }
 LibraryPermissionService.Grant grant(UUID member,String content,String download){return new LibraryPermissionService.Grant("ACCOUNT",member,content,download,false,null);}
 LibraryPermissionService.Policy save(String kind,UUID id,boolean inherit,List<LibraryPermissionService.Grant> grants){return permissions.save(admin,tenant,kind,id,new LibraryPermissionService.Change(UUID.randomUUID(),permissions.policy(admin,tenant,kind,id).revision(),inherit,grants));}
 @Test void personalUploadReferenceRespectsFilePolicyAndDoesNotIncludeOthersUploads(){
  UUID personal=UUID.randomUUID(),readerPersonal=UUID.randomUUID();
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'个人','PERSONAL'),(?,?,?,'读者个人','PERSONAL')",personal,tenant,editor,readerPersonal,tenant,reader);
  assertEquals(List.of(file),materials.list(editor,tenant,personal,null,"",0,20,true).items().stream().map(MaterialService.Entry::id).toList());
  assertTrue(materials.list(reader,tenant,readerPersonal,null,"",0,20,true).items().isEmpty());
  save("MATERIAL",file,false,List.of(grant(editor,"READ","DENY")));
  var ref=materials.list(editor,tenant,personal,null,"",0,20,true).items().getFirst();
  assertEquals(file,ref.id());assertFalse(ref.canMaintain());assertFalse(ref.canDownload());
  assertThrows(IdentityException.class,()->materials.download(editor,tenant,space,file,materials.detail(editor,tenant,space,file,0,20).versions().getFirst().id()));
  save("MATERIAL",file,false,List.of(grant(reader,"READ","ALLOW")));
  assertTrue(materials.list(editor,tenant,personal,null,"",0,20,true).items().isEmpty());
  assertThrows(IdentityException.class,()->materials.detail(editor,tenant,space,file,0,20));
 }
 @Test void administratorDoesNotReadAndEditorDoesNotDelete(){
  var e=permissions.effective(editor,tenant,"MATERIAL",file);assertTrue(e.canEdit());assertTrue(e.canDownload());assertFalse(e.canManageFiles());
  assertFalse(permissions.policy(admin,tenant,"MATERIAL",file).effective().canRead());
  assertThrows(IdentityException.class,()->materials.detail(admin,tenant,space,file,0,20));
  assertThrows(IdentityException.class,()->save("MATERIAL",file,true,List.of(grant(admin,"READ","ALLOW"))));
 }
 @Test void independentFileGrantDoesNotExposeParentsOrAllowDownload(){
  save("MATERIAL",file,false,List.of(grant(external,"READ","DENY")));
  var detail=materials.detail(external,tenant,space,file,0,20);assertEquals(List.of("budget.txt"),detail.document().path());
  assertFalse(detail.document().canDownload());assertEquals("共享资料",detail.document().workspaceName());
  assertThrows(IdentityException.class,()->materials.download(external,tenant,space,file,detail.versions().getFirst().id()));
  assertThrows(IdentityException.class,()->materials.list(external,tenant,space,null,"",0,20));
  assertEquals(List.of(file),materials.list(external,tenant,null,null,"",0,20).items().stream().map(MaterialService.Entry::id).toList());
  assertTrue(materials.list(reader,tenant,space,folder,"",0,20).items().isEmpty());
  assertThrows(IdentityException.class,()->materials.detail(reader,tenant,space,file,0,20));
 }
 @Test void folderRestrictionsAffectNewAndExistingChildrenAndExplicitDenyWins(){
  save("FOLDER",folder,true,List.of(grant(reader,"NONE","DENY")));
  assertThrows(IdentityException.class,()->materials.detail(reader,tenant,space,file,0,20));
  save("MATERIAL",file,true,List.of(grant(reader,"EDIT","ALLOW")));
  assertFalse(permissions.effective(reader,tenant,"MATERIAL",file).canRead());
  var next=materials.upload(editor,tenant,space,folder,null,null,UUID.randomUUID(),new MockMultipartFile("file","new.txt","text/plain",new byte[]{1}));
  assertFalse(permissions.effective(reader,tenant,"MATERIAL",next.id()).canRead());
 }
 @Test void departmentMembershipAndRoleBoundPersonalGrantRevokeAtomically(){
  UUID department=UUID.randomUUID();permissions.saveDepartment(admin,tenant,department,new LibraryPermissionService.DepartmentChange(UUID.randomUUID(),0,"销售",List.of(external)));
  save("MATERIAL",file,false,List.of(new LibraryPermissionService.Grant("DEPARTMENT",department,"READ","DENY",false,null),new LibraryPermissionService.Grant("ACCOUNT",external,"EDIT","INHERIT",false,department)));
  assertTrue(permissions.effective(external,tenant,"MATERIAL",file).canEdit());assertFalse(permissions.effective(external,tenant,"MATERIAL",file).canDownload());
  assertEquals(department,launch.departmentExceptions(admin,tenant,department).getFirst().roleDepartmentId());assertThrows(IdentityException.class,()->launch.departmentExceptions(reader,tenant,department));
  permissions.saveDepartment(admin,tenant,department,new LibraryPermissionService.DepartmentChange(UUID.randomUUID(),1,"销售",List.of()));
  assertFalse(permissions.effective(external,tenant,"MATERIAL",file).canRead());
  permissions.saveDepartment(admin,tenant,department,new LibraryPermissionService.DepartmentChange(UUID.randomUUID(),2,"销售",List.of(external)));
  assertTrue(permissions.effective(external,tenant,"MATERIAL",file).canRead());assertFalse(permissions.effective(external,tenant,"MATERIAL",file).canEdit());
  assertTrue(permissions.events(admin,tenant,"MATERIAL",file,0).stream().anyMatch(e->e.action().equals("ROLE_GRANT_REVOKED")));
 }
 @Test void versionConflictAndReplayPreservePolicyAndAudit(){
  var change=new LibraryPermissionService.Change(UUID.randomUUID(),0,true,List.of(grant(reader,"READ","DENY")));
  permissions.save(admin,tenant,"MATERIAL",file,change);permissions.save(admin,tenant,"MATERIAL",file,change);
  assertEquals(1,permissions.events(admin,tenant,"MATERIAL",file,0).stream().filter(e->e.action().equals("PERMISSION_CHANGE")).count());
  assertThrows(IdentityException.class,()->permissions.save(admin,tenant,"MATERIAL",file,new LibraryPermissionService.Change(UUID.randomUUID(),0,false,List.of())));
  assertEquals(1,permissions.policy(admin,tenant,"MATERIAL",file).revision());
  assertThrows(IdentityException.class,()->permissions.save(reader,tenant,"MATERIAL",file,new LibraryPermissionService.Change(UUID.randomUUID(),1,true,List.of())));
 }
 @Test void tenantAndDisabledMembershipCannotBeBypassed(){
  save("MATERIAL",file,true,List.of(grant(external,"READ","ALLOW")));
  db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,external);
  assertFalse(permissions.effective(external,tenant,"MATERIAL",file).canRead());
  assertEquals(0,permissions.mask(external,UUID.randomUUID(),"MATERIAL",file));
 }
 @Test void restrictedFilesDisappearFromParsedSearchAndActivityAndOldVersions(){
  UUID version=materials.detail(reader,tenant,space,file,0,20).versions().getFirst().id();
  save("MATERIAL",file,true,List.of(grant(reader,"NONE","DENY")));
  assertEquals(0,knowledge.search(reader,tenant,space,"synthetic",0,10).coverage().totalVersions());
  assertTrue(activity.list(reader,tenant,space,null,20).items().isEmpty());
  assertThrows(IdentityException.class,()->knowledge.analysis(reader,tenant,space,file,version,0,20));
  assertThrows(IdentityException.class,()->materials.version(reader,tenant,space,file,version));
 }
 @Test void independentEditorUpdatesSameFileAndKeepsDownloadDenied(){
  save("MATERIAL",file,false,List.of(grant(external,"EDIT","DENY")));
  var receipt=materials.uploadReceipt(external,tenant,space,null,file,1,UUID.randomUUID(),new MockMultipartFile("file","budget.txt","text/plain","revised synthetic".getBytes()));
  assertEquals(2,receipt.version());assertFalse(receipt.canDownload());
  var detail=materials.detail(external,tenant,space,file,0,20);assertEquals(2,detail.versions().size());
  assertEquals("合成成员",detail.versions().getFirst().createdByName());
  assertThrows(IdentityException.class,()->materials.download(external,tenant,space,file,detail.versions().getLast().id()));
 }
 @Test void disabledRolloutPreservesLegacyAndRejectsPermissionMutation(){
  db.update("UPDATE library_permission_rollouts SET enabled=false WHERE tenant_id=?",tenant);
  assertTrue(permissions.effective(editor,tenant,"MATERIAL",file).canManageFiles());
  assertEquals("LIBRARY_PERMISSION_ROLLOUT_REQUIRED",assertThrows(IdentityException.class,()->save("MATERIAL",file,false,List.of())).code);
 }
 @Test void auditRecordsAreImmutableAndObjectTimelineHasVersionAndDownload(){
  UUID version=materials.detail(reader,tenant,space,file,0,20).versions().getFirst().id();
  materials.download(reader,tenant,space,file,version);
  var events=permissions.events(admin,tenant,"MATERIAL",file,0);
  assertTrue(events.stream().anyMatch(e->e.action().equals("MATERIAL_UPLOAD")));
  assertTrue(events.stream().anyMatch(e->e.action().equals("MATERIAL_DOWNLOAD")&&reader.equals(e.actorId())));
  assertThrows(org.springframework.dao.DataAccessException.class,()->db.update("DELETE FROM library_events WHERE tenant_id=?",tenant));
 }


 @Autowired LibraryLaunchService launch;
 @Test void previewIsReadOnlyConfirmedChangeDetectsMembershipDriftAndReplays(){
  var change=new LibraryPermissionService.Change(UUID.randomUUID(),0,true,List.of(grant(external,"READ","DENY")));
  var preview=launch.preview(admin,tenant,"MATERIAL",file,change);
  assertEquals(0,permissions.policy(admin,tenant,"MATERIAL",file).revision());
  assertFalse(permissions.effective(external,tenant,"MATERIAL",file).canRead());
  assertTrue(preview.changes().stream().anyMatch(c->c.accountId().equals(external)&&c.beforeMask()==0&&c.afterMask()==1));
  db.update("UPDATE workspace_members SET can_maintain=true WHERE workspace_id=? AND account_id=?",space,reader);
  var stale=new LibraryLaunchService.Confirmation(change,preview.fingerprint());
  assertEquals("LIBRARY_POLICY_PREVIEW_STALE",assertThrows(IdentityException.class,()->launch.confirm(admin,tenant,"MATERIAL",file,stale)).code);
  var current=new LibraryLaunchService.Confirmation(change,launch.preview(admin,tenant,"MATERIAL",file,change).fingerprint());
  launch.confirm(admin,tenant,"MATERIAL",file,current);launch.confirm(admin,tenant,"MATERIAL",file,current);
  assertTrue(permissions.effective(external,tenant,"MATERIAL",file).canRead());
  assertEquals(1,permissions.events(admin,tenant,"MATERIAL",file,0).stream().filter(e->e.action().equals("PERMISSION_CHANGE")).count());
 }
 @Test void metadataManagementAndSharedOnlyEntryDoNotExposeParentContent(){
  assertTrue(launch.locate(admin,tenant,"MANAGE","budget",0).items().stream().anyMatch(i->i.id().equals(file)&&!i.canRead()));
  assertTrue(launch.locate(reader,tenant,"MANAGE","",0).items().isEmpty());
  save("MATERIAL",file,false,List.of(grant(external,"READ","DENY")));
  var shared=launch.locate(external,tenant,"SHARED","",0).items();assertEquals(List.of(file),shared.stream().map(LibraryLaunchService.Item::id).toList());
  assertTrue(launch.explain(admin,tenant,"MATERIAL",file).people().stream().anyMatch(p->p.id().equals(external)&&p.mask()==1));
  assertTrue(launch.explain(external,tenant,"MATERIAL",file).people().isEmpty());
  assertTrue(launch.explain(external,tenant,"MATERIAL",file).reasons().stream().noneMatch(r->r.scope().equals("机密目录")));
 }
 @Test void independentRangeCannotBypassAncestorsAndDepartmentsCannotSelfEscalate(){
  save("FOLDER",folder,true,List.of(grant(external,"NONE","DENY")));
  save("MATERIAL",file,false,List.of(grant(external,"EDIT","ALLOW")));
  assertFalse(permissions.effective(external,tenant,"MATERIAL",file).canRead());
  UUID department=UUID.randomUUID();permissions.saveDepartment(admin,tenant,department,new LibraryPermissionService.DepartmentChange(UUID.randomUUID(),0,"销售",List.of(reader)));
  save("MATERIAL",file,false,List.of(new LibraryPermissionService.Grant("DEPARTMENT",department,"EDIT","ALLOW",false,null)));
  assertEquals("LIBRARY_SELF_GRANT_REQUIRES_REVIEW",assertThrows(IdentityException.class,()->permissions.saveDepartment(admin,tenant,department,new LibraryPermissionService.DepartmentChange(UUID.randomUUID(),1,"销售",List.of(reader,admin)))).code);
  assertFalse(permissions.effective(admin,tenant,"MATERIAL",file).canRead());
 }
}
