package com.dreamcore.workspace.briefing;

import com.dreamcore.workspace.analysis.CalculationMaterialService;
import com.dreamcore.workspace.identity.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Current authorization and source coverage fence shared by callbacks and the terminal commit. */
@Service
public class BriefingFlowGuard {
 @org.springframework.beans.factory.annotation.Value("${dreamcore.briefing.daily-enabled:false}") private boolean enabled;
 private final JdbcTemplate db; private final CalculationMaterialService materials;
 private final JsonMapper json=new JsonMapper();
 public BriefingFlowGuard(JdbcTemplate db,CalculationMaterialService materials){this.db=db;this.materials=materials;}
 @Transactional public void requireCurrent(UUID task){
  var flow=db.queryForList("SELECT f.schedule_revision,s.revision,s.enabled,p.owner_id,g.owner_id current_owner FROM briefing_flow_tasks f JOIN briefing_daily_schedules s ON s.policy_id=f.policy_id JOIN briefing_generation_policies p ON p.id=s.policy_id JOIN tenant_governance g ON g.tenant_id=p.tenant_id WHERE f.task_id=? FOR SHARE OF s,g",task);
  if(flow.isEmpty())return;
  var f=flow.getFirst();
  if(!enabled||!Boolean.TRUE.equals(f.get("enabled"))||!f.get("schedule_revision").equals(f.get("revision"))||!f.get("owner_id").equals(f.get("current_owner")))throw new IdentityException(409,"BRIEFING_SCHEDULE_CHANGED");
  var sources=db.queryForList("SELECT d.column_names,pinned.data_rows pinned_rows,s.data_rows,s.coverage_through,(f.column_hashes->>d.id::text)=md5(d.column_names::text) columns_current FROM briefing_dataset_selections x JOIN briefing_flow_tasks f ON f.task_id=x.task_id JOIN business_datasets d ON d.id=x.dataset_id JOIN dataset_snapshots pinned ON pinned.id=x.snapshot_id JOIN dataset_snapshots s ON s.id=d.current_snapshot WHERE x.task_id=? FOR SHARE OF d,s,pinned",task);
  for(var use:db.queryForList("SELECT u.*,t.requested_by,t.tenant_id FROM briefing_material_uses u JOIN conversation_tasks t ON t.id=u.task_id WHERE u.task_id=?",task))materials.forUse((UUID)use.get("requested_by"),(UUID)use.get("tenant_id"),(UUID)use.get("material_id"),(Integer)use.get("version_number"),Instant.now().minusSeconds(7200));
  for(var source:sources){
   var coverage=(Timestamp)source.get("coverage_through");
   if(coverage==null||coverage.toInstant().isBefore(Instant.now().minusSeconds(7200)))throw new IdentityException(409,"BRIEFING_SOURCE_TOO_OLD");
   if(!Boolean.TRUE.equals(source.get("columns_current"))||!rows(source.get("pinned_rows")).equals(rows(source.get("data_rows"))))throw new IdentityException(409,"BRIEFING_SOURCE_CHANGED");
  }
 }
 private List<String> rows(Object value){var result=new ArrayList<String>();json.readTree(value.toString()).forEach(r->result.add(r.toString()));Collections.sort(result);return result;}
 @Transactional public void retain(UUID task){
  var tasks=db.queryForList("SELECT t.requested_by,t.tenant_id FROM conversation_tasks t JOIN briefing_flow_tasks f ON f.task_id=t.id WHERE t.id=? AND t.status='SUCCEEDED'",task);
  if(tasks.isEmpty())return;
  var t=tasks.getFirst();UUID actor=(UUID)t.get("requested_by"),tenant=(UUID)t.get("tenant_id");
  for(var a:db.queryForList("SELECT a.id,a.content FROM conversation_artifacts a JOIN analysis_computation_receipts r ON r.artifact_id=a.id JOIN conversation_tasks t ON t.id=a.task_id AND t.attempt=a.attempt_number WHERE a.task_id=? ORDER BY a.id",task)){
   var reused=db.queryForList("SELECT version_id FROM briefing_material_uses WHERE task_id=? AND artifact_id=?",UUID.class,task,a.get("id"));
   if(!reused.isEmpty()){db.update("INSERT INTO briefing_flow_materials(task_id,artifact_id,version_id) VALUES (?,?,?) ON CONFLICT DO NOTHING",task,a.get("id"),reused.getFirst());continue;}
   var content=json.readTree((byte[])a.get("content"));
   var request=json.readValue(content.path("calculation").path("request").toString(),TreeMap.class);request.remove("snapshotId");
   UUID material=UUID.nameUUIDFromBytes((tenant+":"+actor+":"+json.writeValueAsString(request)).getBytes(java.nio.charset.StandardCharsets.UTF_8));
   db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","analysis:"+tenant);
   int current=db.queryForObject("SELECT coalesce((SELECT current_version FROM analysis_materials WHERE id=?),0)",Integer.class,material);
   var version=materials.retain(actor,tenant,(UUID)a.get("id"),material,current,Instant.now().plusSeconds(86400));
   db.update("INSERT INTO briefing_flow_materials(task_id,artifact_id,version_id) VALUES (?,?,?) ON CONFLICT DO NOTHING",task,a.get("id"),version.versionId());
  }
 }
}
