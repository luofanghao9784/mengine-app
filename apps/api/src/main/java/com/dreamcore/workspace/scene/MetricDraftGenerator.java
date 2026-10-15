package com.dreamcore.workspace.scene;
import com.dreamcore.workspace.identity.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
/** Deterministic draft proposals from governed metadata. No business rows or paid model calls. */
@Service
public class MetricDraftGenerator {
 private final JdbcTemplate db;private final MetricCatalog catalog;private final org.springframework.transaction.support.TransactionTemplate tx;private final JsonMapper json=new JsonMapper();
 public MetricDraftGenerator(JdbcTemplate db,MetricCatalog catalog,org.springframework.transaction.support.TransactionTemplate tx){this.db=db;this.catalog=catalog;this.tx=tx;}
 private String clip(String s,int n){return s.substring(0,Math.min(s.length(),n)).replaceAll("[\\p{Cntrl}]"," ");}
 private Map<String,Object> definition(JsonNode meta,String field,JsonNode semantics){
  boolean count=field.isEmpty();var d=new LinkedHashMap<String,Object>();
  d.put("name",clip(meta.path("title").asText("来源数据")+(count?" · 记录条数":" · "+semantics.path("label").asText(field)+"合计"),100));
  d.put("meaning",count?"统计当前快照记录条数；不等于人数、订单数或去重对象数量。":clip("按源单位合计字段 "+field+"。仅为候选定义，须核实可加性、重复记录和业务范围。 "+semantics.path("meaning").asText(),400));
  d.put("unit",count?"条":clip(semantics.path("unit").asText(),40));d.put("grain","每行一条源记录；业务粒度与重复情况待管理员核实");
  d.put("scope","当前获权固定快照全部记录；不代表源系统完整业务覆盖");d.put("exclusions","无");
  d.put("evidence",clip("规则生成草稿；来源："+meta.path("title").asText()+"。"+(count?"COUNT 只计记录，不推断业务数量。":semantics.path("evidence").asText("字段说明尚待核实")),400));
  d.put("aggregation",count?"COUNT":"SUM");d.put("valueField",field);
  d.put("execution",Map.of("groupColumns",List.of(),"dateColumn","","dateFrom","","dateTo","","timeZone","Asia/Shanghai","reviewed",false));return d;
 }
 public Object generate(UUID actor,UUID tenant,boolean platform){
  catalog.admin(actor,tenant,platform);UUID run=UUID.randomUUID();
  db.update("INSERT INTO scene_processing_runs(id,tenant_id,actor_id,operation,state) VALUES(?,?,?,'GENERATE_METRICS','RUNNING')",run,tenant,actor);
  try{var result=tx.execute(s->generateChecked(actor,tenant));db.update("UPDATE scene_processing_runs SET state='SUCCEEDED',finished_at=now() WHERE id=?",run);return result;}
  catch(RuntimeException e){db.update("UPDATE scene_processing_runs SET state='FAILED',finished_at=now(),error_code='METRIC_GENERATION_FAILED' WHERE id=?",run);throw e;}
 }
 private Object generateChecked(UUID actor,UUID tenant){
  db.queryForList("SELECT tenant_id FROM scene_bindings WHERE tenant_id=? FOR UPDATE",tenant);
  db.update("INSERT INTO metric_generation_settings(tenant_id) VALUES(?) ON CONFLICT DO NOTHING",tenant);
  if(!Boolean.TRUE.equals(db.queryForObject("SELECT enabled FROM metric_generation_settings WHERE tenant_id=?",Boolean.class,tenant)))return Map.of("created",0,"paused",true);
  var sources=db.queryForList("SELECT l.source_id,l.metadata FROM scene_asset_links l JOIN business_datasets d ON d.id=l.target_id WHERE l.tenant_id=? AND l.active AND l.kind='TABLE' AND d.status='ACTIVE' AND NOT d.scrubbed AND file_dataset_readable(?,l.target_id) AND (library_mask(?,l.tenant_id,'WORKSPACE',d.workspace_id)&1)=1 ORDER BY l.source_id",tenant,actor,actor);
  int created=0,skipped=0;int count=db.queryForObject("SELECT count(*) FROM scene_metrics WHERE tenant_id=?",Integer.class,tenant);
  // Give each source one record-count candidate first; then consider documented additive units.
  for(int pass=0;pass<2;pass++)for(var row:sources){
   String source=row.get("source_id").toString();var meta=json.readTree(row.get("metadata").toString());var candidates=new LinkedHashMap<String,JsonNode>();
   if(pass==0)candidates.put("",json.createObjectNode());
   else for(var f:meta.path("dictionary").path("fields")){
    String name=f.path("name").asText(),unit=f.path("unit").asText();boolean numeric=false;
    for(var c:meta.path("fields"))if(c.path("name").asText().equals(name)&&c.path("type").asText().equals("number"))numeric=true;
    if(numeric&&!unit.isBlank()&&!unit.matches(".*[%％比率].*")&&!name.toLowerCase(Locale.ROOT).matches(".*(^id$|_id$|order|rank|code|rate|percent|ratio|sort|编号|比例|序号).*")&&candidates.size()<2)candidates.put(name,f);
   }
   for(var c:candidates.entrySet()){
    String key=c.getKey().isEmpty()?"COUNT_ROWS":"SUM:"+c.getKey();
    if(db.queryForObject("SELECT count(*) FROM metric_generation_keys WHERE tenant_id=? AND source_id=? AND candidate_key=?",Integer.class,tenant,source,key)>0)continue;
    if(count>=100){skipped++;continue;}
    var result=json.valueToTree(catalog.saveChecked(actor,tenant,new MetricCatalog.Change(null,0,source,definition(meta,c.getKey(),c.getValue()))));UUID id=UUID.fromString(result.path("id").asText());
    db.update("INSERT INTO metric_generation_keys(tenant_id,source_id,candidate_key,metric_id) VALUES(?,?,?,?)",tenant,source,key,id);
    db.update("UPDATE scene_metric_versions SET generation=?::jsonb WHERE metric_id=? AND version=1",json.writeValueAsString(Map.of("origin","RULE_BASED","ruleVersion","1.0","sourceId",source,"candidateKey",key,"reviewRequired",true,"warnings",List.of("统计粒度、可加性及业务范围尚待确认","未读取业务明细或调用付费模型"))),id);
    created++;count++;
   }
  }
  db.update("UPDATE metric_generation_settings SET checked_at=now(),created_count=?,error_code=? WHERE tenant_id=?",created,skipped>0?"CATALOG_LIMIT":null,tenant);
  return Map.of("created",created,"skipped",skipped,"paused",false,"origin","RULE_BASED");
 }
 public Object status(UUID actor,UUID tenant,boolean platform){catalog.admin(actor,tenant,platform);var rows=db.queryForList("SELECT enabled,checked_at,created_count,error_code FROM metric_generation_settings WHERE tenant_id=?",tenant);return rows.isEmpty()?Map.of("enabled",true,"created_count",0):rows.getFirst();}
 @Transactional public Object setting(UUID actor,UUID tenant,boolean platform,boolean enabled){catalog.admin(actor,tenant,platform);db.queryForList("SELECT tenant_id FROM scene_bindings WHERE tenant_id=? FOR UPDATE",tenant);db.update("INSERT INTO metric_generation_settings(tenant_id,enabled) VALUES(?,?) ON CONFLICT(tenant_id) DO UPDATE SET enabled=excluded.enabled",tenant,enabled);return Map.of("enabled",enabled);}
}
