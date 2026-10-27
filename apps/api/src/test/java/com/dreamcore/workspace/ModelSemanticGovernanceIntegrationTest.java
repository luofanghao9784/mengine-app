package com.dreamcore.workspace;
import com.dreamcore.workspace.governance.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.util.ReflectionTestUtils;
import static org.junit.jupiter.api.Assertions.*;
class ModelSemanticGovernanceIntegrationTest extends GovernanceModelIntegrationTest {
 @Autowired AutomaticGovernanceService automatic;
 @Autowired com.dreamcore.workspace.scene.NativeKnowledgeService knowledgeProjection;
 @Test void currentMaterialReviewPublishesOnlyAfterValidatedModelAndFullParse() {
  configure();seedBackground();db.update("INSERT INTO tenant_governance(tenant_id,owner_id) VALUES (?,?)",tenant,owner);
  var file=upload(space,"语义检查合成资料.txt","合成规则：收入必须以实际确认记录为准，不能只按订单创建认定到账。");finish(file);
  assertFalse(jobs.materialAnalysisReady(owner,tenant,file.material()));
  assertTrue(automatic.reconcile(owner,tenant,"MATERIAL",file.material()));
  assertFalse(automatic.reconcile(owner,tenant,"MATERIAL",file.material()));
  UUID id=db.queryForObject("SELECT id FROM governance_model_jobs WHERE tenant_id=?",UUID.class,tenant);
  var req=(Map<String,Object>)jobs.detail(owner,tenant,id).get("request");
  var context=(Map<String,Object>)req.get("context");var fragment=(Map<String,Object>)((List<?>)context.get("fragments")).getFirst();
  String quote="收入必须以实际确认记录为准";var citation=Map.of("locator",fragment.get("id").toString(),"quote",quote);
  var output=new LinkedHashMap<String,Object>(Map.of("title","合成规则治理","summary","实际确认是认定收入的依据。","limitations",List.of("仅合成数据，未核实真实到账。"),"fields",List.of(),"evidence",List.of(Map.of("chunkId",fragment.get("id"),"quote",quote)),"knowledge",List.of(Map.of("title","收入核验边界","body","订单创建不能作为已经到账的证明，须核对实际确认记录。","citations",List.of(citation))),"qualityReview",Map.of("state","USABLE","summary","当前完整资料说明与引用一致，保留真实到账限制。","citations",List.of(citation))));
  assertEquals("DRAFT_READY",jobs.engineAnswer(owner,tenant,id,new GovernanceModelService.Answer(UUID.randomUUID(),1,req.get("inputHash").toString(),"SYSTEM_MODEL",output)).get("state"));
  assertFalse(jobs.materialAnalysisReady(owner,tenant,file.material()));
  assertEquals(0,knowledgeProjection.snapshot(owner,tenant).path("items").size());
  db.update("UPDATE governance_model_dispatch SET state='SUCCEEDED' WHERE job_id=?",id);
  automatic.reconcile(owner,tenant,"MATERIAL",file.material());
  assertTrue(jobs.materialAnalysisReady(owner,tenant,file.material()));
  assertEquals(1,knowledgeProjection.snapshot(owner,tenant).path("items").size());
  assertEquals("SYSTEM_MODEL",db.queryForObject("SELECT package->>'producer' FROM native_material_releases WHERE id=?",String.class,id));
  automatic.reconcile(owner,tenant,"MATERIAL",file.material());
  assertEquals(1,db.queryForObject("SELECT count(*) FROM governance_model_jobs WHERE tenant_id=?",Integer.class,tenant));
  db.update("UPDATE knowledge_runs SET status='PARTIAL' WHERE id=?",UUID.fromString(context.get("runId").toString()));
  assertFalse(jobs.materialAnalysisReady(owner,tenant,file.material()));assertEquals(0,knowledgeProjection.snapshot(owner,tenant).path("items").size());
  db.update("UPDATE knowledge_runs SET status='READY',generation=generation+1 WHERE id=?",UUID.fromString(context.get("runId").toString()));
  assertFalse(jobs.materialAnalysisReady(owner,tenant,file.material()));
  denied(403,()->jobs.materialAnalysisReady(owner,other,file.material()));
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);denied(404,()->jobs.materialAnalysisReady(owner,tenant,file.material()));
 }
 @Test void failedAutomaticPaidAttemptIsNotRequeuedAndNewVersionGetsItsOwnJob() {
  configure();seedBackground();db.update("INSERT INTO tenant_governance(tenant_id,owner_id) VALUES (?,?)",tenant,owner);
  var file=upload(space,"失败合成资料.txt","合成资料：模型失败后必须等待明确重试授权，不能自动重复付费调用。");finish(file);
  assertTrue(automatic.reconcile(owner,tenant,"MATERIAL",file.material()));
  db.update("UPDATE governance_model_jobs SET state='FAILED',error_code='EXECUTION_OUTCOME_UNKNOWN' WHERE tenant_id=?",tenant);
  db.update("UPDATE governance_model_dispatch SET state='FAILED',error_code='EXECUTION_OUTCOME_UNKNOWN' WHERE job_id IN (SELECT id FROM governance_model_jobs WHERE tenant_id=?)",tenant);
  for(int i=0;i<3;i++)assertFalse(automatic.reconcile(owner,tenant,"MATERIAL",file.material()));
  assertEquals(1,db.queryForObject("SELECT count(*) FROM governance_model_jobs WHERE tenant_id=?",Integer.class,tenant));
  db.update("UPDATE knowledge_runs SET generation=generation+1 WHERE tenant_id=?",tenant);
  assertTrue(automatic.reconcile(owner,tenant,"MATERIAL",file.material()));
  assertEquals(2,db.queryForObject("SELECT count(*) FROM governance_model_jobs WHERE tenant_id=?",Integer.class,tenant));
 }
}
