package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class DatasetSummaryIntegrationTest extends DatasetCalculationFixture {
 ConversationService.Job start(){var j=task(null,"AUTHORIZED_LIBRARY");agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("task_context","compare_dataset","deliver_briefing")));receipt(j,1,"task_context","STARTED");call(j,request("dataset_search",null,null,0));receipt(j,1,"task_context","succeeded");receipt(j,2,"compare_dataset","STARTED");return j;}
 void receipt(ConversationService.Job j,int n,String name,String state){agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(n,name,state));}
 BriefingContentService.Request card(UUID calc){return new BriefingContentService.Request(calc,"门店两期收款比较","两家门店同口径收款合计增长一倍，需结合业务背景解读。",List.of("图表使用固定数据快照的完整记录计算，两家门店两期数据均可比较。","这里呈现已发生的收款变化，经营原因仍需结合其他信息核实。"));}
 @Override List<String> columns(){return List.of("门店","期间","收款（元）","确认时间");}
 @Override List<List<String>> rowsFor(String marker){return List.of(List.of("甲","已确认","0.10","2026-07-31 23:59:59"),List.of("甲","已确认","0.20","2026-08-01 00:00:00"),List.of("甲","已取消","0.30","2026-08-31T16:00:00Z"),List.of("乙","已确认","0.40","2026-09-01"),List.of("乙","已取消","9",""));}
 DatasetCalculationService.Request summary(String from,String to,String missing,String aggregation){return new DatasetCalculationService.Request(dataset,snapshot,null,null,"COUNT".equals(aggregation)?null:"收款（元）",null,null,null,"Asia/Shanghai",aggregation,"SUMMARY",List.of("门店","期间"),"确认时间",from,to,missing);}
 @Test void wholeTableTotalsDoNotRequireInventingAGroupingColumn(){
  var j=start();var sum=new DatasetCalculationService.Request(dataset,snapshot,null,null,"收款（元）",null,null,null,null,"SUM","SUMMARY",List.of(),null,null,null,null);
  var r=json.valueToTree(agents.compareDataset(j.id(),j.token(),sum));assertEquals("10.00",r.at("/calculation/total").asString());assertEquals(1,r.at("/calculation/rows").size());assertEquals(0,r.at("/calculation/rows/0/group").size());assertEquals(5,r.at("/calculation/rows/0/records").asInt());
  var count=new DatasetCalculationService.Request(dataset,snapshot,null,null,null,null,null,null,null,"COUNT","SUMMARY",List.of(),null,null,null,null);
  assertEquals("5",json.valueToTree(agents.compareDataset(j.id(),j.token(),count)).at("/calculation/total").asString());
  receipt(j,2,"compare_dataset","succeeded");receipt(j,3,"deliver_briefing","STARTED");
  var card=agents.deliverBriefing(j.id(),j.token(),new BriefingContentService.Request(UUID.fromString(r.at("/artifact/id").asString()),"记录金额合计","所选记录金额合计10.00元。",List.of("按所选数据范围汇总，不代表已到账收入。","本次汇总覆盖五条记录，业务含义需要结合记录状态判断。")));
  assertNotNull(card);
  var contents=db.queryForList("SELECT content FROM conversation_artifacts WHERE task_id=? AND filename LIKE 'briefing-dataset-%'",byte[].class,j.id());
  assertEquals(1,contents.size());assertTrue(new String(contents.getFirst(),java.nio.charset.StandardCharsets.UTF_8).contains("全部记录"));

 }
 @Test void dateRangeSummaryUsesAllRowsExactDecimalsAndMissingDateAccounting(){
  var j=start();var r=json.valueToTree(agents.compareDataset(j.id(),j.token(),summary("2026-08-01",null,"EXCLUDE","SUM")));
  assertEquals("0.90",r.at("/calculation/total").asString());assertEquals(3,r.at("/calculation/matchedRows").asInt());assertEquals(2,r.at("/calculation/ignoredRows").asInt());assertEquals(1,r.at("/calculation/missingDateRows").asInt());assertEquals(3,r.at("/calculation/rows").size());
  assertEquals(r.at("/artifact/id").asString(),json.valueToTree(agents.compareDataset(j.id(),j.token(),summary("2026-08-01",null,"EXCLUDE","SUM"))).at("/artifact/id").asString());
 }
 @Test void inclusiveUpperDateUsesBusinessTimezoneAndCount(){var j=start();var r=json.valueToTree(agents.compareDataset(j.id(),j.token(),summary("2026-08-01","2026-08-31","EXCLUDE","COUNT")));assertEquals("1",r.at("/calculation/total").asString());assertEquals(1,r.at("/calculation/matchedRows").asInt());}
 @Test void invalidAndMissingDatesAndEmptyRangesFailWithoutArtifacts(){var j=start();assertEquals("DATASET_DATE_REQUIRED",assertThrows(IdentityException.class,()->agents.compareDataset(j.id(),j.token(),summary("2026-08-01",null,null,"SUM"))).code);assertEquals("DATASET_DATE_RANGE_INVALID",assertThrows(IdentityException.class,()->agents.compareDataset(j.id(),j.token(),summary("2026-09-01","2026-08-01","EXCLUDE","SUM"))).code);assertEquals("DATASET_NO_MATCHING_DATA",assertThrows(IdentityException.class,()->agents.compareDataset(j.id(),j.token(),summary("2030-01-01",null,"EXCLUDE","SUM"))).code);assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_artifacts WHERE task_id=?",Integer.class,j.id()));}
 @Test void dateFilterCanFeedVerifiedTwoCategoryDataChart(){var j=start();var p=new DatasetCalculationService.Request(dataset,snapshot,"门店","期间","收款（元）","已取消","已确认","EXACT","Asia/Shanghai","SUM","COMPARE",null,"确认时间","2026-08-01",null,"EXCLUDE");var r=json.valueToTree(agents.compareDataset(j.id(),j.token(),p));assertEquals("0.30",r.at("/calculation/totals/baseline").asString());assertEquals("0.60",r.at("/calculation/totals/current").asString());receipt(j,2,"compare_dataset","succeeded");receipt(j,3,"deliver_briefing","STARTED");assertNotNull(agents.deliverBriefing(j.id(),j.token(),card(UUID.fromString(r.at("/artifact/id").asString()))));}
 @Test void summaryStillRequiresPinnedSnapshotAndCurrentPermission(){var j=start();var newer=version(2,rowsFor("new"));var p=new DatasetCalculationService.Request(dataset,newer,null,null,"收款（元）",null,null,null,null,"SUM","SUMMARY",List.of("门店","期间"),"确认时间","2026-08-01",null,"EXCLUDE");denied(()->agents.compareDataset(j.id(),j.token(),p));db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);denied(()->agents.compareDataset(j.id(),j.token(),summary("2026-08-01",null,"EXCLUDE","SUM")));assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_artifacts WHERE task_id=?",Integer.class,j.id()));}
 @Test void malformedDateAndUnknownGroupingFailClosed(){rows(List.of(List.of("甲","已确认","1","08/01/2026")));var j=start();assertEquals("DATASET_DATE_INVALID",assertThrows(IdentityException.class,()->agents.compareDataset(j.id(),j.token(),summary("2026-08-01",null,"EXCLUDE","SUM"))).code);assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_artifacts WHERE task_id=?",Integer.class,j.id()));}

}
