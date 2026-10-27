package com.dreamcore.workspace;
import com.dreamcore.workspace.collection.*;
import com.dreamcore.workspace.identity.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import static org.junit.jupiter.api.Assertions.*;

class DatasetFingerprintIntegrationTest extends TaskDatasetFixture {
 @Autowired VersionedDatasetEvidence evidence;
 @Autowired CollectionService collections;
 @Autowired DatasetContentFingerprint fingerprints;
 @Test void concurrentFingerprintMissCalculatesOnce() throws Exception {
  var entered=new CountDownLatch(1);var release=new CountDownLatch(1);var count=new AtomicInteger();
  try(var pool=Executors.newFixedThreadPool(2)){
   try{
    var first=pool.submit(()->evidence.get(tenant,dataset,snapshot,"CONTENT_FINGERPRINT","single-flight",()->{count.incrementAndGet();entered.countDown();try{assertTrue(release.await(5,TimeUnit.SECONDS));}catch(InterruptedException e){throw new RuntimeException(e);}return Map.of("value","first");}));
    assertTrue(entered.await(2,TimeUnit.SECONDS));
    var second=pool.submit(()->evidence.get(tenant,dataset,snapshot,"CONTENT_FINGERPRINT","single-flight",()->{count.incrementAndGet();return Map.of("value","second");}));
    assertThrows(TimeoutException.class,()->second.get(150,TimeUnit.MILLISECONDS));
    release.countDown();assertEquals(first.get(),second.get());assertEquals(1,count.get());
   }finally{release.countDown();}
  }
 }
 @Autowired org.springframework.transaction.PlatformTransactionManager transactions;
 @Test void repeatableReadColdMissUsesItsOwnSnapshotWithoutSerializationFailure() throws Exception {
  var barrier=new CyclicBarrier(2);
  Callable<Map<String,Object>> read=()->{
   var tx=new org.springframework.transaction.support.TransactionTemplate(transactions);
   tx.setIsolationLevel(org.springframework.transaction.TransactionDefinition.ISOLATION_REPEATABLE_READ);
   return tx.execute(status->{
    db.queryForObject("SELECT count(*) FROM dataset_evidence_receipts WHERE snapshot_id=?",Integer.class,snapshot);
    try{barrier.await(3,TimeUnit.SECONDS);}catch(Exception e){throw new RuntimeException(e);}
    return evidence.get(tenant,dataset,snapshot,"CONTENT_FINGERPRINT","repeatable-cold",()->Map.of("contentKey","same snapshot"));
   });
  };
  try(var pool=Executors.newFixedThreadPool(2)){
   var first=pool.submit(read);var second=pool.submit(read);
   assertEquals(Map.of("contentKey","same snapshot"),first.get(5,TimeUnit.SECONDS));
   assertEquals(first.get(),second.get(5,TimeUnit.SECONDS));
  }
  assertEquals(0,db.queryForObject("SELECT count(*) FROM dataset_evidence_receipts WHERE snapshot_id=? AND kind='CONTENT_FINGERPRINT'",Integer.class,snapshot));
 }
 @Test void fingerprintKeepsHistoricalAlgorithmAndChangesWithMetadataOrVersion(){
  var d=db.queryForMap("SELECT name,column_names,field_definitions,description FROM business_datasets WHERE id=?",dataset);
  var sorted=new ArrayList<String>();json.readTree(json.writeValueAsString(rowsFor("旧版本"))).forEach(r->sorted.add(r.toString()));Collections.sort(sorted);
  String expected=IdentityService.hash(json.writeValueAsString(List.of(d.get("name").toString(),d.get("column_names").toString(),d.get("field_definitions").toString(),d.get("description").toString(),sorted)));
  String first=fingerprints.key(owner,tenant,dataset,snapshot);assertEquals(expected,first);
  assertEquals(first,fingerprints.key(owner,tenant,dataset,snapshot));
  db.update("UPDATE business_datasets SET description='更新业务说明' WHERE id=?",dataset);
  assertNotEquals(first,fingerprints.key(owner,tenant,dataset,snapshot));
  UUID next=version(2,"新版本");assertNotEquals(first,fingerprints.key(owner,tenant,dataset,next));
 }
 @Test @org.springframework.transaction.annotation.Transactional
 void warmFingerprintDoesNotReadRawRows(){
  String first=fingerprints.key(owner,tenant,dataset,snapshot);
  // PostgreSQL enforces the work budget: hide the raw column after warming the immutable receipt.
  db.execute("ALTER TABLE dataset_snapshots RENAME COLUMN data_rows TO test_hidden_rows");
  try{assertEquals(first,fingerprints.key(owner,tenant,dataset,snapshot));}
  finally{db.execute("ALTER TABLE dataset_snapshots RENAME COLUMN test_hidden_rows TO data_rows");}
 }
 @Test void cachedFingerprintNeverBypassesTenantMembershipOrScrub(){
  fingerprints.key(owner,tenant,dataset,snapshot);
  UUID other=UUID.randomUUID();db.update("INSERT INTO tenants(id,name) VALUES (?,'另一合成企业')",other);
  db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",other,owner);
  assertThrows(IdentityException.class,()->fingerprints.key(owner,other,dataset,snapshot));
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);
  assertThrows(IdentityException.class,()->fingerprints.key(owner,tenant,dataset,snapshot));
  db.update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)",tenant,space,owner);
  db.update("UPDATE dataset_snapshots SET scrubbed=true,data_rows='[]' WHERE id=?",snapshot);
  assertThrows(IdentityException.class,()->fingerprints.key(owner,tenant,dataset,snapshot));
  assertEquals(0,db.queryForObject("SELECT count(*) FROM dataset_evidence_receipts WHERE snapshot_id=?",Integer.class,snapshot));
 }
}
