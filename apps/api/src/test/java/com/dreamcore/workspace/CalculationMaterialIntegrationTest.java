package com.dreamcore.workspace;

import com.dreamcore.workspace.analysis.CalculationMaterialService;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import static org.junit.jupiter.api.Assertions.*;

class CalculationMaterialIntegrationTest extends DatasetCalculationFixture {
    @Autowired CalculationMaterialService pool;
    record Computed(ConversationService.Job job, UUID artifact) {}
    Computed calculate(boolean complete) {
        return calculate(complete,new DatasetCalculationService.Request(dataset,snapshot,"门店","期间","收款（元）","前期","本期"));
    }
    Computed calculate(boolean complete,DatasetCalculationService.Request parameters) {
        var j=task(null,"AUTHORIZED_LIBRARY");
        agents.openExecution(j.id(),j.token(),new AgentTaskService.ExecutionOpen("1.5",List.of("task_context","compare_dataset")));
        agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,"task_context","STARTED"));
        call(j,request("dataset_search",null,null,0));
        agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(1,"task_context","succeeded"));
        agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(2,"compare_dataset","STARTED"));
        var result=json.valueToTree(agents.compareDataset(j.id(),j.token(),parameters));
        agents.toolReceipt(j.id(),j.token(),new AgentTaskService.ToolReceipt(2,"compare_dataset","succeeded"));
        if(complete) agents.finish(j,new AgentResult("1.5","0.16.0",j.id(),j.token(),"AGENT","verification","synthetic-pool","固定版本计算完成。",List.of(),List.of(new AgentResult.Tool("s","task_context","succeeded"),new AgentResult.Tool("c","compare_dataset","succeeded")),List.of(),2,null,List.of(),List.of(),List.of(),"COMPLETE",null));
        return new Computed(j,UUID.fromString(result.at("/artifact/id").asString()));
    }
    CalculationMaterialService.Version retain(Computed c,UUID material,int expected) {
        return pool.retain(owner,tenant,c.artifact(),material,expected,Instant.now().plusSeconds(3600));
    }
    UUID peer() {
        UUID id=UUID.randomUUID();
        db.update("INSERT INTO accounts(id,email,display_name,password_hash) VALUES (?,?,'合成同事','not-a-login')",id,id+"@pool.test");
        db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",tenant,id);
        db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id) VALUES (?,?,?)",tenant,space,id);
        return id;
    }
    @Test void retainsVerifiedVersionAndRetryCannotExtendValidityOrDuplicate() {
        var c=calculate(true); UUID material=UUID.randomUUID();var first=retain(c,material,0);var retry=retain(c,material,0);
        assertEquals(first,retry); assertEquals("CURRENT",first.state());
        assertEquals("0.60",first.content().at("/calculation/totals/baseline").asString());
        assertNull(first.coverageThrough());
        assertEquals(1,db.queryForObject("SELECT count(*) FROM analysis_material_versions WHERE material_id=?",Integer.class,material));
        assertEquals(1,db.queryForObject("SELECT count(*) FROM analysis_material_observations WHERE version_id=?",Integer.class,first.versionId()));
        denied(()->retain(c,UUID.randomUUID(),0));
    }
    @Test void unfinishedTaskAndArtifactWithoutServerReceiptCannotEnterPool() {
        var c=calculate(false);denied(()->retain(c,UUID.randomUUID(),0));
        db.update("UPDATE conversation_tasks SET status='CANCELLED' WHERE id=?",c.job().id());
        var completed=calculate(true);
        db.update("DELETE FROM analysis_computation_receipts WHERE artifact_id=?",completed.artifact());
        denied(()->retain(completed,UUID.randomUUID(),0));
    }
    @Test void unchangedReorderedSnapshotIsObservedWithoutRecalculation() {
        var c=calculate(true);var first=retain(c,UUID.randomUUID(),0);
        var reversed=new ArrayList<>(rowsFor("old"));Collections.reverse(reversed);UUID newer=version(2,reversed);
        var reused=pool.read(owner,tenant,first.materialId(),1,true);
        assertEquals("CURRENT",reused.state());assertEquals(first.versionId(),reused.versionId());
        assertEquals(newer,reused.observedSnapshotId());assertEquals(first.content(),reused.content());
        assertEquals(2,db.queryForObject("SELECT count(*) FROM analysis_material_observations WHERE version_id=?",Integer.class,first.versionId()));
        assertEquals(1,db.queryForObject("SELECT count(*) FROM analysis_computation_receipts p JOIN conversation_artifacts a ON a.id=p.artifact_id WHERE a.tenant_id=?",Integer.class,tenant));
    }
    @Test void newRowsIncludingDuplicatesInvalidateWholeDatasetDependency() {
        var c=calculate(true);var first=retain(c,UUID.randomUUID(),0);
        var added=new ArrayList<>(rowsFor("old"));added.add(added.getFirst());version(2,added);
        var stale=pool.read(owner,tenant,first.materialId(),1,false);
        assertEquals("STALE",stale.state());assertEquals(first.content(),stale.content());
        assertEquals("ANALYSIS_MATERIAL_STALE",assertThrows(IdentityException.class,()->pool.read(owner,tenant,first.materialId(),1,true)).code);
    }
    @Test void correctedCalculationCreatesNewVersionWithoutReplacingOldEvidence() {
        var c=calculate(true);var first=retain(c,UUID.randomUUID(),0);
        snapshot=version(2,"new");var next=calculate(true);
        denied(()->retain(next,first.materialId(),0));
        var second=retain(next,first.materialId(),1);
        assertEquals(2,second.number());assertEquals("CURRENT",second.state());
        var historical=pool.read(owner,tenant,first.materialId(),1,false);
        assertEquals("SUPERSEDED",historical.state());assertEquals(first.content(),historical.content());
        assertNotEquals(first.content(),second.content());
        assertThrows(DataAccessException.class,()->db.update("UPDATE analysis_material_versions SET recipe_version='fake' WHERE id=?",first.versionId()));
        assertThrows(DataAccessException.class,()->db.update("UPDATE analysis_materials SET owner_id=? WHERE id=?",peer(),first.materialId()));
    }
    @Test void sharedSourcePermissionDoesNotExposePrivateTaskMaterial() {
        var c=calculate(true);var first=retain(c,UUID.randomUUID(),0);UUID peer=peer();
        denied(()->pool.read(peer,tenant,first.materialId(),1,false));
        denied(()->pool.retain(peer,tenant,c.artifact(),UUID.randomUUID(),0,Instant.now().plusSeconds(3600)));
        denied(()->pool.read(owner,UUID.randomUUID(),first.materialId(),1,false));
    }
    @Test void revocationIsCheckedEvenWhenCurrentSnapshotAlreadyObserved() {
        var c=calculate(true);var first=retain(c,UUID.randomUUID(),0);
        db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);
        denied(()->pool.read(owner,tenant,first.materialId(),1,false));
    }
    @Test void withdrawnSourceAndSuspendedTenantBlockHistoricalAsWellAsCurrentReads() {
        var c=calculate(true);var first=retain(c,UUID.randomUUID(),0);
        db.update("UPDATE business_datasets SET status='WITHDRAWN' WHERE id=?",dataset);
        denied(()->pool.read(owner,tenant,first.materialId(),1,false));
        db.update("UPDATE tenants SET status='SUSPENDED' WHERE id=?",tenant);
        denied(()->pool.read(owner,tenant,first.materialId(),1,false));
    }
    @Test void validityMustBeBoundedAndFuture() {
        var c=calculate(true);
        denied(()->pool.retain(owner,tenant,c.artifact(),UUID.randomUUID(),0,Instant.now().minusSeconds(1)));
        denied(()->pool.retain(owner,tenant,c.artifact(),UUID.randomUUID(),0,Instant.now().plusSeconds(32L*86400)));
    }
    UUID coveredVersion(int n,Instant coverage) {
        UUID id=UUID.randomUUID(),run=UUID.randomUUID();
        db.update("INSERT INTO collection_runs(id,tenant_id,connection_id,execution_epoch,trigger_kind,status) VALUES (?,?,?,1,'SCHEDULED','SUCCEEDED')",run,tenant,connection);
        db.update("INSERT INTO dataset_snapshots(id,tenant_id,connection_id,dataset_id,run_id,version,data_rows,row_count,collected_at,coverage_through) VALUES (?,?,?,?,?,?,?::jsonb,?,now(),?)",id,tenant,connection,dataset,run,n,json.writeValueAsString(rowsFor("old")),rowsFor("old").size(),java.sql.Timestamp.from(coverage));
        db.update("UPDATE business_datasets SET current_snapshot=? WHERE id=?",id,dataset);return id;
    }
    @Test void generationTimeCannotStandInForBusinessCoverage() {
        var c=calculate(true);var first=retain(c,UUID.randomUUID(),0);
        assertEquals("ANALYSIS_COVERAGE_UNKNOWN",assertThrows(IdentityException.class,()->pool.forUse(owner,tenant,first.materialId(),1,Instant.now().minusSeconds(3600))).code);
        Instant cutoff=Instant.now().minusSeconds(7200);coveredVersion(2,cutoff);
        assertEquals("ANALYSIS_COVERAGE_TOO_OLD",assertThrows(IdentityException.class,()->pool.forUse(owner,tenant,first.materialId(),1,Instant.now().minusSeconds(3600))).code);
        var allowed=pool.forUse(owner,tenant,first.materialId(),1,cutoff.minusSeconds(1));
        assertEquals(first.content(),allowed.content());assertNotNull(allowed.coverageThrough());
    }
    @Test void expiredVersionRemainsHistoricalButCannotBeUsedAsCurrent() throws Exception {
        var c=calculate(true);UUID material=UUID.randomUUID();
        pool.retain(owner,tenant,c.artifact(),material,0,Instant.now().plusMillis(500));
        Thread.sleep(550);
        assertEquals("EXPIRED",pool.read(owner,tenant,material,1,false).state());
        denied(()->pool.read(owner,tenant,material,1,true));
    }
    @Test void simultaneousFirstRetainsAreIdempotent() throws Exception {
        var c=calculate(true);UUID material=UUID.randomUUID();
        try(var executor=java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var start=new java.util.concurrent.CountDownLatch(1);
            var a=executor.submit(()->{start.await();return retain(c,material,0);});
            var b=executor.submit(()->{start.await();return retain(c,material,0);});start.countDown();
            assertEquals(a.get(10,java.util.concurrent.TimeUnit.SECONDS),b.get(10,java.util.concurrent.TimeUnit.SECONDS));
        }
        assertEquals(1,db.queryForObject("SELECT count(*) FROM analysis_material_versions WHERE material_id=?",Integer.class,material));
    }

    @Autowired org.springframework.transaction.PlatformTransactionManager transactionManager;
    @Test void sourceWithdrawalWaitsForConsumerTransactionAndThenBlocksUse() throws Exception {
        var c=calculate(true);var first=retain(c,UUID.randomUUID(),0);
        var locked=new java.util.concurrent.CountDownLatch(1);var release=new java.util.concurrent.CountDownLatch(1);
        var writerStarted=new java.util.concurrent.CountDownLatch(1);
        try(var executor=java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var reader=executor.submit(()->new org.springframework.transaction.support.TransactionTemplate(transactionManager).execute(status->{
                var v=pool.read(owner,tenant,first.materialId(),1,true);locked.countDown();
                try{if(!release.await(5,java.util.concurrent.TimeUnit.SECONDS))throw new IllegalStateException("reader timed out");}
                catch(InterruptedException ex){Thread.currentThread().interrupt();throw new IllegalStateException(ex);}return v;
            }));
            assertTrue(locked.await(5,java.util.concurrent.TimeUnit.SECONDS));
            var writer=executor.submit(()->{writerStarted.countDown();return db.update("UPDATE business_datasets SET status='WITHDRAWN' WHERE id=?",dataset);});
            assertTrue(writerStarted.await(5,java.util.concurrent.TimeUnit.SECONDS));
            try {assertThrows(java.util.concurrent.TimeoutException.class,()->writer.get(150,java.util.concurrent.TimeUnit.MILLISECONDS));}
            finally {release.countDown();}
            reader.get(5,java.util.concurrent.TimeUnit.SECONDS);assertEquals(1,writer.get(5,java.util.concurrent.TimeUnit.SECONDS));
        }
        denied(()->pool.read(owner,tenant,first.materialId(),1,true));
    }
    @Test void sourceErasureRemovesAccessWithoutLeavingASecondCopyOfContent() {
        var c=calculate(true);var first=retain(c,UUID.randomUUID(),0);
        db.update("UPDATE dataset_snapshots SET scrubbed=true,data_rows='[]'::jsonb WHERE id=?",snapshot);
        denied(()->pool.read(owner,tenant,first.materialId(),1,false));
        assertEquals(0,db.queryForObject("SELECT octet_length(content) FROM conversation_artifacts WHERE id=?",Integer.class,c.artifact()));
    }

    @Test void changingBusinessQuestionCannotSilentlyReplaceAnExistingMaterial() {
        var first=retain(calculate(true),UUID.randomUUID(),0);
        var reversed=calculate(true,new DatasetCalculationService.Request(dataset,snapshot,"门店","期间","收款（元）","本期","前期"));
        assertEquals("ANALYSIS_MATERIAL_SCOPE_CHANGED",assertThrows(IdentityException.class,()->retain(reversed,first.materialId(),1)).code);
        assertEquals("CURRENT",pool.read(owner,tenant,first.materialId(),1,true).state());
    }
    @Test void verifiedSummaryRetainsItsQueryAndCannotGainAnInventedCoverageTime() {
        var request=new DatasetCalculationService.Request(dataset,snapshot,null,null,"收款（元）",null,null,null,null,"SUM","SUMMARY",List.of("门店"),null,null,null,null);
        var material=retain(calculate(true,request),UUID.randomUUID(),0);
        assertEquals("dataset-summary-1",material.content().at("/calculation/recipeVersion").asString());
        assertNull(material.coverageThrough());
        assertThrows(DataAccessException.class,()->db.update("UPDATE analysis_material_observations SET coverage_through=now() WHERE version_id=?",material.versionId()));
    }

}
