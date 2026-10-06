package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class BriefingPresentationIntegrationTest extends DatasetCalculationFixture {
    ConversationService.Job start(){
        var j=task(null,"AUTHORIZED_LIBRARY");
        agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("task_context","compare_dataset","deliver_briefing")));
        receipt(j,1,"task_context","STARTED");call(j,request("dataset_search",null,null,0));receipt(j,1,"task_context","succeeded");receipt(j,2,"compare_dataset","STARTED");return j;
    }
    void receipt(ConversationService.Job j,int n,String tool,String status){agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(n,tool,status));}
    UUID calculate(ConversationService.Job j){
        var calculated=agents.compareDataset(j.id(),j.token(),new DatasetCalculationService.Request(dataset,snapshot,"门店","期间","收款（元）","前期","本期"));
        receipt(j,2,"compare_dataset","succeeded");receipt(j,3,"deliver_briefing","STARTED");return UUID.fromString(json.valueToTree(calculated).at("/artifact/id").asString());
    }
    BriefingContentService.Request card(UUID calculation,String style){return new BriefingContentService.Request(calculation,"两家门店核验收款对比","两家门店本期收款均为零点六元，应保持原统计口径。",List.of("两期收款使用固定快照计算，不从分页样本推算合计。","经营原因仍需要结合业务资料核实，不以图表代替证据。"),"DATA",new BriefingPresentationPolicy.Presentation("briefing-presentation-v1","KEY_METRIC",style,"甲","DIFFERENCE",List.of()));}
    void finish(ConversationService.Job j){receipt(j,3,"deliver_briefing","succeeded");agents.finish(j,new AgentResult("1.5","0.16.0",j.id(),j.token(),"AGENT","verification","synthetic-presentation","画报已生成。",List.of(),List.of(new AgentResult.Tool("s","task_context","succeeded"),new AgentResult.Tool("c","compare_dataset","succeeded"),new AgentResult.Tool("b","deliver_briefing","succeeded")),List.of(),4,null,List.of(),List.of(),List.of(),"COMPLETE",null));}
    @Test void presentationPersistsWithVerifiedNumbersAndRetryCannotRewriteIt(){
        var j=start();var calc=calculate(j);
        assertThrows(IdentityException.class,()->agents.deliverBriefing(j.id(),j.token(),card(calc,"PIE")));
        var result=agents.deliverBriefing(j.id(),j.token(),card(calc,"DUMBBELL"));assertEquals("PREPARED",result.get("status"));assertEquals(result,agents.deliverBriefing(j.id(),j.token(),card(calc,"DUMBBELL")));
        assertThrows(IdentityException.class,()->agents.deliverBriefing(j.id(),j.token(),card(calc,"TABLE")));
        finish(j);
        var revision=conversations.taskDetail(owner,tenant,j.conversation(),j.id()).tasks().getFirst().revision();
        var doc=agents.briefing(owner,tenant,j.conversation(),j.id(),revision,1);
        assertEquals("DUMBBELL",doc.content().presentation().chartStyle());assertEquals("甲",doc.content().presentation().focusGroup());assertEquals("0.60",doc.content().chart().rows().getFirst().current());assertEquals("0.30",doc.content().chart().rows().getFirst().difference());assertEquals(snapshot,doc.content().datasetSource().snapshotId());
        var next=start();var nextCalc=calculate(next);assertEquals("NO_NEW_CONTENT",agents.deliverBriefing(next.id(),next.token(),card(nextCalc,"TABLE")).get("status"));
        db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);
        denied(()->agents.briefing(owner,tenant,j.conversation(),j.id(),revision,1));
    }
    @Test void historicalArtifactsWithoutCompositionRemainReadable(){
        var j=start();var calc=calculate(j);var r=card(calc,"GROUPED_BAR");
        var result=agents.deliverBriefing(j.id(),j.token(),new BriefingContentService.Request(calc,r.title(),r.summary(),r.analysis(),"DATA"));finish(j);
        UUID artifact=(UUID)result.get("artifactId");var bytes=db.queryForObject("SELECT content FROM conversation_artifacts WHERE id=?",byte[].class,artifact);
        var node=(tools.jackson.databind.node.ObjectNode)json.readTree(bytes);node.remove("presentation");byte[] legacy=json.writeValueAsBytes(node);
        var sha=java.util.HexFormat.of().formatHex(hash(legacy));db.update("UPDATE conversation_artifacts SET content=?,sha256=? WHERE id=?",legacy,sha,artifact);
        var revision=conversations.taskDetail(owner,tenant,j.conversation(),j.id()).tasks().getFirst().revision();assertNull(agents.briefing(owner,tenant,j.conversation(),j.id(),revision,1).content().presentation());
    }
    byte[] hash(byte[] bytes){try{return java.security.MessageDigest.getInstance("SHA-256").digest(bytes);}catch(Exception e){throw new IllegalStateException(e);}}
}
