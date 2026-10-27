package com.dreamcore.workspace;

import com.dreamcore.workspace.governance.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import static org.junit.jupiter.api.Assertions.*;

/** Legacy private preparation is not a paid semantic attempt; uncertain native calls remain protected. */
class AutomaticGovernanceCompatibilityIntegrationTest extends GovernanceModelIntegrationTest {
 @Autowired AutomaticGovernanceService automatic;
 private File prepared(){
  configure();seedBackground();db.update("INSERT INTO tenant_governance(tenant_id,owner_id) VALUES (?,?)",tenant,owner);
  var file=upload(space,"兼容性合成资料.txt","合成规则：收入必须以实际确认记录为准，不能只按订单创建认定到账。");finish(file);return file;
 }
 private Map<String,Object> legacyOutput(Map<String,Object> request){
  var context=(Map<String,Object>)request.get("context");var fragment=(Map<String,Object>)((List<?>)context.get("fragments")).getFirst();
  String quote="收入必须以实际确认记录为准";var citation=Map.of("locator",fragment.get("id").toString(),"quote",quote);
  return new LinkedHashMap<>(Map.of("title","合成旧版草稿","summary","收入须以实际确认记录为准。","limitations",List.of("未核实真实到账。"),"fields",List.of(),"evidence",List.of(Map.of("chunkId",fragment.get("id"),"quote",quote)),"knowledge",List.of(Map.of("title","核验边界","body","不能只按订单创建认定到账，须核对实际确认记录。","citations",List.of(citation)))));
 }
 private UUID oldNative(File file){return (UUID)jobs.execute(owner,tenant,new GovernanceModelService.Execute(UUID.randomUUID(),"MATERIAL",file.material(),"SYSTEM_MODEL")).get("id");}
 private void completedWithoutReview(UUID id){
  var request=(Map<String,Object>)jobs.detail(owner,tenant,id).get("request");
  assertEquals("DRAFT_READY",jobs.engineAnswer(owner,tenant,id,new GovernanceModelService.Answer(UUID.randomUUID(),1,request.get("inputHash").toString(),"SYSTEM_MODEL",legacyOutput(request))).get("state"));
  db.update("UPDATE governance_model_dispatch SET state='SUCCEEDED' WHERE job_id=?",id);
 }
 @Test void upgradeLegacyManualDraftAndQueueSingleCurrentPolicyReview(){
  var file=prepared();UUID old=(UUID)jobs.start(owner,tenant,new GovernanceModelService.Start(UUID.randomUUID(),"MATERIAL",file.material())).get("id");
  assertTrue(automatic.reconcile(owner,tenant,"MATERIAL",file.material()));
  for(int i=0;i<3;i++)assertFalse(automatic.reconcile(owner,tenant,"MATERIAL",file.material()));
  assertEquals(2,db.queryForObject("SELECT count(*) FROM governance_model_jobs WHERE tenant_id=?",Integer.class,tenant));
  assertEquals(1,db.queryForObject("SELECT count(*) FROM governance_model_dispatch d JOIN governance_model_jobs j ON j.id=d.job_id WHERE j.tenant_id=?",Integer.class,tenant));
  assertEquals("STALE",jobs.detail(owner,tenant,old).get("state"));
  assertEquals("1.0",((Map)jobs.detail(owner,tenant,old).get("request")).get("contractVersion"));
 }
 @Test void completedOlderNativeDraftWithoutReviewGetsOneNewPolicyJob(){
  var file=prepared();UUID old=oldNative(file);completedWithoutReview(old);
  assertTrue(automatic.reconcile(owner,tenant,"MATERIAL",file.material()));
  for(int i=0;i<3;i++)assertFalse(automatic.reconcile(owner,tenant,"MATERIAL",file.material()));
  assertEquals(2,db.queryForObject("SELECT count(*) FROM governance_model_jobs WHERE tenant_id=?",Integer.class,tenant));
  assertEquals("DRAFT_READY",jobs.detail(owner,tenant,old).get("state"));
  assertEquals("SUCCEEDED",db.queryForObject("SELECT state FROM governance_model_dispatch WHERE job_id=?",String.class,old));
 }
 @Test void failedOrUncertainNativeAttemptIsNeverAutomaticallyReplayed(){
  var file=prepared();UUID old=oldNative(file);
  db.update("UPDATE governance_model_jobs SET state='FAILED',error_code='EXECUTION_OUTCOME_UNKNOWN' WHERE id=?",old);
  db.update("UPDATE governance_model_dispatch SET state='FAILED',error_code='EXECUTION_OUTCOME_UNKNOWN' WHERE job_id=?",old);
  for(int i=0;i<3;i++)assertFalse(automatic.reconcile(owner,tenant,"MATERIAL",file.material()));
  assertEquals(1,db.queryForObject("SELECT count(*) FROM governance_model_jobs WHERE tenant_id=?",Integer.class,tenant));
  assertEquals("FAILED",db.queryForObject("SELECT state FROM governance_model_dispatch WHERE job_id=?",String.class,old));
 }
 @Test void activeNativeCallIsNeverDuplicated(){
  var file=prepared();UUID old=oldNative(file);
  assertFalse(automatic.reconcile(owner,tenant,"MATERIAL",file.material()));
  assertEquals(1,db.queryForObject("SELECT count(*) FROM governance_model_jobs WHERE tenant_id=?",Integer.class,tenant));
  assertEquals("PENDING",db.queryForObject("SELECT state FROM governance_model_dispatch WHERE job_id=?",String.class,old));
 }
 @Test void malformedCurrentPolicyResultCannotTriggerEndlessPaidRechecks(){
  var file=prepared();assertTrue(automatic.reconcile(owner,tenant,"MATERIAL",file.material()));
  UUID id=db.queryForObject("SELECT id FROM governance_model_jobs WHERE tenant_id=?",UUID.class,tenant);completedWithoutReview(id);
  for(int i=0;i<3;i++)assertFalse(automatic.reconcile(owner,tenant,"MATERIAL",file.material()));
  assertEquals(1,db.queryForObject("SELECT count(*) FROM governance_model_jobs WHERE tenant_id=?",Integer.class,tenant));
 }
}
