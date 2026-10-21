package com.dreamcore.workspace.analysis.governed;

import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.conversation.BriefingContentService.*;
import com.dreamcore.workspace.identity.*;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Publishes the complete verified fusion evidence, with a composite deduplication key. */
@Service
public class FusionPublicationService {
 private final JdbcTemplate db;private final IdentityAudit audit;private final GovernedFusionService fusion;
 private final JsonMapper json=new JsonMapper();
 public FusionPublicationService(JdbcTemplate db,IdentityAudit audit,GovernedFusionService fusion){this.db=db;this.audit=audit;this.fusion=fusion;}
 public boolean applies(UUID task,UUID calculation){return calculation!=null&&Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM governed_fusion_receipts WHERE task_id=? AND artifact_id=?)",Boolean.class,task,calculation));}
 private void require(boolean ok,String code){if(!ok)throw new IdentityException(422,code);}
 private void text(String s,int min,int max){require(s!=null&&s.strip().length()>=min&&s.length()<=max&&!s.matches("(?s).*<[^>]+>.*"),"BRIEFING_TEXT_INVALID");}
 public Document create(ConversationService.Job job,Request request){
  String type=request.businessType()==null?"DATA":request.businessType();
  require(Set.of("DATA","INSIGHT","SUGGESTION","RESULT").contains(type),"BRIEFING_TYPE_MISMATCH");
  var requested=db.queryForList("SELECT business_type FROM briefing_generation_batches WHERE task_id=? AND business_type IS NOT NULL",String.class,job.id());
  require(requested.isEmpty()||requested.getFirst().equals(type),"BRIEFING_TYPE_MISMATCH");
  text(request.title(),4,80);text(request.summary(),12,240);require(request.analysis()!=null&&request.analysis().size()>=2&&request.analysis().size()<=4,"BRIEFING_ANALYSIS_REQUIRED");for(String p:request.analysis())text(p,12,500);
  BriefingEditorialQuality.validate(request,true,true,true,false);
  var tasks=db.queryForList("SELECT attempt FROM conversation_tasks WHERE id=? AND tenant_id=? AND requested_by=? AND lease_token=? AND status='RUNNING' FOR UPDATE",job.id(),job.tenant(),job.actor(),job.token());
  require(tasks.size()==1,"FUSION_TASK_DENIED");int attempt=((Number)tasks.getFirst().get("attempt")).intValue();
  var evidence=fusion.evidence(job.id(),attempt,request.calculationArtifactId());require(evidence!=null,"FUSION_RECEIPT_REQUIRED");fusion.validateCurrent(job.id());
  var calculated=db.queryForList("""
   SELECT a.content,a.sha256 FROM conversation_artifacts a
   JOIN metric_calculation_receipts m ON m.artifact_id=a.id AND m.task_id=a.task_id AND m.attempt_number=a.attempt_number
   WHERE a.id=? AND a.task_id=? AND a.tenant_id=? AND a.attempt_number=? AND object_is_active('ARTIFACT',a.id)
    AND EXISTS(SELECT 1 FROM identity_audit p WHERE p.target_id=a.id AND p.tenant_id=a.tenant_id AND p.action='TASK_DATASET_COMPUTED' AND p.outcome='SUCCESS')
    AND EXISTS(SELECT 1 FROM conversation_tool_receipts r WHERE r.task_id=a.task_id AND r.attempt_number=a.attempt_number AND r.name='compare_dataset' AND r.status='succeeded')
   """,request.calculationArtifactId(),job.id(),job.tenant(),attempt);
  require(calculated.size()==1,"BRIEFING_CALCULATION_NOT_GRANTED");var calc=calculated.getFirst();byte[] raw=(byte[])calc.get("content");
  require(IdentityService.hash(new String(raw,StandardCharsets.UTF_8)).equals(calc.get("sha256")),"BRIEFING_CALCULATION_INVALID");
  var receipt=json.readTree(raw);var source=json.treeToValue(receipt.path("datasetSource"),DatasetCalculationService.Source.class);
  var results=evidence.path("results");require(results.size()>=2,"FUSION_RESULT_INVALID");
  String prose=request.title()+"\n"+request.summary()+"\n"+String.join("\n",request.analysis());
  // A bundle must be discussed as a bundle, not hidden behind a single-metric paragraph.
  final String narrative=prose;
  require(results.valueStream().filter(metric->narrative.contains(metric.path("label").asText())).count()>=2,"FUSION_ANALYSIS_INCOMPLETE");
  FusionNarrativeEvidence.validate(prose,evidence);
  var first=results.get(0);var rows=new ArrayList<Row>();var labels=evidence.path("dimensionLabels");
  for(var g:first.path("groups")){
   String key=json.writeValueAsString(g.path("dimensions"));String label=labels.path(key).asText();
   if(label.isBlank())label=g.path("dimensions").get(0).isNull()?"未匹配对象":g.path("dimensions").get(0).asText();
   rows.add(new Row(label,null,g.path("value").asText(),null,null,null,null,null));
  }
  require(!rows.isEmpty(),"FUSION_RESULT_INVALID");
  if(results.valueStream().allMatch(r->r.path("groups").valueStream().allMatch(g->new BigDecimal(g.path("value").asText()).signum()==0)))throw new BriefingContentService.NoUsefulData();
  var chart=new Chart("GROUPED_BAR",first.path("label").asText(),first.path("unit").asText(),"不适用","关联汇总","按已发布口径，分别汇总后对齐",rows,new Row(null,null,first.path("total").asText(),null,null,null,null,null));
  var presentation=type.equals("DATA")&&request.presentation()==null?new BriefingPresentationPolicy.Presentation("briefing-presentation-v1","EDITORIAL","TABLE",null,null,List.of()):BriefingPresentationPolicy.resolve(request,type,type.equals("DATA")?chart:null);
  var content=new Content(type.equals("DATA")?"briefing-dataset-v1":"briefing-text-v1",type,request.title().strip(),request.summary().strip(),List.copyOf(request.analysis()),type.equals("DATA")?chart:null,null,request.calculationArtifactId(),calc.get("sha256").toString(),Instant.now().toString(),source,
   new DatasetBasis("已治理关联维度","不适用",first.path("includedRecords").asInt(),first.path("baseRecords").asInt()-first.path("includedRecords").asInt(),"SUMMARY","Asia/Shanghai"),presentation,evidence);
  var previous=db.queryForList("SELECT a.id,a.sha256,a.content FROM conversation_artifacts a WHERE a.task_id=? AND a.attempt_number=? AND EXISTS(SELECT 1 FROM identity_audit p WHERE p.target_id=a.id AND p.tenant_id=a.tenant_id AND p.action='TASK_BRIEFING_CREATED' AND p.outcome='SUCCESS')",job.id(),attempt);
  if(!previous.isEmpty()){
   var old=previous.getFirst();var c=json.readValue((byte[])old.get("content"),Content.class);
   require(c.businessType().equals(type)&&c.calculationArtifactId().equals(content.calculationArtifactId())&&c.title().equals(content.title())&&c.summary().equals(content.summary())&&c.analysis().equals(content.analysis())&&Objects.equals(c.fusion(),content.fusion())&&Objects.equals(c.presentation(),content.presentation()),"BRIEFING_ALREADY_CREATED");
   return new Document((UUID)old.get("id"),old.get("sha256").toString(),c);
  }
  var dedup=evidence.deepCopy();
  for(var s:dedup.path("sources"))((tools.jackson.databind.node.ObjectNode)s).remove("snapshotId");
  String key=IdentityService.hash("FUSION:"+(type.equals("DATA")?"":type+":"+request.summary().replaceAll("[\\p{P}\\s]", "")+":")+fusion.digest(dedup));
  db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","briefing-content:"+job.tenant()+":"+job.actor());
  db.update("DELETE FROM briefing_content_keys k USING conversation_tasks t WHERE k.task_id=t.id AND k.tenant_id=? AND k.owner_id=? AND k.fingerprint=? AND t.status NOT IN('SUCCEEDED','RUNNING','QUEUED')",job.tenant(),job.actor(),key);
  db.update("INSERT INTO briefing_content_keys VALUES(?,?,?,?) ON CONFLICT DO NOTHING",job.tenant(),job.actor(),key,job.id());
  UUID owner=db.queryForObject("SELECT task_id FROM briefing_content_keys WHERE tenant_id=? AND owner_id=? AND fingerprint=?",UUID.class,job.tenant(),job.actor(),key);
  if(!job.id().equals(owner)){
   if("SUCCEEDED".equals(db.queryForObject("SELECT status FROM conversation_tasks WHERE id=?",String.class,owner)))return null;
   throw new IdentityException(409,"BRIEFING_CONTENT_IN_PROGRESS");
  }
  byte[] body=json.writeValueAsBytes(content);var size=db.queryForMap("SELECT count(*) n,coalesce(sum(octet_length(content)),0) bytes FROM conversation_artifacts WHERE task_id=? AND attempt_number=?",job.id(),attempt);
  require(((Number)size.get("n")).intValue()<8&&((Number)size.get("bytes")).longValue()+body.length<=65536,"BRIEFING_RESULT_LIMIT");
  String sha=IdentityService.hash(new String(body,StandardCharsets.UTF_8));UUID id=UUID.randomUUID();
  db.update("INSERT INTO conversation_artifacts(id,tenant_id,workspace_id,task_id,filename,sha256,content,attempt_number) VALUES(?,?,?,?,?,?,?,?)",id,job.tenant(),job.space(),job.id(),(type.equals("DATA")?"briefing-fusion-":"briefing-text-")+sha.substring(0,20)+".json",sha,body,attempt);
  audit.record(job.actor(),job.tenant(),"TASK_BRIEFING_CREATED",id,"SUCCESS");
  db.update("INSERT INTO metric_briefing_receipts(artifact_id,calculation_artifact_id) VALUES(?,?)",id,request.calculationArtifactId());
  return new Document(id,sha,content);
 }
}
