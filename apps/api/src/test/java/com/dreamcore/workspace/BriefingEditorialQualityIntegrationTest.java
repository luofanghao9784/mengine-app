package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.*;
class BriefingEditorialQualityIntegrationTest extends DatasetCalculationFixture {
 ConversationService.Job start(){
  db.update("INSERT INTO work_role_profiles(tenant_id,account_id,responsibilities,revision,changed_by) VALUES (?,?,'核对收款与凭证',1,?)",tenant,owner,owner);
  var submitted=conversations.submit(owner,tenant,null,privateSpace,UUID.randomUUID(),"核对获权收款记录","AGENT");UUID task=submitted.tasks().getLast().id();
  db.update("UPDATE conversation_tasks SET source_scope='AUTHORIZED_LIBRARY' WHERE id=?",task);
  UUID p=UUID.randomUUID();db.update("INSERT INTO briefing_generation_policies(id,tenant_id,owner_id,workspace_id) VALUES (?,?,?,?)",p,tenant,owner,privateSpace);
  db.update("INSERT INTO briefing_generation_batches(id,tenant_id,owner_id,workspace_id,policy_id,policy_epoch,trigger_kind,status,task_id,audience_key) VALUES (?,?,?,?,?,1,'MANUAL','RUNNING',?,work_audience_key(?,?))",UUID.randomUUID(),tenant,owner,privateSpace,p,task,tenant,owner);
  var j=conversations.claim();assertEquals(task,j.id());
  agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("task_context","select_briefing_topic","deliver_briefing")));
  receipt(j,1,"task_context","STARTED");call(j,request("dataset_read",dataset,snapshot,0));receipt(j,1,"task_context","succeeded");
  receipt(j,2,"select_briefing_topic","STARTED");BriefingP0TestPlanning.select(agents,j,"INSIGHT",false);receipt(j,2,"select_briefing_topic","succeeded");
  receipt(j,3,"deliver_briefing","STARTED");return j;
 }
 void receipt(ConversationService.Job j,int sequence,String name,String status){agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(sequence,name,status));}
 BriefingContentService.Request card(String title,String summary){return new BriefingContentService.Request(null,title,summary,List.of("本次查看的记录包括前期、本期和其他期间，不能混合认定当期收款。","建议核对所选期间，再决定需要哪些收款凭证。"),"INSIGHT",new BriefingPresentationPolicy.Presentation("briefing-presentation-v1","EDITORIAL",null,null,null,List.of()));}
 @Test void automaticDeliveryRejectsTechnicalInventoryBeforePersistingCard(){var j=start();var requests=List.of(card("收款明细数据集结构概览","收款数据包含三个字段，需要进行进一步分析。"),card("部分记录标记已取消","部分记录显示 canceled，仍需进一步核实业务状态。"),card("收款记录中定金占比高","收款记录多数为定金，需要关注订单转化。"));var codes=List.of("BRIEFING_NO_BUSINESS_INSIGHT","BRIEFING_INTERNAL_LANGUAGE","BRIEFING_UNVERIFIED_QUANTITY");for(int i=0;i<requests.size();i++){var r=requests.get(i);var ex=assertThrows(IdentityException.class,()->agents.deliverBriefing(j.id(),j.token(),r));assertEquals(422,ex.status);assertEquals(codes.get(i),ex.code);}assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_artifacts WHERE task_id=? AND filename LIKE 'briefing-%'",Integer.class,j.id()));assertEquals(0,db.queryForObject("SELECT count(*) FROM briefing_content_keys WHERE task_id=?",Integer.class,j.id()));}
 @Test void supportedIndividualObservationPassesAndNoCalculationIsClaimed(){var j=start();var r=agents.deliverBriefing(j.id(),j.token(),card("收款比较需先选定期间","查看的收款记录含前期、本期和其他期间，需要先确定比较范围。"));assertNotNull(r);var documents=db.queryForList("SELECT content FROM conversation_artifacts WHERE task_id=? AND filename LIKE 'briefing-%'",byte[].class,j.id());assertEquals(1,documents.size());var content=json.readTree(documents.getFirst());assertTrue(content.path("calculationArtifactId").isNull());assertTrue(content.path("chart").isNull());assertEquals(snapshot.toString(),content.at("/datasetSource/snapshotId").asString());}
 @Test void futureMeasurementSuggestionIsNotMisclassifiedAsStatisticalClaim(){var r=card("部分收款记录需要核实","建议统计定金转化比例，目前不能判断是否增长。");assertDoesNotThrow(()->BriefingEditorialQuality.validate(r,true,true,false));assertDoesNotThrow(()->BriefingEditorialQuality.validate(card("业务报道显示同比增长","有依据的公开报道显示同比增长，需要说明统计范围。"),true,false,false));assertThrows(IdentityException.class,()->BriefingEditorialQuality.validate(card("已核实金额变化","多数记录为定金，存在需要进一步核实的业务问题。"),true,true,true));}
}
