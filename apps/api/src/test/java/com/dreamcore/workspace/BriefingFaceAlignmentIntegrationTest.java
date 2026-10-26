package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class BriefingFaceAlignmentIntegrationTest extends DatasetCalculationFixture {
 ConversationService.Job start(){var j=task(null,"AUTHORIZED_LIBRARY");agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("task_context","compare_dataset","deliver_briefing")));receipt(j,1,"task_context","STARTED");call(j,request("dataset_search",null,null,0));receipt(j,1,"task_context","succeeded");receipt(j,2,"compare_dataset","STARTED");return j;}
 void receipt(ConversationService.Job j,int n,String name,String state){agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(n,name,state));}
 DatasetCalculationService.Request parameters(String op){return new DatasetCalculationService.Request(dataset,snapshot,null,null,"收款（元）",null,null,null,"Asia/Shanghai","SUM",op,List.of("门店"),null,null,null,null);}
 BriefingContentService.Request card(UUID id,BriefingPresentationPolicy.Presentation p){return new BriefingContentService.Request(id,"甲店收款高于乙店","完整核验记录显示两家门店的收款存在差异。",List.of("图表只使用本次固定快照中的完整记录形成汇总。","这些数字不证明经营原因，需要结合实际业务判断。"),"DATA",p);}
 @Test void compositionUsesExactTotalsAndPlatformSharesAndSupportsPrivateDelivery(){
  rows(List.of(List.of("甲","本期","2"),List.of("乙","本期","1")));
  var j=start();var result=agents.compareDataset(j.id(),j.token(),parameters("COMPOSITION"));assertEquals(result,agents.compareDataset(j.id(),j.token(),parameters("COMPOSITION")));
  var data=json.valueToTree(result);assertEquals("3",data.at("/calculation/total").asString());assertEquals("66.666667",data.at("/calculation/rows/0/sharePercent").asString());
  receipt(j,2,"compare_dataset","succeeded");receipt(j,3,"deliver_briefing","STARTED");var id=UUID.fromString(data.at("/artifact/id").asString());
  var delivered=agents.deliverBriefing(j.id(),j.token(),card(id,null));assertEquals("PREPARED",delivered.get("status"));
  var content=json.readTree(db.queryForObject("SELECT content FROM conversation_artifacts WHERE id=?",byte[].class,delivered.get("artifactId")));
  assertEquals("COMPOSITION",content.at("/datasetBasis/periodMode").asString());assertEquals("CURRENT_BAR",content.at("/presentation/chartStyle").asString());assertEquals("66.666667",content.at("/chart/composition/rows/0/sharePercent").asString());
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);denied(()->agents.deliverBriefing(j.id(),j.token(),card(id,null)));
 }
 @Test void zeroCalculationWithMatchedRowsPublishesMeasuredZeroOnce(){
  rows(List.of(List.of("甲","前期","0"),List.of("甲","本期","0")));var j=start();var result=json.valueToTree(agents.compareDataset(j.id(),j.token(),parameters("COMPOSITION")));
  assertTrue(result.at("/calculation/rows/0/sharePercent").isMissingNode());receipt(j,2,"compare_dataset","succeeded");receipt(j,3,"deliver_briefing","STARTED");var r=card(UUID.fromString(result.at("/artifact/id").asString()),null);
  var first=agents.deliverBriefing(j.id(),j.token(),r);assertEquals("PREPARED",first.get("status"));assertEquals(first,agents.deliverBriefing(j.id(),j.token(),r));
  var content=json.readTree(db.queryForObject("SELECT content FROM conversation_artifacts WHERE id=?",byte[].class,first.get("artifactId")));
  assertEquals(2,content.at("/datasetBasis/matchedRows").asInt());assertEquals(0,new java.math.BigDecimal(content.at("/chart/totals/current").asString()).signum());
  assertEquals(2,db.queryForObject("SELECT count(*) FROM conversation_artifacts WHERE task_id=?",Integer.class,j.id()));assertEquals(1,db.queryForObject("SELECT count(*) FROM briefing_content_keys WHERE task_id=?",Integer.class,j.id()));
 }
 @Test void negativeCompositionFailsButOffsettingSummaryIsStillUseful(){
  rows(List.of(List.of("甲","本期","2"),List.of("乙","本期","-2")));var j=start();assertEquals("DATASET_COMPOSITION_NEGATIVE",assertThrows(IdentityException.class,()->agents.compareDataset(j.id(),j.token(),parameters("COMPOSITION"))).code);
  var result=json.valueToTree(agents.compareDataset(j.id(),j.token(),parameters("SUMMARY")));receipt(j,2,"compare_dataset","succeeded");receipt(j,3,"deliver_briefing","STARTED");
  assertEquals("PREPARED",agents.deliverBriefing(j.id(),j.token(),card(UUID.fromString(result.at("/artifact/id").asString()),null)).get("status"));
 }
 @Test void summaryHonorsExplicitTableAndDoesNotBypassLayoutPolicy(){
  var j=start();var result=json.valueToTree(agents.compareDataset(j.id(),j.token(),parameters("SUMMARY")));receipt(j,2,"compare_dataset","succeeded");receipt(j,3,"deliver_briefing","STARTED");var id=UUID.fromString(result.at("/artifact/id").asString());
  var invalid=new BriefingPresentationPolicy.Presentation("briefing-presentation-v1","STEPS","TABLE",null,null,List.of());assertEquals("BRIEFING_PRESENTATION_INVALID",assertThrows(IdentityException.class,()->agents.deliverBriefing(j.id(),j.token(),card(id,invalid))).code);
  var p=new BriefingPresentationPolicy.Presentation("briefing-presentation-v1","KEY_METRIC","TABLE","甲","CURRENT",List.of());var r=agents.deliverBriefing(j.id(),j.token(),card(id,p));var content=json.readTree(db.queryForObject("SELECT content FROM conversation_artifacts WHERE id=?",byte[].class,r.get("artifactId")));assertEquals("TABLE",content.at("/presentation/chartStyle").asString());assertEquals("KEY_METRIC",content.at("/presentation/layout").asString());
 }
 @Test void displayDictionaryIsDatasetAndColumnSpecificAndUnknownsRemainRaw(){
  assertEquals("开课中",BriefingDisplayLabels.dictionary("ninepop_members_v1","会员状态").get("active"));assertEquals("请假中",BriefingDisplayLabels.dictionary("ninepop_members_v1","会员状态").get("on_leave"));assertTrue(BriefingDisplayLabels.dictionary("other","会员状态").isEmpty());assertTrue(BriefingDisplayLabels.dictionary("ninepop_members_v1","门店").isEmpty());assertNull(BriefingDisplayLabels.dictionary("ninepop_members_v1","会员状态").get("unknown"));
 }
 @Test void missingValuesDoNotInventZerosAndSingleNonzeroGroupSurvives(){
  assertFalse(BriefingContentService.hasUsefulData(List.of(new BriefingContentService.Row("甲",null,null,null,null,null,null,"MISSING_PERIOD"))));assertTrue(BriefingContentService.hasUsefulData(List.of(new BriefingContentService.Row("甲",null,"-1",null,null,null,null,"MISSING_PERIOD"))));
 }
 @Test void actualHttpHarnessDeliversCompositionAndMeasuredZeroComparison() throws Exception {
  for(String mode:List.of("composition","zero")){
   rows(List.of(List.of("甲","前期",mode.equals("zero")?"0":"2"),List.of("甲","本期",mode.equals("zero")?"0":"1"),List.of("乙","本期",mode.equals("zero")?"0":"1")));
   var root=java.nio.file.Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();String token="synthetic-face-alignment-012345678901234567890";
   var engine=new ProcessBuilder("node",root.resolve("engine/tests/fixtures/dataset-briefing-server.mjs").toString(),"http://127.0.0.1:"+port,token,mode).redirectError(ProcessBuilder.Redirect.INHERIT).start();
   try(var pool=java.util.concurrent.Executors.newSingleThreadExecutor();var lines=new java.io.BufferedReader(new java.io.InputStreamReader(engine.getInputStream()))){
    String endpoint=pool.submit(lines::readLine).get(5,java.util.concurrent.TimeUnit.SECONDS);var j=task(null,"AUTHORIZED_LIBRARY");var runtime=new EngineTaskRuntime(endpoint,token,"verification",false);var result=runtime.executeAgent(j.id(),j.token(),j.prompt(),()->agents.active(j));assertEquals("COMPLETE",result.outcome());assertTrue(result.tools().stream().allMatch(t->t.status().equals("succeeded")));agents.finish(j,result);
    int n=db.queryForObject("SELECT count(*) FROM conversation_artifacts WHERE task_id=? AND filename LIKE 'briefing-%'",Integer.class,j.id());assertEquals(1,n);
    if(mode.equals("composition")){var t=conversations.taskDetail(owner,tenant,j.conversation(),j.id()).tasks().getFirst();var doc=agents.briefing(owner,tenant,j.conversation(),j.id(),t.revision(),1);assertEquals("CURRENT_BAR",doc.content().presentation().chartStyle());assertEquals("75.000000",doc.content().chart().composition().rows().getFirst().sharePercent());}
    else {var t=conversations.taskDetail(owner,tenant,j.conversation(),j.id()).tasks().getFirst();var doc=agents.briefing(owner,tenant,j.conversation(),j.id(),t.revision(),1);assertEquals(3,doc.content().datasetBasis().matchedRows());assertEquals(0,new java.math.BigDecimal(doc.content().chart().totals().current()).signum());}
   }finally{engine.destroyForcibly();engine.waitFor();}
  }
 }
 @org.springframework.beans.factory.annotation.Autowired BriefingContentService briefingContent;
 @Test void datasetDictionaryProjectsGroupAndColumnLabelsWithoutChangingArtifactBytes(){
  dataset=UUID.randomUUID();
  db.update("INSERT INTO business_datasets(id,tenant_id,connection_id,workspace_id,dataset_key,name,column_names) VALUES (?,?,?,?,'ninepop_payments_v1','销售状态',?::jsonb)",dataset,tenant,connection,space,json.writeValueAsString(List.of("收款状态","收款类型","收款（元）")));
  snapshot=version(1,List.of(List.of("finance_confirmed","deposit","2"),List.of("finance_confirmed","full","4"),List.of("unknown","deposit","1"),List.of("unknown","full","2")));
  var j=start();var p=new DatasetCalculationService.Request(dataset,snapshot,"收款状态","收款类型","收款（元）","deposit","full");var result=json.valueToTree(agents.compareDataset(j.id(),j.token(),p));receipt(j,2,"compare_dataset","succeeded");receipt(j,3,"deliver_briefing","STARTED");
  var delivered=agents.deliverBriefing(j.id(),j.token(),card(UUID.fromString(result.at("/artifact/id").asString()),null));receipt(j,3,"deliver_briefing","succeeded");
  var bytes=db.queryForObject("SELECT content FROM conversation_artifacts WHERE id=?",byte[].class,delivered.get("artifactId"));var doc=briefingContent.find(j.id(),1);
  assertEquals("财务已确认",doc.chartLabels().groups().get("finance_confirmed"));assertEquals("定金",doc.chartLabels().columns().get("deposit"));assertFalse(doc.chartLabels().groups().containsKey("unknown"));assertEquals("deposit",doc.content().chart().baseline());assertEquals("finance_confirmed",doc.content().chart().rows().getFirst().group());assertEquals(com.dreamcore.workspace.identity.IdentityService.hash(new String(bytes,java.nio.charset.StandardCharsets.UTF_8)),doc.sha256());assertFalse(new String(bytes,java.nio.charset.StandardCharsets.UTF_8).contains("chartLabels"));
 }
 @Test void existingCourseEntitlementChartGetsSourceLabelsWithoutChangingItsEvidence(){
  dataset=UUID.randomUUID();
  db.update("INSERT INTO business_datasets(id,tenant_id,connection_id,workspace_id,dataset_key,name,column_names) VALUES (?,?,?,?,'ninepop_course_entitlements_v1','会员课程权益',?::jsonb)",dataset,tenant,connection,space,json.writeValueAsString(List.of("课程状态","期间","数量")));
  var expected=Map.of("active","开课中","on_leave","请假中","frozen","停卡中","finished","已结束","refunded","已退款","canceled","已取消","guarantee_renewal","保底续期","pending_start","待开课","final_payment_pending","尾款限制");
  var records=new ArrayList<List<String>>();for(String state:expected.keySet())records.add(List.of(state,"本期","1"));records.add(List.of("unknown","本期","1"));
  snapshot=version(1,records);var j=start();
  var p=new DatasetCalculationService.Request(dataset,snapshot,null,null,null,null,null,null,"Asia/Shanghai","COUNT","SUMMARY",List.of("课程状态"),null,null,null,null);
  var result=json.valueToTree(agents.compareDataset(j.id(),j.token(),p));receipt(j,2,"compare_dataset","succeeded");receipt(j,3,"deliver_briefing","STARTED");
  var delivered=agents.deliverBriefing(j.id(),j.token(),card(UUID.fromString(result.at("/artifact/id").asString()),null));receipt(j,3,"deliver_briefing","succeeded");
  var bytes=db.queryForObject("SELECT content FROM conversation_artifacts WHERE id=?",byte[].class,delivered.get("artifactId"));var doc=briefingContent.find(j.id(),1);
  assertEquals(expected,doc.chartLabels().groups());assertTrue(doc.chartLabels().columns().isEmpty());
  assertEquals(10,doc.content().chart().rows().size());for(var row:doc.content().chart().rows()){assertTrue(expected.containsKey(row.group())||row.group().equals("unknown"));assertEquals("1",row.current());}
  assertArrayEquals(bytes,db.queryForObject("SELECT content FROM conversation_artifacts WHERE id=?",byte[].class,delivered.get("artifactId")));
  assertEquals(com.dreamcore.workspace.identity.IdentityService.hash(new String(bytes,java.nio.charset.StandardCharsets.UTF_8)),doc.sha256());
  assertTrue(BriefingDisplayLabels.dictionary("ninepop_course_entitlements_v1","会员状态").isEmpty());
 }
 @Test void compositionCountUsesSameDateScopeAndDisclosesExcludedDates(){
  rows(List.of(List.of("甲","2026-09-30T18:00:00Z","not-money"),List.of("乙","2026-10-02","not-money"),List.of("乙","2026-09-30","not-money"),List.of("甲","","not-money")));
  var j=start();var p=new DatasetCalculationService.Request(dataset,snapshot,null,null,null,null,null,null,"Asia/Shanghai","COUNT","COMPOSITION",List.of("门店"),"期间","2026-10-01","2026-10-02","EXCLUDE");var r=json.valueToTree(agents.compareDataset(j.id(),j.token(),p));
  assertEquals("2",r.at("/calculation/total").asString());assertEquals(2,r.at("/calculation/matchedRows").asInt());assertEquals(2,r.at("/calculation/ignoredRows").asInt());assertEquals(1,r.at("/calculation/missingDateRows").asInt());assertEquals("50.000000",r.at("/calculation/rows/0/sharePercent").asString());
  var prose=new BriefingContentService.Request(null,"甲店记录占比为一半","甲店在本次筛选范围内的记录占比为一半。",List.of("仅使用已核验的固定范围内全部记录计算份额。","本次剔除缺少日期的记录，不推断范围外的经营情况。"),"DATA");
  assertDoesNotThrow(()->BriefingEditorialQuality.validate(prose,true,true,true,true));assertEquals("BRIEFING_RATIO_NOT_VERIFIED",assertThrows(IdentityException.class,()->BriefingEditorialQuality.validate(prose,true,true,true,false)).code);
 }
 @Test void mixedProductAggregationCannotPublishAsFormalCourses(){
  dataset=UUID.randomUUID();
  db.update("INSERT INTO business_datasets(id,tenant_id,connection_id,workspace_id,dataset_key,name,column_names) VALUES (?,?,?,?,'ninepop-chain-courses-v1','合成课程','[\"门店\",\"产品类别\",\"课程数\"]'::jsonb)",dataset,tenant,connection,space);
  snapshot=version(1,List.of(List.of("甲","formal_course","5"),List.of("甲","trial_course","2")));
  var j=start();var p=new DatasetCalculationService.Request(dataset,snapshot,null,null,"课程数",null,null,null,"Asia/Shanghai","SUM","SUMMARY",List.of("门店"),null,null,null,null);
  var result=json.valueToTree(agents.compareDataset(j.id(),j.token(),p));receipt(j,2,"compare_dataset","succeeded");receipt(j,3,"deliver_briefing","STARTED");
  var artifact=UUID.fromString(result.at("/artifact/id").asString());
  var bad=new BriefingContentService.Request(artifact,"甲店正式课存量为7份","甲店正式课的课程存量为7份，需要跟进。",List.of("本次按门店汇总课程记录数量。","课程记录数量不代表会员人数。"),"DATA");
  assertEquals("BRIEFING_CATEGORY_SCOPE_MISMATCH",assertThrows(IdentityException.class,()->agents.deliverBriefing(j.id(),j.token(),bad)).code);
  var good=new BriefingContentService.Request(artifact,"甲店课程记录共7份","甲店的课程记录共7份，需要按产品分类跟进。",List.of("本次包含正式课与体验课的课程记录。","课程记录数量不代表会员人数。"),"DATA");
  assertEquals("PREPARED",agents.deliverBriefing(j.id(),j.token(),good).get("status"));
 }
}
