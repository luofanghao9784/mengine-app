package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.audience.WorkAudienceService;
import java.util.*;
final class BriefingP0TestPlanning {
 static void select(AgentTaskService agents,ConversationService.Job j,String type,boolean calculation){
  agents.selectTopic(j.id(),j.token(),request(agents,j,type,calculation));
 }
 static AgentTaskService.TopicSelection request(AgentTaskService agents,ConversationService.Job j,String type,boolean calculation){
  var context=agents.check(j.id(),j.token());var audience=(WorkAudienceService.Context)context.get("workAudience");
  var topic=new AgentTaskService.TopicCandidate("核查当前已授权期间的收款事实","固定快照与已发布方法",calculation,"首次形成此口径基线",type,"核对收款","BRIEFING","支持凭证核查");
  var item=new BriefingEditorialPlan.Item("responsibilities","receipts","当前获权范围","固定期间","NARRATIVE","EMIT",-1,"以核验事实支持岗位工作");
  String batch=Objects.toString(context.get("editorialBatchId"),"");
  return new AgentTaskService.TopicSelection(List.of(topic),0,new BriefingEditorialPlan.Plan(batch.isBlank()?UUID.randomUUID():UUID.fromString(batch),audience.key(),List.of(item)));
 }
}
