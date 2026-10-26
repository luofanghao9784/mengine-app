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
 private final JsonMapper json=new JsonMapper();
 public record Fact(String id,UUID datasetId,String text) {}
 public record Source(UUID datasetId,UUID snapshotId,UUID releaseId,String name) {}
 public record Context(List<Source> sources,List<Fact> facts,String boundaries) {}
 public record Finding(String title,String observation,String interpretation,String action,List<String> factIds) {}
 public record Report(String title,List<Finding> findings,String limitations) {}
 public record Article(UUID id,String title,String content) {}
 private IdentityException unavailable(){return new IdentityException(409,"DATASET_INSIGHT_SOURCE_CHANGED");}
 private void owner(UUID actor,UUID tenant){identities.member(actor,tenant,false);if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM tenant_governance WHERE tenant_id=? AND owner_id=?)",Boolean.class,tenant,actor)))throw new IdentityException(403,"DATASET_INSIGHT_OWNER_REQUIRED");}
 private void fact(List<Fact> facts,UUID dataset,String text){facts.add(new Fact("F"+(facts.size()+1),dataset,text));}
 @Transactional public Context capture(UUID actor,UUID tenant){
  identities.member(actor,tenant,false);
  var rows=db.queryForList("SELECT d.id,d.name,d.current_snapshot,d.column_names,s.data_rows::text data_rows FROM business_datasets d JOIN dataset_snapshots s ON s.id=d.current_snapshot WHERE d.tenant_id=? AND d.status='ACTIVE' AND NOT d.scrubbed AND NOT s.scrubbed ORDER BY d.id",tenant);
  if(rows.isEmpty()||rows.size()>40||rows.size()!=db.queryForObject("SELECT count(*) FROM business_datasets WHERE tenant_id=? AND status='ACTIVE' AND NOT scrubbed",Integer.class,tenant))throw unavailable();
  List<Source> sources=new ArrayList<>();List<Fact> facts=new ArrayList<>();
  for(var row:rows){
   UUID id=(UUID)row.get("id");
   if(!collections.readable(actor,tenant,id)||!governance.analysisReadiness(actor,tenant,id).ready())throw unavailable();
   var publications=releases.currentFor(actor,tenant,id);if(publications.isEmpty())throw unavailable();
   var release=publications.getFirst();sources.add(new Source(id,(UUID)row.get("current_snapshot"),release.releaseId(),(String)row.get("name")));
   var columns=json.readTree(row.get("column_names").toString());var data=json.readTree(row.get("data_rows").toString());
   if(data.size()>100000)throw unavailable();
   String name=(String)row.get("name");fact(facts,id,name+"：本快照共 "+data.size()+" 条来源记录；不等于独立客户数、当前有效合同数或实际到账笔数。");
   // Only known business dimensions; never send names, phones, addresses or raw rows to the model.
   for(int c=0;c<columns.size();c++){
    String col=columns.get(c).asText();
    if(!Set.of("店面","收付状态","收付标记","合同状态（原始码）","业务类型","客户状态").contains(col))continue;
    TreeMap<String,Integer> groups=new TreeMap<>();int blank=0;
    for(var r:data){String v=r.path(c).asText("");if(v.isBlank())blank++;else if(v.length()<=80)groups.merge(v,1,Integer::sum);else blank++;}
    var selected=groups.entrySet().stream().sorted(Map.Entry.<String,Integer>comparingByValue().reversed().thenComparing(Map.Entry.comparingByKey())).limit(8).toList();
    String values=String.join("；",selected.stream().map(e->e.getKey()+"："+e.getValue()+" 条").toList());
    fact(facts,id,name+"按「"+col+"」统计："+values+"；空白或超长值 "+blank+" 条；共 "+groups.size()+" 个非空类别，仅列记录最多的前八类。原始码没有业务映射时不得解释为成功、有效或逾期。");
   }
   for(int c=0;c<columns.size();c++)if("进展".equals(columns.get(c).asText())) {
    Set<String> values=new HashSet<>();int blank=0;
    for(var r:data){String value=r.path(c).asText("");if(value.isBlank())blank++;else values.add(value);}
    fact(facts,id,name+"：进展为来源自由文本，本次有 "+values.size()+" 种不同非空文本、空白 "+blank+" 条。未向模型提供文本内容，不得推断文本具体包含什么，也不能据此判断工单完成或关闭状态。");
   }
   // Finance sums retain source registration meaning; no rental/contract balances are summed across history.
   for(int c=0;c<columns.size();c++){
    String col=columns.get(c).asText();if(!name.equals("财务-流水账")||!Set.of("实收金额","实付金额","逾期费用").contains(col))continue;
    if(release.fields().stream().noneMatch(f->f.column().equals(col)&&f.type().equals("decimal")&&!f.unit().isBlank()))continue;
    BigDecimal sum=BigDecimal.ZERO;int missing=0,invalid=0;
    for(var r:data){var v=r.path(c);if(v.isNull()||v.asText().isBlank()){missing++;continue;}try{sum=sum.add(new BigDecimal(v.asText()));}catch(NumberFormatException bad){invalid++;}}
    String unit=release.fields().stream().filter(f->f.column().equals(col)).findFirst().orElseThrow().unit();
    fact(facts,id,name+"：本次完整快照所含历史记录中的「"+col+"」登记值合计 "+sum.toPlainString()+" "+unit+"；空值 "+missing+" 条，非数值 "+invalid+" 条。仅对非空合法登记值求和；并非银行到账、利润、当月收付或逾期本金。");
   }
   if(name.equals("财务-流水账")) {
    var columnList=new ArrayList<String>();for(var col:columns)columnList.add(col.asText());
    List<String> amounts=List.of("实收金额","实付金额","逾期费用");
    boolean usable=amounts.stream().allMatch(col->columnList.contains(col)&&release.fields().stream().anyMatch(f->f.column().equals(col)&&f.type().equals("decimal")&&!f.unit().isBlank()));
    if(usable)for(String dimension:List.of("店面","应收付日")) {
     int index=columnList.indexOf(dimension);if(index<0)continue;
     TreeMap<String,BigDecimal[]> grouped=new TreeMap<>();TreeMap<String,Integer> counts=new TreeMap<>();int unavailable=0;
     for(var r:data){String key=r.path(index).asText("");
      if(dimension.equals("应收付日")){if(!key.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")){unavailable++;continue;}try{java.time.LocalDate.parse(key);}catch(java.time.DateTimeException invalid){unavailable++;continue;}key=key.substring(0,7);}
      if(key.isBlank()||key.length()>80){unavailable++;continue;}
      var sums=grouped.computeIfAbsent(key,k->new BigDecimal[]{BigDecimal.ZERO,BigDecimal.ZERO,BigDecimal.ZERO});counts.merge(key,1,Integer::sum);
      for(int a=0;a<amounts.size();a++){String v=r.path(columnList.indexOf(amounts.get(a))).asText("");if(!v.isBlank())try{sums[a]=sums[a].add(new BigDecimal(v));}catch(NumberFormatException invalid){throw unavailable();}}
     }
     var keys=dimension.equals("应收付日")?grouped.descendingKeySet().stream().limit(3).toList():grouped.keySet().stream().limit(8).toList();
     for(String key:keys){var sums=grouped.get(key);String summary="";for(int a=0;a<amounts.size();a++){String col=amounts.get(a);String unit=release.fields().stream().filter(f->f.column().equals(col)).findFirst().orElseThrow().unit();summary+=col+"登记合计 "+sums[a].toPlainString()+" "+unit+"；";}
      fact(facts,id,"财务-流水账按"+dimension+(dimension.equals("应收付日")?"月份":"")+"分组「"+key+"」："+counts.get(key)+" 条；"+summary+"仅非空登记值求和。月份是账单应收付归属，不是实际现金收付月份；不能推断利润、银行到账或经营趋势。");}
     fact(facts,id,"财务-流水账按"+dimension+"分组共 "+grouped.size()+" 组，其中缺失或不能分组 "+unavailable+" 条；"+(dimension.equals("应收付日")?"仅展示来源日期最新的三个月份，可能含未来账期，不代表最近三个已结账月份。":"最多展示按名称排序的八个门店。"));
    }
   }
  }
  Context result=new Context(sources,facts,"覆盖以上全部当前获权数据集的完整快照计算；类别仅展示前八类。各表记录粒度不同，不做原始行拼接，不跨表加总人数、房源或金额。门店文字相同只可并列比较，不能证明实体相同。历史记录不能直接推断当前出租率、存量合同、利润、到账或逾期本金。缺乏证据的原因只能表述为待核实假设。当前版本未按合同或房间键联表，未计算趋势。");
  if(json.writeValueAsString(result).length()>45000)throw new IdentityException(409,"DATASET_INSIGHT_PARTITION_REQUIRED");return result;
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
   Report report=json.readValue(raw,Report.class);text(report.title(),120);text(report.limitations(),1800);if(report.findings()==null||report.findings().isEmpty()||report.findings().size()>8)throw unavailable();
   Set<String> covered=new HashSet<>();
   for(Finding f:report.findings()){
    text(f.title(),120);text(f.observation(),700);text(f.interpretation(),700);text(f.action(),500);
    if(f.factIds()==null||f.factIds().isEmpty()||f.factIds().size()>20||new HashSet<>(f.factIds()).size()!=f.factIds().size())throw unavailable();
    Set<String> numbers=new HashSet<>();
    for(var fact:context.facts())if(f.factIds().contains(fact.id())){var matcher=java.util.regex.Pattern.compile("[0-9]+(?:\\.[0-9]+)?").matcher(fact.text());while(matcher.find())numbers.add(new BigDecimal(matcher.group()).stripTrailingZeros().toPlainString());}
    var observed=java.util.regex.Pattern.compile("[0-9]+(?:\\.[0-9]+)?").matcher(f.observation().replace(",",""));while(observed.find())if(!numbers.contains(new BigDecimal(observed.group()).stripTrailingZeros().toPlainString()))throw unavailable();
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
   for(var f:report.findings()){content.append(f.title()).append("\n看到的事实：").append(f.observation()).append("\n可能的影响：").append(f.interpretation()).append("\n建议行动：").append(f.action()).append("\n计算依据：\n");for(String id:f.factIds())current.facts().stream().filter(x->x.id().equals(id)).forEach(x->content.append(x.id()).append(" · ").append(x.text()).append("\n"));content.append("\n");}
   content.append("分析边界：").append(report.limitations()).append("\n").append(current.boundaries());articles.add(new Article((UUID)r.get("id"),report.title(),content.toString()));
  }return articles;
 }
}
