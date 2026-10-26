package com.dreamcore.workspace;
import com.dreamcore.workspace.governance.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.util.ReflectionTestUtils;
import static org.junit.jupiter.api.Assertions.*;

class GovernanceDispatchIntegrationTest extends GovernanceModelIntegrationTest {
 @Autowired GovernanceModelDispatcher dispatcher;
 @Autowired com.dreamcore.workspace.scene.NativeFoundationService foundation;
 @Autowired com.dreamcore.workspace.scene.FoundationProcessingService processing;
 void assertPublication(UUID source,String kind,boolean available){
  String key=kind+"-"+source;var snapshot=foundation.snapshot(owner,tenant);var asset=java.util.stream.StreamSupport.stream(snapshot.path("items").spliterator(),false).filter(x->key.equals(x.path("id").asText())).findFirst().orElseThrow();
  assertEquals(available,asset.path("available").asBoolean());var detail=foundation.detail(owner,tenant,key).path("asset");assertEquals(asset.path("stageStates"),detail.path("stageStates"));assertEquals(asset.path("available"),detail.path("available"));assertEquals(asset.path("availableKnowledgeCount"),detail.path("availableKnowledgeCount"));
  var actual=processing.read(owner,tenant,key,0,1,null);assertEquals(asset.path("stageStates").toString(),new tools.jackson.databind.json.JsonMapper().writeValueAsString(actual.stages().stream().limit(5).map(com.dreamcore.workspace.scene.FoundationProcessingService.Stage::state).toList()));
  assertEquals(java.util.stream.StreamSupport.stream(snapshot.path("items").spliterator(),false).filter(x->x.path("available").asBoolean()).count(),snapshot.path("passed").get(4).asLong());
  if(available){assertTrue(asset.path("ready").isNull());assertTrue(asset.path("quality").isNull());assertEquals(kind.equals("dataset")?"PUBLISHED_GOVERNANCE":"PUBLISHED_KNOWLEDGE",asset.path("availabilityKind").asText());if(kind.equals("dataset"))assertEquals(0,asset.path("availableKnowledgeCount").asInt());else assertTrue(asset.path("availabilityScope").asText().contains("原始记录未判定全部合格"));}
 }

 @Test void nativeDispatchWaitsRecoversAndSavesPrivateKnowledgeIdempotently() throws Exception{
  configure();seedBackground();var file=upload(space,"原生模型合成制度.txt","合成制度：收入必须以实际确认记录为准，不能只按订单创建认定到账。");finish(file);db.update("UPDATE knowledge_runs SET status='PARTIAL',warnings='[\"合成解析限制\"]'::jsonb WHERE tenant_id=?",tenant);
  var start=new GovernanceModelService.Execute(UUID.randomUUID(),"MATERIAL",file.material(),"CODEX");var j=jobs.execute(owner,tenant,start);UUID id=(UUID)j.get("id");assertEquals(id,jobs.execute(owner,tenant,start).get("id"));
  var req=(Map<String,Object>)j.get("request");var context=(Map<String,Object>)req.get("context");var fragment=(Map<String,Object>)((List<?>)context.get("fragments")).getFirst();String quote="收入必须以实际确认记录为准";
  var out=new LinkedHashMap<String,Object>(Map.of("title","合成制度治理","summary","实际确认是认定收入的依据。","limitations",List.of("仅合成测试"),"fields",List.of(),"evidence",List.of(Map.of("chunkId",fragment.get("id"),"quote",quote)),"knowledge",List.of(Map.of("title","收入核验边界","body","仅订单创建不能作为已经到账的证明，须核对实际确认记录。","citations",List.of(Map.of("locator",fragment.get("id").toString(),"quote",quote))))));
  denied(409,()->jobs.answer(owner,tenant,id,new GovernanceModelService.Answer(UUID.randomUUID(),1,req.get("inputHash").toString(),"CODEX",out)));
  var server=com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1",0),0);var ready=new java.util.concurrent.atomic.AtomicBoolean(false);var mapper=new tools.jackson.databind.json.JsonMapper();
  server.createContext("/internal/v1/governance-model",exchange->{try{var sent=mapper.readValue(new String(exchange.getRequestBody().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8),Map.class);var expected=new LinkedHashMap<String,Object>(req);expected.put("attempt",db.queryForObject("SELECT revision FROM governance_model_jobs WHERE id=?",Integer.class,id));assertEquals(expected,sent);assertEquals("Bearer synthetic-token-012345678901234567890",exchange.getRequestHeaders().getFirst("Authorization"));byte[] bytes=mapper.writeValueAsBytes(ready.get()?Map.of("contractVersion","2.0","jobId",id.toString(),"inputHash",req.get("inputHash"),"executor","CODEX","modelName","synthetic-codex","output",out):Map.of("code","GOVERNANCE_MODEL_PENDING"));exchange.sendResponseHeaders(ready.get()?200:202,bytes.length);exchange.getResponseBody().write(bytes);}finally{exchange.close();}});server.start();
  try{
   ReflectionTestUtils.setField(dispatcher,"base","http://127.0.0.1:"+server.getAddress().getPort());ReflectionTestUtils.setField(dispatcher,"token","synthetic-token-012345678901234567890");
   assertTrue(dispatcher.once());assertEquals("WAITING_MODEL",jobs.detail(owner,tenant,id).get("state"));assertEquals(0,db.queryForObject("SELECT count(*) FROM governance_knowledge_drafts WHERE job_id=?",Integer.class,id));
   db.update("UPDATE governance_model_jobs SET state='FAILED',revision=revision+1 WHERE id=?",id);db.update("UPDATE governance_model_dispatch SET state='FAILED' WHERE job_id=?",id);
   denied(404,()->jobs.retry(admin,tenant,id,new GovernanceModelService.Refresh(2)));jobs.retry(owner,tenant,id,new GovernanceModelService.Refresh(2));assertEquals(req,jobs.detail(owner,tenant,id).get("request"));
   // An expired paid-call lease is uncertain: require explicit retry before a fresh dispatcher executes.
   db.update("UPDATE governance_model_dispatch SET state='RUNNING',lease_token=?,lease_until=now()-interval '1 second',next_attempt=now() WHERE job_id=?",UUID.randomUUID(),id);ready.set(true);
   var recovered=new GovernanceModelDispatcher(db,jobs);ReflectionTestUtils.setField(recovered,"base","http://127.0.0.1:"+server.getAddress().getPort());ReflectionTestUtils.setField(recovered,"token","synthetic-token-012345678901234567890");assertFalse(recovered.once());var uncertain=jobs.detail(owner,tenant,id);assertEquals("FAILED",uncertain.get("state"));assertEquals("EXECUTION_OUTCOME_UNKNOWN",uncertain.get("error_code"));assertEquals(0,db.queryForObject("SELECT count(*) FROM governance_knowledge_drafts WHERE job_id=?",Integer.class,id));jobs.retry(owner,tenant,id,new GovernanceModelService.Refresh(((Number)uncertain.get("revision")).intValue()));assertTrue(recovered.once());recovered.close();
   assertEquals("DRAFT_READY",jobs.detail(owner,tenant,id).get("state"));assertEquals(1,db.queryForObject("SELECT count(*) FROM governance_knowledge_drafts WHERE job_id=?",Integer.class,id));assertEquals(0,db.queryForObject("SELECT count(*) FROM wiki_articles WHERE tenant_id=?",Integer.class,tenant));assertFalse(dispatcher.once());
   db.update("INSERT INTO tenant_governance(tenant_id,owner_id) VALUES (?,?) ON CONFLICT (tenant_id) DO UPDATE SET owner_id=excluded.owner_id",tenant,owner);
   var draft=jobs.detail(owner,tenant,id);var publication=new GovernanceModelService.Publish(((Number)draft.get("revision")).intValue(),req.get("inputHash").toString());
   denied(404,()->jobs.publish(admin,tenant,id,publication));
   denied(409,()->jobs.publish(owner,tenant,id,new GovernanceModelService.Publish(publication.revision(),"wrong-hash")));
   assertPublication(file.material(),"material",false);
   assertEquals(true,jobs.publish(owner,tenant,id,publication).get("published"));
   assertPublication(file.material(),"material",true);
   var asset=foundation.detail(owner,tenant,"material-"+file.material()).path("asset");assertEquals("PARTIAL",asset.path("stageStates").get(1).asText());assertTrue(asset.path("needsAttention").asBoolean());assertTrue(asset.path("limitations").toString().contains("合成解析限制"));
   assertFalse(foundation.snapshot(reader,tenant).path("items").get(0).path("available").asBoolean());
   assertEquals(true,jobs.publish(owner,tenant,id,publication).get("published"));
   assertEquals(1,db.queryForObject("SELECT count(*) FROM native_material_releases WHERE id=?",Integer.class,id));
   assertEquals(out,jobs.detail(owner,tenant,id).get("output"));
   assertEquals(true,jobs.detail(owner,tenant,id).get("published"));
   denied(404,()->jobs.detail(admin,tenant,id));db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);denied(404,()->jobs.detail(owner,tenant,id));denied(404,()->jobs.publish(owner,tenant,id,publication));
  }finally{server.stop(0);ReflectionTestUtils.setField(dispatcher,"token","");}
 }
 @Test void nativeKnowledgeRejectsUnsupportedCitation(){var ctx=context();ctx.put("sourceEvidence",List.of(Map.of("column","amount","proof",List.of(Map.of("snippet","合成金额以整数分保存，不代表完成支付")))));var out=output();out.put("knowledge",List.of(Map.of("title","合成知识","body","没有证据的内容不得通过。","citations",List.of(Map.of("locator","amount","quote","伪造引用并不在来源证据文本中")))));assertThrows(com.dreamcore.workspace.identity.IdentityException.class,()->jobs.validateKnowledge(out,ctx));}
 @Test void nativeWaitRechecksRevokedPermissionBeforeCallingEngine(){
  configure();seedBackground();var file=upload(space,"撤权等待.txt","合成资料：仅获权人员可以读取本条规则内容。");finish(file);
  var j=jobs.execute(owner,tenant,new GovernanceModelService.Execute(UUID.randomUUID(),"MATERIAL",file.material(),"CODEX"));UUID id=(UUID)j.get("id");
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);
  ReflectionTestUtils.setField(dispatcher,"token","synthetic-token-012345678901234567890");ReflectionTestUtils.setField(dispatcher,"base","http://127.0.0.1:1");
  try{assertTrue(dispatcher.once());assertEquals("FAILED",db.queryForObject("SELECT state FROM governance_model_dispatch WHERE job_id=?",String.class,id));assertEquals(0,db.queryForObject("SELECT count(*) FROM governance_knowledge_drafts WHERE job_id=?",Integer.class,id));}finally{ReflectionTestUtils.setField(dispatcher,"token","");}
 }
 @Test void nativeWaitMarksChangedBackgroundStaleBeforeModelCall(){
  configure();seedBackground();var file=upload(space,"版本等待.txt","合成资料：来源版本变化后需要重新核对治理任务。");finish(file);
  var j=jobs.execute(owner,tenant,new GovernanceModelService.Execute(UUID.randomUUID(),"MATERIAL",file.material(),"CODEX"));UUID id=(UUID)j.get("id");
  var group=info.get(owner,tenant).groups().stream().filter(g->g.field()==com.dreamcore.workspace.profile.CompanyInformationService.Field.NAME).findFirst().orElseThrow();
  info.change(owner,tenant,new com.dreamcore.workspace.profile.CompanyInformationService.Change(UUID.randomUUID(),com.dreamcore.workspace.profile.CompanyInformationService.Field.NAME,group.revision(),"EDIT",group.tags().getFirst().id(),"合成背景第二版",""));
  ReflectionTestUtils.setField(dispatcher,"token","synthetic-token-012345678901234567890");ReflectionTestUtils.setField(dispatcher,"base","http://127.0.0.1:1");
  try{assertTrue(dispatcher.once());assertEquals("STALE",jobs.detail(owner,tenant,id).get("state"));assertEquals(0,db.queryForObject("SELECT count(*) FROM governance_knowledge_drafts WHERE job_id=?",Integer.class,id));}finally{ReflectionTestUtils.setField(dispatcher,"token","");}
 }
 @Test void nativeDatasetPublicationKeepsUnknownAndRejectsStale() throws Exception {
  configure();seedBackground();db.update("INSERT INTO tenant_governance(tenant_id,owner_id) VALUES (?,?)",tenant,owner);
  UUID connection=UUID.randomUUID(),dataset=UUID.randomUUID(),run=UUID.randomUUID(),snapshot=UUID.randomUUID();
  deployment.apply(new com.dreamcore.workspace.collection.CollectionDeployment.Manifest("1.0",tenant,connection,"合成只读来源","合成路由","合成授权","READY","Asia/Shanghai",List.of(new com.dreamcore.workspace.collection.CollectionDeployment.Dataset(dataset,space,"test","合成表","",List.of("amount","status"),List.of()))));
  db.update("INSERT INTO collection_runs(id,tenant_id,connection_id,execution_epoch,trigger_kind,status) VALUES (?,?,?,0,'SCHEDULED','SUCCEEDED')",run,tenant,connection);
  db.update("INSERT INTO dataset_snapshots(id,tenant_id,connection_id,dataset_id,run_id,version,data_rows,row_count,collected_at) VALUES (?,?,?,?,?,1,'[]'::jsonb,0,now())",snapshot,tenant,connection,dataset,run);db.update("UPDATE business_datasets SET current_snapshot=? WHERE id=?",snapshot,dataset);
  var evidence=java.nio.file.Files.createTempFile("synthetic-publish-",".json");String quote="合成金额以整数分保存，\n不代表完成支付";
  java.nio.file.Files.writeString(evidence,new tools.jackson.databind.json.JsonMapper().writeValueAsString(Map.of("tenantId",tenant.toString(),"entries",List.of(Map.of("table","合成表","column","amount","proof",List.of(Map.of("snippet",quote)))),"schema",List.of())));ReflectionTestUtils.setField(jobs,"evidencePath",evidence.toString());
  var j=jobs.execute(owner,tenant,new GovernanceModelService.Execute(UUID.randomUUID(),"DATASET",dataset,"CODEX"));UUID id=(UUID)j.get("id");var req=(Map<String,Object>)j.get("request");var out=output();var amount=(Map<String,Object>)((List<?>)out.get("fields")).getFirst();amount.put("decision","REVISE");amount.put("evidence",quote);out.put("knowledge",List.of());
  var draft=jobs.engineAnswer(owner,tenant,id,new GovernanceModelService.Answer(UUID.randomUUID(),1,req.get("inputHash").toString(),"CODEX",out));db.update("UPDATE governance_model_dispatch SET state='SUCCEEDED' WHERE job_id=?",id);
  var publication=new GovernanceModelService.Publish(((Number)draft.get("revision")).intValue(),req.get("inputHash").toString());assertEquals(true,jobs.publish(owner,tenant,id,publication).get("published"));assertEquals(true,jobs.publish(owner,tenant,id,publication).get("published"));
  assertPublication(dataset,"dataset",true);var projected=foundation.detail(owner,tenant,"dataset-"+dataset).path("asset");assertEquals(1,projected.path("unknownFieldCount").asInt());assertEquals("PARTIAL",projected.path("stageStates").get(2).asText());assertTrue(projected.path("needsAttention").asBoolean());assertEquals(0,projected.path("total").asInt());
  assertEquals("UNKNOWN",db.queryForObject("SELECT package->'items'->0->'fields'->1->>'status' FROM native_governance_releases WHERE id=?",String.class,id));assertEquals(snapshot,db.queryForObject("SELECT current_snapshot FROM business_datasets WHERE id=?",UUID.class,dataset));
  var group=info.get(owner,tenant).groups().getFirst();info.change(owner,tenant,new com.dreamcore.workspace.profile.CompanyInformationService.Change(UUID.randomUUID(),group.field(),group.revision(),"EDIT",group.tags().getFirst().id(),"新版背景",""));
  denied(409,()->jobs.publish(owner,tenant,id,publication));assertPublication(dataset,"dataset",false);assertEquals(1,db.queryForObject("SELECT count(*) FROM native_governance_releases WHERE id=?",Integer.class,id));java.nio.file.Files.delete(evidence);
 }
}
