package com.dreamcore.workspace;
import com.dreamcore.workspace.briefing.BriefingTaskPrompt;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
class BriefingTaskPromptTest {
 @Test void longSourcesCannotDisplaceRecentReferenceOrExecutionBoundary(){
  for(String type:List.of("DATA","INFO","INSIGHT")){
   String p=BriefingTaskPrompt.compose("DATA_READY",type,List.of("长文件名😀".repeat(300),"第二份资料".repeat(300),"第三份资料".repeat(300)),"近期已报道甲店收款，避免重复。".repeat(150));
   assertTrue(p.length()<=2000);assertTrue(p.contains("近期已报道甲店收款"));assertTrue(p.contains("【执行边界】"));assertTrue(p.contains("已截短"));assertTrue(p.contains("类型："+type));assertTrue(p.contains("不作为新事实"));assertTrue(p.contains("固定来源"));
  }
 }
 @Test void emptyHistoryDoesNotInventCoverage(){String p=BriefingTaskPrompt.compose("INITIALIZATION",null,List.of(),"");assertTrue(p.contains("当前范围没有可用近期摘要"));assertTrue(p.contains("不代表全部企业资料"));}
}
