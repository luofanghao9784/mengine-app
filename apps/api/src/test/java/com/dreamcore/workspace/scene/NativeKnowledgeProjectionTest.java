package com.dreamcore.workspace.scene;

import com.dreamcore.workspace.collection.*;
import com.dreamcore.workspace.identity.IdentityService;
import com.dreamcore.workspace.knowledge.*;
import com.dreamcore.workspace.material.MaterialService;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class NativeKnowledgeProjectionTest {
 @Test void nativeAndWikiPathsProduceOneCurrentKnowledgeAndReadySourcesNeverBecomeRawRows(){
  var materials=mock(MaterialService.class);var wiki=mock(WikiArticleService.class);var identities=mock(IdentityService.class);
  var nativeMaterial=mock(NativeMaterialGovernance.class);var nativeData=mock(NativeGovernanceDeployment.class);
  var definitions=mock(DatasetKnowledgeService.class);var business=mock(DatasetBusinessKnowledgeService.class);var pipeline=mock(KnowledgePipelineProgress.class);var sources=mock(KnowledgeSourceProjection.class);
  var service=new NativeKnowledgeService(materials,wiki,identities);
  for(var entry:Map.of("materialGovernance",nativeMaterial,"governance",nativeData,"datasetKnowledge",definitions,"businessKnowledge",business,"pipeline",pipeline,"provenance",sources).entrySet())ReflectionTestUtils.setField(service,entry.getKey(),entry.getValue());
  UUID actor=UUID.randomUUID(),tenant=UUID.randomUUID(),material=UUID.randomUUID(),version=UUID.randomUUID(),release=UUID.randomUUID(),article=UUID.randomUUID();
  var trace=new KnowledgeSourceProjection.Source("SHARED_UPLOAD","MATERIAL",material,"合成制度",version,"v1",UUID.randomUUID(),1,release,null,null,"READY");
  when(materials.list(actor,tenant,null,null,"",0,100)).thenReturn(new MaterialService.Page(tenant,null,null,List.of(),false,0L,List.of(),false));
  when(pipeline.view(actor,tenant)).thenReturn(new KnowledgePipelineProgress.View(List.of(),0,0,false));
  when(nativeMaterial.current(actor,tenant)).thenReturn(List.of(new NativeMaterialGovernance.Published(release,material,"经核验制度","经过处理的内容")));
  when(wiki.list(actor,tenant,false,0)).thenReturn(new WikiArticleService.Page(List.of(new WikiArticleService.Item(article,tenant,material,1,false,false,true,"合成制度",version,1,"live","model",new WikiLearningService.Article("旧知识","概要","重复路径内容",List.of()))),false));
  when(sources.material(actor,tenant,material,release)).thenReturn(Optional.of(trace));when(sources.material(actor,tenant,material,null)).thenReturn(Optional.of(trace));
  assertEquals(0,service.snapshot(actor,tenant).path("items").size());
  when(sources.materialReady(actor,tenant,trace)).thenReturn(true);
  var snapshot=service.snapshot(actor,tenant);assertEquals(1,snapshot.path("items").size());
  var item=snapshot.path("items").get(0);assertEquals("material-deployment-"+release+"-"+material,item.path("id").asText());assertEquals("SHARED_UPLOAD",item.path("sourceCategory").asText());
  assertEquals(version.toString(),item.path("sources").get(0).path("versionId").asText());assertEquals("共享空间上传 1",snapshot.path("tabs").get(4).path("label").asText());
  when(sources.materialReady(actor,tenant,trace)).thenReturn(false);
  assertEquals(0,service.snapshot(actor,tenant).path("items").size());
 }
 @Test void businessInsightKeepsAllSourceVersionsAndDisappearsWhenAnySourceIsUnavailable(){
  var materials=mock(MaterialService.class);var wiki=mock(WikiArticleService.class);var nativeData=mock(NativeGovernanceDeployment.class);var nativeMaterial=mock(NativeMaterialGovernance.class);
  var definitions=mock(DatasetKnowledgeService.class);var business=mock(DatasetBusinessKnowledgeService.class);var pipeline=mock(KnowledgePipelineProgress.class);var sources=mock(KnowledgeSourceProjection.class);
  var service=new NativeKnowledgeService(materials,wiki,mock(IdentityService.class));
  for(var entry:Map.of("materialGovernance",nativeMaterial,"governance",nativeData,"datasetKnowledge",definitions,"businessKnowledge",business,"pipeline",pipeline,"provenance",sources).entrySet())ReflectionTestUtils.setField(service,entry.getKey(),entry.getValue());
  UUID actor=UUID.randomUUID(),tenant=UUID.randomUUID(),a=UUID.randomUUID(),b=UUID.randomUUID(),snapshotA=UUID.randomUUID(),snapshotB=UUID.randomUUID(),releaseA=UUID.randomUUID(),releaseB=UUID.randomUUID();
  when(materials.list(actor,tenant,null,null,"",0,100)).thenReturn(new MaterialService.Page(tenant,null,null,List.of(),false,0L,List.of(),false));
  when(wiki.list(actor,tenant,false,0)).thenReturn(new WikiArticleService.Page(List.of(),false));when(pipeline.view(actor,tenant)).thenReturn(new KnowledgePipelineProgress.View(List.of(),0,0,false));
  when(definitions.current(actor,tenant)).thenReturn(List.of(new DatasetKnowledgeService.Article(UUID.randomUUID(),a,"字段口径","有用的字段解释",releaseA)));
  when(business.current(actor,tenant)).thenReturn(List.of(new DatasetBusinessKnowledgeService.Article(UUID.randomUUID(),"经营建议","生成的分析和建议",List.of(new DatasetBusinessKnowledgeService.Source(a,snapshotA,releaseA,"数据A"),new DatasetBusinessKnowledgeService.Source(b,snapshotB,releaseB,"数据B")))));
  UUID original=UUID.randomUUID(),originalVersion=UUID.randomUUID(),originalRun=UUID.randomUUID();
  var sourceA=new KnowledgeSourceProjection.Source("SHARED_UPLOAD","DATASET",a,"数据A",snapshotA,"v1",originalRun,1,releaseA,original,originalVersion,null);
  var documentPath=new KnowledgeSourceProjection.Source("SHARED_UPLOAD","MATERIAL",original,"上传表格",originalVersion,"v1",originalRun,1,releaseA,null,null,"READY");
  when(nativeMaterial.current(actor,tenant)).thenReturn(List.of(new NativeMaterialGovernance.Published(releaseA,original,"同一上传的文档路径","不应重复计数")));
  when(sources.material(actor,tenant,original,releaseA)).thenReturn(Optional.of(documentPath));when(sources.materialReady(actor,tenant,documentPath)).thenReturn(true);
  var sourceB=new KnowledgeSourceProjection.Source("SHARED_UPLOAD","DATASET",b,"数据B",snapshotB,"v2",UUID.randomUUID(),1,releaseB,UUID.randomUUID(),UUID.randomUUID(),null);
  when(sources.dataset(actor,tenant,a,releaseA)).thenReturn(Optional.of(sourceA));
  assertEquals(1,service.snapshot(actor,tenant).path("items").size()); // One accessible source cannot authorize a multi-source insight.
  when(sources.dataset(actor,tenant,b,releaseB)).thenReturn(Optional.of(sourceB));
  var published=service.snapshot(actor,tenant);assertEquals(2,published.path("items").size());
  var insight=published.path("items").get(1);assertEquals("SHARED_UPLOAD",insight.path("sourceCategory").asText());assertEquals(2,insight.path("sources").size());
  var next=new KnowledgeSourceProjection.Source("SHARED_UPLOAD","DATASET",a,"数据A",UUID.randomUUID(),"v2",originalRun,1,releaseA,original,originalVersion,null);
  when(sources.dataset(actor,tenant,a,releaseA)).thenReturn(Optional.of(next));
  assertEquals(1,service.snapshot(actor,tenant).path("items").size()); // The old insight is invalid on a new source snapshot.
  when(sources.dataset(actor,tenant,a,releaseA)).thenReturn(Optional.empty());
  when(sources.materialReady(actor,tenant,documentPath)).thenReturn(false);
  assertEquals(0,service.snapshot(actor,tenant).path("items").size());
 }

}
