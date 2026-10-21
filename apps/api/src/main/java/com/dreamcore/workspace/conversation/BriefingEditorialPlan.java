package com.dreamcore.workspace.conversation;

import com.dreamcore.workspace.audience.WorkAudienceService;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;

/** Editorial decisions never grant source access or supply calculated facts. */
public final class BriefingEditorialPlan {
 public record Item(String goalRef,String questionKey,String scope,String period,String shape,String decision,Integer mergeInto,String reason) {}
 public record Plan(UUID batchId,String audienceKey,List<Item> items) {}
 private static IdentityException error(String code){return new IdentityException(422,code);}
 public static void validate(Plan plan,List<AgentTaskService.TopicCandidate> candidates,int selected,WorkAudienceService.Context audience){
  if(plan==null||plan.batchId()==null||!Objects.equals(plan.audienceKey(),audience.key())||plan.items()==null||plan.items().size()!=candidates.size())throw error("BRIEFING_EDITORIAL_PLAN_REQUIRED");
  var keys=new HashSet<String>();
  for(int i=0;i<plan.items().size();i++){
   var p=plan.items().get(i);var c=candidates.get(i);
   if(p==null)throw error("BRIEFING_EDITORIAL_PLAN_INVALID");
   for(String s:List.of(Objects.toString(p.questionKey(),""),Objects.toString(p.scope(),""),Objects.toString(p.period(),""),Objects.toString(p.reason(),"")))if(s.isBlank()||s.length()>500)throw error("BRIEFING_EDITORIAL_PLAN_INVALID");
   String goal=switch(Objects.toString(p.goalRef(),"")){case "governance"->audience.goals().governance();case "stage"->audience.goals().stage();case "responsibilities"->audience.responsibilities();default->"";};
   if(goal==null||goal.isBlank())throw error("BRIEFING_GOAL_UNAVAILABLE");
   if(!Set.of("COMPARISON","SINGLE_FACT","STEPS","OPTIONS","NEWS","NARRATIVE").contains(Objects.toString(p.shape(),"")))throw error("BRIEFING_COMPONENT_MISMATCH");
   if(!Set.of("EMIT","MERGE","SKIP").contains(Objects.toString(p.decision(),"")))throw error("BRIEFING_EDITORIAL_PLAN_INVALID");
   if("EMIT".equals(p.decision())){
    if(p.mergeInto()!=null&&p.mergeInto()!=-1||!"BRIEFING".equals(c.destination())||!keys.add(p.questionKey().strip()+"|"+p.scope().strip()+"|"+p.period().strip()))throw error("BRIEFING_OVERLAPPING_TOPICS");
   }else if("MERGE".equals(p.decision())){
    if(p.mergeInto()==null||p.mergeInto()<0||p.mergeInto()>=plan.items().size()||p.mergeInto()==i)throw error("BRIEFING_MERGE_INVALID");
    var target=plan.items().get(p.mergeInto());
    if(target==null||!"EMIT".equals(target.decision())||!Objects.equals(target.scope(),p.scope())||!Objects.equals(target.period(),p.period()))throw error("BRIEFING_MERGE_INVALID");
   }else if(p.mergeInto()!=null&&p.mergeInto()!=-1)throw error("BRIEFING_MERGE_INVALID");
   if("COMPARISON".equals(p.shape())||"SINGLE_FACT".equals(p.shape())){if(!c.requiresCalculation())throw error("BRIEFING_CALCULATION_REQUIRED");if(!"DATA".equals(c.businessType()))throw error("BRIEFING_COMPONENT_MISMATCH");}
   if("STEPS".equals(p.shape())&&!"SUGGESTION".equals(c.businessType())||"NEWS".equals(p.shape())&&!"INFO".equals(c.businessType())||"OPTIONS".equals(p.shape())&&!Set.of("INSIGHT","SUGGESTION").contains(c.businessType()))throw error("BRIEFING_COMPONENT_MISMATCH");
  }
  if("MERGE".equals(plan.items().get(selected).decision())||"SKIP".equals(plan.items().get(selected).decision())&&"BRIEFING".equals(candidates.get(selected).destination()))throw error("BRIEFING_TOPIC_NOT_DELIVERABLE");
 }
 public static void delivery(Item item,AgentTaskService.TopicCandidate topic,BriefingContentService.Request request){
  if(!Objects.equals(topic.businessType(),request.businessType()))throw error("BRIEFING_TYPE_MISMATCH");
  if(topic.requiresCalculation()&&request.calculationArtifactId()==null)throw error("BRIEFING_CALCULATION_REQUIRED");
  var p=request.presentation();
  String layout=switch(item.shape()){case "STEPS"->"STEPS";case "OPTIONS"->"COMPARISON";case "NEWS"->"SOURCE";case "SINGLE_FACT"->"KEY_METRIC";default->"EDITORIAL";};
  if(p==null||!layout.equals(p.layout()))throw error("BRIEFING_COMPONENT_MISMATCH");
  if("COMPARISON".equals(item.shape())&&!Set.of("GROUPED_BAR","DUMBBELL","CURRENT_BAR","TABLE").contains(Objects.toString(p.chartStyle(),"")))throw error("BRIEFING_COMPONENT_MISMATCH");
 }
 private BriefingEditorialPlan(){}
}
