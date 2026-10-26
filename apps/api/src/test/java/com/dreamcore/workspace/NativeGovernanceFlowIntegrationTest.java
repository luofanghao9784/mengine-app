package com.dreamcore.workspace;

import com.dreamcore.workspace.governance.*;
import com.dreamcore.workspace.profile.CompanyInformationService;
import com.dreamcore.workspace.scene.NativeFoundationService;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.json.JsonMapper;
import com.dreamcore.workspace.collection.CollectionService;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class NativeGovernanceFlowIntegrationTest {
 @Autowired JdbcTemplate db;
 @Autowired GovernanceModelService jobs;
 @Autowired GovernanceModelDispatcher dispatcher;
 @Autowired CompanyInformationService company;
 @Autowired NativeFoundationService foundation;
 @Autowired CollectionService collections;
 UUID tenant,owner,reader,space,connection,dataset;
 @BeforeEach void setup() {
  tenant=UUID.randomUUID();owner=UUID.randomUUID();reader=UUID.randomUUID();space=UUID.randomUUID();connection=UUID.randomUUID();dataset=UUID.randomUUID();
  db.update("INSERT INTO tenants(id,name) VALUES (?,'合成治理企业')",tenant);
  for(UUID actor:List.of(owner,reader)) {
   db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成人员','unused')",actor,actor+"@governance.test");
   db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,actor);
  }
  db.update("INSERT INTO tenant_governance(tenant_id,owner_id) VALUES (?,?)",tenant,owner);
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'合成数据','SHARED')",space,tenant,owner);
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true),(?,?,?,false)",tenant,space,owner,tenant,space,reader);
  db.update("INSERT INTO data_connections(id,tenant_id,name,route_label,access_summary,status,time_zone) VALUES (?,?,'合成导出','只读','本空间','READY','Asia/Shanghai')",connection,tenant);
  db.update("INSERT INTO business_datasets(id,tenant_id,connection_id,workspace_id,dataset_key,name,column_names,field_definitions) VALUES (?,?,?,?,'fixture','合成表','[\"编号\"]'::jsonb,'[{\"column\":\"编号\",\"type\":\"text\",\"meaning\":\"待核实\",\"unit\":\"\",\"evidence\":\"合成导出表头\",\"status\":\"UNKNOWN\"}]'::jsonb)",dataset,tenant,connection,space);
  UUID run=UUID.randomUUID(),snap=UUID.randomUUID();
  db.update("INSERT INTO collection_runs(id,tenant_id,connection_id,execution_epoch,trigger_kind,requested_by,status) VALUES (?,?,?,0,'MANUAL',?,'SUCCEEDED')",run,tenant,connection,owner);
  db.update("INSERT INTO dataset_snapshots(id,tenant_id,connection_id,dataset_id,run_id,version,data_rows,row_count,collected_at) VALUES (?,?,?,?,?,1,'[[\"001\"]]'::jsonb,1,now())",snap,tenant,connection,dataset,run);
  db.update("UPDATE business_datasets SET current_snapshot=? WHERE id=?",snap,dataset);
  ReflectionTestUtils.setField(jobs,"dispatchEnabled",true);
 }
 @AfterEach void cleanup() {
  db.update("UPDATE governance_model_dispatch SET state='FAILED' WHERE job_id IN(SELECT id FROM governance_model_jobs WHERE tenant_id=?) AND state<>'SUCCEEDED'",tenant);
  ReflectionTestUtils.setField(jobs,"dispatchEnabled",false);
 }
 void background() { company.change(owner,tenant,new CompanyInformationService.Change(UUID.randomUUID(),CompanyInformationService.Field.NAME,0,"ADD",null,"合成治理企业","")); }
 @SuppressWarnings("unchecked")
 @ParameterizedTest @ValueSource(booleans={false,true})
 void declaredBusinessRulesAreActuallyCheckedBeforeShowingPublishedReadiness(boolean violation,@org.junit.jupiter.api.io.TempDir java.nio.file.Path directory) throws Exception {
  background();String proof="合成企业负责人确认：编号是本业务导出的唯一标识，按文本保存。";
  var rule=Map.of("datasetId",dataset.toString(),"kind","value-rule","id","known-id","column","编号","type","ENUM","nullable",false,"values",List.of(violation?"other":"001"),"evidence",proof);
  var column=Map.of("datasetId",dataset.toString(),"kind","column","name","编号","type","text","key","PRI","nullable","NO");
  var evidence=Map.of("tenantId",tenant.toString(),"entries",List.of(Map.of("datasetId",dataset.toString(),"column","编号","sourceMetadata",Map.of("definition",proof))),"schema",List.of(column,rule));
  var file=directory.resolve("business.json");java.nio.file.Files.writeString(file,new JsonMapper().writeValueAsString(evidence));
  ReflectionTestUtils.setField(jobs,"evidencePath",file.toString());
  try {
   var job=jobs.execute(owner,tenant,new GovernanceModelService.Execute(UUID.randomUUID(),"DATASET",dataset,"SYSTEM_MODEL"));UUID id=(UUID)job.get("id");
   var req=(Map<String,Object>)job.get("request");var context=(Map<String,Object>)req.get("context");
   var checks=(Map<String,Object>)context.get("checks");assertEquals("CHECKED",checks.get("state"));
   assertEquals(violation?"VIOLATIONS":"CHECKED",((Map<?,?>)checks.get("valueValidation")).get("state"));
   var output=Map.<String,Object>of("title","有依据的业务口径","summary","只对声明规则进行检查","limitations",List.of("不代表银行到账或跨表对账"),"fields",List.of(Map.of("column","编号","decision","REVISE","meaning","企业账单唯一标识，按文本保存","unit","","evidence",proof)),"evidence",List.of(),"knowledge",List.of());
   jobs.engineAnswer(owner,tenant,id,new GovernanceModelService.Answer(UUID.randomUUID(),1,req.get("inputHash").toString(),"SYSTEM_MODEL",output));
   db.update("UPDATE governance_model_dispatch SET state='SUCCEEDED' WHERE job_id=?",id);jobs.publish(owner,tenant,id,new GovernanceModelService.Publish(2,req.get("inputHash").toString()));
   var detail=foundation.detail(owner,tenant,"dataset-"+dataset);var asset=detail.path("asset");
   assertEquals(0,asset.path("unknownFieldCount").asInt());assertEquals(violation,asset.path("needsAttention").asBoolean());
   assertEquals(!violation,asset.path("checksPassed").asBoolean());
   assertFalse(detail.path("dictionary").path("usageRules").asText().contains("未知业务含义仍需核实"));
  } finally {ReflectionTestUtils.setField(jobs,"evidencePath","");}
 }
 @SuppressWarnings("unchecked")
 @Test void exportReceiptIsVisibleToGovernanceWithoutInventingSourceConstraints(@org.junit.jupiter.api.io.TempDir java.nio.file.Path directory) throws Exception {
  background();
  UUID snapshot=db.queryForObject("SELECT current_snapshot FROM business_datasets WHERE id=?",UUID.class,dataset);
  String rowsHash=com.dreamcore.workspace.identity.IdentityService.hash("[[\"001\"]]");
  String technical="采集端将导出编号保存为文本，不证明业务标识含义";
  var evidence=Map.of("tenantId",tenant.toString(),"entries",List.of(Map.of("datasetId",dataset.toString(),"column","编号",
      "definitionScope","TECHNICAL_ONLY","sourceMetadata",Map.of("description",technical))),"schema",List.of(Map.of(
      "datasetId",dataset.toString(),"kind","export-validation","snapshotId",snapshot.toString(),
      "columns",List.of("编号"),"rowsSha256",rowsHash,"rowCount",1,"candidateKeyColumns",List.of("编号"))));
  var file=directory.resolve("evidence.json");java.nio.file.Files.writeString(file,new JsonMapper().writeValueAsString(evidence));
  ReflectionTestUtils.setField(jobs,"evidencePath",file.toString());
  try {
   var job=jobs.execute(owner,tenant,new GovernanceModelService.Execute(UUID.randomUUID(),"DATASET",dataset,"SYSTEM_MODEL"));
   var req=(Map<String,Object>)job.get("request");var context=(Map<String,Object>)req.get("context");
   var checks=(Map<String,Object>)context.get("checks");
   assertEquals("NO_SOURCE_CONSTRAINTS",checks.get("state"));
   assertEquals("CHECKED",((Map<?,?>)checks.get("exportValidation")).get("state"));
   assertFalse(context.containsKey("rows"));
   var output=Map.<String,Object>of("title","合成核验","summary","导出已核验，业务定义仍未知","limitations",List.of("不是源数据库主键证明"),
       "fields",List.of(Map.of("column","编号","decision","UNKNOWN","meaning","缺少业务定义","unit","","evidence","导出候选键不证明业务含义")),"evidence",List.of(),"knowledge",List.of());
   UUID id=(UUID)job.get("id");
   var unsupported=new LinkedHashMap<String,Object>(output);
   unsupported.put("fields",List.of(Map.of("column","编号","decision","REVISE","meaning","已核实业务编号","unit","","evidence",technical)));
   var rejected=jobs.engineAnswer(owner,tenant,id,new GovernanceModelService.Answer(UUID.randomUUID(),1,req.get("inputHash").toString(),"SYSTEM_MODEL",unsupported));
   assertEquals("FAILED",rejected.get("state"));assertEquals("GOVERNANCE_EVIDENCE_INVALID",rejected.get("error_code"));
   jobs.engineAnswer(owner,tenant,id,new GovernanceModelService.Answer(UUID.randomUUID(),2,req.get("inputHash").toString(),"SYSTEM_MODEL",output));
   db.update("UPDATE governance_model_dispatch SET state='SUCCEEDED' WHERE job_id=?",id);
   jobs.publish(owner,tenant,id,new GovernanceModelService.Publish(3,req.get("inputHash").toString()));
   var asset=foundation.detail(owner,tenant,"dataset-"+dataset).path("asset");
   assertTrue(asset.path("available").asBoolean());assertTrue(asset.path("needsAttention").asBoolean());
   assertTrue(asset.path("issues").toString().contains("导出与接收已核验"));
   assertTrue(asset.path("limitations").toString().contains("1 条、1 列逐值摘要一致"));
  } finally { ReflectionTestUtils.setField(jobs,"evidencePath",""); }
 }
 @SuppressWarnings("unchecked")
 @Test void sourceBoundDraftShowsRealProgressAndNeverGrantsReadersGovernanceRights() {
  assertEquals("BACKGROUND_REQUIRED",jobs.datasetStatus(owner,tenant,dataset).get("state"));
  assertEquals("READ_ONLY",jobs.datasetStatus(reader,tenant,dataset).get("state"));
  assertThrows(IdentityException.class,()->jobs.execute(reader,tenant,new GovernanceModelService.Execute(UUID.randomUUID(),"DATASET",dataset,"SYSTEM_MODEL")));
  background();assertEquals("NOT_STARTED",jobs.datasetStatus(owner,tenant,dataset).get("state"));
  var start=new GovernanceModelService.Execute(UUID.randomUUID(),"DATASET",dataset,"SYSTEM_MODEL");
  var job=jobs.execute(owner,tenant,start);UUID id=(UUID)job.get("id");
  assertEquals(id,jobs.execute(owner,tenant,start).get("id"));
  assertEquals("WAITING_MODEL",jobs.datasetStatus(owner,tenant,dataset).get("state"));
  assertEquals("RUNNING",foundation.detail(owner,tenant,"dataset-"+dataset).path("asset").path("stageStates").get(2).asText());
  Map<String,Object> req=(Map<String,Object>)job.get("request"),ctx=(Map<String,Object>)req.get("context");
  assertFalse(ctx.containsKey("rows"));assertFalse(ctx.toString().contains("001"));
  var output=Map.<String,Object>of("title","合成治理草稿","summary","仅核对结构，业务含义未知","limitations",List.of("没有来源约束，未确认业务口径"),"fields",List.of(Map.of("column","编号","decision","UNKNOWN","meaning","待核实业务含义","unit","","evidence","仅有导出列名，缺少业务依据")),"evidence",List.of(),"knowledge",List.of());
  var saved=jobs.engineAnswer(owner,tenant,id,new GovernanceModelService.Answer(UUID.randomUUID(),1,req.get("inputHash").toString(),"SYSTEM_MODEL",output));
  assertEquals("DRAFT_READY",saved.get("state"));
  var asset=foundation.detail(owner,tenant,"dataset-"+dataset).path("asset");
  assertEquals(3,asset.path("gate").asInt());assertFalse(asset.path("available").asBoolean());
  var publish=new GovernanceModelService.Publish(2,req.get("inputHash").toString());
  assertThrows(IdentityException.class,()->jobs.publish(owner,tenant,id,publish));
  // Isolated fixture: simulate the dispatch receipt only after testing the missing-receipt rejection.
  db.update("UPDATE governance_model_dispatch SET state='SUCCEEDED' WHERE job_id=?",id);
  assertEquals(true,jobs.publish(owner,tenant,id,publish).get("published"));
  assertEquals("PUBLISHED",jobs.datasetStatus(owner,tenant,dataset).get("state"));
  assertTrue(foundation.detail(owner,tenant,"dataset-"+dataset).path("asset").path("available").asBoolean());
  assertEquals("UNKNOWN",db.queryForObject("SELECT package->'items'->0->'fields'->0->>'status' FROM native_governance_releases WHERE id=?",String.class,id));
  company.change(owner,tenant,new CompanyInformationService.Change(UUID.randomUUID(),CompanyInformationService.Field.INDUSTRY,0,"ADD",null,"合成行业",""));
  assertEquals("STALE",jobs.datasetStatus(owner,tenant,dataset).get("state"));
  assertThrows(IdentityException.class,()->jobs.publish(owner,tenant,id,publish));
  assertFalse(foundation.detail(owner,tenant,"dataset-"+dataset).path("asset").path("available").asBoolean());
  db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,reader);
  assertThrows(IdentityException.class,()->jobs.datasetStatus(reader,tenant,dataset));
 }
 @Test void expiredExecutionIsNotAutomaticallyReplayedAndExplicitRetryKeepsTheSameJob() {
  background();var job=jobs.execute(owner,tenant,new GovernanceModelService.Execute(UUID.randomUUID(),"DATASET",dataset,"SYSTEM_MODEL"));UUID id=(UUID)job.get("id");
  db.update("UPDATE governance_model_dispatch SET state='RUNNING',lease_token=?,lease_until=now()-interval '1 minute' WHERE job_id=?",UUID.randomUUID(),id);
  ReflectionTestUtils.setField(dispatcher,"token","synthetic-no-network-token-1234567890");
  assertFalse(dispatcher.once());
  var failed=jobs.datasetStatus(owner,tenant,dataset);
  assertEquals("FAILED",failed.get("state"));assertEquals("EXECUTION_OUTCOME_UNKNOWN",failed.get("errorCode"));
  jobs.retry(owner,tenant,id,new GovernanceModelService.Refresh(((Number)failed.get("revision")).intValue()));
  assertEquals("WAITING_MODEL",jobs.datasetStatus(owner,tenant,dataset).get("state"));
 }
 @ParameterizedTest @ValueSource(strings={"FILE_EXPORT","DATABASE","PLATFORM_API"})
 @SuppressWarnings("unchecked")
 void normalizedStructuredSourcesKeepPrecisionAndUseTheSameGovernanceFlow(String sourceKind) {
  background();var json=new JsonMapper();UUID conn=UUID.randomUUID(),table=UUID.randomUUID(),run=UUID.randomUUID(),snap=UUID.randomUUID();
  var columns=sourceKind.equals("FILE_EXPORT")?List.of("外部编号","金额原值","时间原值","标签原值","启用标记")
   :sourceKind.equals("DATABASE")?List.of("pk_id","net_amount","occurred_at","attributes","enabled")
   :List.of("item.id","amount","updatedAt","metadata","active");
  var types=List.of("integer","decimal","timestamp","json","boolean");var fields=new ArrayList<Map<String,String>>();
  for(int i=0;i<columns.size();i++)fields.add(Map.of("column",columns.get(i),"type",types.get(i),"meaning","尚无业务定义","unit","","evidence","合成结构化输入","status","UNKNOWN"));
  List<List<String>> rows=List.of(List.of("9007199254740993","1234567890.123456","2026-10-25T00:00:00Z","{\"tags\":[\"synthetic\"]}","true"),Arrays.asList("9007199254740994","0",null,"{}","false"));
  db.update("INSERT INTO data_connections(id,tenant_id,name,route_label,access_summary,status,time_zone) VALUES (?,?,?,'标准化适配','本空间','READY','Asia/Shanghai')",conn,tenant,sourceKind);
  db.update("INSERT INTO business_datasets(id,tenant_id,connection_id,workspace_id,dataset_key,name,column_names,field_definitions) VALUES (?,?,?,?,'records','同名业务表',?::jsonb,?::jsonb)",table,tenant,conn,space,json.writeValueAsString(columns),json.writeValueAsString(fields));
  db.update("INSERT INTO collection_runs(id,tenant_id,connection_id,execution_epoch,trigger_kind,requested_by,status) VALUES (?,?,?,0,'MANUAL',?,'SUCCEEDED')",run,tenant,conn,owner);
  db.update("INSERT INTO dataset_snapshots(id,tenant_id,connection_id,dataset_id,run_id,version,data_rows,row_count,collected_at) VALUES (?,?,?,?,?,1,?::jsonb,2,now())",snap,tenant,conn,table,run,json.writeValueAsString(rows));
  db.update("UPDATE business_datasets SET current_snapshot=? WHERE id=?",snap,table);
  assertEquals(rows,collections.preview(owner,tenant,table,0,20).rows());
  var job=jobs.execute(owner,tenant,new GovernanceModelService.Execute(UUID.randomUUID(),"DATASET",table,"SYSTEM_MODEL"));
  var context=(Map<String,Object>)((Map<String,Object>)job.get("request")).get("context");
  assertEquals(columns,context.get("columns"));assertEquals(2,context.get("rowCount"));assertEquals(List.of(0,0,1,0,0),context.get("nullCounts"));
  assertFalse(context.containsKey("rows"));assertFalse(context.toString().contains("9007199254740993"));
  assertEquals(sourceKind,foundation.detail(owner,tenant,"dataset-"+table).path("asset").path("source").asText());
 }
}
