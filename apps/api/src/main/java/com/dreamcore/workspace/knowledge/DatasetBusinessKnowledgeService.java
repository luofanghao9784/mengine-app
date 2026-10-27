package com.dreamcore.workspace.knowledge;

import com.dreamcore.workspace.collection.*;
import com.dreamcore.workspace.conversation.*;
import com.dreamcore.workspace.governance.GovernanceModelService;
import com.dreamcore.workspace.identity.*;
import java.util.*;
import java.math.BigDecimal;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Full-snapshot calculations are evidence; model prose is an interpretation, never a new fact. */
@Service
public class DatasetBusinessKnowledgeService {
 @Autowired JdbcTemplate db;
 @Autowired IdentityService identities;
 @Autowired CollectionService collections;
 @Autowired NativeGovernanceDeployment releases;
 @Autowired GovernanceModelService governance;
 @Autowired ConversationService conversations;
 @Autowired VersionedDatasetEvidence evidenceReceipts;
 @Autowired KnowledgePipelineProgress progress;
 @Autowired CollectionSourceContracts contracts;
 @org.springframework.beans.factory.annotation.Value("${dreamcore.governance.source-evidence:}") String evidencePath="";
 public void waiting(UUID tenant,String reason){progress.record(tenant,tenant,"INSIGHT","WAITING",reason);}
 public void failed(UUID tenant){progress.record(tenant,tenant,"INSIGHT","FAILED","PROCESSING_FAILED");}
 public void scheduled(UUID tenant){progress.record(tenant,tenant,"INSIGHT","SUCCEEDED","TASK_REGISTERED");}
 private final JsonMapper json=new JsonMapper();
 public record Fact(String id,UUID datasetId,String text) {}
 public record Source(UUID datasetId,UUID snapshotId,UUID releaseId,String name) {}
 public record Context(List<Source> sources,List<Fact> facts,String boundaries,String evidenceVersion) {
  public Context(List<Source> sources,List<Fact> facts,String boundaries){this(sources,facts,boundaries,"3.0");}
 }
 public record Finding(String title,String interpretation,String action,List<String> factIds) {}
 public record Report(String title,List<Finding> findings,String limitations) {}
 public record Article(UUID id,String title,String content,List<Source> sources) {}
 private IdentityException unavailable(){return new IdentityException(409,"DATASET_INSIGHT_SOURCE_CHANGED");}
 private void owner(UUID actor,UUID tenant){identities.member(actor,tenant,false);if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM tenant_governance WHERE tenant_id=? AND owner_id=?)",Boolean.class,tenant,actor)))throw new IdentityException(403,"DATASET_INSIGHT_OWNER_REQUIRED");}
 private void fact(List<Fact> facts,UUID dataset,String text){facts.add(new Fact("F"+(facts.size()+1),dataset,text));}
 @Transactional public Context capture(UUID actor,UUID tenant){
  identities.member(actor,tenant,false);
  var rows=db.queryForList("SELECT d.id,d.name,d.current_snapshot,d.column_names,s.row_count FROM business_datasets d JOIN dataset_snapshots s ON s.id=d.current_snapshot WHERE d.tenant_id=? AND d.status='ACTIVE' AND NOT d.scrubbed AND NOT s.scrubbed ORDER BY d.id LIMIT 41",tenant);
  if(rows.isEmpty())throw new IdentityException(409,"DATASET_INSIGHT_NO_SOURCES");
  if(rows.size()>40)throw new IdentityException(409,"DATASET_INSIGHT_PARTITION_REQUIRED");
  if(rows.size()!=db.queryForObject("SELECT count(*) FROM business_datasets WHERE tenant_id=? AND status='ACTIVE' AND NOT scrubbed",Integer.class,tenant))throw new IdentityException(409,"DATASET_INSIGHT_SOURCE_INCOMPLETE");
  List<Source> sources=new ArrayList<>();List<Fact> facts=new ArrayList<>();
  for(var row:rows){
   UUID id=(UUID)row.get("id");
   if(!collections.readable(actor,tenant,id))throw new IdentityException(403,"DATASET_INSIGHT_ACCESS_REQUIRED");
   var readiness=governance.analysisReadiness(actor,tenant,id);if(!readiness.ready())throw new IdentityException(409,readiness.reason());
   var publications=releases.currentFor(actor,tenant,id);if(publications.isEmpty())throw unavailable();
   var release=publications.getFirst();sources.add(new Source(id,(UUID)row.get("current_snapshot"),release.releaseId(),(String)row.get("name")));
   if(((Number)row.get("row_count")).longValue()>100000)throw new IdentityException(409,"DATASET_INSIGHT_PARTITION_REQUIRED");
   List<String> columns=json.readValue(row.get("column_names").toString(),List.class);
   var schema=contracts.section(evidencePath,tenant,id,(UUID)row.get("current_snapshot"),"schema");
   var methods=com.dreamcore.workspace.context.NativeAnalysisPlans.fromSchema(schema,tenant,id,(UUID)row.get("current_snapshot"),columns,release.fields(),java.time.Instant.now());
   var plans=DatasetEvidenceCalculator.declared(json.valueToTree(methods).path("items"));
   if(plans.isEmpty())plans=LegacyKnowledgePlans.forSource(row.get("name").toString(),columns,release.fields());
   var fixedPlans=plans;
   var computed=evidenceReceipts.get(tenant,id,(UUID)row.get("current_snapshot"),"INSIGHT_FACTS",List.of("facts-v3",row,release.releaseId(),release.fields(),fixedPlans),()->{
    var data=json.readTree(db.queryForObject("SELECT data_rows::text FROM dataset_snapshots WHERE tenant_id=? AND dataset_id=? AND id=? AND NOT scrubbed",String.class,tenant,id,row.get("current_snapshot")));
    return Map.of("facts",DatasetEvidenceCalculator.calculate(row.get("name").toString(),columns,data,fixedPlans));
   });
   for(Object text:(List<?>)computed.get("facts"))fact(facts,id,text.toString());
  }
  Context result=new Context(sources,facts,"覆盖以上全部当前获权数据集的完整快照计算；类别仅展示前八类。各表记录粒度不同，不做原始行拼接，不跨表加总人数、房源或金额。门店文字相同只可并列比较，不能证明实体相同。历史记录不能直接推断当前出租率、存量合同、利润、到账或逾期本金。缺乏证据的原因只能表述为待核实假设。当前版本未按合同或房间键联表，未计算趋势。");
  if(facts.size()>500||json.writeValueAsString(result).length()>45000)throw new IdentityException(409,"DATASET_INSIGHT_PARTITION_REQUIRED");return result;
 }
 @Transactional public UUID start(UUID actor,UUID tenant){
  owner(actor,tenant);db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","dataset-business-knowledge:"+tenant);
  Context context=capture(actor,tenant);String serialized=json.writeValueAsString(context),hash=IdentityService.hash(serialized);
  var existing=db.queryForList("SELECT id FROM dataset_business_knowledge WHERE tenant_id=? AND actor_id=? AND input_hash=?",UUID.class,tenant,actor,hash);if(!existing.isEmpty())return existing.getFirst();
  if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM dataset_business_knowledge k JOIN conversation_tasks t ON t.id=k.task_id WHERE k.tenant_id=? AND t.status IN ('QUEUED','RUNNING','WAITING_CAPABILITY','WAITING_INPUT','RESULT_UNKNOWN'))",Boolean.class,tenant)))throw new IdentityException(409,"DATASET_INSIGHT_BUSY");
  var spaces=db.queryForList("SELECT id FROM workspaces WHERE tenant_id=? AND owner_id=? AND kind='PERSONAL' AND NOT archived",UUID.class,tenant,actor);if(spaces.size()!=1)throw unavailable();
  var task=conversations.submitClient(actor,tenant,null,spaces.getFirst(),UUID.randomUUID(),"综合企业当前数据集的已计算证据，生成通俗、可行动且可追溯的经营知识。区分事实、推测和建议。","AGENT",null,List.of(),"AUTHORIZED_LIBRARY");
  UUID id=UUID.randomUUID();db.update("INSERT INTO dataset_business_knowledge(id,tenant_id,actor_id,input_hash,context,task_id,conversation_id) VALUES (?,?,?,?,?::jsonb,?,?)",id,tenant,actor,hash,serialized,task.tasks().getFirst().id(),task.conversation().id());return id;
 }
 public boolean ownsTask(UUID task){return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM dataset_business_knowledge WHERE task_id=?)",Boolean.class,task));}
 public Context context(ConversationService.Job job){
  owner(job.actor(),job.tenant());var r=db.queryForMap("SELECT input_hash,context::text context FROM dataset_business_knowledge WHERE task_id=? AND tenant_id=? AND actor_id=?",job.id(),job.tenant(),job.actor());
  Context current=capture(job.actor(),job.tenant());if(!IdentityService.hash(json.writeValueAsString(current)).equals(r.get("input_hash")))throw unavailable();return current;
 }
 public Report validate(String raw,Context context){
  try{
   if(raw==null||raw.length()>18000)throw unavailable();var tree=json.readTree(raw);if(!tree.isObject()||tree.size()!=3||!tree.has("title")||!tree.has("findings")||!tree.has("limitations"))throw unavailable();
   for(var finding:tree.path("findings")){
    if(!finding.isObject()||!new HashSet<>(finding.propertyNames()).equals(Set.of("title","interpretation","action","factIds")))throw unavailable();
   }
   Report report=json.readValue(raw,Report.class);text(report.title(),120);text(report.limitations(),1800);if(report.findings()==null||report.findings().isEmpty()||report.findings().size()>8)throw unavailable();
   Set<String> covered=new HashSet<>();
   for(Finding f:report.findings()){
    text(f.title(),120);text(f.interpretation(),700);text(f.action(),500);
    if(f.factIds()==null||f.factIds().isEmpty()||f.factIds().size()>20||new HashSet<>(f.factIds()).size()!=f.factIds().size())throw unavailable();
    for(String id:f.factIds()){if(context.facts().stream().noneMatch(x->x.id().equals(id)))throw unavailable();covered.add(id);}
   }
   for(var source:context.sources())if(context.facts().stream().noneMatch(f->f.datasetId().equals(source.datasetId())&&covered.contains(f.id())))throw unavailable();
   return report;
  }catch(RuntimeException invalid){throw new IdentityException(502,"DATASET_INSIGHT_RESULT_INVALID");}
 }
 private void text(String text,int max){if(text==null||text.isBlank()||text.length()>max)throw unavailable();}
 public void validateResult(ConversationService.Job job,AgentResult result){
  if(!ownsTask(job.id()))return;
  if(!"1.5".equals(result.contractVersion())||!"COMPLETE".equals(result.outcome())||!result.tools().isEmpty()||!result.artifacts().isEmpty()||!result.sourceIds().isEmpty()||!result.originalIds().isEmpty()||!result.webSources().isEmpty()||!result.skills().isEmpty())throw new IdentityException(502,"DATASET_INSIGHT_RESULT_INVALID");
  var report=validate(result.text(),context(job));db.update("UPDATE dataset_business_knowledge SET report=?::jsonb,published_at=now() WHERE task_id=?",json.writeValueAsString(report),job.id());
 }
 @Transactional public List<Article> current(UUID actor,UUID tenant){
  identities.member(actor,tenant,false);Context current;try{current=capture(actor,tenant);}catch(IdentityException missing){return List.of();}
  String hash=IdentityService.hash(json.writeValueAsString(current));List<Article> articles=new ArrayList<>();
  for(var r:db.queryForList("SELECT k.id,k.report::text report FROM dataset_business_knowledge k JOIN conversation_tasks t ON t.id=k.task_id JOIN tenant_governance g ON g.tenant_id=k.tenant_id AND g.owner_id=k.actor_id WHERE k.tenant_id=? AND k.input_hash=? AND k.published_at IS NOT NULL AND t.status='SUCCEEDED' AND t.execution_class='live' ORDER BY k.published_at DESC LIMIT 1",tenant,hash)){
   Report report=validate(r.get("report").toString(),current);StringBuilder content=new StringBuilder();
   for(var f:report.findings()){content.append(f.title()).append("\n程序核验的事实：\n");for(String id:f.factIds())current.facts().stream().filter(x->x.id().equals(id)).forEach(x->content.append(x.id()).append(" · ").append(x.text()).append("\n"));content.append("AI 解读（待核实）：").append(f.interpretation()).append("\n建议行动：").append(f.action()).append("\n\n");}
   content.append("分析边界：").append(report.limitations()).append("\n").append(current.boundaries());articles.add(new Article((UUID)r.get("id"),report.title(),content.toString(),List.copyOf(current.sources())));
  }return articles;
 }
}
