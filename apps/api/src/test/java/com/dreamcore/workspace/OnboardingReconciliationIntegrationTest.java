package com.dreamcore.workspace;
import com.dreamcore.workspace.scene.*;
import com.dreamcore.workspace.collection.CollectionService;
import com.dreamcore.workspace.identity.IdentityException;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
class OnboardingReconciliationIntegrationTest extends TaskDatasetFixture {
 @Autowired CollectionService collection;@Autowired TransactionTemplate tx;
 @Autowired com.dreamcore.workspace.context.TaskContextGuard guard;
 Path config;OnboardingReconciliationService service;Map<String,Object> registry;
 @BeforeEach void install() throws Exception{
  var fixture=new OnboardingReconciliationTest().fixture();var sources=new LinkedHashMap<String,Object>();int i=0;
  for(var entry:fixture.entrySet()){
   i++;dataset=UUID.randomUUID();var columns=new ArrayList<>(entry.getValue().getFirst().keySet());
   db.update("INSERT INTO business_datasets(id,tenant_id,connection_id,workspace_id,dataset_key,name,column_names) VALUES (?,?,?,?,?,?,?::jsonb)",dataset,tenant,connection,space,entry.getKey(),entry.getKey(),json.writeValueAsString(columns));
   var rows=entry.getValue().stream().map(r->columns.stream().map(r::get).toList()).toList();UUID snap=version(i+1,rows);sources.put(entry.getKey(),Map.of("datasetId",dataset,"snapshotId",snap));
  }
  config=Files.createTempFile("recipe-test-",".json");registry=new LinkedHashMap<>(Map.of("tenantId",tenant.toString(),"ruleVersion",OnboardingReconciliation.VERSION,"backgroundVersionIds",List.of(),"stores",Map.of("s",sources)));Files.writeString(config,json.writeValueAsString(registry));service=new OnboardingReconciliationService(db,collection,config.toString());org.springframework.test.util.ReflectionTestUtils.setField(contexts,"reconciliation",service);
 }
 Object run(){return tx.execute(s->service.execute(owner,tenant,new OnboardingReconciliationService.Request("s","2026-10-01","2026-10-01")));}
 com.dreamcore.workspace.context.TaskContextService.Request taskRequest(){return new com.dreamcore.workspace.context.TaskContextService.Request("reconciliation_execute",null,null,null,null,null,null,null,null,null,null,null,null,"s","2026-10-01","2026-10-01");}
 @Test void taskReceiptPinsAllInputsAndRetriesWithoutDuplicate(){var t=task(null,"AUTHORIZED_LIBRARY");var first=call(t,taskRequest());var second=call(t,taskRequest());assertEquals(first.get("receiptId"),second.get("receiptId"));assertEquals(t.id().toString(),first.get("taskId").asText());assertEquals(3,db.queryForObject("SELECT count(*) FROM task_dataset_reads WHERE task_id=?",Integer.class,t.id()));assertEquals(1,db.queryForObject("SELECT count(*) FROM task_reconciliation_receipts WHERE task_id=?",Integer.class,t.id()));assertFalse(first.get("knowledgeRead").asBoolean());finish(t);}
 @Test void selectedScopeCannotCalculate(){var t=task(null,"SELECTED");denied(()->call(t,taskRequest()));assertEquals(0,db.queryForObject("SELECT count(*) FROM task_reconciliation_receipts WHERE task_id=?",Integer.class,t.id()));}
 @Test void currentWorkspaceCannotReadOtherWorkspaceInputs(){var t=task(null,"WORKSPACE");denied(()->call(t,taskRequest()));}
 @Test void receiptCannotFinishAfterInputChange(){var t=task(null,"AUTHORIZED_LIBRARY");call(t,taskRequest());version(50,"changed");denied(()->finish(t));}
 @Test void receiptCannotFinishAfterRevocation(){var t=task(null,"AUTHORIZED_LIBRARY");call(t,taskRequest());db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);denied(()->finish(t));}
 @Autowired com.dreamcore.workspace.profile.ProfileService profiles;
 @Autowired com.dreamcore.workspace.profile.CompanyInformationService info;
 @Test void backgroundBodyIsActuallyReadAndRevisionInvalidatesTask() throws Exception {
  db.update("UPDATE tenant_memberships SET role='TENANT_ADMIN' WHERE tenant_id=? AND account_id=?",tenant,owner);
  var tag=info.change(owner,tenant,new com.dreamcore.workspace.profile.CompanyInformationService.Change(UUID.randomUUID(),com.dreamcore.workspace.profile.CompanyInformationService.Field.TERM,0,"ADD",null,"财务核查不等于银行到账",""));
  var p=profiles.get(owner,tenant,tag.tagId(),null);
  registry.put("backgroundVersionIds",List.of(p.versionId()));Files.writeString(config,json.writeValueAsString(registry));
  var t=task(null,"AUTHORIZED_LIBRARY");var result=call(t,taskRequest());assertTrue(result.get("background").toString().contains("财务核查"));assertEquals(1,db.queryForObject("SELECT count(*) FROM task_context_reads WHERE task_id=? AND kind='PROFILE'",Integer.class,t.id()));
  info.change(owner,tenant,new com.dreamcore.workspace.profile.CompanyInformationService.Change(UUID.randomUUID(),com.dreamcore.workspace.profile.CompanyInformationService.Field.TERM,1,"EDIT",p.id(),"变更口径",""));denied(()->finish(t));
 }
 @AfterEach void cleanup() throws Exception{Files.deleteIfExists(config);}
 @Test void fixedInputRepeatIsIdempotent(){assertEquals(run(),run());}
 @Test void changedSnapshotFailsWholeRequest(){version(20,"new");assertThrows(IdentityException.class,this::run);}
 @Test void noMembershipNoResult(){db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);assertThrows(IdentityException.class,this::run);}
 @Test void otherTenantCannotUseRegistry(){assertThrows(IdentityException.class,()->service.execute(owner,UUID.randomUUID(),new OnboardingReconciliationService.Request("s","2026-10-01","2026-10-01")));}
 @Test void oneMissingInputRejectsAll(){db.update("UPDATE business_datasets SET status='WITHDRAWN' WHERE id=?",dataset);assertThrows(IdentityException.class,this::run);}
 @Autowired com.dreamcore.workspace.conversation.FirstBriefingDeployment firstBriefing;
 @Autowired com.dreamcore.workspace.material.MaterialService materials;
 @Autowired com.dreamcore.workspace.briefing.BriefingService feed;
 void businessContext() throws Exception {
  db.update("UPDATE tenant_memberships SET role='TENANT_ADMIN' WHERE tenant_id=? AND account_id=?",tenant,owner);
  var tag=info.change(owner,tenant,new com.dreamcore.workspace.profile.CompanyInformationService.Change(UUID.randomUUID(),com.dreamcore.workspace.profile.CompanyInformationService.Field.TERM,0,"ADD",null,"财务核查不等于银行到账",""));
  registry.put("backgroundVersionIds",List.of(profiles.get(owner,tenant,tag.tagId(),null).versionId()));Files.writeString(config,json.writeValueAsString(registry));
  var m=materials.upload(owner,tenant,space,null,null,null,UUID.randomUUID(),new org.springframework.mock.web.MockMultipartFile("file","收款退款规则.txt","text/plain","收款退款需要财务核查。".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
  UUID v=materials.detail(owner,tenant,space,m.id(),0,10).versions().getFirst().id();UUID run=UUID.randomUUID();
  db.update("INSERT INTO knowledge_runs(id,tenant_id,workspace_id,material_id,version_id,generation,requested_by,status) VALUES (?,?,?,?,?,1,?,'READY')",run,tenant,space,m.id(),v,owner);
  db.update("UPDATE knowledge_runs SET status='READY',finished_at=now() WHERE id=?",run);
  db.update("INSERT INTO knowledge_chunks(id,tenant_id,workspace_id,material_id,version_id,run_id,ordinal,locator,method,content) VALUES (?,?,?,?,?,?,0,'第一段','TEXT','收款需要财务核查，门店协助补齐凭证。')",UUID.randomUUID(),tenant,space,m.id(),v,run);
 }
 com.dreamcore.workspace.conversation.FirstBriefingDeployment.Input prepareInput(){return new com.dreamcore.workspace.conversation.FirstBriefingDeployment.Input("prepare",tenant,owner,space,"s","2026-10-01","2026-10-01",null,null,null);}
 com.dreamcore.workspace.conversation.FirstBriefingDeployment.Input deliverInput(tools.jackson.databind.JsonNode prepared){
 firstBriefing.execute(new com.dreamcore.workspace.conversation.FirstBriefingDeployment.Input("select",tenant,owner,space,null,null,null,UUID.fromString(prepared.path("taskId").asText()),null,null,null,null,new com.dreamcore.workspace.conversation.AgentTaskService.TopicSelection(List.of(new com.dreamcore.workspace.conversation.AgentTaskService.TopicCandidate("处理核对待办","任务实际依据",false,"具体待办","SUGGESTION","推进核对","BRIEFING","确定接续事项")),0)));
 return new com.dreamcore.workspace.conversation.FirstBriefingDeployment.Input("deliver",tenant,owner,space,null,null,null,UUID.fromString(prepared.path("taskId").asText()),prepared.at("/evidence/result/receiptId").asText(),new com.dreamcore.workspace.conversation.BriefingContentService.Request(null,"门店收退款待核查事项","请财务核对未完成事项，门店协助补齐凭证；当前结果不等于银行到账。",List.of("已按企业背景中的核查口径读取授权收款和退款资料。","建议财务结合原业务记录核查，不能据此计算净收入或利润。"),"SUGGESTION"));}
 @Test void firstBriefingReadsThenDeliversThroughSharedTools() throws Exception {
  businessContext();var prepared=json.valueToTree(firstBriefing.execute(prepareInput()));assertTrue(prepared.at("/evidence/result/knowledgeRead").asBoolean());assertEquals(1,prepared.at("/evidence/result/background").size());
  assertEquals(0,db.queryForObject("SELECT count(*) FROM identity_audit WHERE tenant_id=? AND action='TASK_BRIEFING_CREATED'",Integer.class,tenant));
  assertEquals("1.1.0",prepared.at("/generationContract/version").asText());
  assertEquals(prepared.path("generationContract"),prepared.at("/evidence/result/generationContract"));
  var original=deliverInput(prepared);var content=original.content();
  var wrong=new com.dreamcore.workspace.conversation.FirstBriefingDeployment.Input("deliver",tenant,owner,space,null,null,null,original.taskId(),original.receiptId(),new com.dreamcore.workspace.conversation.BriefingContentService.Request(null,content.title(),content.summary(),content.analysis(),"RESULT"));
  assertThrows(IdentityException.class,()->firstBriefing.execute(wrong));
  firstBriefing.execute(original);assertEquals(1,feed.list(owner,tenant,null,"LATEST",null,"Asia/Shanghai",0,20,true).items().size());
 }
 @Test void firstBriefingCannotDeliverAfterSourceRevocation() throws Exception {
  businessContext();var prepared=json.valueToTree(firstBriefing.execute(prepareInput()));db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);
  assertThrows(IdentityException.class,()->firstBriefing.execute(deliverInput(prepared)));
  assertEquals(0,db.queryForObject("SELECT count(*) FROM identity_audit WHERE tenant_id=? AND action='TASK_BRIEFING_CREATED'",Integer.class,tenant));
 }
 @Test void firstBriefingRequiresBusinessContext(){var prepared=json.valueToTree(firstBriefing.execute(prepareInput()));assertThrows(IdentityException.class,()->firstBriefing.execute(deliverInput(prepared)));}

 @Test void knowledgeCandidateCannotBeDeliveredAsBriefing() throws Exception {
  businessContext();var prepared=json.valueToTree(firstBriefing.execute(prepareInput()));
  UUID id=UUID.fromString(prepared.path("taskId").asText());
  firstBriefing.execute(new com.dreamcore.workspace.conversation.FirstBriefingDeployment.Input("select",tenant,owner,space,null,null,null,id,null,null,null,null,new com.dreamcore.workspace.conversation.AgentTaskService.TopicSelection(List.of(new com.dreamcore.workspace.conversation.AgentTaskService.TopicCandidate("整理稳定业务规则","已读取知识",false,"复用方法","SUGGESTION","推进核对","KNOWLEDGE_DRAFT","形成业务应用知识")),0)));
  var content=new com.dreamcore.workspace.conversation.BriefingContentService.Request(null,"规则解释不应进入画报","这是稳定业务规则，需要作为知识候选而不是画报。",List.of("已读取的规则解释只能支持业务方法整理。","没有新增的具体业务发现不应向读者推送画报。"),"SUGGESTION");
  var ex=assertThrows(IdentityException.class,()->firstBriefing.execute(new com.dreamcore.workspace.conversation.FirstBriefingDeployment.Input("deliver",tenant,owner,space,null,null,null,id,prepared.at("/evidence/result/receiptId").asText(),content)));
  assertEquals("BRIEFING_DESTINATION_MISMATCH",ex.code);
 }

 @Autowired com.dreamcore.workspace.conversation.BriefingContentService briefingContent;
 com.dreamcore.workspace.conversation.BriefingContentService.Document briefingContentFor(UUID id){return briefingContent.find(id,1);}
 @Test void externalCalculationRejectsUnpinnedDataset() throws Exception {
  businessContext();var p=json.valueToTree(firstBriefing.execute(new com.dreamcore.workspace.conversation.FirstBriefingDeployment.Input("prepare",tenant,owner,space,"s","2026-10-01","2026-10-01",null,null,null,"DATA","核对收款",null)));
  UUID id=UUID.fromString(p.path("taskId").asText());
  var calc=new com.dreamcore.workspace.conversation.DatasetCalculationService.Request(UUID.randomUUID(),UUID.randomUUID(),null,null,null,null,null,null,"Asia/Shanghai","COUNT","SUMMARY",List.of("status"),null,null,null,null);
  assertThrows(IdentityException.class,()->firstBriefing.execute(new com.dreamcore.workspace.conversation.FirstBriefingDeployment.Input("calculate",tenant,owner,space,null,null,null,id,null,null,null,null,null,calc)));
  assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_artifacts WHERE task_id=?",Integer.class,id));
 }
 @Test void externalDataCardUsesPinnedCalculationAndSharedDelivery() throws Exception {
  businessContext();
  var prepared=json.valueToTree(firstBriefing.execute(new com.dreamcore.workspace.conversation.FirstBriefingDeployment.Input("prepare",tenant,owner,space,"s","2026-10-01","2026-10-01",null,null,null,"DATA","检查财务收款状态",null)));
  UUID task=UUID.fromString(prepared.path("taskId").asText());
  firstBriefing.execute(new com.dreamcore.workspace.conversation.FirstBriefingDeployment.Input("select",tenant,owner,space,null,null,null,task,null,null,null,null,new com.dreamcore.workspace.conversation.AgentTaskService.TopicSelection(List.of(new com.dreamcore.workspace.conversation.AgentTaskService.TopicCandidate("核对收款状态","已读收款数据",true,"按状态安排核查","DATA","推进财务核对","BRIEFING","确定复核范围")),0)));
  var source=db.queryForMap("SELECT d.id,r.snapshot_id FROM task_dataset_reads r JOIN business_datasets d ON d.id=r.dataset_id WHERE r.task_id=? AND d.dataset_key='payment_orders'",task);
  var calc=new com.dreamcore.workspace.conversation.DatasetCalculationService.Request((UUID)source.get("id"),(UUID)source.get("snapshot_id"),null,null,null,null,null,null,"Asia/Shanghai","COUNT","SUMMARY",List.of("status"),null,null,null,null);
  firstBriefing.execute(new com.dreamcore.workspace.conversation.FirstBriefingDeployment.Input("read",tenant,owner,space,null,null,null,task,null,null,null,null,null,calc));
  var result=json.valueToTree(firstBriefing.execute(new com.dreamcore.workspace.conversation.FirstBriefingDeployment.Input("calculate",tenant,owner,space,null,null,null,task,null,null,null,null,null,calc)));
  assertEquals("1",result.at("/calculation/total").asText());
  UUID artifact=UUID.fromString(result.at("/artifact/id").asText());
  var content=new com.dreamcore.workspace.conversation.BriefingContentService.Request(artifact,"本批1笔收款已获财务确认","本批收款登记中有1笔财务已确认。",List.of("按收款状态统计现有记录，可用于安排复核工作。","财务确认不等于银行到账，不代表当前的处理进展。"),"DATA");
  firstBriefing.execute(new com.dreamcore.workspace.conversation.FirstBriefingDeployment.Input("deliver",tenant,owner,space,null,null,null,task,prepared.at("/evidence/result/receiptId").asText(),content));
  assertEquals(1,feed.list(owner,tenant,null,"LATEST",null,"Asia/Shanghai",0,20,true).items().size());
  var doc=briefingContentFor(task);
  assertEquals("财务已确认",doc.chartLabels().groups().get("finance_confirmed"));
  assertEquals(4,db.queryForObject("SELECT count(*) FROM conversation_tool_receipts WHERE task_id=? AND status='succeeded'",Integer.class,task));
 }
}
