package com.dreamcore.workspace;

import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.knowledge.*;
import java.time.*;
import com.dreamcore.workspace.material.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(properties={"dreamcore.knowledge.enabled=false","dreamcore.lifecycle.enabled=false"})
class MaterialGovernanceIntegrationTest {
 @Autowired com.dreamcore.workspace.scene.NativeFoundationService nativeFoundation;
 @Test void nativeFoundationIncludesDocumentsOnlyWithinLibraryPermissions(){
  var snapshot=nativeFoundation.snapshot(reader,tenant);
  assertEquals(1,snapshot.path("items").size());
  assertEquals("material-"+file,snapshot.path("items").get(0).path("id").asText());
  assertFalse(snapshot.path("items").get(0).path("checksPassed").asBoolean());
  assertEquals(0,nativeFoundation.snapshot(outsider,tenant).path("items").size());
  grant(reader,"NONE");
  assertEquals(0,nativeFoundation.snapshot(reader,tenant).path("items").size());
 }
 @Test void nativeCountsUseCurrentVersionAndDoNotTreatCheckedAsPassed(){
  assertEquals("[1,0,0,0,0]",nativeFoundation.snapshot(reader,tenant).path("passed").toString());
  governance.change(reader,tenant,file,change(1,0),false);
  // Manual metadata completes annotation, not native checks or publication.
  assertEquals("[1,0,1,0,0]",nativeFoundation.snapshot(reader,tenant).path("passed").toString());
  assertFalse(nativeFoundation.snapshot(reader,tenant).path("items").get(0).path("checksPassed").asBoolean());
  UUID version=db.queryForObject("SELECT id FROM material_versions WHERE material_id=? AND number=1",UUID.class,file),run=UUID.randomUUID();
  db.update("INSERT INTO knowledge_runs(id,tenant_id,workspace_id,material_id,version_id,generation,requested_by,status) VALUES (?,?,?,?,?,1,?,'READY')",run,tenant,space,file,version,reader);
  db.update("INSERT INTO knowledge_chunks(id,tenant_id,workspace_id,material_id,version_id,run_id,ordinal,locator,method,content) VALUES (?,?,?,?,?,?,0,'L1','TEXT','synthetic')",UUID.randomUUID(),tenant,space,file,version,run);
  assertEquals("[1,1,1,0,0]",nativeFoundation.snapshot(reader,tenant).path("passed").toString());
  assertFalse(nativeFoundation.snapshot(reader,tenant).path("items").get(0).path("available").asBoolean());
  materials.storeGenerated(reader,tenant,space,null,file,1,"预算说明.txt","new contents".getBytes());
  assertEquals("[1,0,0,0,0]",nativeFoundation.snapshot(reader,tenant).path("passed").toString());
  grant(reader,"NONE");assertEquals("[0,0,0,0,0]",nativeFoundation.snapshot(reader,tenant).path("passed").toString());
 }
 @Autowired com.dreamcore.workspace.scene.NativeKnowledgeService nativeKnowledge;
 @Test void nativeKnowledgeKeepsUnpublishedSourcesSeparateAndRechecksRevocation(){
  var snapshot=nativeKnowledge.snapshot(reader,tenant);
  assertEquals(0,snapshot.path("items").size());
  assertEquals(1,snapshot.path("tabs").get(1).path("items").size());
  assertEquals(0,snapshot.path("pending").asInt());
  assertEquals("material-"+file,nativeKnowledge.source(reader,tenant,"material-"+file).path("id").asText());
  assertEquals(0,nativeKnowledge.snapshot(outsider,tenant).path("tabs").get(1).path("items").size());
  assertThrows(IdentityException.class,()->nativeKnowledge.source(outsider,tenant,"material-"+file));
  assertThrows(IdentityException.class,()->nativeKnowledge.snapshot(reader,UUID.randomUUID()));
  grant(reader,"NONE");
  assertEquals(0,nativeKnowledge.snapshot(reader,tenant).path("tabs").get(1).path("items").size());
  assertThrows(IdentityException.class,()->nativeKnowledge.source(reader,tenant,"material-"+file));
 }
 @Autowired MaterialGovernanceService governance; @Autowired ObjectStore objects; @Autowired MaterialProcessingService processing;
 @Autowired JdbcTemplate db; @Autowired LibraryPermissionService permissions; @Autowired MaterialService materials; @Autowired KnowledgeWorkbenchService workbench;
 UUID tenant,admin,reader,outsider,space,file;
 @BeforeEach void setup(){
  tenant=UUID.randomUUID();admin=UUID.randomUUID();reader=UUID.randomUUID();outsider=UUID.randomUUID();space=UUID.randomUUID();
  db.update("INSERT INTO tenants(id,name) VALUES (?,'合成工作台企业')",tenant);
  db.update("INSERT INTO library_permission_rollouts VALUES (?,true)",tenant);
  for(UUID id:List.of(admin,reader,outsider)){
   db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,'not-used')",id,id+"@workbench.test","合成成员");
   db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,id,id.equals(admin)?"TENANT_ADMIN":"MEMBER");
  }
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind,responsibility_confirmed) VALUES (?,?,?,'不可泄漏的财务空间','SHARED',true)",space,tenant,admin);
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",tenant,space,reader);
  file=materials.upload(reader,tenant,space,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","预算说明.txt","text/plain",("合成资料 "+"说明".repeat(80)+" 13800138000 fake@example.test").getBytes(java.nio.charset.StandardCharsets.UTF_8))).id();
 }
 UUID upload(String name){return materials.upload(reader,tenant,space,null,null,null,UUID.randomUUID(),new MockMultipartFile("file",name,"text/plain",("synthetic "+name).getBytes())).id();}
 KnowledgeWorkbenchService.Snapshot read(UUID actor){return workbench.read(actor,tenant,"ALL",null,"",0);}
 void grant(UUID target,String content){permissions.save(admin,tenant,"MATERIAL",file,new LibraryPermissionService.Change(UUID.randomUUID(),permissions.policy(admin,tenant,"MATERIAL",file).revision(),false,List.of(new LibraryPermissionService.Grant("ACCOUNT",target,content,"DENY",false,null))));}

 MaterialGovernanceService.Change change(int version,int revision){return new MaterialGovernanceService.Change(UUID.randomUUID(),version,revision,List.of("合成"),LocalDate.now().plusDays(90));}
 MaterialGovernanceService.Page list(UUID actor){return governance.list(actor,tenant,"","all","all","priority",0);}
 @Test void realRuleCheckAndFiltersArePersistedWithoutExposingMatchedText(){
  var result=governance.change(reader,tenant,file,change(1,0),false);
  assertEquals(List.of("phone","email"),result.issues());assertEquals("ORIGINAL_TEXT",result.source());
  var page=list(reader);assertEquals(1,page.summary().checked());assertEquals(1,page.summary().sensitive());assertEquals(68,page.items().getFirst().quality());
  assertEquals(1,governance.list(reader,tenant,"预算","sensitive","phone","quality",0).filteredTotal());
  assertEquals(0,governance.list(reader,tenant,"不存在","all","all","priority",0).filteredTotal());
  assertEquals(1,governance.list(reader,tenant,"不存在","all","all","priority",0).summary().total());
 }
 @Test void redactionCreatesOneNewVersionWithOriginalPreservedAndNoPermissionChanges(){
  governance.change(reader,tenant,file,change(1,0),false);var request=change(1,1);
  var result=governance.change(reader,tenant,file,request,true);var again=governance.change(reader,tenant,file,request,true);
  assertEquals(result,again);assertEquals(2,result.version());assertTrue(result.issues().isEmpty());
  assertEquals(2,db.queryForObject("SELECT count(*) FROM material_versions WHERE material_id=?",Integer.class,file));
  var versions=db.queryForList("SELECT object_id,size_bytes,sha256,number FROM material_versions WHERE material_id=? ORDER BY number",file);
  String original=new String(objects.read((UUID)versions.get(0).get("object_id"),(Long)versions.get(0).get("size_bytes"),(String)versions.get(0).get("sha256")),java.nio.charset.StandardCharsets.UTF_8);
  String clean=new String(objects.read((UUID)versions.get(1).get("object_id"),(Long)versions.get(1).get("size_bytes"),(String)versions.get(1).get("sha256")),java.nio.charset.StandardCharsets.UTF_8);
  assertTrue(original.contains("13800138000"));assertFalse(clean.contains("13800138000"));assertFalse(clean.contains("fake@example.test"));
  assertEquals(0,list(admin).summary().total());assertEquals(100,list(reader).items().getFirst().quality());
  assertEquals(1,db.queryForObject("SELECT count(*) FROM identity_audit WHERE tenant_id=? AND action='MATERIAL_GOVERNANCE_REDACT'",Integer.class,tenant));
 }
 @Test void staleVersionAndConflictingRetriesCannotWrite(){
  var request=change(1,0);governance.change(reader,tenant,file,request,false);
  assertThrows(IdentityException.class,()->governance.change(reader,tenant,file,change(1,0),true));
  assertThrows(IdentityException.class,()->governance.change(reader,tenant,file,new MaterialGovernanceService.Change(request.requestId(),1,0,List.of("changed"),request.reviewAt()),false));
  materials.storeGenerated(reader,tenant,space,null,file,1,"预算说明.txt","new contents".getBytes());
  assertEquals("NOT_CHECKED",governance.detail(reader,tenant,file).source());assertNull(governance.detail(reader,tenant,file).quality());
  assertThrows(IdentityException.class,()->governance.change(reader,tenant,file,change(1,1),true));
 }
 @Test void readonlyRevokedAndCrossTenantCannotInspectOrMutate(){
  governance.change(reader,tenant,file,change(1,0),false);grant(outsider,"READ");
  assertEquals("共享资料",governance.detail(outsider,tenant,file).workspaceName());
  assertFalse(governance.detail(outsider,tenant,file).canEdit());
  assertThrows(IdentityException.class,()->governance.change(outsider,tenant,file,change(1,1),true));
  assertThrows(IdentityException.class,()->governance.detail(admin,tenant,file));
  assertThrows(IdentityException.class,()->governance.detail(outsider,UUID.randomUUID(),file));
  grant(outsider,"NONE");assertEquals(0,list(outsider).summary().total());assertThrows(IdentityException.class,()->governance.detail(outsider,tenant,file));
  assertEquals(0,processing.list(reader,tenant,null,"","ALL",0,20).summary().total());
 }
 @Test void missingOrPartialTextIsNeverGivenFullQualityScoreAndCannotBeRedacted(){
  UUID binary=materials.upload(reader,tenant,space,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","fake.pdf","application/pdf","synthetic".getBytes())).id();
  var result=governance.change(reader,tenant,binary,change(1,0),false);assertEquals("NO_TEXT",result.source());assertNull(governance.detail(reader,tenant,binary).quality());
  assertThrows(IdentityException.class,()->governance.change(reader,tenant,binary,change(1,1),true));
  UUID version=db.queryForObject("SELECT id FROM material_versions WHERE material_id=?",UUID.class,binary),run=UUID.randomUUID();
  db.update("INSERT INTO knowledge_runs(id,tenant_id,workspace_id,material_id,version_id,generation,requested_by,status) VALUES (?,?,?,?,?,1,?,'PARTIAL')",run,tenant,space,binary,version,reader);
  db.update("INSERT INTO knowledge_chunks(id,tenant_id,workspace_id,material_id,version_id,run_id,ordinal,locator,method,content) VALUES (?,?,?,?,?,?,0,'合成','TEXT','13800138000')",UUID.randomUUID(),tenant,space,binary,version,run);
  assertEquals("NOT_CHECKED",governance.detail(reader,tenant,binary).source());
  assertEquals("PARTIAL_TEXT",governance.change(reader,tenant,binary,change(1,1),false).source());assertNull(governance.detail(reader,tenant,binary).quality());
 }
 @Test void reviewDateRemainsExplicitAndReadReflectsTimeExpiry(){
  var result=governance.change(reader,tenant,file,new MaterialGovernanceService.Change(UUID.randomUUID(),1,0,List.of(),LocalDate.now().minusDays(1)),false);
  assertTrue(result.issues().contains("review"));assertTrue(result.issues().contains("tags"));assertEquals(LocalDate.now().minusDays(1),result.reviewAt());
 }
}
