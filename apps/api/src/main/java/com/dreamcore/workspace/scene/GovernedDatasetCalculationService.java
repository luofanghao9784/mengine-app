package com.dreamcore.workspace.scene;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.MaterialAccess;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.context.annotation.Primary;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;
/** Retains the deployed calculator's existing source checks, decimal arithmetic and cache validation. */
@Service @Primary
public class GovernedDatasetCalculationService extends DatasetCalculationService {
 @org.springframework.beans.factory.annotation.Autowired(required=false) private com.dreamcore.workspace.analysis.governed.GovernedFusionService fusion;
 private final JdbcTemplate db;private final JsonMapper json=new JsonMapper();
 public GovernedDatasetCalculationService(JdbcTemplate db,MaterialAccess access,IdentityAudit audit){super(db,access,audit);this.db=db;}
 @Override @Transactional public Map<String,Object> calculate(ConversationService.Job job,Request request){
  if(request==null||request.datasetId()==null||request.snapshotId()==null)throw IdentityException.invalid();
  boolean governed=Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM scene_asset_revisions WHERE tenant_id=? AND target_id=? AND kind='TABLE')",Boolean.class,job.tenant(),request.datasetId()));
  if(!governed){if(request.metricId()!=null||request.metricVersion()!=null)throw IdentityException.invalid();return super.calculate(job,request);}
  if(request.metricId()==null||request.metricVersion()==null)throw new IdentityException(422,"METRIC_DEFINITION_REQUIRED");
  MetricCatalog.lockBackground(db,request.metricId(),request.metricVersion());
  // Read only published, source-current definitions already granted to this task by retrieval.
  var candidates=db.queryForList("""
   SELECT m.id,v.version,v.definition FROM conversation_tasks t
   JOIN task_metric_reads r ON r.task_id=t.id AND r.attempt_number=t.attempt
   JOIN scene_metrics m ON m.id=r.metric_id AND m.tenant_id=t.tenant_id AND m.published_version=r.version
   JOIN scene_metric_versions v ON v.metric_id=m.id AND v.version=r.version
   JOIN scene_asset_links l ON l.tenant_id=m.tenant_id AND l.source_id=m.source_id AND l.kind='TABLE' AND l.active
   JOIN task_dataset_reads pin ON pin.task_id=t.id AND pin.attempt_number=t.attempt AND pin.dataset_id=l.target_id
   WHERE t.id=? AND t.lease_token=? AND t.requested_by=? AND t.tenant_id=? AND t.status='RUNNING'
    AND l.target_id=? AND pin.snapshot_id=? AND r.dataset_id=l.target_id
    AND scene_table_scope(l.metadata)=v.source_scope AND file_dataset_readable(t.requested_by,l.target_id)
    AND task_datasets_readable(t.id) AND NOT EXISTS(SELECT 1 FROM task_dataset_fences f WHERE f.task_id=t.id AND f.attempt_number=t.attempt)
   ORDER BY m.id FOR SHARE OF m
   """,job.id(),job.token(),job.actor(),job.tenant(),request.datasetId(),request.snapshotId());
  Map<String,Object> match=null;
  for(var c:candidates){var d=json.readTree(c.get("definition").toString());if(c.get("id").equals(request.metricId())&&c.get("version").equals(request.metricVersion())&&MetricPlan.ready(d)&&MetricPlan.matches(request,MetricPlan.request(d,request.datasetId(),request.snapshotId(),request.metricId(),request.metricVersion()))){match=c;break;}}
  if(match==null)throw new IdentityException(422,candidates.isEmpty()?"METRIC_DEFINITION_REQUIRED":"METRIC_PLAN_MISMATCH");
  var result=new LinkedHashMap<String,Object>(super.calculate(job,request));
  UUID artifact=UUID.fromString(json.valueToTree(result).path("artifact").path("id").asText());
  String planHash=IdentityService.hash(json.writeValueAsString(request));
  db.update("INSERT INTO metric_calculation_receipts(artifact_id,task_id,attempt_number,metric_id,version,dataset_id,snapshot_id,plan_sha256) SELECT ?,id,attempt,?,?,?,?,? FROM conversation_tasks WHERE id=? ON CONFLICT DO NOTHING",artifact,match.get("id"),match.get("version"),request.datasetId(),request.snapshotId(),planHash,job.id());
  var definition=json.readTree(match.get("definition").toString());result.put("governedMetric",Map.of("id",match.get("id"),"version",match.get("version"),"name",definition.path("name").asText(),"unit",definition.path("unit").asText(),"planSha256",planHash,"scope",definition.path("scope").asText(),"grain",definition.path("grain").asText(),"exclusions",definition.path("exclusions").asText(),"interpretation","仅按此定义解释计算结果；保留声明的单位换算、快照范围和统计粒度，不把记录条数当人数，不把原始金额合计当有效收入。","referenceOnly",true));
  result.put("backgroundVersionIds",definition.path("backgroundVersionIds"));
  return fusion==null?result:fusion.enrich(job,request,result);
 }
}
