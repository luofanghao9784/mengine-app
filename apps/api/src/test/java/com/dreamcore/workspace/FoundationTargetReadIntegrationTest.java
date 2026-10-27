package com.dreamcore.workspace;

import com.dreamcore.workspace.collection.CollectionService;
import com.dreamcore.workspace.material.MaterialService;
import com.dreamcore.workspace.scene.NativeFoundationService;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.AfterEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Real projections and authorization; catalog guards enforce the detail read's work budget. */
class FoundationTargetReadIntegrationTest extends TaskDatasetFixture {
 @Autowired NativeFoundationService foundation;
 @MockitoSpyBean CollectionService collectionReads;
 @MockitoSpyBean MaterialService materialReads;
 @AfterEach void clearParsingFixture(){db.update("UPDATE knowledge_runs SET status='CANCELLED' WHERE tenant_id=? AND status IN ('QUEUED','RUNNING')",tenant);}
 void forbidCatalogReads(){
  doThrow(new AssertionError("single asset must not enumerate all datasets")).when(collectionReads).datasets(eq(owner),eq(tenant),eq(""),anyInt(),eq(100));
  doThrow(new AssertionError("target must reach the dataset query")).when(collectionReads).datasets(eq(owner),eq(tenant),eq(""),eq(""),anyInt(),eq(100),isNull());
  doThrow(new AssertionError("target must reach the material query")).when(materialReads).list(eq(owner),eq(tenant),isNull(),isNull(),eq(""),anyInt(),eq(100),eq(false),isNull());
  doThrow(new AssertionError("single asset must not enumerate all materials")).when(materialReads).list(eq(owner),eq(tenant),isNull(),isNull(),eq(""),anyInt(),eq(100));
 }
 @Test void datasetDetailIsIndependentOfUnrelatedCatalogAndStillChecksRevocation(){
  for(int i=0;i<105;i++){
   UUID unrelated=UUID.randomUUID(),version=UUID.randomUUID();
   db.update("INSERT INTO business_datasets(id,tenant_id,connection_id,workspace_id,dataset_key,name,column_names) VALUES (?,?,?,?,?,?, '[\"无关字段\"]')",unrelated,tenant,connection,space,"unrelated-"+i,"无关资料"+i);
   db.update("INSERT INTO dataset_snapshots(id,tenant_id,connection_id,dataset_id,run_id,version,data_rows,row_count,collected_at) SELECT ?,tenant_id,connection_id,?,run_id,1,data_rows,row_count,collected_at FROM dataset_snapshots WHERE id=?",version,unrelated,snapshot);
   db.update("UPDATE business_datasets SET current_snapshot=? WHERE id=?",version,unrelated);
  }
  var expected=foundation.snapshot(owner,tenant).path("items");assertTrue(expected.size()>100);
  forbidCatalogReads();
  var actual=foundation.detail(owner,tenant,"dataset-"+dataset).path("asset");
  assertEquals("dataset-"+dataset,actual.path("id").asText());assertEquals("销售数据",actual.path("title").asText());assertEquals(2,actual.path("fieldCount").asInt());
  UUID other=UUID.randomUUID();db.update("INSERT INTO tenants(id,name) VALUES (?,'合成其他企业')",other);db.update("INSERT INTO tenant_memberships(tenant_id,account_id,role) VALUES (?,?,'MEMBER')",other,owner);
  assertThrows(IdentityException.class,()->foundation.detail(owner,other,"dataset-"+dataset));
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);
  assertThrows(IdentityException.class,()->foundation.detail(owner,tenant,"dataset-"+dataset));
 }
 @Test void documentDetailSkipsBothFullCatalogs(){
  var material=materialReads.upload(owner,tenant,space,null,null,null,UUID.randomUUID(),new MockMultipartFile("file","合成说明.txt","text/plain","合成业务说明".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
  forbidCatalogReads();
  var actual=foundation.detail(owner,tenant,"material-"+material.id()).path("asset");
  assertEquals("material-"+material.id(),actual.path("id").asText());assertEquals("合成说明.txt",actual.path("title").asText());
 }
}
