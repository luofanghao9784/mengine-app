package com.dreamcore.workspace.scene;

import com.dreamcore.workspace.collection.NativeGovernanceDeployment;
import com.dreamcore.workspace.collection.NativeMaterialGovernance;
import com.dreamcore.workspace.governance.GovernanceReferencePolicy;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.identity.IdentityService;
import com.dreamcore.workspace.knowledge.WikiArticleService;
import com.dreamcore.workspace.material.MaterialService;
import java.util.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Isolation;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Service
public class NativeKnowledgeService {
 @Autowired private NativeGovernanceDeployment governance;
 @Autowired private NativeMaterialGovernance materialGovernance;
 @Autowired private com.dreamcore.workspace.knowledge.DatasetKnowledgeService datasetKnowledge;
 @Autowired private com.dreamcore.workspace.knowledge.DatasetBusinessKnowledgeService businessKnowledge;
 @Autowired private com.dreamcore.workspace.knowledge.KnowledgePipelineProgress pipeline;
 @Autowired private KnowledgeSourceProjection provenance;
 private final MaterialService materials;
 private final WikiArticleService articles;
 private final IdentityService identities;
 private final JsonMapper json=new JsonMapper();
 public NativeKnowledgeService(MaterialService materials,WikiArticleService articles,IdentityService identities){this.materials=materials;this.articles=articles;this.identities=identities;}

 private Map<String,Object> card(String id,String name,String group,String why,String content,List<?> rows,List<String> actions){
  return new LinkedHashMap<>(Map.of("id",id,"name",name,"group",group,"why",why,"side",group,"tone","plain","verdict",content,"kvHead",List.of("项","内容","状态"),"kv",rows,"actions",actions));
 }
 private Map<String,Object> traced(Map<String,Object> card,List<KnowledgeSourceProjection.Source> sources){
  String category=KnowledgeSourceProjection.category(sources);
  card.put("sourceCategory",category);card.put("sources",sources);card.put("side",KnowledgeSourceProjection.label(category));
  var rows=new ArrayList<List<String>>();
  rows.add(List.of("来源类别",KnowledgeSourceProjection.label(category),"当前授权","plain"));
  for(var source:sources){
   rows.add(List.of("来源",source.name(),source.version(),"plain"));
   rows.add(List.of(source.kind().equals("DATASET")?"数据快照":"原件版本",source.versionId()==null?"尚未采集":source.versionId().toString(),source.sourceId().toString(),"plain"));
   if(source.runId()!=null)rows.add(List.of("解析批次",source.runId().toString(),"代次 "+source.generation(),"plain"));
   if(source.materialId()!=null)rows.add(List.of("上传原件",source.materialId().toString(),source.materialVersionId().toString(),"plain"));
   if(source.releaseId()!=null)rows.add(List.of("发布依据",source.releaseId().toString(),"当前有效","plain"));
  }
  rows.addAll((List<List<String>>)card.get("kv"));card.put("kv",rows);return card;
 }
 private List<MaterialService.Entry> sources(UUID actor,UUID tenant){
  var out=new ArrayList<MaterialService.Entry>();
  for(int offset=0;offset<=9900;offset+=100){var page=materials.list(actor,tenant,null,null,"",offset,100);for(var entry:page.items())if("DOCUMENT".equals(entry.kind()))out.add(entry);if(!page.hasMore())return out;}
  throw new IdentityException(409,"SCENE_ASSET_LIMIT");
 }
 @Transactional(isolation=Isolation.REPEATABLE_READ) public JsonNode snapshot(UUID actor,UUID tenant){
  identities.member(actor,tenant,false);
  var items=new ArrayList<Map<String,Object>>();var waiting=new ArrayList<Map<String,Object>>();
  var published=new HashSet<UUID>();var datasetPublished=new HashSet<UUID>();
  // Compiled definitions and genuine multi-source insights are different useful knowledge.
  for(var article:datasetKnowledge.current(actor,tenant)){
   var source=provenance.dataset(actor,tenant,article.datasetId(),article.releaseId());
   if(source.isEmpty()||!datasetPublished.add(article.datasetId()))continue;
   if(source.get().materialId()!=null)published.add(source.get().materialId());
   items.add(traced(card("deployment-auto-"+article.id(),article.title(),"数据口径知识","已发布口径整理；当前快照、检查及模型审阅持续核验",article.content(),List.of(),List.of()),List.of(source.get())));
  }
  for(var g:(List<NativeGovernanceDeployment.Published>)GovernanceReferencePolicy.referenceCards(governance,actor,tenant)){
   var source=provenance.dataset(actor,tenant,g.datasetId(),g.releaseId());
   if(source.isEmpty()||g.knowledge().isBlank()||!datasetPublished.add(g.datasetId()))continue;
   if(source.get().materialId()!=null)published.add(source.get().materialId());
   items.add(traced(card("deployment-"+g.releaseId()+"-"+g.datasetId(),"数据治理参考知识","数据口径知识","绑定当前快照与模型审阅",g.knowledge(),List.of(),List.of()),List.of(source.get())));
  }
  // Prefer structured upload knowledge and the current native publication over duplicate ingestion paths.
  for(var m:materialGovernance.current(actor,tenant)){
   var source=provenance.material(actor,tenant,m.materialId(),m.releaseId());
   if(source.isEmpty()||!provenance.materialReady(actor,tenant,source.get())||!published.add(m.materialId()))continue;
   items.add(traced(card("material-deployment-"+m.releaseId()+"-"+m.materialId(),m.title(),"资料知识","绑定原件、完整解析版本与当前模型审阅",m.content(),List.of(),List.of("查看来源","重新核验")),List.of(source.get())));
  }
  for(int offset=0;offset<=9980;offset+=20){
   var page=articles.list(actor,tenant,false,offset);
   for(var article:page.items()){
    if(article.archived()||article.sourceChanged()||article.article()==null||published.contains(article.materialId()))continue;
    var source=provenance.material(actor,tenant,article.materialId(),null);
    if(source.isEmpty()||!source.get().versionId().equals(article.sourceVersionId())||!provenance.materialReady(actor,tenant,source.get()))continue;
    published.add(article.materialId());
    items.add(traced(card("article-"+article.id(),article.article().title(),"资料知识",article.article().intro(),article.article().content(),List.of(List.of("知识版本","v"+article.revision(),article.id().toString(),"plain")),List.of("查看来源","重新核验")),List.of(source.get())));
   }
   if(!page.hasMore())break;if(offset==9980)throw new IdentityException(409,"SCENE_ASSET_LIMIT");
  }
  for(var article:businessKnowledge.current(actor,tenant)){
   var sourceList=new ArrayList<KnowledgeSourceProjection.Source>();boolean valid=!article.sources().isEmpty();
   for(var ref:article.sources()){
    var source=provenance.dataset(actor,tenant,ref.datasetId(),ref.releaseId());
    if(source.isEmpty()||!source.get().versionId().equals(ref.snapshotId())){valid=false;break;}sourceList.add(source.get());
   }
   if(valid){
    items.add(traced(card("deployment-business-"+article.id(),article.title(),"AI 经营知识","基于全部当前获权来源；事实、AI 解读与建议分开展示",article.content(),List.of(),List.of()),sourceList));
    for(var source:sourceList){datasetPublished.add(source.sourceId());if(source.materialId()!=null)published.add(source.materialId());}
   }
  }
  int sourceCount=0;var datasetOriginals=new HashSet<UUID>();
  for(var source:provenance.datasetSources(actor,tenant)){
   sourceCount++;
   if(source.materialId()!=null)datasetOriginals.add(source.materialId());
   if(datasetPublished.contains(source.sourceId())||(source.materialId()!=null&&published.contains(source.materialId())))continue;
   boolean ready=provenance.datasetReady(actor,tenant,source);String reason=provenance.waitingReason(source,ready);
   waiting.add(traced(card("dataset-"+source.sourceId(),source.name(),"来源待处理",reason,"这是当前获权的数据集来源，尚未形成当前可用知识。"+reason+"。",List.of(),List.of("查看来源","重新核验")),List.of(source)));
  }
  for(var entry:sources(actor,tenant)){
   if(datasetOriginals.contains(entry.id()))continue;
   var source=provenance.material(actor,tenant,entry.id(),null);if(source.isEmpty())continue;sourceCount++;
   if(!published.contains(entry.id())){
    boolean ready=provenance.materialReady(actor,tenant,source.get());String reason=provenance.waitingReason(source.get(),ready);
    waiting.add(traced(card("material-"+entry.id(),entry.name(),"来源待处理",reason,"这是当前获权的资料来源，尚未生成可用知识。"+reason+"。",List.of(List.of("来源空间",entry.workspaceName(),"当前授权","plain")),List.of("查看来源","重新核验")),List.of(source.get())));
   }
  }
  var kinds=new LinkedHashMap<String,Integer>();for(var item:items)kinds.put(item.get("id").toString(),((List<KnowledgeSourceProjection.Source>)item.get("sources")).stream().allMatch(s->s.kind().equals("DATASET"))?0:1);
  var tabs=new ArrayList<Map<String,Object>>();tabs.add(Map.of("label","全部 "+items.size(),"items",items));tabs.add(Map.of("label","来源待处理 "+waiting.size(),"items",waiting));
  for(String category:List.of("STRUCTURED","UNSTRUCTURED","SHARED_UPLOAD")){
   var matching=items.stream().filter(item->category.equals(item.get("sourceCategory"))).toList();tabs.add(Map.of("label",KnowledgeSourceProjection.label(category)+" "+matching.size(),"items",matching));
  }
  int pending=governance.pendingReview(actor,tenant);var progress=pipeline.view(actor,tenant);
  var out=json.createObjectNode();out.set("items",json.valueToTree(items));out.set("relations",json.createArrayNode());out.set("sourceKind",json.valueToTree(kinds));
  out.put("pending",pending);out.set("pipeline",json.valueToTree(progress));out.put("failed",progress.failed());out.put("busy",progress.busy());out.put("available",true);out.put("needsGraph",false);
  out.put("scopeRevision",IdentityService.hash(json.writeValueAsString(List.of(items,waiting))));out.set("tabs",json.valueToTree(tabs));
  out.set("stats",json.valueToTree(Map.of("title","知识构成","rows",List.of(List.of("已发布知识",String.valueOf(items.size())),List.of("获权来源",String.valueOf(sourceCount)),List.of("待处理来源",String.valueOf(waiting.size()))))));
  out.set("aside",json.valueToTree(Map.of("title","当前服务","rows",List.of(List.of("数据来源","AI 可用结构化数据、非结构化资料及经处理的共享上传"),List.of("发布条件","完整解析、当前模型审阅和程序检查通过；持续核验权限与版本")))));
  out.put("status",items.size()+" 条已发布知识 · "+waiting.size()+" 份来源待处理 · "+pending+" 项数据成果待复核 · "+progress.waiting()+" 项等待 · "+progress.failed()+" 项失败");return out;
 }
 @Transactional(isolation=Isolation.REPEATABLE_READ) public JsonNode source(UUID actor,UUID tenant,String id){
  identities.member(actor,tenant,false);
  if(id.startsWith("dataset-")){
   UUID dataset;
   try{dataset=UUID.fromString(id.substring(8));}catch(IllegalArgumentException invalid){throw new IdentityException(404,"DATASET_NOT_FOUND");}
   var current=provenance.datasetSource(actor,tenant,dataset).orElseThrow(()->new IdentityException(404,"DATASET_NOT_FOUND"));
   boolean ready=provenance.datasetReady(actor,tenant,current);
   return json.valueToTree(traced(card(id,current.name(),"数据集来源",provenance.waitingReason(current,ready),"当前获权数据集与版本信息。来源可读不代表知识已生成。",List.of(),List.of("返回知识")),List.of(current)));
  }
  UUID material;
  try{
   if(id.startsWith("article-")){
    var article=articles.detail(actor,tenant,UUID.fromString(id.substring(8)));
    if(article.archived()||article.sourceChanged())throw new IdentityException(404,"MATERIAL_NOT_FOUND");material=article.materialId();
    var current=provenance.material(actor,tenant,material,null);
    if(current.isEmpty()||!provenance.materialReady(actor,tenant,current.get()))throw new IdentityException(404,"MATERIAL_NOT_FOUND");
   }else if(id.startsWith("material-deployment-")){
    var nativeSource=materialGovernance.current(actor,tenant).stream().filter(m->id.equals("material-deployment-"+m.releaseId()+"-"+m.materialId())).findFirst().orElseThrow(()->new IdentityException(404,"MATERIAL_NOT_FOUND"));
    material=nativeSource.materialId();var current=provenance.material(actor,tenant,material,nativeSource.releaseId());
    if(current.isEmpty()||!provenance.materialReady(actor,tenant,current.get()))throw new IdentityException(404,"MATERIAL_NOT_FOUND");
   }else if(id.startsWith("material-"))material=UUID.fromString(id.substring(9));else throw new IllegalArgumentException();
  }catch(IllegalArgumentException invalid){throw new IdentityException(404,"MATERIAL_NOT_FOUND");}
  var current=provenance.material(actor,tenant,material,null).orElseThrow(()->new IdentityException(404,"MATERIAL_NOT_FOUND"));
  boolean ready=provenance.materialReady(actor,tenant,current);
  return json.valueToTree(traced(card(id,current.name(),"资料来源",provenance.waitingReason(current,ready),"当前获权来源与版本信息。来源可读不代表知识已生成。",List.of(),List.of("返回知识")),List.of(current)));
 }
}
