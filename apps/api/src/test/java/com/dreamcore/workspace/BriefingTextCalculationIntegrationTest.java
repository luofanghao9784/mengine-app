package com.dreamcore.workspace;

import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class BriefingTextCalculationIntegrationTest extends DatasetCalculationFixture {
    ConversationService.Job start() {
        db.update("INSERT INTO work_role_profiles(tenant_id,account_id,responsibilities,revision,changed_by) VALUES (?,?,'核对收款与凭证',1,?) ON CONFLICT DO NOTHING",tenant,owner,owner);
        var j=task(null,"AUTHORIZED_LIBRARY");
        agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("task_context","compare_dataset","deliver_briefing","select_briefing_topic")));
        receipt(j,1,"task_context","STARTED");call(j,request("dataset_search",null,null,0));receipt(j,1,"task_context","succeeded");
        return j;
    }
    void receipt(ConversationService.Job j,int n,String tool,String status){agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(n,tool,status));}
    UUID calculate(ConversationService.Job j) {
        receipt(j,2,"compare_dataset","STARTED");
        var value=json.valueToTree(agents.compareDataset(j.id(),j.token(),new DatasetCalculationService.Request(dataset,snapshot,"门店","期间","收款（元）","前期","本期")));
        assertEquals("1.20",value.at("/calculation/totals/current").asString());
        receipt(j,2,"compare_dataset","succeeded");receipt(j,3,"deliver_briefing","STARTED");
        return UUID.fromString(value.at("/artifact/id").asString());
    }
    BriefingContentService.Request card(UUID calculation,String type) {
        return new BriefingContentService.Request(calculation,"两店本期确认收款共一点二元","两店本期确认收款共一点二元，不能视为银行到账。",List.of("固定期间的合成收款较前期增加，原因仍需核对业务依据。","建议财务核对相应凭证，未核实前不要认定实际银行到账。"),type,
            new BriefingPresentationPolicy.Presentation("briefing-presentation-v1","EDITORIAL",null,null,null,List.of()));
    }
    @Test void textTypesRetainVerifiedCalculationWithoutChartAndReplayIsImmutable() {
        for(String type:List.of("INSIGHT","SUGGESTION","RESULT")) {
            var j=start();var calculation=calculate(j);var request=card(calculation,type);
            var result=agents.deliverBriefing(j.id(),j.token(),request);
            assertEquals("PREPARED",result.get("status"));assertEquals(result,agents.deliverBriefing(j.id(),j.token(),request));
            var document=json.readTree(db.queryForObject("SELECT content FROM conversation_artifacts WHERE id=?",byte[].class,result.get("artifactId")));
            assertEquals(type,document.path("businessType").asString());assertTrue(document.path("chart").isNull());
            assertEquals(calculation.toString(),document.path("calculationArtifactId").asString());
            assertEquals(snapshot.toString(),document.at("/datasetSource/snapshotId").asString());
            assertEquals(6,document.at("/datasetBasis/matchedRows").asInt()+document.at("/datasetBasis/ignoredRows").asInt());
            assertThrows(IdentityException.class,()->agents.deliverBriefing(j.id(),j.token(),card(calculation,type.equals("RESULT")?"INSIGHT":"RESULT")));
            db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE id=?",j.id());
        }
    }
    @Test void plannedAutomaticSuggestionRequiresCalculationAndPreservesItsType() {
        var j=start();var calculation=calculate(j);UUID policy=UUID.randomUUID();
        db.update("INSERT INTO briefing_generation_policies(id,tenant_id,owner_id,workspace_id,enabled) VALUES (?,?,?,?,false)",policy,tenant,owner,privateSpace);
        db.update("INSERT INTO briefing_generation_batches(id,tenant_id,owner_id,workspace_id,policy_id,policy_epoch,trigger_kind,status,task_id,audience_key) VALUES (?,?,?,?,?,1,'GENERATE_MORE','RUNNING',?,work_audience_key(?,?))",UUID.randomUUID(),tenant,owner,privateSpace,policy,j.id(),tenant,owner);
        BriefingP0TestPlanning.select(agents,j,"SUGGESTION",true);
        var missing=assertThrows(IdentityException.class,()->agents.deliverBriefing(j.id(),j.token(),card(null,"SUGGESTION")));
        assertEquals("BRIEFING_CALCULATION_REQUIRED",missing.code);
        assertEquals("PREPARED",agents.deliverBriefing(j.id(),j.token(),card(calculation,"SUGGESTION")).get("status"));
    }
    @Test void revokedWorkspaceCannotDeliverExistingCalculation() {
        var j=start();var calculation=calculate(j);
        db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);
        assertThrows(IdentityException.class,()->agents.deliverBriefing(j.id(),j.token(),card(calculation,"SUGGESTION")));
    }
    @Test void aReceiptFromAnotherAttemptIsRejected() {
        var j=start();var calculation=calculate(j);
        db.update("UPDATE conversation_artifacts SET attempt_number=2 WHERE id=?",calculation);
        assertEquals("BRIEFING_CALCULATION_NOT_GRANTED",assertThrows(IdentityException.class,()->agents.deliverBriefing(j.id(),j.token(),card(calculation,"INSIGHT"))).code);
    }
    @Test void alteredCalculationHashCannotBecomeTextEvidence() {
        var j=start();var calculation=calculate(j);
        db.update("UPDATE conversation_artifacts SET sha256=? WHERE id=?","0".repeat(64),calculation);
        assertEquals("BRIEFING_CALCULATION_INVALID",assertThrows(IdentityException.class,()->agents.deliverBriefing(j.id(),j.token(),card(calculation,"RESULT"))).code);
    }
    @Test void forgedOrOtherTaskCalculationNeverBecomesEvidence() {
        var first=start();var calculation=calculate(first);
        db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE id=?",first.id());
        var j=start();receipt(j,2,"deliver_briefing","STARTED");
        for(UUID id:List.of(calculation,UUID.randomUUID())) {
            var ex=assertThrows(IdentityException.class,()->agents.deliverBriefing(j.id(),j.token(),card(id,"SUGGESTION")));
            assertEquals("BRIEFING_CALCULATION_NOT_GRANTED",ex.code);
        }
        assertEquals(0,db.queryForObject("SELECT count(*) FROM briefing_content_keys WHERE task_id=?",Integer.class,j.id()));
    }
    @Test void revokedSourceAndInvalidatedSnapshotCannotBePublished() {
        var j=start();var calculation=calculate(j);
        db.update("UPDATE dataset_snapshots SET scrubbed=true,data_rows='[]'::jsonb WHERE id=?",snapshot);
        assertThrows(IdentityException.class,()->agents.deliverBriefing(j.id(),j.token(),card(calculation,"INSIGHT")));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM briefing_content_keys WHERE task_id=?",Integer.class,j.id()));
    }
    @Test void infoCannotReclassifyInternalCalculationAsNews() {
        var j=start();var calculation=calculate(j);
        assertThrows(IdentityException.class,()->agents.deliverBriefing(j.id(),j.token(),card(calculation,"INFO")));
    }
}
