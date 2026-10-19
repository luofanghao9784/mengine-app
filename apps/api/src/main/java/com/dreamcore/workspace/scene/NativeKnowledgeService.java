package com.dreamcore.workspace.scene;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.MaterialService;
import com.dreamcore.workspace.knowledge.WikiArticleService;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Scene contract over platform-owned sources; never promotes raw documents to published knowledge. */
@Service
public class NativeKnowledgeService {
 private final MaterialService materials;
 private final WikiArticleService articles;
 private final IdentityService identities;
 private final JsonMapper json=new JsonMapper();
 public NativeKnowledgeService(MaterialService materials,WikiArticleService articles,IdentityService identities){this.materials=materials;this.articles=articles;this.identities=identities;}
 private Map<String,Object> card(String id,String name,String group,String why,String content,List<?> rows,List<String> actions){
  return Map.of("id",id,"name",name,"group",group,"why",why,"side",group,"tone","plain","verdict",content,"kvHead",List.of("项","内容","状态"),"kv",rows,"actions",actions);
 }
 private List<MaterialService.Entry> sources(UUID actor,UUID tenant){
  var out=new ArrayList<MaterialService.Entry>();
  for(int offset=0;offset<=9900;offset+=100){
   var page=materials.list(actor,tenant,null,null,"",offset,100);
   for(var entry:page.items())if("DOCUMENT".equals(entry.kind()))out.add(entry);
   if(!page.hasMore())return out;
  }
  throw new IdentityException(409,"SCENE_ASSET_LIMIT");
 }
 @Transactional public JsonNode snapshot(UUID actor,UUID tenant){
  identities.member(actor,tenant,false);
  var items=new ArrayList<Map<String,Object>>();var waiting=new ArrayList<Map<String,Object>>();var published=new HashSet<UUID>();
  for(int offset=0;offset<=9980;offset+=20){
   var page=articles.list(actor,tenant,false,offset);
   for(var a:page.items())if(!a.sourceChanged()&&a.article()!=null){
    published.add(a.materialId());
    items.add(card("article-"+a.id(),a.article().title(),"已发布资料知识",a.article().intro(),a.article().content(),List.of(List.of("来源",a.sourceName(),"v"+a.sourceVersion(),"plain")),List.of("查看来源","重新核验")));
   }
   if(!page.hasMore())break;
   if(offset==9980)throw new IdentityException(409,"SCENE_ASSET_LIMIT");
  }
  var sourceList=sources(actor,tenant);
  for(var s:sourceList)if(!published.contains(s.id()))waiting.add(card("material-"+s.id(),s.name(),"资料来源待发布","尚无当前有效的已发布知识","此项是获权资料来源，不是已发布知识。解析、学习草稿和确认发布是不同步骤。",List.of(List.of("来源空间",s.workspaceName(),"v"+s.version(),"plain")),List.of("查看来源","重新核验")));
  var kinds=new LinkedHashMap<String,Integer>();for(var i:items)kinds.put(i.get("id").toString(),1);
  var out=json.createObjectNode();out.set("items",json.valueToTree(items));out.set("relations",json.createArrayNode());out.set("sourceKind",json.valueToTree(kinds));
  out.put("pending",0);out.put("failed",0);out.put("busy",false);out.put("available",true);out.put("needsGraph",false);
  out.put("scopeRevision",IdentityService.hash(json.writeValueAsString(List.of(items,waiting))));
  out.set("tabs",json.valueToTree(List.of(Map.of("label","全部 "+items.size(),"items",items),Map.of("label","资料来源待发布 "+waiting.size(),"items",waiting),Map.of("label","来自资料 "+items.size(),"items",items))));
  out.set("stats",json.valueToTree(Map.of("title","知识构成","rows",List.of(List.of("已发布知识",String.valueOf(items.size())),List.of("获权资料来源",String.valueOf(sourceList.size())),List.of("待发布来源",String.valueOf(waiting.size()))))));
  out.set("aside",json.valueToTree(Map.of("title","当前服务","rows",List.of(List.of("数据来源","平台原生资料与已发布知识"),List.of("核验","刷新权限和版本；不自动学习或发布")))));
  out.put("status",items.size()+" 条已发布知识 · "+waiting.size()+" 份资料待发布");return out;
 }
 @Transactional public JsonNode source(UUID actor,UUID tenant,String id){
  identities.member(actor,tenant,false);
  UUID material;
  try {
   if(id.startsWith("article-")){
    var a=articles.detail(actor,tenant,UUID.fromString(id.substring(8)));
    if(a.archived()||a.sourceChanged())throw new IdentityException(404,"MATERIAL_NOT_FOUND");
    material=a.materialId();
   }else if(id.startsWith("material-"))material=UUID.fromString(id.substring(9));
   else throw new IllegalArgumentException();
  }catch(IllegalArgumentException e){throw new IdentityException(404,"MATERIAL_NOT_FOUND");}
  var s=sources(actor,tenant).stream().filter(x->x.id().equals(material)).findFirst().orElseThrow(()->new IdentityException(404,"MATERIAL_NOT_FOUND"));
  var detail=materials.detail(actor,tenant,s.workspaceId(),s.id(),0,1);
  return json.valueToTree(card(id,s.name(),"资料来源","当前获权资料版本","来源元数据；此处不展示或下载原文，不代表已生成知识。",List.of(List.of("空间",s.workspaceName(),"当前授权","plain"),List.of("版本","v"+s.version(),detail.versions().isEmpty()?"未知":detail.versions().getFirst().id().toString(),"plain")),List.of("返回知识")));
 }
}
