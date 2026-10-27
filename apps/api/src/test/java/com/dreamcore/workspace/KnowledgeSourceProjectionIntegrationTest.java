package com.dreamcore.workspace;

import com.dreamcore.workspace.scene.KnowledgeSourceProjection;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockMultipartFile;
import static org.junit.jupiter.api.Assertions.*;

class KnowledgeSourceProjectionIntegrationTest extends CompanyAnalysisFixture {
 @Autowired KnowledgeSourceProjection projection;
 @Autowired org.springframework.transaction.PlatformTransactionManager transactions;
 @Test void unavailableSourceDoesNotRollBackOtherKnowledgeInSameRead(){
  var tx=new org.springframework.transaction.support.TransactionTemplate(transactions);
  tx.setIsolationLevel(org.springframework.transaction.TransactionDefinition.ISOLATION_REPEATABLE_READ);
  assertDoesNotThrow(()->tx.execute(status->{
   assertTrue(projection.dataset(reader,tenant,UUID.randomUUID(),null).isEmpty());
   var missing=new KnowledgeSourceProjection.Source("SHARED_UPLOAD","MATERIAL",UUID.randomUUID(),"合成已失效来源",UUID.randomUUID(),"v1",UUID.randomUUID(),1,null,null,null,"READY");
   assertFalse(projection.materialReady(reader,tenant,missing));
   UUID material=db.queryForObject("SELECT material_id FROM knowledge_chunks WHERE id=?",UUID.class,chunk);
   assertTrue(projection.material(reader,tenant,material,null).isPresent());
   return null;
  }));
 }
 @Test void sharedUploadTracesCurrentGenerationAndRejectsCrossTenantRevocationArchiveAndRemovedOriginal(){
  UUID material=db.queryForObject("SELECT material_id FROM knowledge_chunks WHERE id=?",UUID.class,chunk);
  var source=projection.material(reader,tenant,material,null).orElseThrow();
  assertEquals("SHARED_UPLOAD",source.category());assertEquals("READY",source.parseState());assertEquals(1,source.generation());
  assertFalse(projection.materialReady(reader,tenant,source)); // Parsed text alone cannot be published knowledge.
  UUID other=UUID.randomUUID();db.update("INSERT INTO tenants(id,name) VALUES(?,'外部企业')",other);
  assertTrue(projection.material(reader,other,material,null).isEmpty());
  db.update("DELETE FROM workspace_members WHERE tenant_id=? AND workspace_id=? AND account_id=?",tenant,space,reader);
  assertTrue(projection.material(reader,tenant,material,null).isEmpty());
  assertTrue(projection.material(admin,tenant,material,null).isPresent());
  db.update("UPDATE workspaces SET archived=true WHERE id=?",space);assertTrue(projection.material(admin,tenant,material,null).isEmpty());
  db.update("UPDATE workspaces SET archived=false WHERE id=?",space);
  materials.upload(admin,tenant,space,null,material,1,UUID.randomUUID(),new MockMultipartFile("file","企业介绍.txt","text/plain","合成新版企业说明".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
  var next=projection.material(admin,tenant,material,null).orElseThrow();
  assertNotEquals(source.versionId(),next.versionId());assertNotEquals(source.runId(),next.runId());assertEquals("v2",next.version());assertFalse(projection.materialReady(admin,tenant,next));
  db.update("UPDATE materials SET in_library=false WHERE id=?",material);assertTrue(projection.material(admin,tenant,material,null).isEmpty());
 }
}
