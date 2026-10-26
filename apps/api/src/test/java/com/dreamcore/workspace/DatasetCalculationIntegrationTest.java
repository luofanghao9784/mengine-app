package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.*;

class DatasetCalculationIntegrationTest extends DatasetCalculationFixture {
 @org.springframework.beans.factory.annotation.Autowired com.dreamcore.workspace.material.MaterialAccess materialAccess;
 @org.springframework.beans.factory.annotation.Autowired com.dreamcore.workspace.identity.IdentityAudit identityAudit;
 DatasetCalculationService.Request parameters(){return new DatasetCalculationService.Request(dataset,snapshot,"门店","期间","收款（元）","前期","本期");}
 ConversationService.Job start(){var j=task(null,"AUTHORIZED_LIBRARY");agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("task_context","compare_dataset","deliver_briefing")));receipt(j,1,"task_context","STARTED");call(j,request("dataset_search",null,null,0));receipt(j,1,"task_context","succeeded");receipt(j,2,"compare_dataset","STARTED");return j;}
 void receipt(ConversationService.Job j,int n,String name,String state){agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(n,name,state));}
 BriefingContentService.Request card(UUID calc){return new BriefingContentService.Request(calc,"门店两期收款比较","两家门店同口径收款合计增长一倍，需结合业务背景解读。",List.of("图表使用固定数据快照的完整记录计算，两家门店两期数据均可比较。","这里呈现已发生的收款变化，经营原因仍需结合其他信息核实。"));}
 @Test void sceneNonAdditivePolicyRejectsCalculationBeforeSavingArtifacts(){
  db.update("INSERT INTO scene_bindings(tenant_id,workspace_id,connection_id,maintainer_id) VALUES (?,?,?,?)",tenant,space,connection,owner);
  db.update("INSERT INTO scene_asset_revisions(tenant_id,target_id,kind,revision,metadata) VALUES (?,?,'TABLE','policy-test',?::jsonb)",tenant,dataset,"{\"analysisPolicy\":{\"noSumFields\":[\"收款（元）\"],\"excludeFields\":[]}}");
  db.update("UPDATE scene_bindings SET governance_valid_until=now()+interval '5 minutes' WHERE tenant_id=?",tenant);
  db.update("INSERT INTO scene_asset_links(tenant_id,source_id,kind,target_id,revision,metadata) VALUES(?,'synthetic','TABLE',?,'policy-test',?::jsonb)",tenant,dataset,json.writeValueAsString(Map.of("governance",Map.of("allowedActors",List.of(owner.toString())))));
  var j=start();var error=assertThrows(IdentityException.class,()->agents.compareDataset(j.id(),j.token(),parameters()));
  assertEquals("METRIC_DEFINITION_REQUIRED",error.code);
  var core=new DatasetCalculationService(db,materialAccess,identityAudit);
  var coreError=assertThrows(IdentityException.class,()->core.calculate(j,parameters()));
  assertEquals("DATASET_NON_ADDITIVE_FIELD",coreError.code);assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_artifacts WHERE task_id=?",Integer.class,j.id()));
 }
 @Test void fullPinnedSnapshotUsesExactDecimalsAndCompetitionRanksAndPrivateCard(){
  var j=start();var result=agents.compareDataset(j.id(),j.token(),parameters());assertEquals(result,agents.compareDataset(j.id(),j.token(),parameters()));
  var data=json.valueToTree(result);assertEquals(5,data.at("/calculation/matchedRows").asInt());assertEquals(1,data.at("/calculation/ignoredRows").asInt());assertEquals("0.60",data.at("/calculation/totals/baseline").asString());assertEquals("1.20",data.at("/calculation/totals/current").asString());assertEquals("100.00",data.at("/calculation/totals/changePercent").asString());assertEquals(1,data.at("/calculation/rows/1/currentRank").asInt());assertTrue(data.at("/datasetSource/coverageThrough").isNull());assertFalse(data.toString().contains("部署"));
  receipt(j,2,"compare_dataset","succeeded");receipt(j,3,"deliver_briefing","STARTED");UUID calc=UUID.fromString(data.at("/artifact/id").asString());var created=agents.deliverBriefing(j.id(),j.token(),card(calc));assertEquals(created,agents.deliverBriefing(j.id(),j.token(),card(calc)));receipt(j,3,"deliver_briefing","succeeded");
  agents.finish(j,new AgentResult("1.5","0.16.0",j.id(),j.token(),"AGENT","verification","synthetic-dataset","画报已生成。",List.of(),List.of(new AgentResult.Tool("s","task_context","succeeded"),new AgentResult.Tool("c","compare_dataset","succeeded"),new AgentResult.Tool("b","deliver_briefing","succeeded")),List.of(),4,null,List.of(),List.of(),List.of(),"COMPLETE",null));
  var t=conversations.taskDetail(owner,tenant,j.conversation(),j.id()).tasks().getFirst();var doc=agents.briefing(owner,tenant,j.conversation(),j.id(),t.revision(),1);
  assertEquals("briefing-dataset-v1",doc.content().schemaVersion());assertNull(doc.content().source());assertEquals("RECORDED",doc.ruleTrace().status());assertTrue(doc.ruleTrace().versions().isEmpty());db.update("DELETE FROM expression_rule_task_snapshots WHERE task_id=?",j.id());var historical=agents.briefing(owner,tenant,j.conversation(),j.id(),t.revision(),1);assertEquals("NOT_RECORDED",historical.ruleTrace().status());assertEquals(doc.sha256(),historical.sha256());assertEquals(snapshot,doc.content().datasetSource().snapshotId());assertEquals("元",doc.content().chart().unit());
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);denied(()->agents.briefing(owner,tenant,j.conversation(),j.id(),t.revision(),1));
 }
 @Test void computationRequiresCurrentAttemptGrantAndIgnoresLaterSnapshot(){
  var j=task(null,"AUTHORIZED_LIBRARY");agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("compare_dataset")));receipt(j,1,"compare_dataset","STARTED");denied(()->agents.compareDataset(j.id(),j.token(),parameters()));call(j,request("dataset_search",null,null,0));
  var newer=version(2,"new");assertEquals(snapshot.toString(),json.valueToTree(agents.compareDataset(j.id(),j.token(),parameters())).at("/datasetSource/snapshotId").asString());
  denied(()->agents.compareDataset(j.id(),j.token(),new DatasetCalculationService.Request(dataset,newer,"门店","期间","收款（元）","前期","本期")));
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES (?,?,?)",tenant,space,owner);denied(()->agents.compareDataset(j.id(),j.token(),parameters()));
 }
 @Test void persistedCardFactsCannotSwapGroupsOrRepeatModelInventedTotals(){
  rows(List.of(List.of("甲店","前期","80.00"),List.of("乙店","前期","10.00"),List.of("甲店","本期","100.00"),List.of("乙店","本期","20.00")));
  var j=start();var computed=json.valueToTree(agents.compareDataset(j.id(),j.token(),parameters()));UUID calculation=UUID.fromString(computed.at("/artifact/id").asText());
  receipt(j,2,"compare_dataset","succeeded");receipt(j,3,"deliver_briefing","STARTED");
  var request=new BriefingContentService.Request(calculation,"乙店收入999元，远超甲店","乙店登记100元，甲店登记20元，合计999元。",List.of("乙店排名最高，甲店排名最低，收入已经银行到账。","建议核对各门店原始账单与登记凭据。"));
  var result=agents.deliverBriefing(j.id(),j.token(),request);assertEquals(result,agents.deliverBriefing(j.id(),j.token(),request));
  byte[] body=db.queryForObject("SELECT content FROM conversation_artifacts WHERE task_id=? AND filename LIKE 'briefing-dataset-%'",byte[].class,j.id());
  var card=json.readTree(body);String text=card.path("title").asText()+card.path("summary").asText()+card.path("analysis");
  assertFalse(text.contains("999"));assertFalse(text.contains("乙店排名最高"));assertTrue(text.contains("本期合计 120.00 元"));assertTrue(text.contains("最大为 100.00 元，对应「甲店」"));
  assertEquals(calculation.toString(),card.path("calculationArtifactId").asText());assertEquals(snapshot.toString(),card.path("datasetSource").path("snapshotId").asText());
 }
 DatasetCalculationService.Request wholeSummary(){return new DatasetCalculationService.Request(dataset,snapshot,null,null,"收款（元）",null,null,null,"Asia/Shanghai","SUM","SUMMARY",List.of("门店"),null,null,null,null);}
 @Test void measuredZeroWithActualRowsIsDeliverableRatherThanNoUsefulData(){
  rows(List.of(List.of("甲店","本期","0.00"),List.of("乙店","本期","0.00")));var j=start();
  var computed=json.valueToTree(agents.compareDataset(j.id(),j.token(),wholeSummary()));assertEquals("0.00",computed.at("/calculation/total").asText());assertEquals(2,computed.at("/calculation/matchedRows").asInt());
  receipt(j,2,"compare_dataset","succeeded");receipt(j,3,"deliver_briefing","STARTED");
  var result=agents.deliverBriefing(j.id(),j.token(),card(UUID.fromString(computed.at("/artifact/id").asText())));assertEquals("PREPARED",result.get("status"));
  var saved=json.readTree(db.queryForObject("SELECT content FROM conversation_artifacts WHERE task_id=? AND filename LIKE 'briefing-dataset-%'",byte[].class,j.id()));assertTrue(saved.path("summary").asText().contains("0.00 元"));assertEquals(2,saved.path("datasetBasis").path("matchedRows").asInt());
 }
 @Test void emptyAndNullAreRejectedInsteadOfBecomingMeasuredZero(){
  rows(List.of());var j=start();var empty=assertThrows(IdentityException.class,()->agents.compareDataset(j.id(),j.token(),wholeSummary()));assertEquals("DATASET_NO_MATCHING_DATA",empty.code);
  assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_artifacts WHERE task_id=?",Integer.class,j.id()));
  rows(List.of(Arrays.asList("甲店","本期",null)));var other=start();var missing=assertThrows(IdentityException.class,()->agents.compareDataset(other.id(),other.token(),wholeSummary()));assertEquals("DATASET_AMOUNT_REQUIRED",missing.code);
  assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_artifacts WHERE task_id=?",Integer.class,other.id()));
 }
 @Test void missingPeriodsAndNonPositiveBaselineAreGapsNotZeroOrPercent(){
  rows(List.of(List.of("甲","前期","0"),List.of("甲","本期","10"),List.of("乙","本期","3")));
  var j=start();var r=json.valueToTree(agents.compareDataset(j.id(),j.token(),parameters())).path("calculation");
  assertTrue(r.at("/totals/difference").isNull());assertEquals("UNEQUAL_GROUP_COVERAGE",r.at("/totals/issue").asString());
  assertTrue(r.path("rows").valueStream().anyMatch(v->"NON_POSITIVE_BASELINE".equals(v.path("issue").asString())));
  assertTrue(r.path("rows").valueStream().anyMatch(v->"MISSING_PERIOD".equals(v.path("issue").asString())&&v.path("baseline").isNull()));
 }
 @Test void malformedNumberFailsWithoutPersistingAnyCalculation(){
  rows(List.of(List.of("甲","前期","1,000"),List.of("甲","本期","1200")));var j=start();var error=assertThrows(IdentityException.class,()->agents.compareDataset(j.id(),j.token(),parameters()));assertEquals("DATASET_NUMBER_INVALID",error.code);assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_artifacts WHERE task_id=?",Integer.class,j.id()));
 }
 @Test void onlySelectedFilesCannotGainDatasetAccessFromForgedIdentifiers(){
  var j=start();db.update("UPDATE conversation_tasks SET source_scope='SELECTED' WHERE id=?",j.id());denied(()->agents.compareDataset(j.id(),j.token(),parameters()));
 }
 @Test void wrongColumnAndCrossDatasetIdentitiesAreRejected(){
  var j=start();denied(()->agents.compareDataset(j.id(),j.token(),new DatasetCalculationService.Request(UUID.randomUUID(),snapshot,"门店","期间","收款（元）","前期","本期")));denied(()->agents.compareDataset(j.id(),j.token(),new DatasetCalculationService.Request(dataset,snapshot,"门店","期间","A","前期","本期")));
 }
 @Test void monthGroupingUsesBusinessTimezoneAndComputesAllRows(){rows(List.of(List.of("甲","2026-09-10","10"),List.of("甲","2026-09-30T18:00:00Z","20"),List.of("甲","2026-10-02T10:00:00","5"),List.of("甲","2026-08-01","100")));var j=start();var p=new DatasetCalculationService.Request(dataset,snapshot,"门店","期间","收款（元）","2026-09","2026-10","MONTH","Asia/Shanghai");var r=json.valueToTree(agents.compareDataset(j.id(),j.token(),p));assertEquals("dataset-compare-month-1",r.at("/calculation/recipeVersion").asString());assertEquals("10",r.at("/calculation/totals/baseline").asString());assertEquals("25",r.at("/calculation/totals/current").asString());assertEquals(3,r.at("/calculation/matchedRows").asInt());assertEquals(1,r.at("/calculation/ignoredRows").asInt());receipt(j,2,"compare_dataset","succeeded");receipt(j,3,"deliver_briefing","STARTED");assertNotNull(agents.deliverBriefing(j.id(),j.token(),card(UUID.fromString(r.at("/artifact/id").asString()))));}
 @Test void ambiguousDatesAndInvalidTimezonesFailWithoutArtifact(){rows(List.of(List.of("甲","09/10/2026","10"),List.of("甲","2026-10-02","20")));var j=start();assertEquals("DATASET_DATE_INVALID",assertThrows(IdentityException.class,()->agents.compareDataset(j.id(),j.token(),new DatasetCalculationService.Request(dataset,snapshot,"门店","期间","收款（元）","2026-09","2026-10","MONTH","Asia/Shanghai"))).code);assertEquals("DATASET_TIMEZONE_INVALID",assertThrows(IdentityException.class,()->agents.compareDataset(j.id(),j.token(),new DatasetCalculationService.Request(dataset,snapshot,"门店","期间","收款（元）","2026-09","2026-10","MONTH","Not/AZone"))).code);assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_artifacts WHERE task_id=?",Integer.class,j.id()));}

 @Test void countRowsAcceptsTextMeasuresAndProducesVerifiedCard(){
  rows(List.of(List.of("甲","前期","姓名甲"),List.of("甲","前期","姓名乙"),List.of("甲","本期","姓名丙"),List.of("甲","其他","姓名丁")));
  var j=start();var p=new DatasetCalculationService.Request(dataset,snapshot,"门店","期间",null,"前期","本期","EXACT",null,"COUNT");
  var r=json.valueToTree(agents.compareDataset(j.id(),j.token(),p));
  assertEquals("2",r.at("/calculation/totals/baseline").asString());assertEquals("1",r.at("/calculation/totals/current").asString());assertEquals(1,r.at("/calculation/ignoredRows").asInt());
  receipt(j,2,"compare_dataset","succeeded");receipt(j,3,"deliver_briefing","STARTED");
  assertNotNull(agents.deliverBriefing(j.id(),j.token(),card(UUID.fromString(r.at("/artifact/id").asString()))));
 }
 @Test void sqlDatetimeCountsUseExplicitMonths(){
 rows(List.of(List.of("甲","2026-09-10 12:00:00","姓名甲"),List.of("甲","2026-10-02 09:00:00","姓名乙")));
 var j=start();var p=new DatasetCalculationService.Request(dataset,snapshot,"门店","期间",null,"2026-09","2026-10","MONTH","Asia/Shanghai","COUNT");
 var r=json.valueToTree(agents.compareDataset(j.id(),j.token(),p));assertEquals("1",r.at("/calculation/totals/current").asString());assertEquals(2,r.at("/calculation/matchedRows").asInt());
 }
}
