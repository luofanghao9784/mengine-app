package com.dreamcore.workspace;

import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class BriefingSupportingCalculationIntegrationTest extends TaskDatasetFixture {
 @Override List<String> columns(){return List.of("门店","应收付日","应收付金额（元）","逾期费用（元）");}
 @Override List<List<String>> rowsFor(String marker){return List.of(List.of("甲","2026-09-02","10","0"),List.of("乙","2026-09-03","5","0"),List.of("甲","2026-10-02","20","0"),List.of("乙","2026-10-03","10","0"));}
 void receipt(ConversationService.Job j,int n,String name,String state){agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(n,name,state));}
 ConversationService.Job start(){var j=task(null,"AUTHORIZED_LIBRARY");agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("task_context","compare_dataset","deliver_briefing")));receipt(j,1,"task_context","STARTED");call(j,request("dataset_search",null,null,0));receipt(j,1,"task_context","succeeded");receipt(j,2,"compare_dataset","STARTED");return j;}
 UUID calculate(ConversationService.Job j,String month,String field){var r=new DatasetCalculationService.Request(dataset,snapshot,null,null,field,null,null,null,"Asia/Shanghai","SUM","SUMMARY",List.of("门店"),"应收付日",month+"-01",month.equals("2026-10")?month+"-31":month+"-30","FAIL");return UUID.fromString(json.valueToTree(agents.compareDataset(j.id(),j.token(),r)).at("/artifact/id").asText());}
 BriefingContentService.Request card(UUID primary,List<UUID> supporting){return new BriefingContentService.Request(primary,"模型自拟合并收入999元","模型尝试把两个月金额相加为收入999元。",List.of("模型尝试声称银行已到账999元。","建议核对各月份账单登记与原始凭据。"),"DATA",null,supporting);}
 Map<String,Object> deliver(ConversationService.Job j,UUID primary,List<UUID> supporting){receipt(j,2,"compare_dataset","succeeded");receipt(j,3,"deliver_briefing","STARTED");return agents.deliverBriefing(j.id(),j.token(),card(primary,supporting));}
 void complete(ConversationService.Job j){receipt(j,3,"deliver_briefing","succeeded");agents.finish(j,new AgentResult("1.5","0.19.0",j.id(),j.token(),"AGENT","verification","synthetic-supporting","画报已生成。",List.of(),List.of(new AgentResult.Tool("s","task_context","succeeded"),new AgentResult.Tool("c","compare_dataset","succeeded"),new AgentResult.Tool("d","deliver_briefing","succeeded")),List.of(),4,null,List.of(),List.of(),List.of(),"COMPLETE",null));}
 BriefingContentService.Document document(ConversationService.Job j){var task=conversations.taskDetail(owner,tenant,j.conversation(),j.id()).tasks().getFirst();return agents.briefing(owner,tenant,j.conversation(),j.id(),task.revision(),1);}
 @Test void newPriorMonthAndMeasuredZeroSurvivePrimaryDedupAndRetainExactEvidence(){
  var first=start();var current=calculate(first,"2026-10","应收付金额（元）");assertEquals("PREPARED",deliver(first,current,List.of()).get("status"));complete(first);byte[] old=db.queryForObject("SELECT content FROM conversation_artifacts WHERE task_id=? AND filename LIKE 'briefing-%'",byte[].class,first.id());
  var second=start();current=calculate(second,"2026-10","应收付金额（元）");var previous=calculate(second,"2026-09","应收付金额（元）");var zero=calculate(second,"2026-10","逾期费用（元）");assertEquals("PREPARED",deliver(second,current,List.of(previous,zero)).get("status"));complete(second);
  var content=document(second).content();assertEquals(2,content.supportingCalculations().size());assertEquals("30",content.chart().totals().current());
  String narrative=content.title()+content.summary()+content.analysis();assertTrue(narrative.contains("2026-09"));assertTrue(narrative.contains("15 元"));assertTrue(narrative.contains("0 元"));assertFalse(narrative.contains("999"));assertTrue(narrative.contains("不相加"));assertEquals(4,content.analysis().size());assertTrue(content.analysis().stream().allMatch(p->p.length()<=500));
  var evidence=content.supportingCalculations().getFirst();assertEquals(previous,evidence.artifactId());assertEquals("元",evidence.unit());assertEquals("2026-09-01",evidence.receipt().at("/calculation/request/dateFrom").asText());assertEquals("15",evidence.receipt().at("/calculation/total").asText());assertEquals(2,evidence.receipt().at("/calculation/matchedRows").asInt());
  assertArrayEquals(old,db.queryForObject("SELECT content FROM conversation_artifacts WHERE task_id=? AND filename LIKE 'briefing-%'",byte[].class,first.id()));
 }
 @Test void auxiliaryOrderAndUnchangedNewSnapshotsCannotManufactureNewBusinessFacts(){
  var first=start();var p=calculate(first,"2026-10","应收付金额（元）");var s=calculate(first,"2026-09","应收付金额（元）");var z=calculate(first,"2026-10","逾期费用（元）");assertEquals("PREPARED",deliver(first,p,List.of(s,z)).get("status"));complete(first);
  snapshot=version(2,"same values");var second=start();p=calculate(second,"2026-10","应收付金额（元）");s=calculate(second,"2026-09","应收付金额（元）");z=calculate(second,"2026-10","逾期费用（元）");var result=deliver(second,p,List.of(z,s));assertEquals("NO_NEW_CONTENT",result.get("status"));assertEquals("DUPLICATE_CONTENT",result.get("reason"));
 }
 @Test void auxiliaryEvidenceCannotComeFromAnotherAttemptOrAnUnverifiedArtifact(){
  var foreign=start();var older=calculate(foreign,"2026-09","应收付金额（元）");
  var j=start();var p=calculate(j,"2026-10","应收付金额（元）");receipt(j,2,"compare_dataset","succeeded");receipt(j,3,"deliver_briefing","STARTED");
  for(UUID id:List.of(older,UUID.randomUUID()))assertEquals("BRIEFING_CALCULATION_NOT_GRANTED",assertThrows(IdentityException.class,()->agents.deliverBriefing(j.id(),j.token(),card(p,List.of(id)))).code);
  assertThrows(IdentityException.class,()->agents.deliverBriefing(j.id(),j.token(),card(p,List.of(p))));
  assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_artifacts WHERE task_id=? AND filename LIKE 'briefing-%'",Integer.class,j.id()));
 }
 @Test void unrelatedBinaryArtifactsAreNeverParsedAsBriefingJson(){
  var j=start();var p=calculate(j,"2026-10","应收付金额（元）");var s=calculate(j,"2026-09","应收付金额（元）");
  db.update("INSERT INTO conversation_artifacts(id,tenant_id,workspace_id,task_id,filename,sha256,content,attempt_number) VALUES (?,?,?,?,?,?,?,1)",UUID.randomUUID(),tenant,privateSpace,j.id(),"binary.bin","f".repeat(64),new byte[]{(byte)255,0,1});
  deliver(j,p,List.of(s));complete(j);assertNotNull(document(j));
 }
 @Test void erasingAuxiliaryCalculationMakesTheWholeHistoricalCardUnavailable(){
  var j=start();var p=calculate(j,"2026-10","应收付金额（元）");var s=calculate(j,"2026-09","应收付金额（元）");deliver(j,p,List.of(s));complete(j);assertNotNull(document(j));
  db.update("UPDATE object_lifecycle SET state='PURGE_PENDING' WHERE kind='ARTIFACT' AND object_id=?",s);assertThrows(IdentityException.class,()->document(j));
 }
}
