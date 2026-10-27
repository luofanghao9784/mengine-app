package com.dreamcore.workspace.scene;

import com.dreamcore.workspace.governance.GovernanceModelService;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class KnowledgeSourceProjectionTest {
 @Test void categoryUsesSharedUploadPrecedenceWithoutLosingVersionTrace(){
  var source=new KnowledgeSourceProjection.Source("SHARED_UPLOAD","MATERIAL",UUID.randomUUID(),"制度",UUID.randomUUID(),"v2",UUID.randomUUID(),3,null,null,null,null);
  assertEquals("SHARED_UPLOAD",KnowledgeSourceProjection.category(List.of(source)));
  assertEquals("STRUCTURED",KnowledgeSourceProjection.category(List.of(new KnowledgeSourceProjection.Source("STRUCTURED","DATASET",UUID.randomUUID(),"数据",UUID.randomUUID(),"v1",null,null,UUID.randomUUID(),null,null,null))));
  assertEquals("SHARED_UPLOAD",KnowledgeSourceProjection.category(List.of(new KnowledgeSourceProjection.Source("STRUCTURED","DATASET",UUID.randomUUID(),"数据",UUID.randomUUID(),"v1",null,null,null,null,null,null),source)));
 }
 @Test void materialsRequireFullParseAndCurrentModelReview(){
  var models=mock(GovernanceModelService.class);var projection=new KnowledgeSourceProjection(mock(JdbcTemplate.class),models);
  var source=new KnowledgeSourceProjection.Source("UNSTRUCTURED","MATERIAL",UUID.randomUUID(),"制度",UUID.randomUUID(),"v1",UUID.randomUUID(),1,null,null,null,"PARTIAL");
  UUID actor=UUID.randomUUID(),tenant=UUID.randomUUID();
  assertFalse(projection.materialReady(actor,tenant,source));verifyNoInteractions(models);
  var parsed=new KnowledgeSourceProjection.Source("UNSTRUCTURED","MATERIAL",source.sourceId(),source.name(),source.versionId(),"v1",source.runId(),1,null,null,null,"READY");
  assertFalse(projection.materialReady(actor,tenant,parsed));
  when(models.materialAnalysisReady(actor,tenant,source.sourceId())).thenReturn(true);
  assertTrue(projection.materialReady(actor,tenant,parsed));
  when(models.materialAnalysisReady(actor,tenant,source.sourceId())).thenReturn(false);
  assertFalse(projection.materialReady(actor,tenant,parsed));
 }
 @Test void operationalReadinessCannotBypassCurrentModelPublicationForStructuredKnowledge(){
  var models=mock(GovernanceModelService.class);var db=mock(JdbcTemplate.class);var projection=new KnowledgeSourceProjection(db,models);
  UUID actor=UUID.randomUUID(),tenant=UUID.randomUUID(),dataset=UUID.randomUUID(),snapshot=UUID.randomUUID(),release=UUID.randomUUID();
  when(models.analysisReadiness(actor,tenant,dataset)).thenReturn(new GovernanceModelService.AnalysisReadiness("legacy-ready",null));
  assertTrue(projection.dataset(actor,tenant,dataset,release).isEmpty());verifyNoInteractions(db);
  when(models.datasetKnowledgeReady(actor,tenant,dataset)).thenReturn(true);
  when(db.queryForList(anyString(),eq(tenant),eq(dataset),eq(actor))).thenReturn(List.of(Map.of("name","合成表","snapshot_id",snapshot,"version",2)));
  var ready=projection.dataset(actor,tenant,dataset,release).orElseThrow();
  assertEquals("STRUCTURED",ready.category());assertEquals(snapshot,ready.versionId());assertEquals(release,ready.releaseId());
  when(models.datasetKnowledgeReady(actor,tenant,dataset)).thenReturn(false);
  assertTrue(projection.dataset(actor,tenant,dataset,release).isEmpty());
 }

}
