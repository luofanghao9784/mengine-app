package com.dreamcore.workspace;

import com.dreamcore.workspace.collection.*;
import com.dreamcore.workspace.identity.*;
import java.time.*;
import java.net.*;
import java.net.http.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"dreamcore.collection.enabled=false","dreamcore.auth.ip-attempts=1000","dreamcore.auth.email-attempts=1000"})
class CollectionIntegrationTest {
    @TestConfiguration static class Config {
        // This fixture explicitly tests its synthetic collector, not the production scene bridge.
        @Bean static org.springframework.beans.factory.config.BeanFactoryPostProcessor chooseSyntheticCollector(){return factory->{if(factory.containsBeanDefinition("sceneCollectionAdapter"))factory.getBeanDefinition("sceneCollectionAdapter").setPrimary(false);};}
        @Bean @Primary CollectionAdapter syntheticCollector(){return new CollectionAdapter(){public boolean available(){return true;}public Result collect(Request r){return new Result("1.0",r.datasets().stream().map(d->new Snapshot(d.id(),Instant.parse("2026-01-01T00:00:00Z"),List.of(d.columns().stream().map(c->"synthetic-"+c).toList()))).toList());}};}
    }
    @Autowired com.dreamcore.workspace.scene.NativeFoundationService nativeFoundation;
    @Autowired com.dreamcore.workspace.scene.SceneService scenes;
    @Autowired com.dreamcore.workspace.scene.FoundationProcessingService processing;
    @Test void collectedRowsAreNotGovernedOrPublishedAndSummaryMatchesDetail(){
        var before=nativeFoundation.snapshot(reader,tenant);
        assertFalse(before.path("items").get(0).path("available").asBoolean());
        assertEquals("WAITING",before.path("items").get(0).path("stageStates").get(0).asText());
        start();var claim=service.claim(tenant,connection,Instant.now());
        assertTrue(service.complete(claim,result("原始记录",null),Instant.now()));
        var snapshot=nativeFoundation.snapshot(reader,tenant);
        var asset=snapshot.path("items").get(0);
        assertFalse(asset.path("available").asBoolean());assertFalse(asset.path("checksPassed").asBoolean());
        assertTrue(asset.path("needsAttention").asBoolean());assertTrue(asset.path("ready").isNull());
        assertEquals(2,asset.path("gate").asInt());
        assertEquals("[1,1,0,0,0]",snapshot.path("passed").toString());
        assertEquals(1,snapshot.path("governance").path("attention").asInt());
        var detail=nativeFoundation.detail(reader,tenant,"dataset-"+dataset);
        assertEquals(asset.path("stageStates"),detail.path("asset").path("stageStates"));
        assertEquals("waiting",detail.path("dictionary").path("status").asText());
        assertFalse(detail.path("dictionary").path("current").asBoolean());
        for(var event:detail.path("events"))assertFalse(List.of("records-checked","published").contains(event.path("event").asText()));
        var stages=processing.read(reader,tenant,"dataset-"+dataset,0,20,null).stages();
        assertEquals(List.of("READY","READY","WAITING","WAITING","WAITING"),stages.stream().map(com.dreamcore.workspace.scene.FoundationProcessingService.Stage::state).toList());
        // Recollection, including an empty snapshot, must not fabricate a governance receipt.
        start();var next=service.claim(tenant,connection,Instant.now());
        assertTrue(service.complete(next,new CollectionAdapter.Result("1.0",List.of(new CollectionAdapter.Snapshot(dataset,null,List.of()))),Instant.now()));
        var empty=nativeFoundation.detail(reader,tenant,"dataset-"+dataset).path("asset");
        assertEquals(0,empty.path("total").asInt());assertTrue(empty.path("ready").isNull());assertFalse(empty.path("available").asBoolean());
    }
    @Test void documentedSourceFieldsStillNeedGovernanceChecks(){
        var fields=List.of(new DatasetField("门店","text","门店名称","","来源说明","SOURCE_DOCUMENTED"));
        UUID defined=UUID.randomUUID();
        deployment.apply(manifest(List.of(new CollectionDeployment.Dataset(defined,space,"defined","来源字段资料","",List.of("门店"),fields))));
        start();var claim=service.claim(tenant,connection,Instant.now());
        assertTrue(service.complete(claim,new CollectionAdapter.Result("1.0",List.of(new CollectionAdapter.Snapshot(defined,null,List.of(List.of("合成门店"))))),Instant.now()));
        var snapshot=nativeFoundation.snapshot(reader,tenant);
        assertEquals("[1,1,0,0,0]",snapshot.path("passed").toString());
        assertFalse(snapshot.path("items").get(0).path("available").asBoolean());
        var detail=nativeFoundation.detail(reader,tenant,"dataset-"+defined);
        assertEquals("[\"READY\",\"READY\",\"WAITING\",\"WAITING\",\"WAITING\"]",detail.path("asset").path("stageStates").toString());
    }
    @Test void processingShowsActualColumnsRecordsAndRejectsChangedPaginationSnapshot(){
        start();var claim=service.claim(tenant,connection,Instant.now());
        var rows=java.util.stream.IntStream.range(0,25).mapToObj(i->List.of("合成门店"+i,String.valueOf(i))).toList();
        assertTrue(service.complete(claim,new CollectionAdapter.Result("1.0",List.of(new CollectionAdapter.Snapshot(dataset,null,rows))),Instant.now()));
        var first=processing.read(reader,tenant,"dataset-"+dataset,0,20,null);
        assertEquals(25,first.recordCount());assertEquals(20,first.records().size());assertTrue(first.hasMore());
        assertEquals(List.of("门店","数量"),first.fields().stream().map(com.dreamcore.workspace.scene.FoundationProcessingService.Field::name).toList());
        assertTrue(first.fields().stream().allMatch(f->f.origin().equals("SOURCE_COLUMN")));
        assertEquals("WAITING",first.stages().get(2).state());assertFalse(first.history().isEmpty());
        var second=processing.read(reader,tenant,"dataset-"+dataset,20,20,first.revision());
        assertEquals(5,second.records().size());assertEquals("合成门店20",second.records().getFirst().getFirst());assertFalse(second.hasMore());
        start();var next=service.claim(tenant,connection,Instant.now());assertTrue(service.complete(next,result("新版本",null),Instant.now()));
        code("FOUNDATION_VERSION_CHANGED",()->processing.read(reader,tenant,"dataset-"+dataset,20,20,first.revision()));
        assertEquals(2,processing.read(reader,tenant,"dataset-"+dataset,0,20,null).version());
    }
    @Test void processingAndNativeDetailRetainOriginalPermissions(){
        start();var claim=service.claim(tenant,connection,Instant.now());assertTrue(service.complete(claim,result("可读记录",null),Instant.now()));
        code("DATASET_NOT_FOUND",()->processing.read(admin,tenant,"dataset-"+dataset,0,20,null));
        assertThrows(IdentityException.class,()->processing.read(outside,tenant,"dataset-"+dataset,0,20,null));
        var detail=scenes.dispatch(reader,tenant,false,"GET","/scene-foundation/dataset-"+dataset,null);
        assertEquals(2,detail.path("dictionary").path("fields").size());
        assertEquals(5,detail.path("asset").path("stageStates").size());
        UUID another=UUID.randomUUID();db.update("INSERT INTO tenants(id,name) VALUES (?,'另一企业')",another);
        db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role,status) VALUES (?,?,'MEMBER','ACTIVE')",another,reader);
        code("DATASET_NOT_FOUND",()->processing.read(reader,another,"dataset-"+dataset,0,20,null));
        db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,reader);
        code("DATASET_NOT_FOUND",()->processing.read(reader,tenant,"dataset-"+dataset,0,20,null));
    }
    @Test void nativeSceneUsesOriginalContentPermissionsAndDoesNotClaimGovernance() {
        assertEquals(0,nativeFoundation.snapshot(admin,tenant).path("items").size());
        var snapshot=nativeFoundation.snapshot(reader,tenant);
        assertTrue(snapshot.path("nativePlatform").asBoolean());
        assertEquals(1,snapshot.path("items").size());
        assertFalse(snapshot.path("items").get(0).path("checksPassed").asBoolean());
        assertTrue(snapshot.path("governance").path("averageQuality").isNull());
        assertThrows(IdentityException.class,()->nativeFoundation.snapshot(outside,tenant));
        assertEquals(snapshot.path("items"),scenes.dispatch(reader,tenant,false,"GET","/scene-foundation",null).path("items"));
        admins.grant(owner,tenant,space,reader,UUID.randomUUID(),admins.spaceInfo(owner,tenant,space).version(),false);
        assertEquals(0,nativeFoundation.snapshot(reader,tenant).path("items").size());
    }
    @Test void platformListsNativeTenantCountsWithoutContentOrBridgeBinding(){
        assertThrows(IdentityException.class,()->scenes.bindings(reader));
        UUID operator=UUID.randomUUID();
        db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成总台','unused')",operator,operator+"@native.test");
        db.update("INSERT INTO platform_roles(account_id,role) VALUES (?,'PLATFORM_ADMIN')",operator);
        db.update("INSERT INTO platform_accounts(account_id,login_name,password_hash) VALUES (?,?,'unused')",operator,operator+"@native.test");
        var item=scenes.bindings(operator).stream().filter(r->tenant.equals(r.get("tenant_id"))).findFirst().orElseThrow();
        assertEquals(true,item.get("native_platform"));assertEquals(1L,((Number)item.get("datasets")).longValue());
        assertEquals(Set.of("tenant_id","name","workspace_id","connection_id","native_platform","datasets","materials"),item.keySet());
        assertNull(item.get("connection_id"));
    }
    @Autowired DatasetLifecycleService lifecycle;
    @Autowired WorkspaceArchiveService archives;
    @Autowired CollectionDeployment deployment;
    @Autowired CollectionService service;@Autowired CollectionWorker worker;@Autowired JdbcTemplate db;
    @Autowired TenantAdminService admins;@Autowired TenantServiceRuntime runtime;@Autowired PasswordEncoder passwords;
    @Autowired org.springframework.transaction.support.TransactionTemplate tx;
    @LocalServerPort int port;
    @Autowired NativeGovernanceDeployment nativeDeployment;
    @Autowired com.dreamcore.workspace.profile.CompanyInformationService company;
    NativeGovernanceDeployment.Package nativePackage(){
        db.update("INSERT INTO tenant_governance(tenant_id,owner_id) VALUES (?,?) ON CONFLICT(tenant_id) DO UPDATE SET owner_id=excluded.owner_id",tenant,owner);
        company.change(owner,tenant,new com.dreamcore.workspace.profile.CompanyInformationService.Change(UUID.randomUUID(),com.dreamcore.workspace.profile.CompanyInformationService.Field.NAME,0,"ADD",null,"合成企业",""));
        start();var claim=service.claim(tenant,connection,Instant.now());assertTrue(service.complete(claim,result("合成",null),Instant.now()));
        var ctx=nativeDeployment.context(owner,tenant,List.of(dataset));
        var fields=List.of(new DatasetField("门店","text","合成门店","","合成测试","SOURCE_DOCUMENTED"),new DatasetField("数量","integer","合成数量","个","合成测试","SOURCE_DOCUMENTED"));
        return new NativeGovernanceDeployment.Package("1.0",UUID.randomUUID(),tenant,owner,ctx.backgroundVersion(),List.of(new NativeGovernanceDeployment.Item(dataset,ctx.sources().getFirst().token(),fields,"",List.of("合成行与固定快照"))));
    }
    @Test void nativeGovernanceUnchangedRecollectionRetainsVerifiedContent(){
      var p=nativePackage();nativeDeployment.submit(p,true);var before=nativeDeployment.context(owner,tenant,List.of(dataset));
      start();var claim=service.claim(tenant,connection,Instant.now());assertTrue(service.complete(claim,result("合成",null),Instant.now()));
      var after=nativeDeployment.context(owner,tenant,List.of(dataset));
      assertNotEquals(before.sources().getFirst().snapshotId(),after.sources().getFirst().snapshotId());
      assertEquals(before.sources().getFirst().token(),after.sources().getFirst().token());assertEquals(1,nativeDeployment.current(owner,tenant).size());
      var bad=new NativeGovernanceDeployment.Package("1.1",UUID.randomUUID(),tenant,owner,p.backgroundVersion(),p.items(),List.of(new NativeMaterialGovernance.Reference(UUID.randomUUID(),UUID.randomUUID(),UUID.randomUUID(),"fake")));
      assertThrows(IdentityException.class,()->nativeDeployment.submit(bad,true));
      var missing=new NativeGovernanceDeployment.Package("1.1",UUID.randomUUID(),tenant,owner,p.backgroundVersion(),p.items(),List.of());
      assertThrows(IdentityException.class,()->nativeDeployment.submit(missing,true));
    }
    @Test void nativeGovernancePreviewIsNonPublishingAndCollectionCompatible(){
        var p=nativePackage();service.configure(admin,tenant,connection,UUID.randomUUID(),service.detail(admin,tenant,connection).revision(),new CollectionService.Schedule(true,"DAILY","03:00","Asia/Shanghai"));
        var before=db.queryForMap("SELECT * FROM data_connections WHERE id=?",connection);
        assertFalse(nativeDeployment.submit(p,false).published());
        assertEquals(0,db.queryForObject("SELECT count(*) FROM native_governance_releases WHERE tenant_id=?",Integer.class,tenant));
        var receipt=nativeDeployment.submit(p,true);assertTrue(receipt.published());assertEquals(receipt,nativeDeployment.submit(p,true));
        assertEquals(1,nativeDeployment.current(owner,tenant).size());assertEquals(List.of(),nativeDeployment.current(reader,tenant));
        assertThrows(IdentityException.class,()->nativeDeployment.read(reader,tenant,p.id()));
        assertEquals(before,db.queryForMap("SELECT * FROM data_connections WHERE id=?",connection));
        assertEquals("[]",db.queryForObject("SELECT field_definitions::text FROM business_datasets WHERE id=?",String.class,dataset));
        start();var claim=service.claim(tenant,connection,Instant.now());assertTrue(service.complete(claim,result("新数据",null),Instant.now()));
        assertEquals(List.of(),nativeDeployment.current(owner,tenant));
        assertEquals("STALE",((Map<?,?>)nativeDeployment.read(owner,tenant,p.id())).get("state"));
        assertThrows(IdentityException.class,()->nativeDeployment.submit(p,true));
        assertEquals(before.get("next_due"),db.queryForMap("SELECT next_due FROM data_connections WHERE id=?",connection).get("next_due"));
    }
    @Test void nativeGovernanceRejectsChangedBackgroundScopeAndMalformedBatch(){
        var p=nativePackage();
        var bad=new NativeGovernanceDeployment.Package("1.0",p.id(),tenant,owner,p.backgroundVersion(),List.of(new NativeGovernanceDeployment.Item(dataset,p.items().getFirst().token(),List.of(),"bad",List.of("synthetic"))));
        assertThrows(IdentityException.class,()->nativeDeployment.submit(bad,true));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM native_governance_releases WHERE tenant_id=?",Integer.class,tenant));
        nativeDeployment.submit(p,true);
        company.change(owner,tenant,new com.dreamcore.workspace.profile.CompanyInformationService.Change(UUID.randomUUID(),com.dreamcore.workspace.profile.CompanyInformationService.Field.TERM,0,"ADD",null,"新背景","合成变化"));
        assertEquals(List.of(),nativeDeployment.current(owner,tenant));assertThrows(IdentityException.class,()->nativeDeployment.submit(p,true));
        assertThrows(IdentityException.class,()->nativeDeployment.context(outside,tenant,List.of(dataset)));
        assertThrows(IdentityException.class,()->nativeDeployment.read(owner,UUID.randomUUID(),p.id()));
    }
    @Test void nativeGovernanceRevocationHidesPublishedContent(){
        var p=nativePackage();nativeDeployment.submit(p,true);
        db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,owner);
        assertEquals(List.of(),nativeDeployment.current(owner,tenant));assertThrows(IdentityException.class,()->nativeDeployment.read(owner,tenant,p.id()));
    }
    UUID tenant,admin,owner,reader,outside,space,connection,dataset;
    private static final JsonMapper JSON=new JsonMapper();
    @BeforeEach void fixture(){
        tenant=UUID.randomUUID();admin=UUID.randomUUID();owner=UUID.randomUUID();reader=UUID.randomUUID();outside=UUID.randomUUID();connection=UUID.randomUUID();dataset=UUID.randomUUID();
        db.update("INSERT INTO tenants(id,name) VALUES (?,'合成取数企业')",tenant);
        for(UUID actor:List.of(admin,owner,reader,outside)){
            db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,?,?)",actor,actor+"@collection.test","合成取数人员",passwords.encode("synthetic-password"));
            if(!actor.equals(outside))db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role,status) VALUES (?,?,?,'ACTIVE')",tenant,actor,actor.equals(admin)?"TENANT_ADMIN":"MEMBER");
        }
        space=admins.createSpace(admin,tenant,UUID.randomUUID(),"合成销售空间",owner,"").id();
        admins.grant(owner,tenant,space,reader,UUID.randomUUID(),0,true);
        db.update("INSERT INTO data_connections(id,tenant_id,name,route_label,access_summary,status,time_zone) VALUES (?,?,'合成业务后台','已部署合成采集器','限定销售共享空间','READY','Asia/Shanghai')",connection,tenant);
        db.update("INSERT INTO business_datasets(id,tenant_id,connection_id,workspace_id,dataset_key,name,column_names) VALUES (?,?,?,?,'sales','合成销售数据','[\"门店\",\"数量\"]'::jsonb)",dataset,tenant,connection,space);
    }
    CollectionService.Schedule hourly(boolean enabled){return new CollectionService.Schedule(enabled,"HOURLY",null,"Asia/Shanghai");}
    CollectionService.Run start(){return service.updateNow(admin,tenant,connection,UUID.randomUUID(),service.detail(admin,tenant,connection).revision());}
    CollectionAdapter.Result result(String name,Instant coverage){return new CollectionAdapter.Result("1.0",List.of(new CollectionAdapter.Snapshot(dataset,coverage,List.of(List.of(name,"3")))));}
    void code(String expected,Runnable action){assertEquals(expected,assertThrows(IdentityException.class,action::run).code);}
    @Test void datasetLifecycleRequiresScopeAndCapabilityAndErasesAllSnapshots() {
        code("MATERIAL_NOT_FOUND",()->lifecycle.get(admin,tenant,dataset));
        code("CAPABILITY_REQUIRED",()->lifecycle.act(reader,tenant,dataset,UUID.randomUUID(),0,"WITHDRAW",true));
        admins.grant(owner,tenant,space,admin,UUID.randomUUID(),admins.spaceInfo(owner,tenant,space).version(),true);
        start();var claim=service.claim(tenant,connection,Instant.now());assertTrue(service.complete(claim,result("待清理正文",null),Instant.now()));
        start();var late=service.claim(tenant,connection,Instant.now());
        UUID key=UUID.randomUUID();var receipt=lifecycle.act(admin,tenant,dataset,key,0,"WITHDRAW",true);
        assertEquals("WITHDRAWN",receipt.state());assertEquals(1,receipt.rows());
        assertEquals(receipt,lifecycle.act(admin,tenant,dataset,key,0,"WITHDRAW",true));
        assertFalse(service.complete(late,result("不得复活",null),Instant.now()));
        assertTrue(service.datasets(reader,tenant,"",0,20).items().isEmpty());
        code("CAPABILITY_REQUIRED",()->lifecycle.act(admin,tenant,dataset,UUID.randomUUID(),1,"PURGE",true));
        db.update("INSERT INTO governance_capabilities(tenant_id,account_id,workspace_id,capability,granted_by) VALUES (?,?,?,'LIFECYCLE_PURGE',?)",tenant,admin,space,admin);
        code("INVALID_REQUEST",()->lifecycle.act(admin,tenant,dataset,UUID.randomUUID(),1,"PURGE",false));
        code("DATASET_LIFECYCLE_CONFLICT",()->lifecycle.act(admin,tenant,dataset,UUID.randomUUID(),0,"PURGE",true));
        UUID purge=UUID.randomUUID();var cleared=lifecycle.act(admin,tenant,dataset,purge,1,"PURGE",true);
        assertEquals("PURGED",cleared.state());assertEquals(0,cleared.rows());
        assertTrue(admins.records(admin,tenant,0,50).stream().anyMatch(r->r.action().equals("DATASET_PURGE")));
        assertEquals(cleared,lifecycle.act(admin,tenant,dataset,purge,1,"PURGE",true));
        assertEquals("[]",db.queryForObject("SELECT data_rows::text FROM dataset_snapshots WHERE dataset_id=?",String.class,dataset));
        assertThrows(Exception.class,()->db.update("UPDATE business_datasets SET status='ACTIVE' WHERE id=?",dataset));
    }
    @Test void workspaceArchiveBlocksDependenciesAndNewContentAndCanRestore() {
        code("WORKSPACE_ARCHIVE_DEPENDENCIES",()->archives.act(admin,tenant,space,UUID.randomUUID(),admins.spaceInfo(admin,tenant,space).version(),true));
        UUID empty=admins.createSpace(admin,tenant,UUID.randomUUID(),"空空间",owner,"").id();
        assertThrows(IdentityException.class,()->archives.get(reader,tenant,empty));
        UUID key=UUID.randomUUID();var archived=archives.act(owner,tenant,empty,key,0,true);
        assertTrue(archived.archived());assertEquals(archived,archives.act(owner,tenant,empty,key,0,true));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM pg_trigger WHERE tgname='archive_insert_guard' AND tgrelid IN ('departure_export_sets'::regclass,'departure_export_grants'::regclass,'object_lifecycle_scopes'::regclass)",Integer.class));
        assertTrue(admins.records(admin,tenant,0,50).stream().anyMatch(r->r.action().equals("WORKSPACE_ARCHIVE")));
        code("WORKSPACE_ARCHIVED",()->admins.renameSpace(admin,tenant,empty,UUID.randomUUID(),1,"不能修改"));
        assertThrows(Exception.class,()->db.update("INSERT INTO material_folders(id,tenant_id,workspace_id,name,created_by) VALUES (?,?,?,'不能写入',?)",UUID.randomUUID(),tenant,empty,owner));
        assertFalse(archives.act(owner,tenant,empty,UUID.randomUUID(),1,false).archived());
        assertDoesNotThrow(()->db.update("INSERT INTO material_folders(id,tenant_id,workspace_id,name,created_by) VALUES (?,?,?,'恢复后可写入',?)",UUID.randomUUID(),tenant,empty,owner));
    }
    @Test void controlsDoNotGrantContentAndSpaceReaderCannotControl(){
        assertTrue(service.detail(admin,tenant,connection).canControl());assertEquals(0,service.datasets(admin,tenant,"",0,20).items().size());
        code("DATASET_NOT_FOUND",()->service.preview(admin,tenant,dataset,0,20));
        assertFalse(service.detail(owner,tenant,connection).canControl());assertFalse(service.detail(reader,tenant,connection).canControl());
        assertEquals(1,service.datasets(reader,tenant,"",0,20).items().size());
        code("CAPABILITY_REQUIRED",()->service.configure(owner,tenant,connection,UUID.randomUUID(),0,hourly(true)));
        code("CAPABILITY_REQUIRED",()->service.updateNow(reader,tenant,connection,UUID.randomUUID(),0));
        assertThrows(IdentityException.class,()->service.connections(outside,tenant));
        UUID unrelated=UUID.randomUUID();db.update("INSERT INTO tenants(id,name) VALUES (?,'其他合成企业')",unrelated);db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role,status) VALUES (?,?,'TENANT_ADMIN','ACTIVE')",unrelated,admin);
        code("DATA_CONNECTION_NOT_FOUND",()->service.detail(admin,unrelated,connection));code("DATASET_NOT_FOUND",()->service.preview(admin,unrelated,dataset,0,20));
    }
    @Test void scheduleValidationVersionsIdempotencyAndNoBriefingMutation(){
        long policies=db.queryForObject("SELECT count(*) FROM briefing_generation_policies WHERE tenant_id=?",Long.class,tenant);
        UUID request=UUID.randomUUID();var configured=service.configure(admin,tenant,connection,request,0,hourly(true));
        assertEquals(1,configured.revision());assertTrue(configured.nextDue().isAfter(Instant.now().plusSeconds(3500)));
        assertEquals(configured,service.configure(admin,tenant,connection,request,0,hourly(true)));
        code("COLLECTION_STATE_CHANGED",()->service.configure(admin,tenant,connection,UUID.randomUUID(),0,hourly(false)));
        for(var invalid:List.of(new CollectionService.Schedule(true,"HOURLY","09:00","UTC"),new CollectionService.Schedule(true,"DAILY","25:00","UTC"),new CollectionService.Schedule(true,null,null,"UTC"),new CollectionService.Schedule(false,"HOURLY",null,"invalid-zone")))assertThrows(IdentityException.class,()->service.configure(admin,tenant,connection,UUID.randomUUID(),1,invalid));
        assertEquals(policies,db.queryForObject("SELECT count(*) FROM briefing_generation_policies WHERE tenant_id=?",Long.class,tenant));
    }
    @Test void onlyOneRunWithConcurrentManualRequestsAndLostResponseRetries() throws Exception {
        UUID request=UUID.randomUUID();var run=service.updateNow(admin,tenant,connection,request,0);
        assertEquals(run,service.updateNow(admin,tenant,connection,request,0));
        try(var pool=java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()){
            var a=pool.submit(()->start().id());var b=pool.submit(()->start().id());assertEquals(run.id(),a.get());assertEquals(run.id(),b.get());
        }
        assertEquals(1,db.queryForObject("SELECT count(*) FROM collection_runs WHERE connection_id=?",Integer.class,connection));
        var claim=service.claim(tenant,connection,Instant.now());assertNotNull(claim);assertNull(service.claim(tenant,connection,Instant.now()));
        assertTrue(service.complete(claim,result("首次",Instant.now().minusSeconds(5)),Instant.now()));
        assertEquals(run.id(),service.updateNow(admin,tenant,connection,request,0).id());
        assertEquals(1,db.queryForObject("SELECT count(*) FROM collection_runs WHERE connection_id=?",Integer.class,connection));
    }
    @Test void disablingAutomationKeepsCurrentRunAndAllowsManualUpdateWithoutMovingSchedule(){
        service.configure(admin,tenant,connection,UUID.randomUUID(),0,hourly(true));var due=service.detail(admin,tenant,connection).nextDue();start();
        assertEquals(due,service.detail(admin,tenant,connection).nextDue());var claim=service.claim(tenant,connection,Instant.now());
        service.configure(admin,tenant,connection,UUID.randomUUID(),1,hourly(false));assertTrue(service.complete(claim,result("自动已关",Instant.now().minusSeconds(2)),Instant.now()));
        var detail=service.detail(admin,tenant,connection);assertFalse(detail.schedule().enabled());assertNull(detail.nextDue());
        assertNotNull(start());assertEquals(2,db.queryForObject("SELECT count(*) FROM collection_runs WHERE connection_id=?",Integer.class,connection));
    }
    @Test void failurePreservesLastGoodSnapshotAndUnknownCoverageIsNotInvented(){
        start();var first=service.claim(tenant,connection,Instant.now());assertTrue(service.complete(first,result("上次成功",null),Instant.now()));
        var preview=service.preview(reader,tenant,dataset,0,20);assertEquals(1,preview.dataset().version());assertNull(preview.dataset().coverageThrough());
        start();var failed=service.claim(tenant,connection,Instant.now());service.fail(failed,"raw-secret-and-external-payload",Instant.now());
        var latest=service.preview(reader,tenant,dataset,0,20);assertEquals(preview.rows(),latest.rows());assertEquals(1,latest.dataset().version());assertEquals("COLLECTION_ADAPTER_FAILED",latest.dataset().latestRun().reason());
        assertFalse(service.complete(failed,result("迟到的结果",null),Instant.now()));
    }
    @Test void schemaMismatchForeignDatasetAndPartialOutputsCannotPublish(){
        start();var claim=service.claim(tenant,connection,Instant.now());
        var invalid=new CollectionAdapter.Result("1.0",List.of(new CollectionAdapter.Snapshot(dataset,null,List.of(List.of("one-cell")))));
        assertFalse(service.complete(claim,invalid,Instant.now()));assertNull(service.preview(reader,tenant,dataset,0,20).dataset().version());
        start();claim=service.claim(tenant,connection,Instant.now());assertFalse(service.complete(claim,new CollectionAdapter.Result("1.0",List.of(new CollectionAdapter.Snapshot(UUID.randomUUID(),null,List.of()))),Instant.now()));
        start();claim=service.claim(tenant,connection,Instant.now());assertFalse(service.complete(claim,new CollectionAdapter.Result("1.0",List.of()),Instant.now()));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM dataset_snapshots WHERE dataset_id=?",Integer.class,dataset));
    }
    @Test void servicePauseAndRestoreFenceOldResultsAndScheduleOnlyFuture(){
        service.configure(admin,tenant,connection,UUID.randomUUID(),0,hourly(true));start();var claim=service.claim(tenant,connection,Instant.now());
        db.update("UPDATE tenants SET status='SUSPENDED' WHERE id=?",tenant);assertFalse(service.complete(claim,result("禁止旧结果",null),Instant.now()));
        assertThrows(IdentityException.class,()->service.updateNow(admin,tenant,connection,UUID.randomUUID(),1));
        Instant now=Instant.now();tx.executeWithoutResult(status->{db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",tenant);runtime.resume(tenant,now);db.update("UPDATE tenants SET status='ACTIVE' WHERE id=?",tenant);});
        assertEquals(now.plusSeconds(3600).getEpochSecond(),service.detail(admin,tenant,connection).nextDue().getEpochSecond());
        assertNull(service.claim(tenant,connection,Instant.now()));assertNull(service.preview(reader,tenant,dataset,0,20).dataset().version());
        assertEquals("TENANT_SERVICE_SUSPENDED",service.detail(admin,tenant,connection).lastRun().reason());
    }
    @Test void revokedManualRequesterCannotPublishEvenIfLaterRestored(){
        start();var claim=service.claim(tenant,connection,Instant.now());
        db.update("UPDATE tenant_memberships SET role='MEMBER' WHERE tenant_id=? AND account_id=?",tenant,admin);
        db.update("UPDATE tenant_memberships SET role='TENANT_ADMIN' WHERE tenant_id=? AND account_id=?",tenant,admin);
        assertFalse(service.complete(claim,result("禁止复活",null),Instant.now()));assertEquals("AUTHORIZATION_REVOKED",service.detail(admin,tenant,connection).lastRun().reason());
    }
    @Test void connectionAndDatasetWithdrawalFenceRunningWorkAndHideContent(){
        start();var claim=service.claim(tenant,connection,Instant.now());db.update("UPDATE data_connections SET status='UNAVAILABLE' WHERE id=?",connection);
        code("CONNECTION_UNAVAILABLE",()->start());db.update("UPDATE data_connections SET status='READY' WHERE id=?",connection);assertFalse(service.complete(claim,result("旧连接",null),Instant.now()));
        start();var next=service.claim(tenant,connection,Instant.now());db.update("UPDATE business_datasets SET status='WITHDRAWN' WHERE id=?",dataset);
        assertFalse(service.complete(next,result("旧数据集",null),Instant.now()));code("DATASET_NOT_FOUND",()->service.preview(reader,tenant,dataset,0,20));
        assertThrows(org.springframework.dao.DataAccessException.class,()->db.update("UPDATE business_datasets SET workspace_id=? WHERE id=?",UUID.randomUUID(),dataset));
    }
    @Test void scheduledRunsSkipMissedIntervalsAndWorkerPublishesOnlyActualAdapterResult(){
        service.configure(admin,tenant,connection,UUID.randomUUID(),0,hourly(true));db.update("UPDATE data_connections SET next_due=now()-interval '2 days' WHERE id=?",connection);
        Instant now=Instant.now();service.schedule(tenant,connection,now);service.schedule(tenant,connection,now);
        assertEquals(1,db.queryForObject("SELECT count(*) FROM collection_runs WHERE connection_id=?",Integer.class,connection));
        assertEquals(now.plusSeconds(3600).getEpochSecond(),service.detail(admin,tenant,connection).nextDue().getEpochSecond());
        var claim=service.claim(tenant,connection,Instant.now());assertNotNull(claim);worker.execute(claim);
        var data=service.preview(reader,tenant,dataset,0,1);assertEquals(List.of(List.of("synthetic-门店","synthetic-数量")),data.rows());assertEquals("SUCCEEDED",data.dataset().latestRun().status());
        assertFalse(service.complete(claim,result("重复完成",null),Instant.now()));
    }
    @Test void leaseExpiryCannotAcceptDelayedCompletionAndDataRevocationIsImmediate(){
        start();Instant now=Instant.now();var claim=service.claim(tenant,connection,now);
        assertFalse(service.complete(claim,result("租约过期",null),now.plusSeconds(661)));
        assertEquals("COLLECTION_LEASE_EXPIRED",service.detail(admin,tenant,connection).lastRun().reason());
        db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,reader);
        code("DATASET_NOT_FOUND",()->service.preview(reader,tenant,dataset,0,20));code("DATA_CONNECTION_NOT_FOUND",()->service.detail(reader,tenant,connection));
    }
    @Test void publicHttpUsesCustomerSessionCsrfAndRejectsScopeEscalation() throws Exception {
        var browser=HttpClient.newBuilder().cookieHandler(new CookieManager(null,CookiePolicy.ACCEPT_ALL)).build();
        String root="http://127.0.0.1:"+port;String path="/api/v1/tenants/"+tenant+"/database";
        assertEquals(401,browser.send(HttpRequest.newBuilder(URI.create(root+path+"/connections")).GET().build(),HttpResponse.BodyHandlers.ofString()).statusCode());
        String csrf=csrf(browser,root);var login=post(browser,root,"/api/v1/auth/login",Map.of("email",admin+"@collection.test","password","synthetic-password"),csrf);assertEquals(200,login.statusCode());
        assertEquals(403,post(browser,root,path+"/connections/"+connection+"/update",Map.of("requestId",UUID.randomUUID(),"expectedRevision",0),null).statusCode());
        var response=post(browser,root,path+"/connections/"+connection+"/update",Map.of("requestId",UUID.randomUUID(),"expectedRevision",0),csrf(browser,root));assertEquals(200,response.statusCode(),response.body());
        var forbidden=browser.send(HttpRequest.newBuilder(URI.create(root+path+"/datasets/"+dataset)).GET().build(),HttpResponse.BodyHandlers.ofString());assertEquals(404,forbidden.statusCode());
        assertTrue(forbidden.headers().firstValue("Cache-Control").orElse("").contains("no-store"));
        assertEquals(404,post(browser,root,path+"/connections/"+connection+"/credentials",Map.of("endpoint","https://forbidden.test"),csrf(browser,root)).statusCode());
    }
    CollectionDeployment.Manifest manifest(List<CollectionDeployment.Dataset> datasets){return new CollectionDeployment.Manifest("1.0",tenant,connection,"已部署合成系统","系统只读采集 → 销售空间","部署限定空间和列","READY","UTC",datasets);}
    @Test void full107TableManifestRegistersAtomicallyAndKeepsBoundedCapacity(){
        var defs=java.util.stream.IntStream.range(0,107).mapToObj(i->new CollectionDeployment.Dataset(UUID.randomUUID(),space,"table-"+i,"合成表"+i,"",List.of("id"))).toList();
        deployment.apply(manifest(defs));
        assertEquals(107,db.queryForObject("SELECT count(*) FROM business_datasets WHERE connection_id=? AND status='ACTIVE'",Integer.class,connection));
        var revision=service.detail(admin,tenant,connection).revision();deployment.apply(manifest(defs));
        assertEquals(revision,service.detail(admin,tenant,connection).revision());
        var excessive=new ArrayList<>(defs);for(int i=107;i<=CollectionDeployment.MAX_DATASETS;i++)excessive.add(new CollectionDeployment.Dataset(UUID.randomUUID(),space,"table-"+i,"合成表"+i,"",List.of("id")));
        assertThrows(IllegalArgumentException.class,()->deployment.apply(manifest(excessive)));
        assertEquals(107,db.queryForObject("SELECT count(*) FROM business_datasets WHERE connection_id=? AND status='ACTIVE'",Integer.class,connection));
    }
    @Test void deploymentPreservesUserScheduleAndRequiresNewDatasetIdentityForScopeOrSchema(){
        service.configure(admin,tenant,connection,UUID.randomUUID(),0,hourly(true));var before=service.detail(admin,tenant,connection);
        start();var claim=service.claim(tenant,connection,Instant.now());
        var definition=new CollectionDeployment.Dataset(dataset,space,"sales","新名称","部署说明",List.of("门店","数量"));
        deployment.apply(manifest(List.of(definition)));var after=service.detail(admin,tenant,connection);
        assertEquals(before.schedule(),after.schedule());assertEquals(before.nextDue(),after.nextDue());
        assertEquals(before.revision()+1,after.revision());
        code("COLLECTION_STATE_CHANGED",()->service.updateNow(admin,tenant,connection,UUID.randomUUID(),before.revision()));
        code("COLLECTION_STATE_CHANGED",()->service.configure(admin,tenant,connection,UUID.randomUUID(),before.revision(),hourly(false)));
        assertFalse(service.complete(claim,result("部署前执行",null),Instant.now()));
        assertThrows(IllegalArgumentException.class,()->deployment.apply(manifest(List.of(new CollectionDeployment.Dataset(dataset,space,"sales","新名称","",List.of("另一列"))))));
        UUID replacement=UUID.randomUUID();deployment.apply(manifest(List.of(new CollectionDeployment.Dataset(replacement,space,"sales","新口径数据","",List.of("门店")))));
        code("DATASET_NOT_FOUND",()->service.preview(reader,tenant,dataset,0,20));assertNull(service.preview(reader,tenant,replacement,0,20).dataset().version());
    }
    @Test void identicalDeploymentKeepsRunningAndQueuedCollectionsAndUserSchedule() {
        var definition=new CollectionDeployment.Dataset(dataset,space,"sales","新名称","部署说明",List.of("门店","数量"));
        var manifest=manifest(List.of(definition));
        deployment.apply(manifest);
        service.configure(admin,tenant,connection,UUID.randomUUID(),service.detail(admin,tenant,connection).revision(),hourly(true));
        start();var claim=service.claim(tenant,connection,Instant.now());
        var before=db.queryForMap("SELECT * FROM data_connections WHERE id=?",connection);
        var run=db.queryForMap("SELECT * FROM collection_runs WHERE id=?",claim.runId());
        deployment.apply(manifest);
        assertEquals(before,db.queryForMap("SELECT * FROM data_connections WHERE id=?",connection));
        assertEquals(run,db.queryForMap("SELECT * FROM collection_runs WHERE id=?",claim.runId()));
        assertTrue(service.complete(claim,result("重复登记仍可完成",null),Instant.now()));
        var queued=start();
        deployment.apply(manifest);
        assertEquals("QUEUED",db.queryForObject("SELECT status FROM collection_runs WHERE id=?",String.class,queued.id()));
    }
    @Test void deploymentDatasetOrderIsIrrelevantButRemovalStillFencesWork() {
        var first=new CollectionDeployment.Dataset(dataset,space,"sales","销售","",List.of("门店","数量"));
        var second=new CollectionDeployment.Dataset(UUID.randomUUID(),space,"other","其他","",List.of("编号"));
        deployment.apply(manifest(List.of(first,second)));
        var before=service.detail(admin,tenant,connection).revision();
        start();
        deployment.apply(manifest(List.of(second,first)));
        assertEquals(before,service.detail(admin,tenant,connection).revision());
        deployment.apply(manifest(List.of(first)));
        assertEquals(before+1,service.detail(admin,tenant,connection).revision());
        assertEquals("WITHDRAWN",db.queryForObject("SELECT status FROM business_datasets WHERE id=?",String.class,second.id()));
        assertEquals(0,db.queryForObject("SELECT count(*) FROM collection_runs WHERE connection_id=? AND status IN ('QUEUED','RUNNING')",Integer.class,connection));
    }
    @Test void deployedFieldsAreScopedImmutableAndLegacyCompatible() {
        var fields=List.of(new DatasetField("门店","text","门店名称","","源字典说明","SOURCE_DOCUMENTED"),new DatasetField("数量","integer","含义未明确","","仅有字段名","UNKNOWN"));
        UUID defined=UUID.randomUUID();
        var definition=new CollectionDeployment.Dataset(defined,space,"defined","部署字段资料","部署说明",List.of("门店","数量"),fields);
        deployment.apply(manifest(List.of(definition)));
        assertEquals(fields,service.preview(reader,tenant,defined,0,20).dataset().fieldDefinitions());
        code("DATASET_NOT_FOUND",()->service.preview(admin,tenant,defined,0,20));
        assertThrows(IdentityException.class,()->service.preview(outside,tenant,defined,0,20));
        deployment.apply(manifest(List.of(definition))); // same definition can be redeployed
        var changed=List.of(fields.getFirst(),new DatasetField("数量","integer","推断为次数","次","部署推断","DEPLOYMENT_INFERRED"));
        assertThrows(IllegalArgumentException.class,()->deployment.apply(manifest(List.of(new CollectionDeployment.Dataset(defined,space,"defined","部署字段资料","部署说明",List.of("门店","数量"),changed)))));
        assertThrows(org.springframework.dao.DataAccessException.class,()->db.update("UPDATE business_datasets SET field_definitions='[]' WHERE id=?",defined));
        assertEquals(fields,service.preview(reader,tenant,defined,0,20).dataset().fieldDefinitions());
        db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,reader);
        code("DATASET_NOT_FOUND",()->service.preview(reader,tenant,defined,0,20));
    }
    @Test void workspaceAclRestrictionHidesDatasetCatalogSummaryAndSourceFromExistingMember(){
        db.update("INSERT INTO library_permission_rollouts VALUES (?,true)",tenant);
        db.update("INSERT INTO library_policies(tenant_id,object_kind,object_id,workspace_id) VALUES (?,'WORKSPACE',?,?)",tenant,space,space);
        db.update("INSERT INTO library_grants(tenant_id,object_kind,object_id,principal_kind,principal_id,content,download) VALUES (?,'WORKSPACE',?,'ACCOUNT',?,'NONE','DENY')",tenant,space,reader);
        assertEquals(0,service.summary(reader,tenant).datasets());
        assertTrue(service.datasets(reader,tenant,"",0,20).items().isEmpty());
        assertTrue(service.connections(reader,tenant).isEmpty());
        code("DATASET_NOT_FOUND",()->service.preview(reader,tenant,dataset,0,20));
        assertTrue(service.detail(admin,tenant,connection).canControl());
        assertEquals(1,service.summary(owner,tenant).datasets());
    }
    @Test void deploymentRejectsIncompleteFieldExplanationsAndPurgeErasesThem() {
        var field=new DatasetField("门店","text","门店名称","","源字典说明","SOURCE_DOCUMENTED");
        assertThrows(IllegalArgumentException.class,()->DatasetField.validate(List.of("门店","数量"),List.of(field)));
        assertThrows(IllegalArgumentException.class,()->DatasetField.validate(List.of("另一列"),List.of(field)));
        assertThrows(IllegalArgumentException.class,()->DatasetField.validate(List.of("门店"),List.of(new DatasetField("门店","text","意义","","","UNKNOWN"))));
        UUID defined=UUID.randomUUID();deployment.apply(manifest(List.of(new CollectionDeployment.Dataset(defined,space,"defined","部署说明","",List.of("门店"),List.of(field)))));
        admins.grant(owner,tenant,space,admin,UUID.randomUUID(),admins.spaceInfo(owner,tenant,space).version(),true);
        db.update("INSERT INTO governance_capabilities(tenant_id,account_id,workspace_id,capability,granted_by) VALUES (?,?,?,'LIFECYCLE_PURGE',?)",tenant,admin,space,admin);
        lifecycle.act(admin,tenant,defined,UUID.randomUUID(),0,"WITHDRAW",true);
        lifecycle.act(admin,tenant,defined,UUID.randomUUID(),1,"PURGE",true);
        assertEquals("[]",db.queryForObject("SELECT field_definitions::text FROM business_datasets WHERE id=?",String.class,defined));
    }
    @Test void scopedSummaryFiltersAndHumanActionsEnterTenantManagementRecords(){
        assertEquals(0,service.summary(admin,tenant).datasets());assertEquals(1,service.summary(reader,tenant).datasets());assertEquals(0,service.summary(reader,tenant).available());
        service.configure(admin,tenant,connection,UUID.randomUUID(),0,hourly(true));start();
        assertEquals(1,service.summary(reader,tenant).updating());assertEquals(1,service.datasets(reader,tenant,"","UPDATING",0,20).items().size());
        worker.execute(service.claim(tenant,connection,Instant.now()));assertEquals(1,service.summary(reader,tenant).available());assertEquals(0,service.summary(reader,tenant).updating());
        assertEquals(0,service.datasets(reader,tenant,"","EMPTY",0,20).items().size());
        var actions=admins.records(admin,tenant,0,100).stream().map(TenantAdminService.AuditEntry::action).toList();assertTrue(actions.contains("COLLECTION_CONFIGURE"));assertTrue(actions.contains("COLLECTION_NOW"));
    }
    @Test void effectiveEnterpriseExitStopsQueuedAndRunningCollectionEvenBeforeServiceStatusChanges(){
        service.configure(admin,tenant,connection,UUID.randomUUID(),0,hourly(true));start();var claim=service.claim(tenant,connection,Instant.now());
        db.update("INSERT INTO departure_executions(id,tenant_id,kind,state,requested_by,reason,policy_key,policy_revision,effective_at,deadline,prior_tenant_status) VALUES (?,?,'TENANT_EXIT','EXPORT_WINDOW',?,'synthetic exit','synthetic',1,now(),now()+interval '1 day','ACTIVE')",UUID.randomUUID(),tenant,admin);
        assertFalse(service.complete(claim,result("退出旧结果",null),Instant.now()));
        assertEquals("TENANT_EXITING",db.queryForObject("SELECT reason FROM collection_runs WHERE id=?",String.class,claim.runId()));
        assertFalse(service.candidates().stream().anyMatch(c->connection.equals(c.get("id"))));
    }
    String csrf(HttpClient browser,String root)throws Exception{return JSON.readTree(browser.send(HttpRequest.newBuilder(URI.create(root+"/api/v1/auth/csrf")).GET().build(),HttpResponse.BodyHandlers.ofString()).body()).get("token").asString();}
    HttpResponse<String> post(HttpClient browser,String root,String path,Object body,String csrf)throws Exception{var r=HttpRequest.newBuilder(URI.create(root+path)).header("Content-Type","application/json");if(csrf!=null)r.header("X-CSRF-TOKEN",csrf);return browser.send(r.POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body))).build(),HttpResponse.BodyHandlers.ofString());}
}
