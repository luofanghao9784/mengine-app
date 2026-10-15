package com.dreamcore.workspace.scene;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.collection.DatasetField;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/** Projects file admissions through the existing scene contract; never copies library data into Wiki's ACL domain. */
@Service
public class FileTableSceneService {
 private final JdbcTemplate db;private final IdentityService identities;private final JsonMapper json=new JsonMapper();
 public FileTableSceneService(JdbcTemplate db,IdentityService identities){this.db=db;this.identities=identities;}
 private List<Map<String,Object>> rows(UUID actor,UUID tenant,boolean platform){
  if(platform)identities.platform(actor);else identities.member(actor,tenant,false);
  return db.queryForList("""
   SELECT m.id,m.workspace_id,v.filename,v.number,v.created_at,w.name workspace_name,f.state,f.reason,f.checked_at,
    d.id dataset_id,d.field_definitions,s.row_count,k.status parse_status,
    coalesce(d.status='ACTIVE' AND NOT d.scrubbed AND file_dataset_current(d.id),false) available
   FROM active_materials m JOIN workspaces w ON w.id=m.workspace_id
   JOIN material_versions v ON v.material_id=m.id AND v.number=m.current_version
   LEFT JOIN file_table_sources f ON f.version_id=v.id
   LEFT JOIN business_datasets d ON d.id=f.dataset_id LEFT JOIN dataset_snapshots s ON s.id=d.current_snapshot
   LEFT JOIN LATERAL(SELECT status FROM knowledge_runs WHERE version_id=v.id ORDER BY generation DESC LIMIT 1) k ON true
   WHERE m.tenant_id=? AND m.in_library AND w.kind='SHARED' AND NOT w.archived AND object_is_active('MATERIAL',m.id)
    AND lower(v.filename) ~ '[.](csv|tsv|xlsx|xls)$' AND (? OR (library_mask(?,m.tenant_id,'MATERIAL',m.id)&1)=1)
   ORDER BY m.id
   """,tenant,platform,actor);
 }
 private String explanation(Map<String,Object> r){
  if(Boolean.TRUE.equals(r.get("available")))return "已完成完整表格校验；仅代表该文件版本的业务数据，业务含义与单位仍需核对";
  if(r.get("reason")==null)return "等待原件解析与结构校验";
  return switch(r.get("reason").toString()){
   case "FILE_TABLE_VALIDATED"->"来源或处理状态已变化，旧表停止提供";
   case "FILE_TABLE_HEADER_INVALID","FILE_TABLE_HEADER_DUPLICATE"->"表头为空、重复或格式不明确，保留为资料";
   case "FILE_TABLE_NON_RECTANGULAR"->"各行列数不一致，保留为资料";
   case "FILE_TABLE_FORMULA_OR_ERROR"->"包含公式或错误值，保留为资料，未将缓存结果当作确定业务数据";
   case "FILE_TABLE_MULTIPLE_SHEETS","FILE_TABLE_REPORT_LAYOUT"->"包含多页或复杂报表布局，保留为资料";
   case "FILE_TABLE_NUMBER_FORMAT","FILE_TABLE_NUMBER_PRECISION"->"数值格式或精度需要人工核对，保留为资料";
   case "FILE_TABLE_ENCODING"->"编码未确认，请将原文件转为 UTF-8 后上传新版本";
   case "FILE_TABLE_LEGACY_XLS"->"旧版 XLS 保留为资料，可转换为无公式的 XLSX 或 CSV 后重新上传";
   case "FILE_TABLE_LIMIT"->"超过完整表格处理上限，未截取部分数据入表";
   case "FILE_TABLE_EMPTY"->"没有可用的数据行，保留为资料";
   default->"未通过结构化准入，保留原件与资料解析结果";
  };
 }
 private ObjectNode asset(Map<String,Object> r){
  boolean available=Boolean.TRUE.equals(r.get("available")),table=r.get("dataset_id")!=null;
  boolean pending=r.get("parse_status")==null||Set.of("QUEUED","RUNNING").contains(r.get("parse_status").toString());
  var a=json.createObjectNode();a.put("id","file-"+r.get("id"));a.put("title",r.get("filename").toString());a.put("department",r.get("workspace_name").toString());
  a.put("kind",table?"table":"document");a.put("sourceKind",table?0:1);a.put("source","企业资料原件");a.put("status",available?"ready":pending?"processing":"quarantined");a.put("label",available?"结构化完成 · 文件版本数据":pending?"等待结构校验":"保留为资料 · 待核对");
  a.put("gate",available?2:1);a.put("available",available);a.put("needsAttention",!available);a.put("checksPassed",available);a.put("paused",false);a.put("version",((Number)r.get("number")).intValue());a.put("policyVersion",1);
  a.put("updatedAt",((java.sql.Timestamp)r.get("created_at")).toInstant().toString());a.putNull("reviewAt");a.put("quality",available?100:0);a.put("classification",1);
  a.set("issues",json.valueToTree(available?List.of():List.of(explanation(r))));a.set("tags",json.valueToTree(List.of("文件接入","原件权限","版本绑定")));
  int total=r.get("row_count")==null?0:((Number)r.get("row_count")).intValue();a.put("total",total);a.put("ready",available?total:0);a.put("isolated",0);
  a.put("fieldCount",r.get("field_definitions")==null?0:DatasetField.read(r.get("field_definitions")).size());a.put("dictionaryStatus",available?"source-defined":"waiting");a.set("actions",json.createArrayNode());a.put("tone",available?"ok":pending?"run":"warn");a.put("updatePolicy","上传同一资料的新版本后重新校验；不是实时数据库同步");a.putNull("sync");return a;
 }
 @Transactional public JsonNode detail(UUID actor,UUID tenant,boolean platform,String id){
  var r=rows(actor,tenant,platform).stream().filter(x->("file-"+x.get("id")).equals(id)).findFirst().orElseThrow(()->new IdentityException(404,"MATERIAL_NOT_FOUND"));
  var out=json.createObjectNode();out.set("asset",asset(r));out.putNull("analysis");out.set("audit",json.createArrayNode());out.set("events",json.createArrayNode());out.set("batches",json.createArrayNode());out.set("findings",json.createArrayNode());
  if(r.get("field_definitions")==null)out.putNull("dictionary");else{
   var d=json.createObjectNode();d.put("status","source-defined");d.put("current",Boolean.TRUE.equals(r.get("available")));d.put("revision",((Number)r.get("number")).intValue());d.put("provider","原文件结构校验");d.putNull("at");d.putNull("job");d.put("tableMeaning",explanation(r));d.put("usageRules","仅按原件列和值使用；不推断主键、必填、单位或业务统计口径。空值和重复行保留，不自动去重。");d.set("warnings",json.valueToTree(List.of("业务语义尚未确认")));d.set("relations",json.createArrayNode());
   var fields=json.createArrayNode();for(var f:DatasetField.read(r.get("field_definitions"))){var n=json.createObjectNode();n.put("name",f.column());n.put("label",f.column());n.put("type",f.type());n.put("required",false);n.put("unique",false);n.put("sensitive",false);n.put("meaning",f.meaning());n.put("unit",f.unit());n.put("rules","");n.put("evidence",f.evidence());fields.add(n);}d.set("fields",fields);out.set("dictionary",d);
  }return out;
 }
 @Transactional public JsonNode merge(UUID actor,UUID tenant,boolean platform,JsonNode base){
  var out=(ObjectNode)base.deepCopy();var items=out.withArray("items");for(var r:rows(actor,tenant,platform))items.add(asset(r));
  var active=new ArrayList<JsonNode>();items.forEach(x->{if(!"archived".equals(x.path("status").asText()))active.add(x);});
  out.set("passed",json.valueToTree(List.of(active.size(),active.stream().filter(x->x.path("gate").asInt()>1).count(),active.stream().filter(x->x.path("gate").asInt()>2).count(),active.stream().filter(x->x.path("checksPassed").asBoolean()).count(),active.stream().filter(x->x.path("available").asBoolean()).count())));
  for(var source:out.withArray("sources")){int kind=source.path("name").asText().equals("外部数据集")?0:source.path("name").asText().equals("内部资料库")?1:2;((ObjectNode)source).put("count",active.stream().filter(x->x.path("sourceKind").asInt()==kind).count());}
  var g=(ObjectNode)out.get("governance");g.put("attention",active.stream().filter(x->x.path("needsAttention").asBoolean()).count());g.put("isolated",active.stream().filter(x->x.path("status").asText().equals("quarantined")||x.path("isolated").asInt()>0).count());
  g.put("averageQuality",active.isEmpty()?0:Math.round(active.stream().mapToInt(x->x.path("quality").asInt()).average().orElse(0)));var groups=json.createArrayNode();active.stream().map(x->x.path("department").asText()).distinct().forEach(name->{var n=json.createObjectNode();n.put("name",name);n.put("total",active.stream().filter(x->x.path("department").asText().equals(name)).count());n.put("attention",active.stream().filter(x->x.path("department").asText().equals(name)&&x.path("needsAttention").asBoolean()).count());groups.add(n);});g.set("departments",groups);return out;
 }
}
