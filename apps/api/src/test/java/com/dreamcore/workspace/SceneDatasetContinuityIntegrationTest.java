package com.dreamcore.workspace;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SceneDatasetContinuityIntegrationTest extends TaskDatasetFixture {
 String meta(int version,int policy,String field){return """
 {"id":"sales","version":%d,"updatedAt":"v%d","policyVersion":1,"governance":{"allowedActors":["%s"]},"fields":[{"name":"%s"}],"sourceBasis":[{"id":"source-a","version":%d,"sha256":"hash%d","collectedAt":"v%d","policyVersion":%d}]}
 """.formatted(version,version,owner,field,version,version,version,policy);}
 @Test void oldTaskSurvivesOnlyDataRefreshAndStillLosesAccessOnRevocation(){
  db.update("INSERT INTO scene_bindings(tenant_id,workspace_id,connection_id,maintainer_id,governance_valid_until) VALUES(?,?,?,?,now()+interval '5 minutes')",tenant,space,connection,owner);
  var job=task(null,"AUTHORIZED_LIBRARY");call(job,request("dataset_search",null,null,0));call(job,request("dataset_read",dataset,snapshot,0));finish(job);
  assertTrue(readable(job.id()));
  db.update("UPDATE business_datasets SET status='WITHDRAWN' WHERE id=?",dataset);
  UUID current=UUID.randomUUID();
  db.update("INSERT INTO business_datasets(id,tenant_id,connection_id,workspace_id,dataset_key,name,column_names) SELECT ?,tenant_id,connection_id,workspace_id,dataset_key,name,column_names FROM business_datasets WHERE id=?",current,dataset);
  db.update("INSERT INTO scene_asset_revisions(tenant_id,target_id,kind,revision,metadata) VALUES (?,?,'TABLE','old',?::jsonb)",tenant,dataset,meta(1,1,"数量"));
  db.update("INSERT INTO scene_asset_links(tenant_id,source_id,kind,target_id,revision,metadata) VALUES (?,'sales','TABLE',?,'new',?::jsonb)",tenant,current,meta(2,1,"数量"));
  assertTrue(readable(job.id()),"data-only replacement preserves old task");
  db.update("UPDATE scene_bindings SET governance_valid_until=now()-interval '1 second' WHERE tenant_id=?",tenant);
  assertFalse(readable(job.id()),"expired grant cannot preserve history");
  db.update("UPDATE scene_bindings SET governance_valid_until=now()+interval '5 minutes' WHERE tenant_id=?",tenant);
  db.update("UPDATE scene_asset_links SET metadata=jsonb_set(metadata,'{governance,allowedActors}','[]') WHERE tenant_id=?",tenant);
  assertFalse(readable(job.id()),"current source revocation blocks historical result");

  db.update("UPDATE scene_asset_links SET metadata=?::jsonb WHERE tenant_id=?",meta(2,2,"数量"),tenant);
  assertFalse(readable(job.id()),"upstream policy change revokes old result");
  db.update("UPDATE scene_asset_links SET metadata=?::jsonb WHERE tenant_id=?",meta(2,1,"新口径"),tenant);
  assertFalse(readable(job.id()),"schema/meaning change cannot relabel old evidence");
  db.update("UPDATE scene_asset_links SET metadata=?::jsonb,active=false WHERE tenant_id=?",meta(2,1,"数量"),tenant);
  assertFalse(readable(job.id()),"source withdrawal revokes history");
  db.update("UPDATE scene_asset_links SET active=true WHERE tenant_id=?",tenant);
  db.update("UPDATE business_datasets SET status='WITHDRAWN' WHERE id=?",current);
  assertFalse(readable(job.id()));
  db.update("UPDATE business_datasets SET status='ACTIVE' WHERE id=?",current);
  db.update("DELETE FROM workspace_members WHERE workspace_id=? AND account_id=?",space,owner);
  assertFalse(readable(job.id()),"membership withdrawal still applies");
 }
 @Test void routingRestrictionBlocksExistingTaskEvenWhenSourceAndSpaceStillAllowIt(){
  db.update("INSERT INTO scene_bindings(tenant_id,workspace_id,connection_id,maintainer_id,governance_valid_until) VALUES(?,?,?,?,now()+interval '5 minutes')",tenant,space,connection,owner);
  var job=task(null,"AUTHORIZED_LIBRARY");call(job,request("dataset_search",null,null,0));call(job,request("dataset_read",dataset,snapshot,0));finish(job);
  db.update("INSERT INTO scene_asset_revisions(tenant_id,target_id,kind,revision,metadata) VALUES (?,?,'TABLE','old',?::jsonb)",tenant,dataset,meta(1,1,"数量"));
  db.update("INSERT INTO scene_asset_links(tenant_id,source_id,kind,target_id,revision,metadata) VALUES (?,'sales','TABLE',?,'new',?::jsonb)",tenant,dataset,meta(1,1,"数量"));
  assertTrue(readable(job.id()));
  db.update("UPDATE scene_asset_links SET metadata=jsonb_set(metadata,'{routing}','{\"readers\":[]}') WHERE tenant_id=?",tenant);
  assertFalse(readable(job.id()),"resource readers narrow otherwise granted source and workspace");
 }
 boolean readable(UUID task){return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM readable_source_tasks WHERE id=?)",Boolean.class,task));}
}
