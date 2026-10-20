package com.dreamcore.workspace;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import static org.junit.jupiter.api.Assertions.*;
@org.springframework.test.context.TestPropertySource(properties="dreamcore.briefing.merge-seconds=0")
class BriefingBootstrapIntegrationTest extends DatasetCalculationFixture {
 @Autowired BriefingBootstrapDeployment deployment;
 @Autowired com.dreamcore.workspace.briefing.BriefingService feed;
 DatasetCalculationService.Request calculation(){return new DatasetCalculationService.Request(dataset,snapshot,"门店","期间","收款（元）","前期","本期");}
 BriefingContentService.Request content(){return new BriefingContentService.Request(null,"门店两期收款变化","门店登记收款有所变化，需要结合业务发生期间逐项核实。",List.of("本次使用完整固定版本计算两期收款，保留原始单位并按门店归集。","收款变化只能说明这两期的登记差异，不能据此认定实际到账或解释经营原因。"),"DATA");}
 BriefingBootstrapDeployment.Manifest manifest(UUID request,List<BriefingBootstrapDeployment.Card> cards){return new BriefingBootstrapDeployment.Manifest("1.0",request,tenant,owner,privateSpace,cards);}
 BriefingBootstrapDeployment.Card card(){return new BriefingBootstrapDeployment.Card("门店同口径收款核查",calculation(),content());}
 @Test void previewRollsBackAndApplyIsIdempotentWithExplicitExternalProvenance(){
  var m=manifest(UUID.randomUUID(),List.of(card()));var preview=deployment.apply(m,true);assertEquals(true,preview.get("preview"));
  assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_tasks WHERE tenant_id=?",Integer.class,tenant));
  var result=deployment.apply(m,false);
  assertEquals(1,feed.list(owner,tenant,null,"LATEST",null,"Asia/Shanghai",0,20,true).items().size());assertEquals(json.valueToTree(result),json.valueToTree(deployment.apply(m,false)));
  assertEquals(1,db.queryForObject("SELECT count(*) FROM conversation_tasks WHERE tenant_id=? AND status='SUCCEEDED' AND model_name='codex-external' AND model_calls IS NULL AND token_usage IS NULL",Integer.class,tenant));
  assertEquals(1,db.queryForObject("SELECT count(*) FROM conversation_attempts a JOIN conversation_tasks t ON t.id=a.task_id WHERE t.tenant_id=? AND provenance='EXTERNAL_DEPLOYMENT'",Integer.class,tenant));
  assertEquals(2,db.queryForObject("SELECT count(*) FROM conversation_tool_receipts r JOIN conversation_tasks t ON t.id=r.task_id WHERE t.tenant_id=? AND r.status='succeeded'",Integer.class,tenant));
 }
 @Test void changedSourceAndRevokedAccessCannotPublish(){
  var m=manifest(UUID.randomUUID(),List.of(card()));rows(List.of(List.of("甲","前期","1")));
  assertEquals("BOOTSTRAP_SOURCE_CHANGED",assertThrows(IdentityException.class,()->deployment.apply(m,false)).code);
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);
  assertThrows(IdentityException.class,()->deployment.apply(m,false));
  assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_tasks WHERE tenant_id=?",Integer.class,tenant));
 }
 @Test void invalidSecondCardRollsBackWholeBatchAndConflictDoesNotRewrite(){
  var bad=new BriefingBootstrapDeployment.Card("第二项",calculation(),new BriefingContentService.Request(null,"坏","不完整",List.of(),"DATA"));
  assertThrows(IdentityException.class,()->deployment.apply(manifest(UUID.randomUUID(),List.of(card(),bad)),false));
  assertEquals(0,db.queryForObject("SELECT count(*) FROM conversation_tasks WHERE tenant_id=?",Integer.class,tenant));
  var id=UUID.randomUUID();deployment.apply(manifest(id,List.of(card())),false);
  assertEquals("BOOTSTRAP_REQUEST_CONFLICT",assertThrows(IdentityException.class,()->deployment.apply(manifest(id,List.of(bad)),false)).code);
 }
 @Test void foreignTenantCannotUseSelectedDataset(){
  var m=new BriefingBootstrapDeployment.Manifest("1.0",UUID.randomUUID(),UUID.randomUUID(),owner,privateSpace,List.of(card()));assertThrows(IdentityException.class,()->deployment.apply(m,false));
 }
 @Autowired com.dreamcore.workspace.briefing.BriefingGenerationService generation;
 @Test void unchangedBootstrapStaysIdleAndNewDataDispatchesOnlyScopedDataset(){
  var m=new BriefingBootstrapDeployment.Manifest("1.0",UUID.randomUUID(),tenant,owner,privateSpace,List.of(card()),true);
  deployment.apply(m,false);
  UUID policy=db.queryForObject("SELECT id FROM briefing_generation_policies WHERE tenant_id=?",UUID.class,tenant);
  assertEquals(1,db.queryForObject("SELECT count(*) FROM briefing_bootstrap_scopes WHERE policy_id=?",Integer.class,policy));
  generation.tick(policy);
  assertEquals(1,db.queryForObject("SELECT count(*) FROM briefing_generation_batches WHERE policy_id=?",Integer.class,policy));
  snapshot=version(2,"new");
  generation.tick(policy);
  assertEquals(2,db.queryForObject("SELECT count(*) FROM briefing_generation_batches WHERE policy_id=?",Integer.class,policy));
  var selected=db.queryForList("SELECT s.dataset_id FROM briefing_dataset_selections s JOIN conversation_tasks t ON t.id=s.task_id WHERE t.tenant_id=? AND t.execution_class<>'external'",UUID.class,tenant);
  assertEquals(List.of(dataset),selected);
  assertEquals(1,db.queryForObject("SELECT count(*) FROM conversation_tasks WHERE tenant_id=? AND status='QUEUED'",Integer.class,tenant));
 }
 @Test void unreadableOldDeliveryDoesNotSuppressFreshAuthorizedSnapshot(){
  var first=json.valueToTree(deployment.apply(manifest(UUID.randomUUID(),List.of(card())),false));
  UUID oldTask=UUID.fromString(first.at("/items/0/taskId").asText());
  UUID oldArtifact=UUID.fromString(first.at("/items/0/artifactId").asText());
  var same=deployment.apply(manifest(UUID.randomUUID(),List.of(card())),false);
  assertEquals("NO_NEW_CONTENT",json.valueToTree(same).at("/items/0/state").asText());
  UUID oldSnapshot=snapshot;snapshot=version(2,"旧版本");
  db.update("UPDATE dataset_snapshots SET scrubbed=true,data_rows='[]'::jsonb WHERE id=?",oldSnapshot);
  assertFalse(db.queryForObject("SELECT EXISTS(SELECT 1 FROM readable_source_tasks WHERE id=?)",Boolean.class,oldTask));
  var next=json.valueToTree(deployment.apply(manifest(UUID.randomUUID(),List.of(card())),false));
  assertEquals("SUCCEEDED",next.at("/items/0/state").asText());
  assertNotEquals(oldArtifact.toString(),next.at("/items/0/artifactId").asText());
  assertEquals(1,db.queryForObject("SELECT count(*) FROM conversation_artifacts WHERE id=?",Integer.class,oldArtifact));
 }
}
