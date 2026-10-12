package com.dreamcore.workspace;

import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.knowledge.KnowledgeWorkbenchService;
import com.dreamcore.workspace.material.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(properties={"dreamcore.knowledge.enabled=false","dreamcore.lifecycle.enabled=false"})
class KnowledgeWorkbenchIntegrationTest {
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
  file=upload("预算说明.txt");
 }
 UUID upload(String name){return materials.upload(reader,tenant,space,null,null,null,UUID.randomUUID(),new MockMultipartFile("file",name,"text/plain",("synthetic "+name).getBytes())).id();}
 KnowledgeWorkbenchService.Snapshot read(UUID actor){return workbench.read(actor,tenant,"ALL",null,"",0);}
 void grant(UUID target,String content){permissions.save(admin,tenant,"MATERIAL",file,new LibraryPermissionService.Change(UUID.randomUUID(),permissions.policy(admin,tenant,"MATERIAL",file).revision(),false,List.of(new LibraryPermissionService.Grant("ACCOUNT",target,content,"DENY",false,null))));}
 @Test void adminHasNoImplicitContentAndReaderCountsWholeAuthorizedSet(){
  assertEquals(0,read(admin).summary().total());assertTrue(read(admin).spaces().isEmpty());
  assertEquals(1,read(reader).summary().total());assertEquals(1,read(reader).summary().notStarted());assertEquals(file,read(reader).items().getFirst().id());
 }
 @Test void directFileGrantHidesParentAndRevocationRemovesAllProjections(){
  grant(outsider,"READ");var result=read(outsider);
  assertEquals(1,result.summary().total());assertNull(result.spaces().getFirst().id());assertEquals("共享资料",result.spaces().getFirst().name());assertEquals("共享资料",result.items().getFirst().workspaceName());
  assertEquals(0,workbench.read(outsider,tenant,"ALL",space,"",0).filteredTotal());
  assertEquals(0,read(reader).summary().total());
  grant(outsider,"NONE");assertEquals(0,read(outsider).summary().total());assertTrue(read(outsider).items().isEmpty());assertTrue(read(outsider).spaces().isEmpty());
 }
 @Test void paginationAndSearchDoNotTruncateHeadlineCounts(){
  for(int i=0;i<22;i++)upload("资料-"+i+".txt");
  var first=read(reader);assertEquals(23,first.summary().total());assertEquals(20,first.items().size());assertTrue(first.hasMore());
  var second=workbench.read(reader,tenant,"ALL",null,"",20);assertEquals(3,second.items().size());assertFalse(second.hasMore());
  assertTrue(Collections.disjoint(first.items().stream().map(x->x.id()).toList(),second.items().stream().map(x->x.id()).toList()));
  var found=workbench.read(reader,tenant,"NOT_STARTED",space,"预算",0);assertEquals(23,found.summary().total());assertEquals(1,found.filteredTotal());assertEquals(file,found.items().getFirst().id());
  assertEquals(0,workbench.read(reader,tenant,"READY",null,"",0).filteredTotal());
 }
 @Test void privateArchivedAndOtherTenantMaterialsDoNotEnterProjection(){
  UUID personal=UUID.randomUUID();db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'私人','PERSONAL')",personal,tenant,reader);
  materials.upload(reader,tenant,personal,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","private.txt","text/plain","private".getBytes()));
  assertEquals(1,read(reader).summary().total());
  assertThrows(IdentityException.class,()->workbench.read(reader,UUID.randomUUID(),"ALL",null,"",0));
  db.update("UPDATE workspaces SET archived=true WHERE id=?",space);assertEquals(0,read(reader).summary().total());
 }
 @Test void disabledMembershipAndInvalidFiltersAreRejected(){
  assertThrows(IdentityException.class,()->workbench.read(reader,tenant,"FAKE",null,"",0));
  assertThrows(IdentityException.class,()->workbench.read(reader,tenant,"ALL",null,"",-1));
  db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,reader);
  assertThrows(IdentityException.class,()->read(reader));
 }
 @Test void latestParseRunDeterminesStatusAndDoesNotCountHistory(){
  UUID version=db.queryForObject("SELECT id FROM material_versions WHERE material_id=?",UUID.class,file);
  for(int generation=1;generation<=2;generation++)db.update("INSERT INTO knowledge_runs(id,tenant_id,workspace_id,material_id,version_id,generation,requested_by,status) VALUES (?,?,?,?,?,?,?,?)",UUID.randomUUID(),tenant,space,file,version,generation,reader,generation==1?"FAILED":"READY");
  assertEquals(1,read(reader).summary().ready());assertEquals(0,read(reader).summary().attention());
  assertEquals(1,workbench.read(reader,tenant,"READY",null,"",0).filteredTotal());
 }
 @Test void tenantsWithoutAclRolloutKeepOriginalReadBoundary(){
  db.update("UPDATE library_permission_rollouts SET enabled=false WHERE tenant_id=?",tenant);
  assertEquals(1,read(reader).summary().total());assertEquals(0,read(admin).summary().total());assertEquals(0,read(outsider).summary().total());
 }

}
