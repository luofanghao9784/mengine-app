package com.dreamcore.workspace.scene;

import com.dreamcore.workspace.collection.CollectionService;
import com.dreamcore.workspace.identity.IdentityService;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.material.MaterialService;
import java.util.*;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Existing platform assets projected into the current enterprise shell, with original ACLs. */
@Service
public class NativeFoundationService {
 @org.springframework.beans.factory.annotation.Autowired private org.springframework.core.env.Environment environment;
 @org.springframework.beans.factory.annotation.Autowired private org.springframework.jdbc.core.JdbcTemplate db;
 @org.springframework.beans.factory.annotation.Autowired private FoundationProcessingService processing;
 private final CollectionService collections; private final MaterialService materials; private final IdentityService identities;
 private final JsonMapper json=new JsonMapper();
 public NativeFoundationService(CollectionService collections,MaterialService materials,IdentityService identities){this.collections=collections;this.materials=materials;this.identities=identities;}
 @org.springframework.transaction.annotation.Transactional(isolation=org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
 public JsonNode detail(UUID actor,UUID tenant,String id){
  var result=processing.read(actor,tenant,id,0,1,null);
  JsonNode asset=null;for(var item:snapshot(actor,tenant).path("items"))if(id.equals(item.path("id").asText())){asset=item;break;}
  if(asset==null)throw new IdentityException(404,"FOUNDATION_ASSET_NOT_FOUND");
  var a=(tools.jackson.databind.node.ObjectNode)asset.deepCopy();a.put("fieldCount",result.fields().size());
  a.set("stageStates",json.valueToTree(result.stages().stream().limit(5).map(FoundationProcessingService.Stage::state).toList()));
  var out=json.createObjectNode();out.set("asset",a);out.putNull("analysis");out.set("audit",json.createArrayNode());out.set("findings",json.createArrayNode());
  var events=json.createArrayNode();var names=List.of("received","structure-stored","dictionary-generated","records-checked","published");
  for(int i=0;i<Math.min(5,result.stages().size());i++){var s=result.stages().get(i);if(s.at()!=null&&"READY".equals(s.state()))events.add(json.valueToTree(Map.of("event",names.get(i),"at",s.at())));}out.set("events",events);
  var batches=json.createArrayNode();for(var h:result.history())batches.add(json.valueToTree(Map.of("at",h.createdAt(),"version",result.version(),"actor","处理服务","operation",h.stage(),"status",h.state(),"reason",h.detail())));out.set("batches",batches);
  if(!"table".equals(a.path("kind").asText()))out.putNull("dictionary");else{
   var d=json.createObjectNode();d.put("status","source-defined");d.put("current",result.stages().get(2).state().equals("READY"));d.put("revision",result.version());d.putNull("at");d.put("provider","来源字段定义");d.put("tableMeaning",result.name());d.put("usageRules","按来源字段和已保存说明使用；未知业务含义仍需核实。");d.putNull("job");d.set("warnings",json.createArrayNode());d.set("relations",json.createArrayNode());
   var fields=json.createArrayNode();for(var f:result.fields()){var n=json.createObjectNode();n.put("name",f.name());n.put("label",f.name());n.put("type",f.type());n.put("meaning",f.meaning());n.put("unit",f.unit());n.put("evidence",f.evidence());n.put("rules","");n.put("required",false);n.put("unique",false);n.put("sensitive",false);fields.add(n);}d.set("fields",fields);out.set("dictionary",d);
  }return out;
 }
 public JsonNode snapshot(UUID actor,UUID tenant){
  identities.member(actor,tenant,false);
  var items=json.createArrayNode(); var visibleMaterials=new ArrayList<UUID>(); int datasets=0,documents=0,parsed=0,annotated=0,checked=0,usable=0;
  for(int offset=0;;offset+=100){
   var page=collections.datasets(actor,tenant,"",offset,100);
   for(var d:page.items()){
    var a=base("dataset-"+d.id(),d.name(),d.workspaceName(),"table",0,d.version()==null?0:d.version(),d.collectedAt()==null?null:d.collectedAt().toString());
    boolean available=d.version()!=null;
    if(available)usable++;
    if(!d.fieldDefinitions().isEmpty())annotated++;
    a.put("available",available);a.put("label",available?"已采集 · 口径见字段说明":"等待采集");a.put("total",d.rowCount()==null?0:d.rowCount());a.put("ready",available?d.rowCount():0);a.put("fieldCount",d.columns().size());a.put("dictionaryStatus",d.fieldDefinitions().isEmpty()?"waiting":"source-defined");a.put("source","企业业务数据");items.add(a);datasets++;
   }
   if(!page.hasMore())break;
   if(offset>=9900)throw new IdentityException(409,"SCENE_ASSET_LIMIT");
  }
  for(int offset=0;;offset+=100){
   var page=materials.list(actor,tenant,null,null,"",offset,100);
   for(var d:page.items()){
    if(!"DOCUMENT".equals(d.kind()))continue;
    visibleMaterials.add(d.id());
    var a=base("material-"+d.id(),d.name(),d.workspaceName(),"document",1,d.version(),d.updatedAt().toString());
    var pipeline=materials.pipeline(actor,tenant,d.workspaceId(),d.id());
    boolean ready="READY".equals(pipeline.parsing());
    boolean examined="CHECKED".equals(pipeline.governance());
    boolean readable=Set.of("READY","PARTIAL").contains(pipeline.parsing())&&searchReady(tenant,d.id());
    if(ready)parsed++;
    if(examined)checked++;
    if(readable)usable++;
    a.put("available",readable);a.put("checksPassed",examined&&pipeline.issues()==0);
    a.put("label","解析："+pipeline.parsing()+" · 治理："+pipeline.governance());a.put("source","企业资料库");items.add(a);documents++;
   }
   if(!page.hasMore())break;
   if(offset>=9900)throw new IdentityException(409,"SCENE_ASSET_LIMIT");
  }
  var out=json.createObjectNode();out.put("nativePlatform",true);out.put("at",java.time.Instant.now().toString());
  out.set("items",items);out.set("user",json.valueToTree(Map.of("name","当前企业成员","role","member")));
  out.set("tenant",json.valueToTree(Map.of("name","企业数据基座")));out.set("model",json.valueToTree(Map.of("configured",false,"enabled",false,"model","")));
  out.set("passed",json.valueToTree(List.of(items.size(),parsed,annotated,checked,usable)));
  out.set("sources",json.valueToTree(List.of(Map.of("name","外部数据集","count",datasets),Map.of("name","内部资料库","count",documents),Map.of("name","外网数据集","count",0))));
  var governance=json.createObjectNode();governance.put("attention",0);governance.put("isolated",0);governance.put("overdue",0);governance.put("failed",0);governance.putNull("averageQuality");governance.set("departments",json.createArrayNode());out.set("governance",governance);out.put("auditValid",false);out.put("canScan",false);
  out.set("adapters",json.valueToTree(List.of(
   Map.of("name","Docling PDF 解析","enabled",environment.getProperty("dreamcore.knowledge.docling-enabled",Boolean.class,false),"scope","PDF 解析；结果仍需治理复核"),
   Map.of("name","WeKnora 索引、混合检索与重排","enabled",environment.getProperty("dreamcore.weknora.enabled",Boolean.class,false),"scope",indexStatus(tenant,visibleMaterials)))));return out;
 }
 private boolean searchReady(UUID tenant,UUID material){
  boolean remote=environment.getProperty("dreamcore.weknora.enabled",Boolean.class,false)&&Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM knowledge_index_targets WHERE tenant_id=? AND enabled)",Boolean.class,tenant));
  return Boolean.TRUE.equals(db.queryForObject("""
    SELECT count(*)>0 AND bool_and(NOT ? OR (coalesce(i.state='READY',false) AND i.remote_id IS NOT NULL AND coalesce(t.enabled,false)))
    FROM active_materials m JOIN material_versions v ON v.material_id=m.id AND v.number=m.current_version
    JOIN LATERAL (SELECT id FROM knowledge_runs WHERE version_id=v.id ORDER BY generation DESC LIMIT 1) r ON true
    JOIN knowledge_chunks c ON c.run_id=r.id AND c.version_id=v.id
    LEFT JOIN knowledge_remote_index i ON i.chunk_id=c.id AND i.tenant_id=c.tenant_id
    LEFT JOIN knowledge_index_targets t ON t.tenant_id=i.tenant_id AND t.knowledge_base_id=i.knowledge_base_id
    WHERE m.tenant_id=? AND m.id=?
    """,Boolean.class,remote,tenant,material));
 }
 private String indexStatus(UUID tenant,List<UUID> materials){
  boolean bound=Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM knowledge_index_targets WHERE tenant_id=? AND enabled)",Boolean.class,tenant));
  if(!bound)return "企业知识库尚未绑定启用";
  if(materials.isEmpty())return "企业知识库已绑定；当前没有获权资料";
  var args=new ArrayList<Object>();args.add(tenant);args.addAll(materials);
  var rows=db.queryForList("SELECT state,count(*) AS n FROM knowledge_remote_index WHERE tenant_id=? AND material_id IN ("+String.join(",",Collections.nCopies(materials.size(),"?"))+") GROUP BY state ORDER BY state",args.toArray());
  var labels=Map.of("QUEUED","排队","UPLOADING","上传中","INDEXING","索引中","READY","就绪","FAILED","失败","UNKNOWN","待核查","DELETE_PENDING","待删除","DELETING","删除中","DELETED","已删除");
  return "企业知识库已绑定 · 当前获权资料的索引片段："+(rows.isEmpty()?"等待建立":String.join("、",rows.stream().map(r->labels.get((String)r.get("state"))+" "+r.get("n")).toList()))+"；此为持久化任务状态，不代表实时服务健康";
 }
 private tools.jackson.databind.node.ObjectNode base(String id,String title,String space,String kind,int source,int version,String at){
  var a=json.createObjectNode();a.put("id",id);a.put("title",title);a.put("department",space);a.put("kind",kind);a.put("sourceKind",source);a.put("status","received");a.put("gate",0);a.put("available",false);a.put("needsAttention",false);a.put("checksPassed",false);a.put("paused",false);a.put("version",version);a.put("policyVersion",0);a.put("updatedAt",at);a.putNull("reviewAt");a.put("quality",0);a.put("classification",0);a.set("issues",json.createArrayNode());a.set("tags",json.createArrayNode());a.putNull("total");a.putNull("ready");a.put("isolated",0);a.put("fieldCount",0);a.putNull("dictionaryStatus");a.set("actions",json.createArrayNode());a.put("tone","plain");a.put("updatePolicy","按原数据集与资料版本处理");a.putNull("sync");return a;
 }
}
