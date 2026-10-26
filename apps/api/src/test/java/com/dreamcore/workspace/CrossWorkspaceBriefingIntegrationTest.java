package com.dreamcore.workspace;

import com.dreamcore.workspace.briefing.BriefingGenerationService;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.material.MaterialService;
import com.dreamcore.workspace.knowledge.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockMultipartFile;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.tasks.enabled=true","dreamcore.tasks.agent-mode=verification","dreamcore.tasks.initial-delay-ms=3600000","dreamcore.collection.enabled=false","dreamcore.knowledge.enabled=true","dreamcore.knowledge.initial-delay-ms=3600000","dreamcore.briefing.merge-seconds=0"})
class CrossWorkspaceBriefingIntegrationTest extends TaskDatasetFixture {
 @org.springframework.test.context.DynamicPropertySource
 static void isolateQueue(org.springframework.test.context.DynamicPropertyRegistry registry){IsolatedTestDatabase.register(registry);}
 @BeforeEach void configureWork(){db.update("INSERT INTO work_role_profiles(tenant_id,account_id,responsibilities,revision,changed_by) VALUES (?,?,'核对获权业务资料与服务规范',1,?)",tenant,owner,owner);}
 @Autowired BriefingGenerationService generation;
 @Autowired MaterialService materials;
 @Autowired KnowledgeService knowledge;
 @AfterEach void cleanupParsing(){db.update("UPDATE knowledge_runs SET status='CANCELLED' WHERE tenant_id=? AND status IN ('RUNNING','QUEUED')",tenant);}
 MaterialService.UploadReceipt upload(UUID at,String text){
  var receipt=materials.uploadReceipt(owner,tenant,at,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","scope.txt","text/plain",text.getBytes(StandardCharsets.UTF_8)));
  var job=knowledge.claim();assertNotNull(job);assertEquals(receipt.acceptedVersion().id(),job.version());
  knowledge.finish(job,new DocumentParser.Result("synthetic","READY",List.of(),List.of(new DocumentParser.Fragment("L1",text,"TEXT"))));return receipt;
 }
 ConversationService.Job generate(){
  var batch=generation.generate(owner,tenant,UUID.randomUUID(),privateSpace,"INSIGHT");
  UUID policy=db.queryForObject("SELECT policy_id FROM briefing_generation_batches WHERE id=?",UUID.class,batch.id());
  generation.tick(policy);var job=conversations.claim();assertNotNull(job);assertEquals(generation.get(owner,tenant,batch.id()).taskId(),job.id());return job;
 }
 @Test void publicAndDepartmentSourcesCombineWithoutChangingOutputOrGrantingOtherSpaces(){
  var department=upload(privateSpace,"marker 业务背景");var common=upload(space,"marker 公共服务规范");
  UUID closed=UUID.randomUUID();db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'未授权空间','SHARED')",closed,tenant,owner);
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",tenant,closed,owner);
  var hidden=upload(closed,"marker 不可访问的资料");
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",closed,owner);
  var job=generate();assertEquals(privateSpace,job.space());
  var found=agents.search(job.id(),job.token(),"marker");assertEquals(2,found.size());assertFalse(found.stream().anyMatch(f->f.content().contains("不可访问")));
  assertTrue(found.stream().anyMatch(f->f.content().contains("公共服务规范")));
  assertTrue(found.stream().anyMatch(f->f.content().contains("业务背景")));
  assertEquals(Set.of(department.acceptedVersion().id(),common.acceptedVersion().id()),new HashSet<>(db.queryForList("SELECT version_id FROM conversation_originals WHERE task_id=?",UUID.class,job.id())));
  db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,owner);
  denied(()->agents.search(job.id(),job.token(),"marker"));assertFalse(agents.active(job));
 }
 @Test void crossSpaceSelectedDatasetIsPinnedAndRevocationFencesItsTask(){
  var job=generate();assertEquals(privateSpace,job.space());
  assertEquals(snapshot,db.queryForObject("SELECT snapshot_id FROM briefing_dataset_selections WHERE task_id=?",UUID.class,job.id()));
  version(2,"新版本");
  var read=call(job,request("dataset_read",dataset,snapshot,0));assertEquals(1,read.get("source").get("version").asInt());
  denied(()->call(job,request("dataset_read",dataset,UUID.randomUUID(),0)));
  db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,owner);
  assertFalse(agents.active(job));denied(()->call(job,request("dataset_read",dataset,snapshot,0)));
 }
 @Test void unparsedDocumentsInAnotherReadableSpaceDoNotBlockReadyEvidence(){
  var pending=materials.uploadReceipt(owner,tenant,space,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","pending.txt","text/plain","pending".getBytes(StandardCharsets.UTF_8)));
  var job=generate();assertNotNull(job);
  assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_originals WHERE task_id=? AND version_id=?",Integer.class,job.id(),pending.acceptedVersion().id()));
  assertEquals(1,call(job,request("dataset_search",null,null,0)).get("items").size());
 }
 @Test void unrelatedSelectedTaskCannotUseTheCrossSpaceBriefingGrant(){
  var selected=task(null,"SELECTED");assertEquals("SELECTED_ONLY",call(selected,request("dataset_search",null,null,0)).get("reason").asString());
  db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE id=?",selected.id());
  db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,owner);
  var batch=generation.generate(owner,tenant,UUID.randomUUID(),privateSpace,"INSIGHT");
  UUID policy=db.queryForObject("SELECT policy_id FROM briefing_generation_batches WHERE id=?",UUID.class,batch.id());generation.tick(policy);
  assertNull(generation.get(owner,tenant,batch.id()).taskId());
 }
}
