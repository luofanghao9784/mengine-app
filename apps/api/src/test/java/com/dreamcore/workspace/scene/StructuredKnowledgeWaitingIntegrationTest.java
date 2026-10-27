package com.dreamcore.workspace.scene;

import com.dreamcore.workspace.governance.GovernanceModelService;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.knowledge.DocumentParser;
import com.dreamcore.workspace.knowledge.KnowledgeService;
import com.dreamcore.workspace.material.MaterialService;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.JsonNode;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@SpringBootTest(properties={"dreamcore.knowledge.enabled=true"})
class StructuredKnowledgeWaitingIntegrationTest {
 @Autowired JdbcTemplate db;
 @Autowired NativeKnowledgeService knowledge;
 @Autowired MaterialService materials;
 @Autowired KnowledgeService parsing;
 @MockitoBean GovernanceModelService models;
 UUID tenant,actor,space,connection,dataset,snapshot,run;
 @BeforeEach void fixture(){
  tenant=UUID.randomUUID();actor=UUID.randomUUID();space=UUID.randomUUID();connection=UUID.randomUUID();dataset=UUID.randomUUID();snapshot=UUID.randomUUID();run=UUID.randomUUID();
  db.update("INSERT INTO tenants(id,name) VALUES (?,'合成来源待处理企业')",tenant);
  db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成员工','unused')",actor,actor+"@waiting.test");
  db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,actor);
  db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'合成共享空间','SHARED')",space,tenant,actor);
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",tenant,space,actor);
  db.update("INSERT INTO data_connections(id,tenant_id,name,route_label,access_summary,status,time_zone) VALUES (?,?,'合成连接','只读','获权空间','READY','UTC')",connection,tenant);
  db.update("INSERT INTO business_datasets(id,tenant_id,connection_id,workspace_id,dataset_key,name,column_names) VALUES (?,?,?,?,'waiting','待审阅数据','[\"字段\"]'::jsonb)",dataset,tenant,connection,space);
  db.update("INSERT INTO collection_runs(id,tenant_id,connection_id,execution_epoch,trigger_kind,status) VALUES (?,?,?,1,'SCHEDULED','SUCCEEDED')",run,tenant,connection);
  addSnapshot(snapshot,1);
  when(models.analysisReadiness(any(),any(),any())).thenReturn(new GovernanceModelService.AnalysisReadiness("synthetic-wait","SOURCE_MODEL_REVIEW_REQUIRED"));
 }
 void addSnapshot(UUID id,int version){
  UUID snapshotRun=run;
  if(version>1){snapshotRun=UUID.randomUUID();db.update("INSERT INTO collection_runs(id,tenant_id,connection_id,execution_epoch,trigger_kind,status) VALUES (?,?,?,1,'SCHEDULED','SUCCEEDED')",snapshotRun,tenant,connection);}
  db.update("INSERT INTO dataset_snapshots(id,tenant_id,connection_id,dataset_id,run_id,version,data_rows,row_count,collected_at) VALUES (?,?,?,?,?,?,?::jsonb,1,now())",id,tenant,connection,dataset,snapshotRun,version,"[[\"PRIVATE_RAW_ROW_SENTINEL\"]]");
  db.update("UPDATE business_datasets SET current_snapshot=? WHERE tenant_id=? AND id=?",id,tenant,dataset);
 }
 @AfterEach void cancelFixtureJobs(){db.update("UPDATE knowledge_runs SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);}
 JsonNode waiting(JsonNode response){return response.path("tabs").get(1).path("items");}
 @Test void filteredDatasetBecomesPendingMetadataCardAndExistingSourceActionWorks(){
  var response=knowledge.snapshot(actor,tenant);
  assertEquals(0,response.path("items").size());assertEquals(1,waiting(response).size());
  var card=waiting(response).get(0);assertEquals("dataset-"+dataset,card.path("id").asText());
  assertEquals("STRUCTURED",card.path("sourceCategory").asText());assertTrue(card.path("why").asText().contains("模型审阅"));
  assertEquals(snapshot.toString(),card.path("sources").get(0).path("versionId").asText());assertEquals("v1",card.path("sources").get(0).path("version").asText());
  assertEquals("查看来源",card.path("actions").get(0).asText());assertFalse(response.toString().contains("PRIVATE_RAW_ROW_SENTINEL"));
  var detail=knowledge.source(actor,tenant,"dataset-"+dataset);assertEquals("返回知识",detail.path("actions").get(0).asText());
  assertEquals(snapshot.toString(),detail.path("sources").get(0).path("versionId").asText());
 }
 @Test void reviewedDatasetWithoutKnowledgeExplainsGenerationWaitAndVersionChangeIsImmediate(){
  when(models.datasetKnowledgeReady(actor,tenant,dataset)).thenReturn(true);
  var before=knowledge.snapshot(actor,tenant);assertEquals(1,waiting(before).size());assertTrue(waiting(before).get(0).path("why").asText().contains("等待生成"));
  UUID next=UUID.randomUUID();addSnapshot(next,2);when(models.datasetKnowledgeReady(actor,tenant,dataset)).thenReturn(false);
  var after=knowledge.snapshot(actor,tenant);assertEquals("v2",waiting(after).get(0).path("sources").get(0).path("version").asText());
  assertEquals(next.toString(),waiting(after).get(0).path("sources").get(0).path("versionId").asText());
  assertNotEquals(before.path("scopeRevision").asText(),after.path("scopeRevision").asText());
 }
 @Test void uncollectedDatasetDoesNotFabricateSnapshotAndDeliveryReasonWins(){
  db.update("UPDATE business_datasets SET current_snapshot=null WHERE id=?",dataset);
  var response=knowledge.snapshot(actor,tenant);assertEquals(1,waiting(response).size());
  var card=waiting(response).get(0);assertTrue(card.path("sources").get(0).path("versionId").isNull());assertTrue(card.path("why").asText().contains("采集"));
  db.update("INSERT INTO collection_delivery_waits(tenant_id,dataset_id,run_id,reason,checked_at) VALUES (?,?,?,'SOURCE_DATA_REQUIRES_REVIEW',now())",tenant,dataset,run);
  var held=waiting(knowledge.snapshot(actor,tenant)).get(0);assertTrue(held.path("why").asText().contains("规则"));assertTrue(held.path("why").asText().contains("来源"));
 }
 @Test void revokedArchivedScrubbedAndCrossTenantDatasetsNeverLeakPendingMetadata(){
  db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,actor);
  assertEquals(0,waiting(knowledge.snapshot(actor,tenant)).size());assertThrows(IdentityException.class,()->knowledge.source(actor,tenant,"dataset-"+dataset));
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",tenant,space,actor);
  db.update("UPDATE workspaces SET archived=true WHERE id=?",space);assertEquals(0,waiting(knowledge.snapshot(actor,tenant)).size());
  db.update("UPDATE workspaces SET archived=false WHERE id=?",space);db.update("UPDATE dataset_snapshots SET data_rows='[]'::jsonb,scrubbed=true WHERE dataset_id=?",dataset);db.update("UPDATE business_datasets SET current_snapshot=null,status='WITHDRAWN',name='内容已按退出期限清理',description='',dataset_key='removed-'||id::text,column_names='[\"已清理\"]'::jsonb,field_definitions='[]'::jsonb,scrubbed=true WHERE id=?",dataset);assertEquals(0,waiting(knowledge.snapshot(actor,tenant)).size());
  UUID other=UUID.randomUUID();db.update("INSERT INTO tenants(id,name) VALUES (?,'其他合成企业')",other);db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",other,actor);
  assertEquals(0,waiting(knowledge.snapshot(actor,other)).size());assertThrows(IdentityException.class,()->knowledge.source(actor,other,"dataset-"+dataset));
 }
 @Test void uploadedTableAndOriginalDocumentProduceOnePendingSourceWithLineage(){
  var material=materials.upload(actor,tenant,space,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","合成表.csv","text/csv","编号\n001".getBytes(StandardCharsets.UTF_8)));
  var job=parsing.claim();assertNotNull(job);assertEquals(tenant,job.tenant());
  var structured=new DocumentParser.Structured("READY","FILE_TABLE_VALIDATED",List.of("编号"),List.of(List.of("001")),List.of("text"));
  parsing.finish(job,new DocumentParser.Result("synthetic-parser","READY",List.of(),List.of(new DocumentParser.Fragment("表格","编号 001","TABLE")),structured));
  UUID derived=db.queryForObject("SELECT dataset_id FROM file_table_sources WHERE tenant_id=? AND material_id=?",UUID.class,tenant,material.id());
  var pending=waiting(knowledge.snapshot(actor,tenant));assertEquals(2,pending.size());
  var cards=new ArrayList<JsonNode>();pending.forEach(cards::add);
  var upload=cards.stream().filter(n->n.path("id").asText().equals("dataset-"+derived)).findFirst().orElseThrow();
  assertEquals("SHARED_UPLOAD",upload.path("sourceCategory").asText());assertEquals(material.id().toString(),upload.path("sources").get(0).path("materialId").asText());
  assertTrue(cards.stream().noneMatch(n->n.path("id").asText().equals("material-"+material.id())));
 }
}
