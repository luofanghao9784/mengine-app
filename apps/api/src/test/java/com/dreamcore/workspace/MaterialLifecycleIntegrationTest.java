package com.dreamcore.workspace;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.*;
import com.dreamcore.workspace.lifecycle.*;
import com.dreamcore.workspace.knowledge.*;
import com.dreamcore.workspace.source.SourceService;
import java.time.LocalDate;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(properties={"dreamcore.lifecycle.enabled=false","dreamcore.knowledge.enabled=true","dreamcore.knowledge.initial-delay-ms=3600000"})
class MaterialLifecycleIntegrationTest {
 @Autowired com.dreamcore.workspace.retention.RetentionService retention;@Autowired JdbcTemplate db;@Autowired MaterialService materials;@Autowired MaterialLifecycleService lifecycle;@Autowired MaterialCleanupService cleanup;@Autowired KnowledgeService knowledge;@Autowired SourceService sources;@Autowired ObjectStore store;
 UUID tenant,owner,reader,admin,space,personal;
 @BeforeEach void fixture(){
  tenant=UUID.randomUUID();owner=UUID.randomUUID();reader=UUID.randomUUID();admin=UUID.randomUUID();space=UUID.randomUUID();personal=UUID.randomUUID();
  db.update("INSERT INTO tenants(id,name) VALUES (?,'合成生命周期企业')",tenant);
  for(UUID id:List.of(owner,reader,admin)){db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,'not-used')",id,id+"@lifecycle.test","合成成员");db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,?)",tenant,id,id.equals(admin)?"TENANT_ADMIN":"MEMBER");}
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'共享','SHARED'),(?,?,?,'私人','PERSONAL')",space,tenant,admin,personal,tenant,owner);
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true),(?,?,?,false)",tenant,space,owner,tenant,space,reader);
 }
 @AfterEach void after(){db.update("UPDATE knowledge_runs SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);db.update("UPDATE content_lifecycle SET purge_after=now()+interval '30 days' WHERE tenant_id=? AND state='TRASHED'",tenant);}
 MaterialService.Entry upload(UUID w,UUID folder,String name){return materials.upload(owner,tenant,w,folder,null,null,UUID.randomUUID(),new MockMultipartFile("file",name,"text/plain","retained synthetic body".getBytes()));}
 UUID version(UUID w,UUID id){return materials.detail(owner,tenant,w,id,0,50).versions().getFirst().id();}
 MaterialLifecycleService.Receipt act(UUID w,String kind,UUID id,String action){int revision=lifecycle.preview(owner,tenant,w,kind,id).item().revision();return lifecycle.act(owner,tenant,w,kind,id,UUID.randomUUID(),revision,action);}
 void denied(Runnable f){assertThrows(IdentityException.class,f::run);}
 void purgeGrant(){db.update("INSERT INTO governance_capabilities(tenant_id,account_id,workspace_id,capability,granted_by) VALUES (?,?,?,'LIFECYCLE_PURGE',?)",tenant,owner,space,admin);}
 @Test void recycleBlocksEveryMaterialReadAndRestoreKeepsVersionAndStopsOldParser(){
  var file=upload(space,null,"sensitive.txt");UUID v=version(space,file.id());var job=knowledge.claim();assertEquals(v,job.version());
  var receipt=act(space,"MATERIAL",file.id(),"TRASH");assertEquals("TRASHED",receipt.resultingState());
  denied(()->materials.download(owner,tenant,space,file.id(),v));denied(()->materials.detail(reader,tenant,space,file.id(),0,50));
  assertTrue(materials.list(reader,tenant,space,null,"",0,50).items().isEmpty());assertEquals(0,knowledge.search(reader,tenant,space,"synthetic",0,10).coverage().totalVersions());
  assertNull(knowledge.input(job));
  denied(()->lifecycle.list(reader,tenant,space,0,50));denied(()->lifecycle.preview(admin,tenant,space,"MATERIAL",file.id()));
  var deadline=lifecycle.preview(owner,tenant,space,"MATERIAL",file.id()).item().purgeAfter();assertEquals(deadline,lifecycle.list(owner,tenant,space,0,50).items().getFirst().purgeAfter());
  act(space,"MATERIAL",file.id(),"RESTORE");assertArrayEquals("retained synthetic body".getBytes(),materials.download(owner,tenant,space,file.id(),v).bytes());assertEquals("CANCELLED",knowledge.analysis(owner,tenant,space,file.id(),v,0,20).status());assertNull(knowledge.claim());
 }
 @Test void folderRestoreDoesNotRestoreChildDeletedEarlierOrPermitHiddenFolderUpload(){
  UUID folder=materials.createFolder(owner,tenant,space,null,"父目录",UUID.randomUUID()).id();var one=upload(space,folder,"one.txt");var two=upload(space,folder,"two.txt");
  act(space,"MATERIAL",one.id(),"TRASH");act(space,"FOLDER",folder,"TRASH");
  denied(()->upload(space,folder,"late.txt"));denied(()->materials.list(owner,tenant,space,folder,"",0,50));denied(()->act(space,"MATERIAL",one.id(),"RESTORE"));
  act(space,"FOLDER",folder,"RESTORE");assertEquals(List.of(two.id()),materials.list(owner,tenant,space,folder,"",0,50).items().stream().map(MaterialService.Entry::id).toList());denied(()->materials.detail(owner,tenant,space,one.id(),0,50));
 }
 @Test void sharedPurgeNeedsExplicitCapabilityAndRecordsPhysicalFailureUntilRetry(){
  var file=upload(space,null,"source.txt");UUID v=version(space,file.id()),object=db.queryForObject("SELECT object_id FROM material_versions WHERE id=?",UUID.class,v);String hash=ObjectStore.sha256("retained synthetic body".getBytes());
  act(space,"MATERIAL",file.id(),"TRASH");denied(()->act(space,"MATERIAL",file.id(),"PURGE"));purgeGrant();var purging=act(space,"MATERIAL",file.id(),"PURGE");
  denied(()->act(space,"MATERIAL",file.id(),"RESTORE"));var job=cleanup.claim();assertEquals(purging.cleanupJobId(),job.id());cleanup.fail(job);
  assertEquals("FAILED",lifecycle.cleanup(owner,tenant,space,job.id()).state());assertArrayEquals("retained synthetic body".getBytes(),store.read(object,23,hash));
  act(space,"MATERIAL",file.id(),"RETRY_CLEANUP");job=cleanup.claim();for(UUID blob:cleanup.pending(job)){cleanup.remove(blob);cleanup.removed(job,blob);}cleanup.finish(job);
  assertEquals("COMPLETE",lifecycle.cleanup(owner,tenant,space,job.id()).state());assertEquals("NOT_COVERED_BY_ONLINE_CLEANUP",lifecycle.cleanup(owner,tenant,space,job.id()).backupState());denied(()->store.read(object,23,hash));assertEquals("PURGED",lifecycle.preview(owner,tenant,space,"MATERIAL",file.id()).item().state());
 }
 @Test void lostReceiptReplayDoesNotRetrashRestoredContentAndRevocationWins(){
  var file=upload(space,null,"receipt.txt");UUID key=UUID.randomUUID();var first=lifecycle.act(owner,tenant,space,"MATERIAL",file.id(),key,0,"TRASH");act(space,"MATERIAL",file.id(),"RESTORE");assertEquals(first,lifecycle.act(owner,tenant,space,"MATERIAL",file.id(),key,0,"TRASH"));assertEquals("ACTIVE",lifecycle.preview(owner,tenant,space,"MATERIAL",file.id()).item().state());
  db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,owner);denied(()->lifecycle.act(owner,tenant,space,"MATERIAL",file.id(),key,0,"TRASH"));
 }
 @Test void sourceCoverageLosesRemovedEvidenceWithoutLeakingNamesThenRestores(){
  var file=upload(space,null,"monthly.txt");UUID v=version(space,file.id());LocalDate date=LocalDate.of(2026,9,1);var s=sources.create(owner,tenant,space,UUID.randomUUID(),new SourceService.Settings("来源","",owner,24,date,date,"ACTIVE"));var sub=sources.submit(owner,tenant,space,s.id(),UUID.randomUUID(),date,date,"声明",List.of(v));assertEquals("DECLARED",sources.get(reader,tenant,space,s.id()).coverageState());
  act(space,"MATERIAL",file.id(),"TRASH");assertNotEquals("DECLARED",sources.get(reader,tenant,space,s.id()).coverageState());var history=sources.submission(reader,tenant,space,s.id(),sub.id());assertEquals(1,history.unavailableVersions());assertTrue(history.versions().isEmpty());
  denied(()->sources.submit(owner,tenant,space,s.id(),UUID.randomUUID(),date,date,"",List.of(v)));act(space,"MATERIAL",file.id(),"RESTORE");assertEquals("DECLARED",sources.get(reader,tenant,space,s.id()).coverageState());
 }
 @Test void expiredExplicitTrashEnqueuesButNeverEnrollsUnrelatedOldAssets(){
  var expired=upload(personal,null,"expire.txt");var retained=upload(personal,null,"keep.txt");act(personal,"MATERIAL",expired.id(),"TRASH");db.update("UPDATE content_lifecycle SET purge_after=now()-interval '1 second' WHERE object_id=?",expired.id());denied(()->act(personal,"MATERIAL",expired.id(),"RESTORE"));assertTrue(lifecycle.enqueueDue());assertEquals("PURGING",lifecycle.preview(owner,tenant,personal,"MATERIAL",expired.id()).item().state());assertEquals("ACTIVE",lifecycle.preview(owner,tenant,personal,"MATERIAL",retained.id()).item().state());
  var job=cleanup.claim();for(UUID id:cleanup.pending(job)){cleanup.remove(id);cleanup.removed(job,id);}cleanup.finish(job);assertFalse(lifecycle.enqueueDue());
 }

 @Test void failedDescendantDoesNotStarveAnotherTenantsExpiredContent(){
  UUID folder=materials.createFolder(owner,tenant,personal,null,"待清理父目录",UUID.randomUUID()).id();var child=upload(personal,folder,"child.txt");act(personal,"MATERIAL",child.id(),"TRASH");act(personal,"MATERIAL",child.id(),"PURGE");var failed=cleanup.claim();cleanup.fail(failed);act(personal,"FOLDER",folder,"TRASH");db.update("UPDATE content_lifecycle SET purge_after=now()-interval '2 days' WHERE object_id=?",folder);
  UUID other=UUID.randomUUID(),otherSpace=UUID.randomUUID();db.update("INSERT INTO tenants(id,name) VALUES (?,'另一合成企业')",other);db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",other,owner);db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'个人','PERSONAL')",otherSpace,other,owner);
  var file=materials.upload(owner,other,otherSpace,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","unblocked.txt","text/plain","other tenant".getBytes()));lifecycle.act(owner,other,otherSpace,"MATERIAL",file.id(),UUID.randomUUID(),0,"TRASH");db.update("UPDATE content_lifecycle SET purge_after=now()-interval '1 day' WHERE object_id=?",file.id());
  assertTrue(lifecycle.enqueueDue());assertEquals("PURGING",lifecycle.preview(owner,other,otherSpace,"MATERIAL",file.id()).item().state());assertEquals("TRASHED",lifecycle.preview(owner,tenant,personal,"FOLDER",folder).item().state());
  var job=cleanup.claim();assertEquals(other,job.tenant());for(UUID object:cleanup.pending(job)){cleanup.remove(object);cleanup.removed(job,object);}cleanup.finish(job);
 }
 @Test void newTrashUsesPolicyVersionAndLaterChangesDoNotRepriceOriginalReceipt(){
  var one=upload(personal,null,"fixed-window.txt");retention.configure(admin,tenant,"TRASH",UUID.randomUUID(),0,5,"合成五天回收政策");
  UUID key=UUID.randomUUID();var first=lifecycle.act(owner,tenant,personal,"MATERIAL",one.id(),key,0,"TRASH");
  assertEquals(java.time.Duration.ofDays(5),java.time.Duration.between(first.occurredAt(),first.purgeAfter()));
  assertEquals(1,db.queryForObject("SELECT retention_policy_revision FROM content_lifecycle WHERE object_id=?",Integer.class,one.id()));
  retention.configure(admin,tenant,"TRASH",UUID.randomUUID(),1,3,"仅新删除改为三天");
  assertEquals(first,lifecycle.act(owner,tenant,personal,"MATERIAL",one.id(),key,0,"TRASH"));
  assertEquals(first.purgeAfter(),lifecycle.preview(owner,tenant,personal,"MATERIAL",one.id()).item().purgeAfter());
  var two=upload(personal,null,"new-window.txt");var next=act(personal,"MATERIAL",two.id(),"TRASH");
  assertEquals(java.time.Duration.ofDays(3),java.time.Duration.between(next.occurredAt(),next.purgeAfter()));
  assertEquals(2,db.queryForObject("SELECT retention_policy_revision FROM content_lifecycle WHERE object_id=?",Integer.class,two.id()));
 }

 @Test void recycleViewsSearchBeforePagingAndNeverLeakAnotherWorkspace(){
  UUID parent=materials.createFolder(owner,tenant,space,null,"原目录",UUID.randomUUID()).id();
  var one=upload(space,parent,"月报100%.txt");var two=upload(space,parent,"月报其他.txt");var active=upload(space,null,"月报未删除.txt");
  act(space,"MATERIAL",one.id(),"TRASH");act(space,"MATERIAL",two.id(),"TRASH");
  var privateFile=upload(personal,null,"月报私人.txt");act(personal,"MATERIAL",privateFile.id(),"TRASH");
  var literal=lifecycle.list(owner,tenant,space,0,1,"TRASH","100%");
  assertEquals(List.of(one.id()),literal.items().stream().map(MaterialLifecycleService.Item::id).toList());assertFalse(literal.hasMore());
  assertEquals(List.of("共享","原目录"),literal.items().getFirst().path());assertTrue(literal.items().getFirst().parentAvailable());
  var first=lifecycle.list(owner,tenant,space,0,1,"TRASH","月报");var second=lifecycle.list(owner,tenant,space,1,1,"TRASH","月报");
  assertTrue(first.hasMore());assertFalse(second.hasMore());assertNotEquals(first.items().getFirst().id(),second.items().getFirst().id());
  assertFalse(lifecycle.list(owner,tenant,space,0,50,"TRASH","").items().stream().anyMatch(i->i.id().equals(active.id())||i.id().equals(privateFile.id())));
  purgeGrant();act(space,"MATERIAL",one.id(),"PURGE");
  assertEquals(List.of(two.id()),lifecycle.list(owner,tenant,space,0,50,"TRASH","").items().stream().map(MaterialLifecycleService.Item::id).toList());
  assertEquals(List.of(one.id()),lifecycle.list(owner,tenant,space,0,50,"RECORDS","").items().stream().map(MaterialLifecycleService.Item::id).toList());
  denied(()->lifecycle.list(reader,tenant,space,0,50,"TRASH","") );
  denied(()->lifecycle.list(admin,tenant,personal,0,50,"RECORDS","") );
  denied(()->lifecycle.list(owner,tenant,space,0,50,"invented","") );
  denied(()->lifecycle.list(owner,tenant,space,0,50,"TRASH","x".repeat(181)) );
  var job=cleanup.claim();for(UUID blob:cleanup.pending(job)){cleanup.remove(blob);cleanup.removed(job,blob);}cleanup.finish(job);
  assertEquals("PURGED",lifecycle.list(owner,tenant,space,0,50,"RECORDS","").items().getFirst().state());
 }
 @Test void parentUnavailableIsExplicitAndExpiredTrashIsNotOfferedForRestore(){
  UUID parent=materials.createFolder(owner,tenant,personal,null,"父目录",UUID.randomUUID()).id();var child=upload(personal,parent,"子资料.txt");
  act(personal,"MATERIAL",child.id(),"TRASH");act(personal,"FOLDER",parent,"TRASH");
  var before=lifecycle.preview(owner,tenant,personal,"MATERIAL",child.id()).item();assertFalse(before.parentAvailable());assertEquals(List.of("私人","父目录"),before.path());
  var error=assertThrows(IdentityException.class,()->act(personal,"MATERIAL",child.id(),"RESTORE"));assertEquals("LIFECYCLE_PARENT_UNAVAILABLE",error.code);
  act(personal,"FOLDER",parent,"RESTORE");assertTrue(lifecycle.preview(owner,tenant,personal,"MATERIAL",child.id()).item().parentAvailable());
  db.update("UPDATE content_lifecycle SET purge_after=now()-interval '1 second' WHERE object_id=?",child.id());
  assertTrue(lifecycle.list(owner,tenant,personal,0,20,"TRASH","").items().isEmpty());
  assertEquals(child.id(),lifecycle.list(owner,tenant,personal,0,20,"RECORDS","").items().getFirst().id());
  denied(()->act(personal,"MATERIAL",child.id(),"RESTORE"));
 }

}
