package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class BriefingBusinessLabelsTest {
 @Test void compoundStatusesAndUnitsArePresentedWithoutChangingEvidence(){
  var rows=List.of(new BriefingContentService.Row("active / 尚无转化记录",null,"91",null,null,null,null,null),new BriefingContentService.Row("future_status / 尚无转化记录",null,"2",null,null,null,null,null));
  var chart=new BriefingContentService.Chart("GROUPED_BAR","开课数","原数据数值单位","不适用","本次汇总","全部快照 · 16 行",rows,null);
  var source=new DatasetCalculationService.Source(UUID.randomUUID(),UUID.randomUUID(),1,"合成开课","synthetic",16,"2026-10-15T15:00:00Z","2026-10-15T13:00:00Z");
  var content=new BriefingContentService.Content("briefing-dataset-v1","DATA","标题","摘要",List.of(),chart,null,null,null,"2026-10-15T15:01:00Z",source,new BriefingContentService.DatasetBasis("开课状态 / 转化状态","不适用",16,0));
  var labels=BriefingDisplayLabels.forContent("ninepop-chain-trial-v1",content);
  assertEquals("有效开课 / 尚无转化记录",labels.groups().get(rows.getFirst().group()));
  assertEquals("待核实分类 / 尚无转化记录",labels.groups().get(rows.getLast().group()));
  assertEquals("份",labels.unit());assertEquals("数据截至 2026年10月15日 21:00",labels.range());
  assertEquals("active / 尚无转化记录",content.chart().rows().getFirst().group());assertEquals("91",content.chart().rows().getFirst().current());
 }
 @Test void approvalActionCountsDoNotMeasureEfficiency(){
  var r=new BriefingContentService.Request(null,"流转效率低于已通过基线","处理中申请的动作数更高。",List.of("仅统计动作数量。"));
  assertThrows(com.dreamcore.workspace.identity.IdentityException.class,()->BriefingEditorialQuality.validateApprovalScope(r));
 }
 @Test void allStatusDimensionsHaveBusinessLabels(){
  for(String[] v:List.of(new String[]{"transfers","转店状态","withdrawn","已撤回"},new String[]{"approvals","审批状态","in_progress","审批中"},new String[]{"courses","课程状态","active","开课中"},new String[]{"refunds","财务处理","income_reduction","冲减原收入"},new String[]{"sessions","课时状态","pending_cross_store_claim","跨店待认领"}))assertEquals(v[3],BriefingDisplayLabels.dictionary("ninepop-chain-"+v[0]+"-v1",v[1]).get(v[2]));
 }
 @Test void mixedCourseTotalsCannotBeClaimedAsFormalCourses(){
  var misleading=new BriefingContentService.Request(null,"某店正式课在读94份","正式课程存量需要跟进。",List.of("各店在读数量按课程记录统计。"));
  assertThrows(com.dreamcore.workspace.identity.IdentityException.class,()->BriefingEditorialQuality.validateCourseScope(misleading,true,false));
  assertDoesNotThrow(()->BriefingEditorialQuality.validateCourseScope(misleading,true,true));
  var complete=new BriefingContentService.Request(null,"某店课程在读94份","课程存量需要跟进。",List.of("本次包含正式课与体验课，不代表会员人数。"));
  assertDoesNotThrow(()->BriefingEditorialQuality.validateCourseScope(complete,true,false));
  assertEquals("课程体验官",BriefingDisplayLabels.dictionary("ninepop-chain-courses-v1","产品类别").get("course_experience_officer"));
 }
}
