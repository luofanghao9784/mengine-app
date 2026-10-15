package com.dreamcore.workspace;
import com.dreamcore.workspace.scene.SceneGovernance;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

class SceneGovernanceTest extends CompanyAnalysisFixture {
 @Test void sourceEvidenceIsPreservedWithoutPromotingInferredMeaning(){
  var j=new JsonMapper();var a=j.readTree("""
   {"dictionaryStatus":"generated","fields":[{"name":"amount","type":"number"}],"fieldEvidence":[{"column":"amount","status":"SOURCE_DOCUMENTED","reference":"源表定义：单位分"}],"dictionary":{"fields":[{"name":"amount","meaning":"金额","unit":"分","evidence":"模型解释"}]}}
   """);
  var f=SceneGovernance.field(a,a.path("fields").get(0));assertEquals("SOURCE_DOCUMENTED",f.status());assertEquals("源表定义：单位分",f.evidence());
  ((tools.jackson.databind.node.ObjectNode)a).remove("fieldEvidence");
  assertEquals("DEPLOYMENT_INFERRED",SceneGovernance.field(a,a.path("fields").get(0)).status());
 }
 @Test void sourceGateIntersectsMembershipExpiresAndRejectsWithdrawnCopies(){
  UUID target=UUID.randomUUID(),connection=UUID.randomUUID();
  db.update("INSERT INTO scene_bindings(tenant_id,workspace_id,connection_id,maintainer_id,governance_valid_until) VALUES(?,?,?,?,now()+interval '5 minutes')",tenant,space,connection,admin);
  String meta="{\"governance\":{\"allowedActors\":[\""+admin+"\"]}}";
  db.update("INSERT INTO scene_asset_links(tenant_id,source_id,kind,target_id,revision,metadata) VALUES(?,'synthetic','TABLE',?,'v1',?::jsonb)",tenant,target,meta);
  db.update("INSERT INTO scene_asset_revisions(tenant_id,target_id,kind,revision,metadata) VALUES(?,?,'TABLE','v1',?::jsonb)",tenant,target,meta);
  assertTrue(allowed(admin,target));assertFalse(allowed(reader,target));assertFalse(allowed(UUID.randomUUID(),target));
  assertTrue(db.queryForObject("SELECT file_dataset_readable(?,?)",Boolean.class,admin,target));
  assertFalse(db.queryForObject("SELECT file_dataset_readable(?,?)",Boolean.class,reader,target));
  db.update("UPDATE scene_bindings SET governance_valid_until=now()-interval '1 second' WHERE tenant_id=?",tenant);assertFalse(allowed(admin,target));
  db.update("UPDATE scene_bindings SET governance_valid_until=now()+interval '5 minutes' WHERE tenant_id=?",tenant);
  db.update("UPDATE scene_asset_links SET active=false WHERE tenant_id=?",tenant);assertFalse(allowed(admin,target));
  db.update("UPDATE scene_asset_links SET active=true WHERE tenant_id=?",tenant);
  db.update("UPDATE tenant_memberships SET status='DISABLED' WHERE tenant_id=? AND account_id=?",tenant,admin);assertFalse(allowed(admin,target));
 }
 private boolean allowed(UUID actor,UUID target){return Boolean.TRUE.equals(db.queryForObject("SELECT scene_asset_readable(?,?)",Boolean.class,actor,target));}
}
