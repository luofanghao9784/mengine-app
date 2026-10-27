package com.dreamcore.workspace;
import com.dreamcore.workspace.governance.*;
import com.dreamcore.workspace.identity.IdentityService;
import com.dreamcore.workspace.material.MaterialService;
import com.dreamcore.workspace.knowledge.*;
import java.util.*;
import java.nio.file.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

/** Explicit opt-in paid acceptance: isolated synthetic business data, real engine and provider. */
@org.springframework.boot.test.context.SpringBootTest(properties={"dreamcore.knowledge.enabled=true","dreamcore.knowledge.initial-delay-ms=3600000"})
@EnabledIfEnvironmentVariable(named="LIVE_GOVERNANCE_BASE",matches="http://127\\.0\\.0\\.1:[0-9]+")
class LiveGovernanceAcceptanceTest extends NativeGovernanceFlowIntegrationTest {
 @Autowired AutomaticGovernanceService automatic;
 @Autowired MaterialService materials;
 @Autowired KnowledgeService knowledge;
 @Autowired com.dreamcore.workspace.scene.NativeKnowledgeService star;
 @Test void realDatasetAndMaterialReviewReachNativePublication(@org.junit.jupiter.api.io.TempDir Path dir)throws Exception {
  background();var json=new JsonMapper();String proof="合成企业已确认：本表一行对应一张账单，编号是账单唯一标识，必须非空且按文本保存；本合成验收来源只允许编号001。";
  UUID previousDataset=dataset;dataset=UUID.randomUUID();UUID newSnapshot=UUID.randomUUID();
  db.update("INSERT INTO business_datasets(id,tenant_id,connection_id,workspace_id,dataset_key,name,column_names,field_definitions) VALUES (?,?,?,?,'confirmed-live-fixture','合成来源已确认账单','[\"编号\"]'::jsonb,?::jsonb)",dataset,tenant,connection,space,json.writeValueAsString(List.of(Map.of("column","编号","type","text","meaning","一张账单的唯一标识，必须非空且按文本保存","unit","","evidence",proof,"status","SOURCE_DOCUMENTED"))));
  db.update("INSERT INTO dataset_snapshots(id,tenant_id,connection_id,dataset_id,run_id,version,data_rows,row_count,collected_at) SELECT ?,tenant_id,connection_id,?,run_id,1,data_rows,row_count,collected_at FROM dataset_snapshots WHERE id=(SELECT current_snapshot FROM business_datasets WHERE id=?)",newSnapshot,dataset,previousDataset);
  db.update("UPDATE business_datasets SET current_snapshot=? WHERE id=?",newSnapshot,dataset);
  var evidence=Map.of("tenantId",tenant.toString(),"entries",List.of(Map.of("datasetId",dataset.toString(),"column","编号","sourceMetadata",Map.of("definition",proof))),"schema",List.of(Map.of("datasetId",dataset.toString(),"kind","column","name","编号","type","text","key","PRI","nullable","NO"),Map.of("datasetId",dataset.toString(),"kind","value-rule","id","synthetic-id-domain","column","编号","type","ENUM","nullable",false,"values",List.of("001"),"evidence",proof)));
  Path file=dir.resolve("source.json");Files.writeString(file,json.writeValueAsString(evidence));
  ReflectionTestUtils.setField(jobs,"evidencePath",file.toString());ReflectionTestUtils.setField(jobs,"automaticTenants",tenant.toString());
  String priorBase=(String)ReflectionTestUtils.getField(dispatcher,"base"),priorToken=(String)ReflectionTestUtils.getField(dispatcher,"token");
  ReflectionTestUtils.setField(dispatcher,"base",System.getenv("LIVE_GOVERNANCE_BASE"));ReflectionTestUtils.setField(dispatcher,"token",System.getenv("LIVE_GOVERNANCE_TOKEN"));
  try {
   UUID snapshot=db.queryForObject("SELECT current_snapshot FROM business_datasets WHERE id=?",UUID.class,dataset);
   var receipt=Map.of("scopeHash","a".repeat(64),"kind","export-validation","snapshotId",snapshot.toString(),"rowCount",1,"columns",List.of("编号"),"candidateKeyColumns",List.of("编号"),"rowsSha256",IdentityService.hash("[[\"001\"]]"));
   db.update("INSERT INTO collection_snapshot_receipts(snapshot_id,tenant_id,dataset_id,receipt) VALUES (?,?,?,?::jsonb)",snapshot,tenant,dataset,json.writeValueAsString(receipt));
   String definition=json.writeValueAsString(Map.of("columns",List.of("编号"),"scopeHash","a".repeat(64),"entries",evidence.get("entries"),"schema",evidence.get("schema")));
   var contract=new com.dreamcore.workspace.collection.CollectionAdapter.SourceContract("1.0",tenant,dataset,1,IdentityService.hash(definition),definition);
   db.update("UPDATE collection_snapshot_receipts SET source_contract=?::jsonb WHERE snapshot_id=?",json.writeValueAsString(contract),snapshot);
   assertTrue(automatic.reconcile(owner,tenant,"DATASET",dataset));assertTrue(dispatcher.once());
   assertEquals("SUCCEEDED",db.queryForObject("SELECT d.state FROM governance_model_dispatch d JOIN governance_model_jobs j ON j.id=d.job_id WHERE j.tenant_id=? AND j.kind='DATASET'",String.class,tenant));
   automatic.reconcile(owner,tenant,"DATASET",dataset);assertTrue(jobs.datasetKnowledgeReady(owner,tenant,dataset),jobs.analysisReadiness(owner,tenant,dataset).reason());
   var upload=materials.upload(owner,tenant,space,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","合成验收制度.txt","text/plain","合成企业制度：收入必须以实际确认记录为准，不能只按订单创建认定到账。每笔收入应保留来源与确认日期。".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
   var parse=knowledge.claim();assertNotNull(parse);var input=knowledge.input(parse);
   Path root=Path.of("").toAbsolutePath();if(root.endsWith("api"))root=root.getParent().getParent();Path parser=root.resolve("workers/parser");if(Files.isSymbolicLink(parser.resolve(".venv")))parser=parser.resolve(".venv").toRealPath().getParent();
   var parsed=new LocalDocumentParser(parser.toString()).parse(input.filename(),input.bytes());assertEquals("READY",parsed.status());knowledge.finish(parse,parsed);
   assertTrue(automatic.reconcile(owner,tenant,"MATERIAL",upload.id()));assertTrue(dispatcher.once());
   assertEquals("SUCCEEDED",db.queryForObject("SELECT d.state FROM governance_model_dispatch d JOIN governance_model_jobs j ON j.id=d.job_id WHERE j.tenant_id=? AND j.kind='MATERIAL'",String.class,tenant));
   automatic.reconcile(owner,tenant,"MATERIAL",upload.id());assertTrue(jobs.materialAnalysisReady(owner,tenant,upload.id()));assertTrue(star.snapshot(owner,tenant).path("items").size()>0);
   var usage=db.queryForList("SELECT j.kind,u.execution_class,u.state,u.model_name,u.model_calls,u.input_tokens,u.output_tokens FROM governance_model_usage u JOIN governance_model_jobs j ON j.id=u.job_id WHERE j.tenant_id=? ORDER BY j.kind",tenant);
   assertEquals(2,usage.size());for(var u:usage){assertEquals("live",u.get("execution_class"));assertEquals("RETURNED",u.get("state"));assertEquals(1L,((Number)u.get("model_calls")).longValue());}
   Files.writeString(Path.of(System.getenv("LIVE_GOVERNANCE_RECEIPT")),json.writeValueAsString(Map.of("passed",true,"syntheticData",true,"usage",usage,"datasetReady",true,"materialReady",true,"publishedKnowledge",star.snapshot(owner,tenant).path("items").size())));
  }finally{ReflectionTestUtils.setField(jobs,"evidencePath","");ReflectionTestUtils.setField(jobs,"automaticTenants","");ReflectionTestUtils.setField(dispatcher,"base",priorBase);ReflectionTestUtils.setField(dispatcher,"token",priorToken);}
 }
}
