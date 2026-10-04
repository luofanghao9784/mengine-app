package com.dreamcore.workspace.objectlifecycle;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.departure.DepartureAccess;
import com.dreamcore.workspace.governance.GovernanceAccess;
import com.dreamcore.workspace.material.MaterialAccess;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;
/** Metadata and maintenance still follow original content scope, including private evidence. */
@Component public class ObjectLifecycleAccess {
 private final JdbcTemplate db;private final IdentityService identities;private final MaterialAccess materials;private final GovernanceAccess governance;private final DepartureAccess departure;
 private final JsonMapper json=new JsonMapper();
 public ObjectLifecycleAccess(JdbcTemplate db,IdentityService identities,MaterialAccess materials,GovernanceAccess governance,DepartureAccess departure){this.db=db;this.identities=identities;this.materials=materials;this.governance=governance;this.departure=departure;}
 public Map<String,Object> source(String kind,UUID id){var rows=db.queryForList("SELECT * FROM lifecycle_object_sources WHERE kind=? AND object_id=?",kind,id);if(rows.isEmpty())throw missing();return rows.getFirst();}
 public void require(UUID actor,UUID tenant,Map<String,Object> source,boolean purge){
  if(!Objects.equals(tenant,source.get("tenant_id")))throw missing();
  if(tenant==null){identities.platform(actor);return;}
  UUID space=(UUID)source.get("workspace_id"),owner=(UUID)source.get("owner_id");
  if(source.get("kind").equals("PROFILE_VERSION")){
   identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);
   if(owner!=null&&!owner.equals(identities.permissionActor(actor,tenant)))throw missing();if(space!=null)materials.require(actor,tenant,space,false);
   if(owner==null)governance.require(actor,tenant,GovernanceAccess.Capability.PROFILE_MAINTAIN,space);
   if(purge&&owner==null&&!governance.allows(actor,tenant,GovernanceAccess.Capability.LIFECYCLE_PURGE,space)&&!governance.allows(actor,tenant,GovernanceAccess.Capability.LIFECYCLE_PURGE,null))throw new IdentityException(403,"LIFECYCLE_PURGE_REQUIRED");
   return;
  }
  var scope=materials.require(actor,tenant,space,false);
  if(owner!=null&&!owner.equals(identities.permissionActor(actor,tenant)))throw missing();
  if(owner!=null)departure.requirePrivateRead(actor,tenant);else departure.requireContentRead(actor,tenant,space);
  String kind=(String)source.get("kind");
  if(owner==null){GovernanceAccess.Capability cap=kind.equals("EXPERIENCE_VERSION")?GovernanceAccess.Capability.EXPERIENCE_MAINTAIN:GovernanceAccess.Capability.EVALUATION_MAINTAIN;governance.require(actor,tenant,cap,space);}
  if(purge&&owner==null&&!governance.allows(actor,tenant,GovernanceAccess.Capability.LIFECYCLE_PURGE,space)&&!governance.allows(actor,tenant,GovernanceAccess.Capability.LIFECYCLE_PURGE,null))throw new IdentityException(403,"LIFECYCLE_PURGE_REQUIRED");
  // Owning a task is not owning its sources. Metadata never contains their contents.
  requireSources(actor,tenant,kind,(UUID)source.get("object_id"));
 }
 private void material(UUID actor,UUID tenant,UUID version){var rows=db.queryForList("SELECT workspace_id FROM material_versions WHERE id=? AND tenant_id=?",UUID.class,version,tenant);if(rows.isEmpty())throw missing();materials.require(actor,tenant,rows.getFirst(),false);materials.requireVersionActive(tenant,rows.getFirst(),version);}
 private void task(UUID actor,UUID tenant,UUID task){
  departure.requirePrivateRead(actor,tenant);
  var rows=db.queryForList("SELECT t.workspace_id FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id WHERE t.id=? AND t.tenant_id=? AND c.owner_id=?",UUID.class,task,tenant,identities.permissionActor(actor,tenant));if(rows.isEmpty())throw missing();materials.require(actor,tenant,rows.getFirst(),false);
  for(UUID v:db.queryForList("SELECT version_id FROM conversation_originals WHERE task_id=? UNION SELECT c.version_id FROM conversation_sources s JOIN knowledge_chunks c ON c.id=s.chunk_id WHERE s.task_id=? UNION SELECT c.version_id FROM conversation_agent_grants s JOIN knowledge_chunks c ON c.id=s.chunk_id WHERE s.task_id=? UNION SELECT version_id FROM feedback_task_sources WHERE task_id=? UNION SELECT version_id FROM task_context_materials WHERE task_id=?",UUID.class,task,task,task,task,task))material(actor,tenant,v);
 }
 private void feedback(UUID actor,UUID tenant,UUID id){
  departure.requirePrivateRead(actor,tenant);
  var rows=db.queryForList("SELECT task_id,material_version_id FROM feedback_entries WHERE id=? AND tenant_id=? AND actor_id=?",id,tenant,actor);if(rows.isEmpty())throw missing();var r=rows.getFirst();
  if(r.get("task_id")!=null)task(actor,tenant,(UUID)r.get("task_id"));else material(actor,tenant,(UUID)r.get("material_version_id"));
  for(UUID v:db.queryForList("SELECT version_id FROM feedback_source_versions WHERE feedback_id=?",UUID.class,id))material(actor,tenant,v);
 }
 public void requireSources(UUID actor,UUID tenant,String kind,UUID id){
  if(tenant==null)return;
  switch(kind){
   case "TASK" -> task(actor,tenant,id);
   case "DOCUMENT","ARTIFACT","EXPORT_CACHE" -> {var s=source(kind,id);String p=(String)s.get("parent_kind");requireSources(actor,tenant,p,(UUID)s.get("parent_id"));}
   case "FEEDBACK_VERSION" -> {UUID feedback=db.queryForObject("SELECT feedback_id FROM feedback_versions WHERE id=?",UUID.class,id);feedback(actor,tenant,feedback);}
   case "EXPERIENCE_VERSION" -> {
    String mode=db.queryForObject("SELECT access_mode FROM experience_versions WHERE id=?",String.class,id);
    if(mode.equals("SOURCE_BOUND"))for(var e:db.queryForList("SELECT * FROM experience_evidence WHERE version_id=?",id)){if(e.get("material_version_id")!=null)material(actor,tenant,(UUID)e.get("material_version_id"));else task(actor,tenant,(UUID)e.get("task_id"));}
   }
   case "EVALUATION_VERSION" -> {
    String evidence=db.queryForObject("SELECT evidence::text FROM evaluation_asset_versions WHERE id=?",String.class,id);var items=json.readTree(evidence).get("items");if(items!=null)for(var e:items){String k=e.get("kind").asString();UUID ref=UUID.fromString(e.get("id").asString());if(k.equals("MATERIAL_VERSION"))material(actor,tenant,ref);else if(k.equals("TASK"))task(actor,tenant,ref);else {feedback(actor,tenant,ref);}}
   }
   case "EVALUATION_RUN" -> {for(UUID v:db.queryForList("SELECT standard_version FROM evaluation_runs WHERE id=? UNION SELECT version_id FROM evaluation_run_samples WHERE run_id=?",UUID.class,id,id))requireSources(actor,tenant,"EVALUATION_VERSION",v);}
   default -> throw IdentityException.invalid();
  }
 }
 public IdentityException missing(){return new IdentityException(404,"LIFECYCLE_OBJECT_UNAVAILABLE");}
}
