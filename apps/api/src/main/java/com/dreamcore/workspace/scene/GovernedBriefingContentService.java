package com.dreamcore.workspace.scene;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.identity.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.context.annotation.Primary;
import org.springframework.transaction.annotation.Transactional;
@Service @Primary
public class GovernedBriefingContentService extends BriefingContentService {
 @org.springframework.beans.factory.annotation.Autowired(required=false) private com.dreamcore.workspace.analysis.governed.FusionPublicationService fusion;
 private final JdbcTemplate db;
 public GovernedBriefingContentService(JdbcTemplate db,IdentityAudit audit){super(db,audit);this.db=db;}
 @Override @Transactional public Document create(ConversationService.Job job,Request request){
  if(request!=null&&fusion!=null&&fusion.applies(job.id(),request.calculationArtifactId()))return fusion.create(job,request);
  if(request==null)throw IdentityException.invalid();
  boolean governed=false;
  if(request.calculationArtifactId()!=null){
   var bodies=db.queryForList("SELECT content FROM conversation_artifacts WHERE id=? AND task_id=? AND tenant_id=? AND attempt_number=(SELECT attempt FROM conversation_tasks WHERE id=?)",byte[].class,request.calculationArtifactId(),job.id(),job.tenant(),job.id());
   if(!bodies.isEmpty()){
    var payload=new tools.jackson.databind.json.JsonMapper().readTree(bodies.getFirst());String dataset=payload.path("datasetSource").path("datasetId").asText();
    if(!dataset.isEmpty())try{governed=Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM scene_asset_revisions WHERE tenant_id=? AND target_id=? AND kind='TABLE')",Boolean.class,job.tenant(),UUID.fromString(dataset)));}catch(IllegalArgumentException e){throw new IdentityException(422,"BRIEFING_CALCULATION_INVALID");}
   }
  }
  if(governed&& !Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM metric_calculation_receipts r JOIN conversation_tasks t ON t.id=r.task_id AND t.attempt=r.attempt_number WHERE t.id=? AND r.artifact_id=? AND task_datasets_readable(t.id) AND NOT EXISTS(SELECT 1 FROM task_dataset_fences f WHERE f.task_id=t.id AND f.attempt_number=t.attempt))",Boolean.class,job.id(),request.calculationArtifactId())))throw new IdentityException(422,"METRIC_CALCULATION_REQUIRED");
  var document=super.create(job,request);
  if(governed&&document!=null)db.update("INSERT INTO metric_briefing_receipts(artifact_id,calculation_artifact_id) VALUES(?,?) ON CONFLICT DO NOTHING",document.artifactId(),request.calculationArtifactId());
  return document;
 }
}
