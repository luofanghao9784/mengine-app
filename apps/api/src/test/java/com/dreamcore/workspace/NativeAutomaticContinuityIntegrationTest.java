package com.dreamcore.workspace;

import com.dreamcore.workspace.briefing.BriefingGenerationService;
import com.dreamcore.workspace.collection.NativeGovernanceDeployment;
import com.dreamcore.workspace.governance.GovernanceModelService;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.identity.IdentityService;
import com.dreamcore.workspace.profile.CompanyInformationService;
import com.dreamcore.workspace.scene.NativeFoundationService;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.util.ReflectionTestUtils;
import static org.junit.jupiter.api.Assertions.*;

/** Synthetic source → acceptance receipt → stable definitions → deterministic checks → automatic dispatch. */
@TestPropertySource(properties="dreamcore.briefing.merge-seconds=0")
class NativeAutomaticContinuityIntegrationTest extends TaskDatasetFixture {
    @Autowired GovernanceModelService governance;
    @Autowired com.dreamcore.workspace.collection.SourceContractPublicationService sourcePublication;
    @Autowired NativeGovernanceDeployment releases;
    @Autowired CompanyInformationService company;
    @Autowired NativeFoundationService foundation;
    @Autowired BriefingGenerationService generation;
    @Autowired com.dreamcore.workspace.context.DatasetTaskContext datasetContext;
    @Autowired com.dreamcore.workspace.knowledge.DatasetKnowledgeService datasetKnowledge;
    @Autowired com.dreamcore.workspace.scene.NativeKnowledgeService knowledgeScene;
    @TempDir Path directory;
    Path evidence;
    List<Map<String,Object>> schema;
    List<Map<String,String>> declaredFields;

    @BeforeEach void declaredSource() throws Exception {
        db.update("INSERT INTO work_role_profiles(tenant_id,account_id,responsibilities,revision,changed_by) VALUES (?,?,'核对当前获权来源登记数量',1,?)",tenant,owner,owner);
        db.update("INSERT INTO tenant_governance(tenant_id,owner_id) VALUES (?,?)",tenant,owner);
        company.change(owner,tenant,new CompanyInformationService.Change(UUID.randomUUID(),CompanyInformationService.Field.NAME,0,"ADD",null,"合成自动业务企业",""));
        declaredFields=List.of(
            Map.of("column","门店","type","text","meaning","来源门店唯一标识","unit","","evidence","合成负责人确认：每行对应唯一门店","status","SOURCE_DOCUMENTED"),
            Map.of("column","数量","type","decimal","meaning","来源登记数量","unit","件","evidence","合成来源定义：数量按件登记","status","SOURCE_DOCUMENTED"));
        schema=List.of(
            Map.of("datasetId",dataset.toString(),"kind","column","name","门店","type","text","key","PRI","nullable","NO"),
            Map.of("datasetId",dataset.toString(),"kind","column","name","数量","type","decimal","key","","nullable","NO"),
            Map.of("datasetId",dataset.toString(),"kind","value-rule","id","store","column","门店","type","TEXT","nullable",false,"evidence","合成唯一门店文本定义"),
            Map.of("datasetId",dataset.toString(),"kind","value-rule","id","quantity","column","数量","type","DECIMAL","nullable",false,"evidence","合成十进制数量定义"));
        evidence=directory.resolve("source.json");writeEvidence(schema);
        ReflectionTestUtils.setField(governance,"evidencePath",evidence.toString());
        ReflectionTestUtils.setField(releases,"evidencePath",evidence.toString());
        ReflectionTestUtils.setField(datasetContext,"evidencePath",evidence.toString());
        ReflectionTestUtils.setField(governance,"dispatchEnabled",true);
        receipt(snapshot,"a".repeat(64));
    }
    void writeEvidence(List<Map<String,Object>> items) throws Exception {
        Files.writeString(evidence,json.writeValueAsString(Map.of("tenantId",tenant.toString(),"entries",declaredFields.stream().map(f->Map.of("datasetId",dataset.toString(),"column",f.get("column"),"sourceMetadata",Map.of("definition",f.get("evidence")))).toList(),"schema",items)));
    }
    @AfterEach void reset() {
        ReflectionTestUtils.setField(governance,"evidencePath","");ReflectionTestUtils.setField(releases,"evidencePath","");
        ReflectionTestUtils.setField(datasetContext,"evidencePath","");
        ReflectionTestUtils.setField(governance,"dispatchEnabled",false);
        db.update("UPDATE governance_model_dispatch SET state='FAILED' WHERE job_id IN(SELECT id FROM governance_model_jobs WHERE tenant_id=?) AND state<>'SUCCEEDED'",tenant);
        db.update("UPDATE briefing_generation_policies SET enabled=false WHERE tenant_id=?",tenant);
        db.update("UPDATE briefing_generation_batches SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING','WAITING_DATA','WAITING_RESOURCE','WAITING_CAPABILITY')",tenant);
    }
    void receipt(UUID version,String scope) {
        var rows=json.readTree(db.queryForObject("SELECT data_rows::text FROM dataset_snapshots WHERE id=?",String.class,version));
        var value=new LinkedHashMap<String,Object>();
        value.put("kind","export-validation");value.put("contractVersion","1.0");value.put("snapshotId",version.toString());
        value.put("sourceSnapshotId",UUID.randomUUID().toString());value.put("scopeHash",scope);value.put("completeSnapshot",true);
        value.put("rowsSha256",IdentityService.hash(rows.toString()));value.put("rowCount",rows.size());
        value.put("columns",columns());value.put("candidateKeyColumns",List.of("门店"));
        db.update("INSERT INTO collection_snapshot_receipts(snapshot_id,tenant_id,dataset_id,receipt) VALUES (?,?,?,?::jsonb) ON CONFLICT(snapshot_id) DO UPDATE SET receipt=excluded.receipt",version,tenant,dataset,json.writeValueAsString(value));
    }
    @SuppressWarnings("unchecked") UUID publish() {
        var job=governance.execute(owner,tenant,new GovernanceModelService.Execute(UUID.randomUUID(),"DATASET",dataset,"SYSTEM_MODEL"));
        UUID id=(UUID)job.get("id");var request=(Map<String,Object>)job.get("request");var context=(Map<String,Object>)request.get("context");
        var fields=new ArrayList<Map<String,Object>>();
        for(var raw:declaredFields)fields.add(Map.of("column",raw.get("column"),"decision","REVISE","meaning",raw.get("meaning"),"unit",raw.get("unit"),"evidence",raw.get("evidence")));
        var output=Map.<String,Object>of("title","合成稳定口径","summary","模型错误声称包含999个NULL字段。","limitations",List.of("不代表未声明的其他业务规则已核验"),"fields",fields,"evidence",List.of(),"knowledge",List.of());
        assertEquals("DRAFT_READY",governance.engineAnswer(owner,tenant,id,new GovernanceModelService.Answer(UUID.randomUUID(),1,request.get("inputHash").toString(),"SYSTEM_MODEL",output)).get("state"));
        // Synthetic executor receipt; this test never calls a model or changes a real source.
        db.update("UPDATE governance_model_dispatch SET state='SUCCEEDED' WHERE job_id=?",id);
        governance.publish(owner,tenant,id,new GovernanceModelService.Publish(2,request.get("inputHash").toString()));
        assertEquals("1.2",db.queryForObject("SELECT package->>'contractVersion' FROM native_governance_releases WHERE id=?",String.class,id));
        return id;
    }
    UUID policy(UUID workspace) {
        for(int i=0;i<100;i++){generation.discover();var values=generation.state(owner,tenant).policies().stream().filter(p->p.workspaceId().equals(workspace)).toList();if(!values.isEmpty())return values.getFirst().id();}
        throw new AssertionError("Fixture policy not discovered");
    }
    int dispatched(){return db.queryForObject("SELECT count(*) FROM briefing_generation_batches WHERE tenant_id=? AND task_id IS NOT NULL AND coalesce(business_type,'AUTO')<>'INFO'",Integer.class,tenant);}

    @Test void confirmedDefinitionsAutomaticallyPublishKnowledgeAndRepeatWithoutDuplicates() {
        UUID release=publish();
        new com.dreamcore.workspace.knowledge.DatasetKnowledgeWorker(db,datasetKnowledge,tenant.toString()).tick();
        datasetKnowledge.reconcile(owner,tenant,dataset);
        var items=datasetKnowledge.current(owner,tenant);
        assertEquals(1,items.size());assertEquals(release,items.getFirst().releaseId());
        assertTrue(items.getFirst().content().contains("来源登记数量"));
        assertTrue(items.getFirst().content().contains("合成来源定义：数量按件登记"));
        assertFalse(items.getFirst().content().contains("999"));
        assertEquals(1,db.queryForObject("SELECT count(*) FROM dataset_knowledge_publications WHERE tenant_id=?",Integer.class,tenant));
        assertTrue(knowledgeScene.snapshot(owner,tenant).path("items").toString().contains("数据口径知识"));
        snapshot=version(2,List.of(List.of("新店","12.50")));receipt(snapshot,"a".repeat(64));
        datasetKnowledge.reconcile(owner,tenant,dataset);
        assertEquals(items.getFirst().id(),datasetKnowledge.current(owner,tenant).getFirst().id());
    }

    @Test void knowledgeRechecksNewBatchesBeforeWorkerAndResumesSameVersion() {
        publish();datasetKnowledge.reconcile(owner,tenant,dataset);
        UUID article=datasetKnowledge.current(owner,tenant).getFirst().id();
        snapshot=version(2,List.of(List.of("新店","bad-decimal")));receipt(snapshot,"a".repeat(64));
        assertTrue(datasetKnowledge.current(owner,tenant).isEmpty());
        datasetKnowledge.reconcile(owner,tenant,dataset);
        assertEquals("STALE",db.queryForObject("SELECT state FROM dataset_knowledge_publications WHERE id=?",String.class,article));
        snapshot=version(3,List.of(List.of("新店","12.50")));receipt(snapshot,"a".repeat(64));
        datasetKnowledge.reconcile(owner,tenant,dataset);
        assertEquals(article,datasetKnowledge.current(owner,tenant).getFirst().id());
    }

    @Test void knowledgeRejectsUnpublishedSourcesAndRevokedOrCrossTenantReaders() {
        datasetKnowledge.reconcile(owner,tenant,dataset);
        assertTrue(datasetKnowledge.current(owner,tenant).isEmpty());
        publish();datasetKnowledge.reconcile(owner,tenant,dataset);
        assertThrows(IdentityException.class,()->datasetKnowledge.current(owner,UUID.randomUUID()));
        db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,owner);
        assertTrue(datasetKnowledge.current(owner,tenant).isEmpty());
    }

    @Test void changedBackgroundImmediatelyHidesOldKnowledge() {
        publish();datasetKnowledge.reconcile(owner,tenant,dataset);
        company.change(owner,tenant,new CompanyInformationService.Change(UUID.randomUUID(),CompanyInformationService.Field.BUSINESS,0,"ADD",null,"新版合成业务",""));
        assertTrue(datasetKnowledge.current(owner,tenant).isEmpty());
        datasetKnowledge.reconcile(owner,tenant,dataset);
        assertEquals("STALE",db.queryForObject("SELECT state FROM dataset_knowledge_publications WHERE tenant_id=?",String.class,tenant));
    }

    @Test void sourceReaderCanReadCompiledKnowledgeButCannotPublishIt() {
        publish();datasetKnowledge.reconcile(owner,tenant,dataset);
        UUID reader=UUID.randomUUID();
        db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成知识读者','unused')",reader,reader+"@knowledge.test");
        db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,reader);
        db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,false)",tenant,space,reader);
        assertEquals(1,datasetKnowledge.current(reader,tenant).size());
        assertEquals("DATASET_KNOWLEDGE_PUBLISH_FORBIDDEN",assertThrows(IdentityException.class,()->datasetKnowledge.reconcile(reader,tenant,dataset)).code);
        db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,reader);
        assertTrue(datasetKnowledge.current(reader,tenant).isEmpty());
    }

    @Test void refreshedRowsKeepDefinitionsButRecheckEverySnapshotAndDoNotCallModel() {
        UUID release=publish();String key=governance.analysisReadiness(owner,tenant,dataset).key();
        snapshot=version(2,List.of(List.of("合成新店","12.50")));receipt(snapshot,"a".repeat(64));
        assertEquals(release,releases.currentFor(owner,tenant,dataset).getFirst().releaseId());
        assertEquals(key,governance.analysisReadiness(owner,tenant,dataset).key());
        assertEquals("PUBLISHED",governance.datasetStatus(owner,tenant,dataset).get("state"));
        var asset=foundation.detail(owner,tenant,"dataset-"+dataset).path("asset");
        assertEquals(1,asset.path("queryableRecords").asInt());assertTrue(asset.path("checksPassed").asBoolean());
        assertEquals(1,db.queryForObject("SELECT count(*) FROM governance_model_jobs WHERE tenant_id=?",Integer.class,tenant));
        snapshot=version(3,List.of(List.of("合成新店","not-a-number")));receipt(snapshot,"a".repeat(64));
        assertFalse(governance.analysisReadiness(owner,tenant,dataset).ready());
        assertEquals("SOURCE_VALIDATION_FAILED",governance.analysisReadiness(owner,tenant,dataset).reason());
        assertEquals(release,releases.currentFor(owner,tenant,dataset).getFirst().releaseId());
        assertFalse(foundation.detail(owner,tenant,"dataset-"+dataset).path("asset").path("checksPassed").asBoolean());
    }
    @Test void confirmedContractAutomaticallyPublishesAndReusesDefinitionsWithoutModelJobs() throws Exception {
        var entries=declaredFields.stream().map(f -> Map.of("datasetId",dataset.toString(),"column",f.get("column"),"declaredUnit",f.get("unit"),"definitionScope","BUSINESS_DEFINITION","sourceMetadata",Map.of("definition",f.get("meaning")),"proof",List.of(Map.of("snippet",f.get("evidence"))))).toList();
        String body=json.writeValueAsString(Map.of("columns",columns(),"scopeHash","a".repeat(64),"entries",entries,"schema",schema));
        var contract=new com.dreamcore.workspace.collection.CollectionAdapter.SourceContract("1.0",tenant,dataset,1,IdentityService.hash(body),body);
        var approved=new ArrayList<>(schema);
        approved.add(Map.of("kind","source-contract","datasetId",dataset.toString(),"definitionVersion",1,"definitionSha256",contract.definitionSha256()));
        Files.writeString(evidence,json.writeValueAsString(Map.of("tenantId",tenant.toString(),"entries",entries,"schema",approved)));
        snapshot=version(2,List.of(List.of("合成门店","12.50")));receipt(snapshot,"a".repeat(64));
        db.update("UPDATE collection_snapshot_receipts SET source_contract=?::jsonb WHERE snapshot_id=?",json.writeValueAsString(contract),snapshot);
        assertTrue(sourcePublication.reconcile(owner,tenant,dataset));
        assertTrue(sourcePublication.reconcile(owner,tenant,dataset));
        assertEquals(1,db.queryForObject("SELECT count(*) FROM source_contract_publications WHERE tenant_id=?",Integer.class,tenant));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM governance_model_jobs WHERE tenant_id=?",Integer.class,tenant));
        var asset=foundation.detail(owner,tenant,"dataset-"+dataset).path("asset");
        assertTrue(asset.path("checksPassed").asBoolean(),asset.toString());
        assertTrue(asset.path("automaticAnalysisReady").asBoolean());
        assertEquals("READY",asset.path("stageStates").path(2).asText());
        assertEquals("READY",asset.path("stageStates").path(3).asText());
        assertTrue(governance.analysisReadiness(owner,tenant,dataset).ready());
        datasetKnowledge.reconcile(owner,tenant,dataset);
        assertEquals(1,db.queryForObject("SELECT count(*) FROM dataset_knowledge_publications WHERE tenant_id=? AND state='PUBLISHED'",Integer.class,tenant));
        snapshot=version(3,List.of(List.of("合成门店","invalid")));receipt(snapshot,"a".repeat(64));
        db.update("UPDATE collection_snapshot_receipts SET source_contract=?::jsonb WHERE snapshot_id=?",json.writeValueAsString(contract),snapshot);
        assertFalse(sourcePublication.reconcile(owner,tenant,dataset));
        assertFalse(governance.analysisReadiness(owner,tenant,dataset).ready());
        assertEquals(1,db.queryForObject("SELECT count(*) FROM source_contract_publications WHERE tenant_id=?",Integer.class,tenant));
    }
    @Test void transportedDefinitionsReusePublishedMeaningButNeverCarryForwardRowSuccess() throws Exception {
        UUID release=publish(), oldSnapshot=snapshot;
        String body=json.writeValueAsString(Map.of("columns",columns(),"scopeHash","a".repeat(64),
            "entries",json.readValue(Files.readString(evidence),Map.class).get("entries"),"schema",schema));
        var contract=new com.dreamcore.workspace.collection.CollectionAdapter.SourceContract("1.0",tenant,dataset,1,IdentityService.hash(body),body);
        var approved=new ArrayList<>(schema);
        approved.add(Map.of("kind","source-contract","datasetId",dataset.toString(),"definitionVersion",1,"definitionSha256",contract.definitionSha256()));
        writeEvidence(approved);
        // Opting into delivery does not invalidate an unchanged published definition; it does require a fresh receipt.
        assertEquals(release,releases.currentFor(owner,tenant,dataset).getFirst().releaseId());
        var missing=foundation.detail(owner,tenant,"dataset-"+dataset).path("asset");
        assertFalse(missing.path("automaticAnalysisReady").asBoolean());
        assertTrue(missing.toString().contains("当前批次未附带已认可的来源定义"));
        assertEquals("GOVERNANCE_SOURCE_CONTRACT_REQUIRED",assertThrows(IdentityException.class,()->governance.execute(owner,tenant,new GovernanceModelService.Execute(UUID.randomUUID(),"DATASET",dataset,"SYSTEM_MODEL"))).code);
        snapshot=version(2,List.of(List.of("合成门店","12.50")));receipt(snapshot,"a".repeat(64));
        db.update("UPDATE collection_snapshot_receipts SET source_contract=?::jsonb WHERE snapshot_id=?",json.writeValueAsString(contract),snapshot);
        assertTrue(governance.analysisReadiness(owner,tenant,dataset).ready());
        assertEquals(release,releases.currentFor(owner,tenant,dataset).getFirst().releaseId());
        assertFalse(governance.analysisReadiness(owner,tenant,dataset,oldSnapshot).ready());
        snapshot=version(3,List.of(List.of("合成门店","invalid-decimal")));receipt(snapshot,"a".repeat(64));
        db.update("UPDATE collection_snapshot_receipts SET source_contract=?::jsonb WHERE snapshot_id=?",json.writeValueAsString(contract),snapshot);
        assertEquals("SOURCE_VALIDATION_FAILED",governance.analysisReadiness(owner,tenant,dataset).reason());
        var failed=foundation.detail(owner,tenant,"dataset-"+dataset).path("asset");
        assertTrue(failed.toString().contains("已声明字段规则存在异常"));
        assertFalse(failed.toString().contains("尚无已确认业务规则"));
        assertEquals(1,db.queryForObject("SELECT count(*) FROM governance_model_jobs WHERE tenant_id=?",Integer.class,tenant));
    }
    @Test void displayedSummaryUsesFrozenCountsRatherThanModelArithmetic() {
        UUID release=publish();
        var displayed=json.valueToTree(governance.detail(owner,tenant,release)).path("output").path("summary").asString();
        assertTrue(displayed.contains("治理输入第 1 版：共 6 条记录、2 个字段"));
        assertTrue(displayed.contains("0 个字段包含 NULL，合计 0 个 NULL 单元格"));
        assertTrue(displayed.contains("字段值规则 2 项，异常 0 项"));assertFalse(displayed.contains("999"));
        assertTrue(db.queryForObject("SELECT output->>'summary' FROM governance_model_jobs WHERE id=?",String.class,release).contains("999"));
        snapshot=version(2,List.of(List.of("当前仅一条","3")));receipt(snapshot,"a".repeat(64));
        assertEquals(displayed,json.valueToTree(governance.detail(owner,tenant,release)).path("output").path("summary").asString());
        var asset=foundation.detail(owner,tenant,"dataset-"+dataset).path("asset");
        assertEquals(1,asset.path("queryableRecords").asInt());assertFalse(asset.toString().contains("999"));
    }
    @Test void missingAcceptanceWaitsWithoutPaidTaskAndReceiptResumesExactlyOnce() {
        publish();snapshot=version(2,List.of(List.of("合成新店","12.50")));
        assertEquals("SOURCE_RECEIPT_REQUIRED",governance.analysisReadiness(owner,tenant,dataset).reason());
        UUID p=policy(space);generation.tick(p);assertEquals(0,dispatched());
        assertEquals("SOURCE_RECEIPT_REQUIRED",db.queryForObject("SELECT reason FROM briefing_generation_policies WHERE id=?",String.class,p));
        receipt(snapshot,"a".repeat(64));generation.tick(p);assertEquals(1,dispatched());
        generation.tick(p);generation.tick(p);assertEquals(1,dispatched());
    }
    @Test void queuedAutomaticTaskKeepsCheckedSnapshotAndPlansWhenCollectionAdvances() throws Exception {
        var items=new ArrayList<>(schema);
        var plan=Map.of("name","门店登记数量","meaning","来源登记数量","unit","件","grain","来源记录","scope","固定快照","exclusions","无","evidence","合成负责人已核对","aggregation","SUM","valueField","数量","execution",Map.of("groupColumns",List.of("门店"),"dateColumn","","dateFrom","","dateTo","","timeZone","Asia/Shanghai","reviewed",true));
        items.add(Map.of("kind","analysis-plan","datasetId",dataset.toString(),"definition",plan));writeEvidence(items);
        UUID release=publish(),p=policy(space),selected=snapshot;generation.tick(p);
        UUID task=db.queryForObject("SELECT task_id FROM briefing_generation_batches WHERE policy_id=? AND task_id IS NOT NULL",UUID.class,p);
        assertEquals(selected,db.queryForObject("SELECT snapshot_id FROM briefing_dataset_selections WHERE task_id=? AND dataset_id=?",UUID.class,task,dataset));
        // A subsequent accepted source has invalid values. It cannot replace the selected proof.
        snapshot=version(2,List.of(List.of("新采集门店","not-a-number")));receipt(snapshot,"a".repeat(64));
        assertEquals("SOURCE_VALIDATION_FAILED",governance.analysisReadiness(owner,tenant,dataset).reason());
        assertTrue(governance.analysisReadiness(owner,tenant,dataset,selected).ready());
        var job=conversations.claim();assertEquals(task,job.id());
        var source=call(job,request("dataset_read",dataset,selected,0)).path("source");
        assertEquals(selected.toString(),source.path("snapshotId").asString());
        assertEquals("PUBLISHED_GOVERNANCE",source.path("definitionOrigin").asString());
        assertEquals("件",source.path("publishedFieldUnits").path("数量").asString());
        assertTrue(source.path("analysisReadiness").path("ready").asBoolean());
        assertEquals(selected.toString(),source.at("/nativeAnalysisPlans/items/0/executionRequest/snapshotId").asString());
        assertEquals(release,releases.currentForSnapshot(owner,tenant,dataset,selected).getFirst().releaseId());
        db.update("DELETE FROM collection_snapshot_receipts WHERE snapshot_id=?",selected);
        assertTrue(releases.currentForSnapshot(owner,tenant,dataset,selected).isEmpty());
        assertFalse(governance.analysisReadiness(owner,tenant,dataset,selected).ready());
    }
    @Test void laterGoodSnapshotCannotValidateSelectedBadSnapshotOrChangedScope() {
        publish();UUID invalid=version(2,List.of(List.of("合成门店","not-a-number")));receipt(invalid,"a".repeat(64));
        snapshot=version(3,List.of(List.of("合成门店","12")));receipt(snapshot,"a".repeat(64));
        assertTrue(governance.analysisReadiness(owner,tenant,dataset).ready());
        assertEquals("SOURCE_VALIDATION_FAILED",governance.analysisReadiness(owner,tenant,dataset,invalid).reason());
        receipt(invalid,"b".repeat(64));assertTrue(releases.currentForSnapshot(owner,tenant,dataset,invalid).isEmpty());
        assertFalse(governance.analysisReadiness(owner,tenant,dataset,invalid).ready());
        assertTrue(releases.currentForSnapshot(owner,tenant,dataset,UUID.randomUUID()).isEmpty());
        receipt(invalid,"a".repeat(64));db.update("UPDATE dataset_snapshots SET scrubbed=true,data_rows='[]'::jsonb WHERE id=?",invalid);
        assertTrue(releases.currentForSnapshot(owner,tenant,dataset,invalid).isEmpty());
        db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,owner);
        assertTrue(releases.currentForSnapshot(owner,tenant,dataset,snapshot).isEmpty());
        assertThrows(IdentityException.class,()->governance.analysisReadiness(owner,tenant,dataset,snapshot));
    }
    @Test void deliveringCalculatedOlderSnapshotKeepsItsPublishedUnitWhenCollectionAdvances() {
        publish();UUID selected=snapshot;var job=task(null,"AUTHORIZED_LIBRARY");
        agents.openExecution(job.id(),job.token(),new com.dreamcore.workspace.conversation.AgentTaskService.ExecutionOpen("1.5",List.of("task_context","compare_dataset","deliver_briefing")));
        agents.toolReceipt(job.id(),job.token(),new com.dreamcore.workspace.conversation.AgentTaskService.ToolReceipt(1,"task_context","STARTED"));
        call(job,request("dataset_read",dataset,selected,0));
        agents.toolReceipt(job.id(),job.token(),new com.dreamcore.workspace.conversation.AgentTaskService.ToolReceipt(1,"task_context","succeeded"));
        agents.toolReceipt(job.id(),job.token(),new com.dreamcore.workspace.conversation.AgentTaskService.ToolReceipt(2,"compare_dataset","STARTED"));
        var parameters=new com.dreamcore.workspace.conversation.DatasetCalculationService.Request(dataset,selected,null,null,"数量",null,null,null,"Asia/Shanghai","SUM","SUMMARY",List.of("门店"),null,null,null,null);
        var calculated=json.valueToTree(agents.compareDataset(job.id(),job.token(),parameters));assertEquals("15",calculated.at("/calculation/total").asString());
        UUID calculation=UUID.fromString(calculated.at("/artifact/id").asString());
        agents.toolReceipt(job.id(),job.token(),new com.dreamcore.workspace.conversation.AgentTaskService.ToolReceipt(2,"compare_dataset","succeeded"));
        snapshot=version(2,List.of(List.of("新采集门店","999")));receipt(snapshot,"a".repeat(64));
        agents.toolReceipt(job.id(),job.token(),new com.dreamcore.workspace.conversation.AgentTaskService.ToolReceipt(3,"deliver_briefing","STARTED"));
        var proposed=new com.dreamcore.workspace.conversation.BriefingContentService.Request(calculation,"来源登记数量已经核对","本次依据获权范围核对门店登记数量。",List.of("门店登记数量应按来源已发布口径使用。","建议结合原始业务记录核对差异原因。"));
        assertEquals("PREPARED",agents.deliverBriefing(job.id(),job.token(),proposed).get("status"));
        var saved=json.readTree(db.queryForObject("SELECT content FROM conversation_artifacts WHERE task_id=? AND filename LIKE 'briefing-dataset-%'",byte[].class,job.id()));
        assertEquals(selected.toString(),saved.at("/datasetSource/snapshotId").asString());assertEquals("15",saved.at("/chart/totals/current").asString());
        assertEquals("件",saved.at("/chart/unit").asString());assertTrue(saved.path("title").asString().contains("15 件"));assertFalse(saved.path("summary").asString().contains("999"));
    }
    @Test void changedScopeDefinitionOrPermissionCannotReusePublication() throws Exception {
        publish();receipt(snapshot,"b".repeat(64));assertTrue(releases.currentFor(owner,tenant,dataset).isEmpty());
        receipt(snapshot,"a".repeat(64));assertFalse(releases.currentFor(owner,tenant,dataset).isEmpty());
        var changed=new ArrayList<>(schema);var changedRule=new LinkedHashMap<>(schema.getLast());changedRule.put("evidence","合成数量定义发生变化");changed.set(changed.size()-1,changedRule);writeEvidence(changed);
        assertTrue(releases.currentFor(owner,tenant,dataset).isEmpty());
        writeEvidence(schema);assertFalse(releases.currentFor(owner,tenant,dataset).isEmpty());
        db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,owner);
        assertThrows(IdentityException.class,()->governance.analysisReadiness(owner,tenant,dataset));
    }
    @Test void freshGovernanceRecoversFailedSourceOnceAndNextFailureRequiresRetry() {
        publish();UUID p=policy(space);generation.tick(p);assertEquals(1,dispatched());
        UUID task=db.queryForObject("SELECT task_id FROM briefing_generation_batches WHERE policy_id=? AND task_id IS NOT NULL",UUID.class,p);
        db.update("UPDATE conversation_tasks SET status='PARTIAL',finished_at=now(),lease_token=NULL,lease_until=NULL WHERE id=?",task);
        generation.tick(p);generation.tick(p);assertEquals(1,dispatched());
        assertEquals("ANALYSIS_RETRY_REQUIRED",db.queryForObject("SELECT reason FROM briefing_generation_policies WHERE id=?",String.class,p));
        publish();generation.tick(p);assertEquals(2,dispatched());
        generation.tick(p);assertEquals(2,dispatched());
    }
    @Test void pendingGovernanceBatchClaimsWorkAcrossEquivalentSpaces() {
        UUID p=policy(space),other=policy(privateSpace);generation.tick(p);generation.tick(other);
        assertEquals(0,dispatched());
        assertEquals(1,db.queryForObject("SELECT count(*) FROM briefing_generation_batches WHERE tenant_id=? AND coalesce(business_type,'AUTO')<>'INFO' AND status='WAITING_DATA'",Integer.class,tenant));
        publish();generation.tick(p);generation.tick(other);assertEquals(1,dispatched());
    }
    @Test void missingWorkGoalWaitsWithoutModelTaskAndResumesOnceAfterConfiguration() {
        publish();db.update("DELETE FROM work_role_profiles WHERE tenant_id=? AND account_id=?",tenant,owner);
        UUID p=policy(space);generation.tick(p);generation.tick(p);assertEquals(0,dispatched());
        assertEquals("WORK_GOAL_REQUIRED",db.queryForObject("SELECT reason FROM briefing_generation_batches WHERE policy_id=?",String.class,p));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_attempts a JOIN conversation_tasks t ON t.id=a.task_id WHERE t.tenant_id=?",Integer.class,tenant));
        db.update("INSERT INTO work_role_profiles(tenant_id,account_id,responsibilities,revision,changed_by) VALUES (?,?,'核对当前获权来源登记数量',1,?)",tenant,owner,owner);
        generation.tick(p);generation.tick(p);assertEquals(1,dispatched());
    }
    @Test void publishedFieldsReachOnlyCurrentSourceReadersWithoutPrivateDraft() {
        UUID release=publish(),reader=UUID.randomUUID();
        db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成读者','unused')",reader,reader+"@native-reader.test");
        db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,reader);
        db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,false)",tenant,space,reader);
        var publication=releases.currentFor(reader,tenant,dataset).getFirst();
        assertEquals(release,publication.releaseId());assertEquals(2,publication.fields().size());
        assertTrue(publication.knowledge().isEmpty());assertTrue(publication.evidence().isEmpty());
        assertTrue(governance.analysisReadiness(reader,tenant,dataset).ready());
        assertTrue(releases.list(reader,tenant).isEmpty());
        assertThrows(IdentityException.class,()->releases.read(reader,tenant,release));
        assertThrows(IdentityException.class,()->governance.detail(reader,tenant,release));
        var asset=foundation.detail(reader,tenant,"dataset-"+dataset).path("asset");
        assertFalse(asset.path("limitations").toString().contains("不代表未声明的其他业务规则已核验"));
        assertThrows(IdentityException.class,()->governance.analysisReadiness(reader,UUID.randomUUID(),dataset));
        UUID readerSpace=UUID.randomUUID();db.update("INSERT INTO workspaces(id,tenant_id,owner_id,name,kind) VALUES (?,?,?,'合成读者私人空间','PERSONAL')",readerSpace,tenant,reader);
        var submitted=conversations.submit(reader,tenant,null,readerSpace,UUID.randomUUID(),"核对获权来源字段","AGENT");
        UUID task=submitted.tasks().getLast().id();db.update("UPDATE conversation_tasks SET source_scope='AUTHORIZED_LIBRARY' WHERE id=?",task);
        var job=conversations.claim();assertEquals(task,job.id());var metadata=call(job,request("dataset_read",dataset,snapshot,0));
        assertEquals("PUBLISHED_GOVERNANCE",metadata.at("/source/definitionOrigin").asString());
        assertEquals("NATIVE_GOVERNANCE_RELEASE",metadata.at("/source/governedFields/source").asString());
        assertEquals("件",metadata.at("/source/fieldDefinitions/1/unit").asString());
        db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,reader);
        assertTrue(releases.currentFor(reader,tenant,dataset).isEmpty());
        assertThrows(IdentityException.class,()->governance.analysisReadiness(reader,tenant,dataset));
        assertThrows(IdentityException.class,()->call(job,request("dataset_read",dataset,snapshot,0)));
    }
    @Test void rollingMonthChangesTriggerKeyWithoutRefreshingDataOrReinterpretingFields() throws Exception {
        declaredFields=List.of(Map.of("column","门店","type","date","meaning","合成登记日期","unit","","evidence","合成来源确认：本列按日保存登记日期","status","SOURCE_DOCUMENTED"),declaredFields.get(1));
        var items=new ArrayList<>(schema);
        var column=new LinkedHashMap<>(items.get(0));column.put("type","date");items.set(0,column);
        var rule=new LinkedHashMap<>(items.get(2));rule.put("type","DATE");items.set(2,rule);
        var definition=new LinkedHashMap<String,Object>();
        definition.putAll(Map.of("name","本月登记数量","meaning","按合成登记日归月","unit","件","grain","来源记录","scope","本月来源日期","exclusions","无","evidence","合成负责人明确日期与数量口径","aggregation","SUM","valueField","数量","calendarWindow","CURRENT_MONTH"));
        definition.put("execution",Map.of("groupColumns",List.of(),"dateColumn","门店","dateFrom","","dateTo","","timeZone","Asia/Shanghai","reviewed",true));
        items.add(Map.of("kind","analysis-plan","datasetId",dataset.toString(),"definition",definition));
        writeEvidence(items);snapshot=version(2,List.of(List.of("2026-10-01","12.50")));receipt(snapshot,"a".repeat(64));publish();
        Object original=ReflectionTestUtils.getField(governance,"analysisClock");
        try {
            ReflectionTestUtils.setField(governance,"analysisClock",new com.dreamcore.workspace.plans.PlanClock(){public java.time.Instant now(){return java.time.Instant.parse("2026-10-31T15:59:00Z");}});
            String october=governance.analysisReadiness(owner,tenant,dataset).key();assertTrue(october.endsWith(":2026-10"));
            ReflectionTestUtils.setField(governance,"analysisClock",new com.dreamcore.workspace.plans.PlanClock(){public java.time.Instant now(){return java.time.Instant.parse("2026-10-31T16:00:00Z");}});
            String november=governance.analysisReadiness(owner,tenant,dataset).key();assertTrue(november.endsWith(":2026-11"));
            assertNotEquals(october,november);assertTrue(governance.analysisReadiness(owner,tenant,dataset).ready());
        } finally {ReflectionTestUtils.setField(governance,"analysisClock",original);}
    }

}
