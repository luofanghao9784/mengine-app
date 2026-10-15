package com.dreamcore.workspace;
import com.dreamcore.workspace.scene.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.junit.jupiter.api.Assertions.*;

class MetricCatalogTest extends TaskDatasetFixture {
 @Autowired MetricCatalog catalog;
 @MockitoBean SceneBridgeClient bridge;
 @BeforeEach void govern(){
  db.update("UPDATE tenant_memberships SET role='TENANT_ADMIN' WHERE tenant_id=?",tenant);
  db.update("INSERT INTO scene_bindings(tenant_id,workspace_id,connection_id,maintainer_id,governance_valid_until) VALUES(?,?,?,?,now()+interval '5 minutes')",tenant,space,connection,owner);
  String meta=json.writeValueAsString(Map.of("fields",List.of(Map.of("name","数量","type","number")),"governance",Map.of("allowedActors",List.of(owner.toString()),"policyVersion",1)));
  db.update("INSERT INTO scene_asset_links(tenant_id,source_id,kind,target_id,revision,metadata) VALUES(?,'synthetic','TABLE',?,'r1',?::jsonb)",tenant,dataset,meta);
  db.update("INSERT INTO scene_asset_revisions(tenant_id,target_id,kind,revision,metadata) VALUES(?,?,'TABLE','r1',?::jsonb)",tenant,dataset,meta);
  when(bridge.call(eq(tenant),anyString(),eq("GET"),eq("/scene-access"),isNull())).thenReturn(json.readTree("{\"user\":{\"role\":\"admin\"}}"));
 }
 Map<String,Object> definition(){return new HashMap<>(Map.of("name","合成数量","meaning","样本数量合计","unit","件","grain","每行一个样本","scope","仅合成快照","exclusions","无","evidence","测试业务定义，不代表真实业务","aggregation","SUM","valueField","数量"));}
 UUID save(){return UUID.fromString(json.valueToTree(catalog.save(owner,tenant,false,new MetricCatalog.Change(null,0,"synthetic",definition()))).path("id").asText());}
 @Test void publicationRetrievalPinAndWithdrawal(){
  UUID id=save();var task=task(null,"AUTHORIZED_LIBRARY");
  assertEquals(0,call(task,request("dataset_search",null,null,0)).path("items").get(0).path("governedMetrics").path("items").size());
  catalog.transition(owner,tenant,false,id,new MetricCatalog.Transition(1),true);
  var result=call(task,new com.dreamcore.workspace.context.TaskContextService.Request("dataset_search",null,"合成数量",0,null,null,null,null,null,null,null));
  assertEquals(id.toString(),result.path("items").get(0).path("governedMetrics").path("items").get(0).path("metricId").asText());
  assertEquals(1,db.queryForObject("SELECT count(*) FROM task_metric_reads WHERE task_id=?",Integer.class,task.id()));
  catalog.transition(owner,tenant,false,id,new MetricCatalog.Transition(1),false);
  assertFalse(db.queryForObject("SELECT task_datasets_readable(?)",Boolean.class,task.id()));
  denied(()->call(task,request("dataset_search",null,null,0)));
  catalog.transition(owner,tenant,false,id,new MetricCatalog.Transition(1),true);
  denied(()->call(task,request("dataset_search",null,null,0)));
 }
 @Test void draftDoesNotReplacePublishedAndSourceChangesBlockPublication(){
  UUID id=save();catalog.transition(owner,tenant,false,id,new MetricCatalog.Transition(1),true);
  catalog.save(owner,tenant,false,new MetricCatalog.Change(id,1,"synthetic",definition()));
  assertEquals(1,db.queryForObject("SELECT published_version FROM scene_metrics WHERE id=?",Integer.class,id));
  assertThrows(IdentityException.class,()->catalog.save(owner,tenant,false,new MetricCatalog.Change(id,1,"synthetic",definition())));
  db.update("UPDATE scene_asset_links SET metadata=jsonb_set(metadata,'{governance,policyVersion}','2') WHERE tenant_id=?",tenant);
  assertThrows(IdentityException.class,()->catalog.transition(owner,tenant,false,id,new MetricCatalog.Transition(2),true));
  var task=task(null,"AUTHORIZED_LIBRARY");assertEquals(0,call(task,request("dataset_search",null,null,0)).path("items").get(0).path("governedMetrics").path("items").size());
 }
 @Test void sourceAclExpiryBadColumnsAndCrossTenantAreRejected(){
  var bad=definition();bad.put("valueField","不存在");assertThrows(IdentityException.class,()->catalog.save(owner,tenant,false,new MetricCatalog.Change(null,0,"synthetic",bad)));
  UUID id=save();assertThrows(IdentityException.class,()->catalog.transition(owner,UUID.randomUUID(),false,id,new MetricCatalog.Transition(1),true));
  db.update("UPDATE scene_bindings SET governance_valid_until=now()-interval '1 second' WHERE tenant_id=?",tenant);
  assertThrows(IdentityException.class,()->catalog.transition(owner,tenant,false,id,new MetricCatalog.Transition(1),true));
  assertThrows(IdentityException.class,()->catalog.save(owner,tenant,false,new MetricCatalog.Change(null,0,"synthetic",definition())));
 }
}
