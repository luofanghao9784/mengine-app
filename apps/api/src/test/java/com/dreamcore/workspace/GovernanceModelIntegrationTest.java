package com.dreamcore.workspace;
import com.dreamcore.workspace.governance.GovernanceModelService;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import static org.junit.jupiter.api.Assertions.*;

/** Uses the same synthetic source/permission fixture as the real Wiki task boundary. */
class GovernanceModelIntegrationTest extends WikiLearningIntegrationTest {
 @Autowired GovernanceModelService jobs;
 @Autowired com.dreamcore.workspace.collection.CollectionDeployment deployment;
 @Autowired com.dreamcore.workspace.identity.EngineTelemetryService telemetry;
 @Autowired com.dreamcore.workspace.profile.CompanyInformationService info;
 @org.junit.jupiter.api.AfterEach void resetEvidence(){org.springframework.test.util.ReflectionTestUtils.setField(jobs,"evidencePath","");}
 @org.junit.jupiter.api.BeforeEach void enableSyntheticDispatch(){org.springframework.test.util.ReflectionTestUtils.setField(jobs,"dispatchEnabled",true);}
 @org.junit.jupiter.api.AfterEach void disableSyntheticDispatch(){org.springframework.test.util.ReflectionTestUtils.setField(jobs,"dispatchEnabled",false);db.update("UPDATE governance_model_dispatch SET state='FAILED' WHERE job_id IN (SELECT id FROM governance_model_jobs WHERE tenant_id=?) AND state IN ('PENDING','WAITING_MODEL','RUNNING')",tenant);}
 void configure(){db.update("UPDATE tenant_memberships SET role='TENANT_ADMIN' WHERE tenant_id=? AND account_id=?",tenant,owner);}
 Map<String,Object> context(){return new LinkedHashMap<>(Map.of("kind","DATASET","columns",List.of("amount","status"),"fields",List.of(Map.of("column","amount","status","SOURCE_DOCUMENTED","meaning","以分存储的金额原值","unit","分","evidence","合成明确来源：整数分"),Map.of("column","status","status","UNKNOWN","meaning","未确认","unit","","evidence","缺少状态流转依据"))));}
 Map<String,Object> output(){return new LinkedHashMap<>(Map.of("title","合成表治理草稿","summary","来源金额以分存储，不代表已经到账。状态含义仍缺证。","limitations",List.of("不能代替实际支付核验"),"fields",List.of(new LinkedHashMap<>(Map.of("column","amount","decision","KEEP_SOURCE","meaning","以分存储的金额原值","unit","分","evidence","合成明确来源：整数分")),new LinkedHashMap<>(Map.of("column","status","decision","UNKNOWN","meaning","缺少业务流转证据","unit","","evidence","来源未提供状态枚举及写入依据"))),"evidence",List.of()));}
 @Test void validatesAllFieldsAndRejectsInventedUnitsOrConfirmedUnknowns(){
  jobs.validate(output(),context());var o=output();((Map)((List)o.get("fields")).get(0)).put("unit","元");assertThrows(IdentityException.class,()->jobs.validate(o,context()));
  var u=output();((Map)((List)u.get("fields")).get(1)).put("decision","KEEP_SOURCE");assertThrows(IdentityException.class,()->jobs.validate(u,context()));
  var incomplete=output();incomplete.put("fields",List.of());assertThrows(IdentityException.class,()->jobs.validate(incomplete,context()));
 }
 @Test void sourceProofMustBeQuotedExactlyForReinterpretation(){
  var ctx=context();ctx.put("sourceEvidence",List.of(Map.of("column","status","proof",List.of(Map.of("snippet","entity.setStatus(input.getStatus()); // 合成实际写入")))));
  var out=output();var f=(Map)((List)out.get("fields")).get(1);f.put("decision","REVISE");f.put("evidence","entity.setStatus(input.getStatus());");jobs.validate(out,ctx);
  f.put("evidence","这不是实际提供的源码证据");assertThrows(IdentityException.class,()->jobs.validate(out,ctx));
 }
 @Test void durableRequestCanResumeAfterFailureWithoutPublishingOrDuplicating(){
  configure();seedBackground();var file=upload(space,"持久任务.txt","合成制度：收入必须以实际确认记录为准。");finish(file);
  var start=new GovernanceModelService.Start(UUID.randomUUID(),"MATERIAL",file.material());var job=jobs.start(owner,tenant,start);UUID id=(UUID)job.get("id");
  assertEquals(id,jobs.start(owner,tenant,start).get("id"));assertEquals("WAITING_MODEL",jobs.detail(owner,tenant,id).get("state"));
  var request=(Map<String,Object>)job.get("request");var ctx=(Map<String,Object>)request.get("context");var fragment=(Map<String,Object>)((List<?>)ctx.get("fragments")).getFirst();
  Map<String,Object> out=new LinkedHashMap<>(Map.of("title","合成制度草稿","summary","收入判断依照实际确认记录。","limitations",List.of("仅合成来源"),"fields",List.of(),"evidence",List.of(Map.of("chunkId",fragment.get("id"),"quote","完全不在原文里的伪造内容"))));
  var failed=jobs.answer(owner,tenant,id,new GovernanceModelService.Answer(UUID.randomUUID(),1,request.get("inputHash").toString(),"CODEX",out));assertEquals("FAILED",failed.get("state"));
  assertEquals(request,jobs.detail(owner,tenant,id).get("request"));
  out.put("evidence",List.of(Map.of("chunkId",fragment.get("id"),"quote","收入必须以实际确认记录为准")));
  var body=new GovernanceModelService.Answer(UUID.randomUUID(),2,request.get("inputHash").toString(),"CODEX",out);
  var ready=jobs.answer(owner,tenant,id,body);assertEquals("DRAFT_READY",ready.get("state"));assertEquals(ready.get("output"),jobs.answer(owner,tenant,id,body).get("output"));
  assertEquals(0,db.queryForObject("SELECT count(*) FROM wiki_articles WHERE tenant_id=?",Integer.class,tenant));
  denied(404,()->jobs.detail(admin,tenant,id));
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);denied(404,()->jobs.detail(owner,tenant,id));
 }
 void seedBackground(){
  info.change(owner,tenant,new com.dreamcore.workspace.profile.CompanyInformationService.Change(UUID.randomUUID(),com.dreamcore.workspace.profile.CompanyInformationService.Field.NAME,0,"ADD",null,"合成背景企业",""));
 }

 @Test void nativeDatasetFreezesFullProfileAndRejectsChangedSnapshotWithoutTouchingCollection() throws Exception{
  configure();seedBackground();UUID connection=UUID.randomUUID(),dataset=UUID.randomUUID(),run=UUID.randomUUID(),snapshot=UUID.randomUUID();
  deployment.apply(new com.dreamcore.workspace.collection.CollectionDeployment.Manifest("1.0",tenant,connection,"合成只读来源","合成路由","合成授权","READY","Asia/Shanghai",List.of(new com.dreamcore.workspace.collection.CollectionDeployment.Dataset(dataset,space,"test","合成表","",List.of("amount","status"),List.of(new com.dreamcore.workspace.collection.DatasetField("amount","integer","以分存储的金额原值","分","合成明确来源：整数分","SOURCE_DOCUMENTED"),new com.dreamcore.workspace.collection.DatasetField("status","text","未确认","","缺少状态流转依据","UNKNOWN"))))));
  db.update("INSERT INTO collection_runs(id,tenant_id,connection_id,execution_epoch,trigger_kind,status) VALUES (?,?,?,0,'SCHEDULED','SUCCEEDED')",run,tenant,connection);
  db.update("INSERT INTO dataset_snapshots(id,tenant_id,connection_id,dataset_id,run_id,version,data_rows,row_count,collected_at) VALUES (?,?,?,?,?,1,'[[\"123\",null],[\"500\",\"private-sample\"]]'::jsonb,2,now())",snapshot,tenant,connection,dataset,run);
  db.update("UPDATE business_datasets SET current_snapshot=? WHERE id=?",snapshot,dataset);
  var evidence=java.nio.file.Files.createTempFile("synthetic-governance-evidence-",".json");java.nio.file.Files.writeString(evidence,new tools.jackson.databind.json.JsonMapper().writeValueAsString(Map.of("tenantId",tenant.toString(),"entries",List.of(),"schema",List.of(Map.of("kind","column","table","合成表","name","amount","key","PRI","nullable","NO"),Map.of("kind","column","table","合成表","name","status","key","","nullable","YES")))));
  org.springframework.test.util.ReflectionTestUtils.setField(jobs,"evidencePath",evidence.toString());
  var j=jobs.execute(owner,tenant,new GovernanceModelService.Execute(UUID.randomUUID(),"DATASET",dataset,"CODEX"));var request=(Map<String,Object>)j.get("request");var ctx=(Map<String,Object>)request.get("context");assertEquals(List.of(0,1),ctx.get("nullCounts"));assertFalse(request.toString().contains("private-sample"));assertEquals(0L,((Number)((Map)ctx.get("checks")).get("duplicatePrimaryKeys")).longValue());assertEquals("CHECKED",((Map)ctx.get("checks")).get("state"));
  assertEquals(1,telemetry.read(owner,tenant,false).channels().stream().filter(c->c.code().equals("SCENE_KNOWLEDGE")).findFirst().orElseThrow().waiting());
  var nativeOutput=output();nativeOutput.put("knowledge",List.of());var draft=jobs.engineAnswer(owner,tenant,(UUID)j.get("id"),new GovernanceModelService.Answer(UUID.randomUUID(),1,request.get("inputHash").toString(),"CODEX",nativeOutput));assertEquals("DRAFT_READY",draft.get("state"));
  assertEquals(1,telemetry.read(owner,tenant,false).channels().stream().filter(c->c.code().equals("SCENE_KNOWLEDGE")).findFirst().orElseThrow().completedRecent());
  var waiting=jobs.start(owner,tenant,new GovernanceModelService.Start(UUID.randomUUID(),"DATASET",dataset));var req=(Map<String,Object>)waiting.get("request");
  var group=info.get(owner,tenant).groups().stream().filter(g->g.field()==com.dreamcore.workspace.profile.CompanyInformationService.Field.NAME).findFirst().orElseThrow();
  info.change(owner,tenant,new com.dreamcore.workspace.profile.CompanyInformationService.Change(UUID.randomUUID(),com.dreamcore.workspace.profile.CompanyInformationService.Field.NAME,group.revision(),"EDIT",group.tags().getFirst().id(),"合成背景新版",""));
  var stale=jobs.answer(owner,tenant,(UUID)waiting.get("id"),new GovernanceModelService.Answer(UUID.randomUUID(),1,req.get("inputHash").toString(),"CODEX",output()));assertEquals("STALE",stale.get("state"));
  var recovered=jobs.refresh(owner,tenant,(UUID)waiting.get("id"),new GovernanceModelService.Refresh(2));assertEquals("WAITING_MODEL",recovered.get("state"));assertEquals(3,recovered.get("revision"));assertNotEquals(req.get("inputHash"),((Map)recovered.get("request")).get("inputHash"));assertEquals(1,db.queryForObject("SELECT count(*) FROM governance_model_input_history WHERE job_id=?",Integer.class,waiting.get("id")));
  denied(409,()->jobs.answer(owner,tenant,(UUID)waiting.get("id"),new GovernanceModelService.Answer(UUID.randomUUID(),3,req.get("inputHash").toString(),"CODEX",output())));
  assertEquals(3,jobs.refresh(owner,tenant,(UUID)waiting.get("id"),new GovernanceModelService.Refresh(3)).get("revision"));
  assertEquals(snapshot,db.queryForObject("SELECT current_snapshot FROM business_datasets WHERE id=?",UUID.class,dataset));assertEquals(1,db.queryForObject("SELECT count(*) FROM collection_runs WHERE connection_id=?",Integer.class,connection));assertFalse(db.queryForObject("SELECT auto_enabled FROM data_connections WHERE id=?",Boolean.class,connection));
 }

}
