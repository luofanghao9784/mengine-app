package com.dreamcore.workspace;
import com.dreamcore.workspace.governance.GovernanceModelService;
import com.dreamcore.workspace.identity.IdentityService;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;
class DatasetSemanticGovernanceIntegrationTest extends NativeGovernanceFlowIntegrationTest {
 @Test void currentSnapshotNeedsModelReviewEvenWithStablePublishedSourceDefinitions(@org.junit.jupiter.api.io.TempDir java.nio.file.Path directory) throws Exception {
  background();String proof="合成企业负责人确认：编号是本业务导出的唯一标识，按文本保存。";
  var column=Map.of("datasetId",dataset.toString(),"kind","column","name","编号","type","text","key","PRI","nullable","NO");
  var file=directory.resolve("source.json");java.nio.file.Files.writeString(file,new JsonMapper().writeValueAsString(Map.of("tenantId",tenant.toString(),"entries",List.of(Map.of("datasetId",dataset.toString(),"column","编号","sourceMetadata",Map.of("definition",proof))),"schema",List.of(column))));
  ReflectionTestUtils.setField(jobs,"evidencePath",file.toString());ReflectionTestUtils.setField(jobs,"automaticTenants",tenant.toString());
  try {
   UUID current=db.queryForObject("SELECT current_snapshot FROM business_datasets WHERE id=?",UUID.class,dataset);receipt(current,"001");
   var fields=List.of(Map.of("column","编号","decision","REVISE","meaning","企业账单唯一标识，按文本保存","unit","","evidence",proof));
   var output=new LinkedHashMap<String,Object>(Map.of("title","有依据的业务口径","summary","只对声明规则进行检查","limitations",List.of("未核验资金到账"),"fields",fields,"evidence",List.of(),"knowledge",List.of()));
   UUID first=publishReview(output);
   assertEquals("SOURCE_MODEL_REVIEW_REQUIRED",jobs.analysisReadiness(owner,tenant,dataset).reason());assertFalse(jobs.datasetKnowledgeReady(owner,tenant,dataset));
   output.put("qualityReview",Map.of("state","USABLE","summary","语义与本批确定性检查一致，未扩大已声明范围。","citations",List.of(Map.of("locator","编号","quote",proof))));
   UUID reviewed=publishReview(output);
   assertNotEquals(first,reviewed);assertTrue(jobs.analysisReadiness(owner,tenant,dataset).ready());assertTrue(jobs.datasetKnowledgeReady(owner,tenant,dataset));
   assertEquals("MODEL_DETERMINED",db.queryForObject("SELECT package->'items'->0->'fields'->0->>'status' FROM native_governance_releases WHERE id=?",String.class,reviewed));
   UUID run=UUID.randomUUID(),next=UUID.randomUUID();
   db.update("INSERT INTO collection_runs(id,tenant_id,connection_id,execution_epoch,trigger_kind,status) VALUES (?,?,?,0,'SCHEDULED','SUCCEEDED')",run,tenant,connection);
   db.update("INSERT INTO dataset_snapshots(id,tenant_id,connection_id,dataset_id,run_id,version,data_rows,row_count,collected_at) VALUES (?,?,?,?,?,2,'[[\"002\"]]'::jsonb,1,now())",next,tenant,connection,dataset,run);
   db.update("UPDATE business_datasets SET current_snapshot=? WHERE id=?",next,dataset);receipt(next,"002");
   assertEquals("SOURCE_MODEL_REVIEW_REQUIRED",jobs.analysisReadiness(owner,tenant,dataset).reason());assertFalse(jobs.datasetKnowledgeReady(owner,tenant,dataset));
  } finally {ReflectionTestUtils.setField(jobs,"evidencePath","");ReflectionTestUtils.setField(jobs,"automaticTenants","");}
 }
 private UUID publishReview(Map<String,Object> output){
  var job=jobs.execute(owner,tenant,new GovernanceModelService.Execute(UUID.randomUUID(),"DATASET",dataset,"SYSTEM_MODEL"));UUID id=(UUID)job.get("id");var request=(Map<String,Object>)job.get("request");assertTrue(request.get("prompt").toString().contains("表locator必须为sourceEvidence对应column"));
  assertEquals("DRAFT_READY",jobs.engineAnswer(owner,tenant,id,new GovernanceModelService.Answer(UUID.randomUUID(),1,request.get("inputHash").toString(),"SYSTEM_MODEL",output)).get("state"));
  db.update("UPDATE governance_model_dispatch SET state='SUCCEEDED' WHERE job_id=?",id);jobs.publish(owner,tenant,id,new GovernanceModelService.Publish(2,request.get("inputHash").toString()));return id;
 }
 private void receipt(UUID snapshot,String value){
  var export=Map.of("scopeHash","a".repeat(64),"kind","export-validation","snapshotId",snapshot.toString(),"rowCount",1,"columns",List.of("编号"),"candidateKeyColumns",List.of("编号"),"rowsSha256",IdentityService.hash(new JsonMapper().writeValueAsString(List.of(List.of(value)))));
  db.update("INSERT INTO collection_snapshot_receipts(snapshot_id,tenant_id,dataset_id,receipt) VALUES (?,?,?,?::jsonb)",snapshot,tenant,dataset,new JsonMapper().writeValueAsString(export));
 }
}
