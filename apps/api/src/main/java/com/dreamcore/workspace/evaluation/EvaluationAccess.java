package com.dreamcore.workspace.evaluation;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.departure.DepartureAccess;
import com.dreamcore.workspace.governance.GovernanceAccess;
import com.dreamcore.workspace.material.MaterialAccess;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Evaluation has no authority to expand the underlying evidence's audience. */
@Service
public class EvaluationAccess {
 public record Evidence(String kind,UUID id,int revision,int attempt) {}
 public record Fact(String mode,String origin,String state,boolean exact,List<UUID> sources) {}
 private final JdbcTemplate db;private final IdentityService identities;private final GovernanceAccess governance;private final MaterialAccess materials;private final DepartureAccess departure;
 public EvaluationAccess(JdbcTemplate db,IdentityService identities,GovernanceAccess governance,MaterialAccess materials,DepartureAccess departure){this.db=db;this.identities=identities;this.governance=governance;this.materials=materials;this.departure=departure;}
 public void scope(UUID actor,UUID tenant,UUID workspace,boolean write){
  if(tenant==null){if(workspace!=null)throw IdentityException.invalid();identities.platform(actor);return;}
  if(workspace==null)throw IdentityException.invalid();var s=materials.require(actor,tenant,workspace,false);
  if(write)departure.requireActiveBusiness(actor,tenant);
  if(write&&!s.kind().equals("PERSONAL"))governance.require(actor,tenant,GovernanceAccess.Capability.EVALUATION_MAINTAIN,workspace);
 }
 public Fact evidence(UUID actor,UUID tenant,UUID workspace,Evidence e){
  if(tenant==null||e==null||e.id()==null||e.kind()==null||e.revision()<0||e.attempt()<0)throw IdentityException.invalid();
  if(e.kind().equals("MATERIAL_VERSION")){
   var rows=db.queryForList("SELECT v.workspace_id,v.number FROM material_versions v JOIN active_materials m ON m.id=v.material_id WHERE v.tenant_id=? AND v.id=?",tenant,e.id());if(rows.isEmpty())throw missing();var r=rows.getFirst();
   if(!workspace.equals(r.get("workspace_id")))throw missing();materials.require(actor,tenant,workspace,false);materials.requireVersionActive(tenant,workspace,e.id());
   return new Fact("NO_MODEL","material:"+e.id(),"AVAILABLE",e.revision()==((Number)r.get("number")).intValue()&&e.attempt()==0,List.of(e.id()));
  }
  departure.requirePrivateRead(actor,tenant);
  UUID task=e.id();Map<String,Object> feedback=null;
  if(e.kind().equals("FEEDBACK")){
   var rows=db.queryForList("SELECT f.*,v.status FROM feedback_entries f JOIN feedback_versions v ON v.feedback_id=f.id AND v.revision=f.revision JOIN readable_feedback rf ON rf.id=f.id WHERE f.id=? AND f.tenant_id=? AND f.actor_id=?",e.id(),tenant,actor);if(rows.isEmpty())throw missing();feedback=rows.getFirst();task=(UUID)feedback.get("task_id");if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM feedback_versions v WHERE v.feedback_id=? AND v.revision=? AND object_is_active('FEEDBACK_VERSION',v.id))",Boolean.class,e.id(),e.revision())))throw missing();
  }else if(!e.kind().equals("TASK"))throw IdentityException.invalid();
  if(feedback!=null&&"PUBLICATION".equals(feedback.get("kind"))){
   if(!workspace.equals(feedback.get("workspace_id")))throw missing();UUID version=(UUID)feedback.get("material_version_id");materials.require(actor,tenant,workspace,false);materials.requireVersionActive(tenant,workspace,version);
   return new Fact("NO_MODEL","publication:"+feedback.get("publication_id"),(String)feedback.get("status"),e.revision()==((Number)feedback.get("revision")).intValue()&&e.attempt()==0&&"ACTIVE".equals(feedback.get("status")),List.of(version));
  }
  var rows=db.queryForList("SELECT t.* FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id JOIN readable_source_tasks r ON r.id=t.id WHERE t.id=? AND t.tenant_id=? AND c.owner_id=?",task,tenant,actor);if(rows.isEmpty())throw missing();var t=rows.getFirst();if(!workspace.equals(t.get("workspace_id")))throw missing();materials.require(actor,tenant,workspace,false);
  var sources=new TreeSet<UUID>(db.queryForList("SELECT version_id FROM conversation_originals WHERE task_id=? UNION SELECT c.version_id FROM conversation_sources s JOIN knowledge_chunks c ON c.id=s.chunk_id WHERE s.task_id=? UNION SELECT c.version_id FROM conversation_agent_grants g JOIN knowledge_chunks c ON c.id=g.chunk_id WHERE g.task_id=? UNION SELECT version_id FROM feedback_task_sources WHERE task_id=? UNION SELECT version_id FROM task_context_materials WHERE task_id=?",UUID.class,task,task,task,task,task));
  if(feedback!=null)sources.addAll(db.queryForList("SELECT version_id FROM feedback_source_versions WHERE feedback_id=?",UUID.class,e.id()));
  for(UUID version:sources){var s=db.queryForList("SELECT workspace_id FROM material_versions WHERE tenant_id=? AND id=?",UUID.class,tenant,version);if(s.isEmpty())throw missing();materials.require(actor,tenant,s.getFirst(),false);materials.requireVersionActive(tenant,s.getFirst(),version);}
  String mode=switch(Objects.toString(t.get("execution_class"),"none")){case "verification"->"VERIFICATION";case "live"->"LIVE";case "none"->"SOURCE_LOOKUP".equals(t.get("mode"))?"NO_MODEL":"UNKNOWN";default->"UNKNOWN";};
  boolean exact=feedback==null?e.revision()==((Number)t.get("revision")).intValue()&&e.attempt()==((Number)t.get("attempt")).intValue():e.revision()==((Number)feedback.get("revision")).intValue()&&"ACTIVE".equals(feedback.get("status"));
  return new Fact(mode,"task:"+task,feedback==null?(String)t.get("status"):(String)feedback.get("status"),exact,List.copyOf(sources));
 }
 public IdentityException missing(){return new IdentityException(404,"EVALUATION_EVIDENCE_UNAVAILABLE");}
}
