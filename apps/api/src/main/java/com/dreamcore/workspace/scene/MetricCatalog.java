package com.dreamcore.workspace.scene;

import com.dreamcore.workspace.identity.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Governed definitions are reference data, never executable SQL or model instructions. */
@Service
public class MetricCatalog {
 private static final JsonMapper JSON=new JsonMapper();
 private final JdbcTemplate db; private final SceneService scene;
 public MetricCatalog(JdbcTemplate db,SceneService scene){this.db=db;this.scene=scene;}
 public record Change(UUID id,int expectedVersion,String sourceId,Map<String,Object> definition) {}
 public record Transition(int expectedVersion) {}
 private IdentityException conflict(){return new IdentityException(409,"METRIC_VERSION_OR_SOURCE_CHANGED");}
 void admin(UUID actor,UUID tenant,boolean platform){scene.status(actor,tenant,platform);}
 Map<String,Object> source(UUID actor,UUID tenant,String id){
  var rows=db.queryForList("SELECT l.target_id,l.metadata,scene_table_scope(l.metadata)::text scope FROM scene_asset_links l JOIN business_datasets d ON d.id=l.target_id WHERE l.tenant_id=? AND l.source_id=? AND l.kind='TABLE' AND l.active AND d.status='ACTIVE' AND NOT d.scrubbed AND file_dataset_readable(?,l.target_id) AND (library_mask(?,l.tenant_id,'WORKSPACE',d.workspace_id)&1)=1",tenant,id,actor,actor);
  if(rows.isEmpty())throw new IdentityException(403,"METRIC_SOURCE_UNAVAILABLE");return rows.getFirst();
 }
 private String text(JsonNode d,String key,int limit,boolean required){var n=d.path(key);if(!n.isTextual()||n.asText().length()>limit||(required&&n.asText().isBlank())||n.asText().codePoints().anyMatch(Character::isISOControl))throw IdentityException.invalid();return n.asText().strip();}
 private JsonNode validate(Map<String,Object> supplied,JsonNode meta){
  if(supplied==null||!new HashSet<>(supplied.keySet().stream().filter(k->!k.equals("execution")).toList()).equals(Set.of("name","meaning","unit","grain","scope","exclusions","evidence","aggregation","valueField")))throw IdentityException.invalid();
  var d=JSON.valueToTree(supplied);var clean=JSON.createObjectNode();
  for(String k:List.of("name","meaning","unit","grain","scope","exclusions","evidence"))clean.put(k,text(d,k,k.equals("name")?100:k.equals("unit")?40:400,true));
  String agg=text(d,"aggregation",10,true),field=text(d,"valueField",160,false);
  if(!Set.of("COUNT","SUM").contains(agg)||agg.equals("COUNT")&&!field.isEmpty())throw IdentityException.invalid();
  if(agg.equals("SUM")){boolean numeric=false;for(var f:meta.path("fields"))if(f.path("name").asText().equals(field)&&f.path("type").asText().equals("number"))numeric=true;if(!numeric)throw new IdentityException(422,"METRIC_NUMERIC_FIELD_REQUIRED");}
  clean.put("aggregation",agg);clean.put("valueField",field);clean.set("execution",MetricPlan.validate(d.path("execution"),meta,field));return clean;
 }
 @Transactional public Object save(UUID actor,UUID tenant,boolean platform,Change request){
  admin(actor,tenant,platform);return saveChecked(actor,tenant,request);
 }
 Object saveChecked(UUID actor,UUID tenant,Change request){
  if(request==null||request.sourceId()==null||request.sourceId().length()>160)throw IdentityException.invalid();
  // Serialize tenant catalog writes, including first insertion and its bounded size.
  db.queryForList("SELECT tenant_id FROM scene_bindings WHERE tenant_id=? FOR UPDATE",tenant);
  var src=source(actor,tenant,request.sourceId());var definition=validate(request.definition(),JSON.readTree(src.get("metadata").toString()));
  UUID id=request.id()==null?UUID.randomUUID():request.id();int version=1;
  if(request.id()==null){if(request.expectedVersion()!=0||db.queryForObject("SELECT count(*) FROM scene_metrics WHERE tenant_id=?",Integer.class,tenant)>=100)throw conflict();db.update("INSERT INTO scene_metrics(id,tenant_id,source_id,head_version,created_by) VALUES(?,?,?,1,?)",id,tenant,request.sourceId(),actor);}
  else {var old=db.queryForList("SELECT * FROM scene_metrics WHERE id=? AND tenant_id=? FOR UPDATE",id,tenant);if(old.isEmpty()||!old.getFirst().get("head_version").equals(request.expectedVersion())||!old.getFirst().get("source_id").equals(request.sourceId()))throw conflict();version=request.expectedVersion()+1;db.update("UPDATE scene_metrics SET head_version=?,updated_at=now() WHERE id=?",version,id);}
  db.update("INSERT INTO scene_metric_versions(metric_id,version,definition,source_scope,source_dataset,created_by) VALUES(?,?,?::jsonb,?::jsonb,?,?)",id,version,definition.toString(),src.get("scope"),src.get("target_id"),actor);
  event(actor,tenant,id,version,"DRAFT");return Map.of("id",id,"version",version);
 }
 @Transactional public Object transition(UUID actor,UUID tenant,boolean platform,UUID id,Transition request,boolean publish){
  admin(actor,tenant,platform);return transitionChecked(actor,tenant,id,request,publish);
 }
 Object transitionChecked(UUID actor,UUID tenant,UUID id,Transition request,boolean publish){
  if(request==null)throw IdentityException.invalid();
  db.queryForList("SELECT tenant_id FROM scene_bindings WHERE tenant_id=? FOR UPDATE",tenant);
  var rows=db.queryForList("SELECT m.*,v.source_scope::text scope,v.definition FROM scene_metrics m JOIN scene_metric_versions v ON v.metric_id=m.id AND v.version=m.head_version WHERE m.tenant_id=? AND m.id=? FOR UPDATE OF m",tenant,id);
  if(rows.isEmpty()||!rows.getFirst().get("head_version").equals(request.expectedVersion()))throw conflict();var m=rows.getFirst();
  if(publish){if(!MetricPlan.ready(JSON.readTree(m.get("definition").toString())))throw new IdentityException(422,"METRIC_PLAN_REVIEW_REQUIRED");var src=source(actor,tenant,m.get("source_id").toString());if(!src.get("scope").equals(m.get("scope")))throw conflict();}
  db.update("UPDATE scene_metrics SET published_version=?,updated_at=now() WHERE id=?",publish?request.expectedVersion():null,id);
  event(actor,tenant,id,request.expectedVersion(),publish?"PUBLISH":"WITHDRAW");return Map.of("id",id,"published",publish);
 }
 private void event(UUID actor,UUID tenant,UUID id,int version,String action){db.update("INSERT INTO scene_metric_events(tenant_id,metric_id,version,action,actor_id) VALUES(?,?,?,?,?)",tenant,id,version,action,actor);}
 public Object list(UUID actor,UUID tenant,boolean platform){
  admin(actor,tenant,platform);
  var rows=db.queryForList("SELECT m.id,m.source_id,m.head_version,m.published_version,m.updated_at,v.definition,v.generation,v.source_dataset,coalesce(l.active AND scene_table_scope(l.metadata)=v.source_scope AND b.governance_valid_until>now(),false) current,coalesce(l.active AND scene_table_scope(l.metadata)=pv.source_scope AND b.governance_valid_until>now(),false) published_current FROM scene_metrics m JOIN scene_metric_versions v ON v.metric_id=m.id AND v.version=m.head_version LEFT JOIN scene_metric_versions pv ON pv.metric_id=m.id AND pv.version=m.published_version LEFT JOIN scene_asset_links l ON l.tenant_id=m.tenant_id AND l.source_id=m.source_id AND l.kind='TABLE' LEFT JOIN scene_bindings b ON b.tenant_id=m.tenant_id WHERE m.tenant_id=? ORDER BY m.updated_at DESC LIMIT 100",tenant);
  for(var row:rows){row.put("definition",JSON.readTree(row.get("definition").toString()));row.put("generation",JSON.readTree(row.get("generation").toString()));row.put("calculations",db.queryForMap("SELECT count(*) count,max(created_at) last_calculated_at FROM metric_calculation_receipts WHERE metric_id=?",row.get("id")));row.put("history",db.queryForList("SELECT version,action,created_at FROM scene_metric_events WHERE metric_id=? ORDER BY id DESC LIMIT 10",row.get("id")));}
  return Map.of("items",rows,"referenceOnly",true);
 }
 /** Invoked after dataset authorization and snapshot pinning, in the task transaction. */
 public static Object context(JdbcTemplate db,UUID task,UUID dataset,String query){
  var rows=db.queryForList("""
   SELECT m.id,v.version,v.definition,p.snapshot_id FROM conversation_tasks t
   JOIN scene_metrics m ON m.tenant_id=t.tenant_id
   JOIN scene_metric_versions v ON v.metric_id=m.id AND v.version=m.published_version
   JOIN scene_asset_links l ON l.tenant_id=m.tenant_id AND l.source_id=m.source_id AND l.kind='TABLE' AND l.active
   JOIN task_dataset_reads p ON p.task_id=t.id AND p.attempt_number=t.attempt AND p.dataset_id=l.target_id
   WHERE t.id=? AND l.target_id=? AND scene_table_scope(l.metadata)=v.source_scope AND file_dataset_readable(t.requested_by,l.target_id)
   ORDER BY CASE WHEN ?<>'' AND strpos(lower(v.definition->>'name'),lower(?))>0 THEN 0 ELSE 1 END,m.id LIMIT 4 FOR SHARE OF m
   """,task,dataset,query,query);
  var result=new ArrayList<Object>();for(var r:rows.stream().limit(3).toList()){
   var definition=JSON.readTree(r.get("definition").toString());
   var old=db.queryForList("SELECT version FROM task_metric_reads WHERE task_id=? AND attempt_number=(SELECT attempt FROM conversation_tasks WHERE id=?) AND metric_id=?",Integer.class,task,task,r.get("id"));
   if(!old.isEmpty()&&!old.getFirst().equals(r.get("version")))throw new IdentityException(409,"TASK_CONTEXT_CHANGED");
   db.update("INSERT INTO task_metric_reads(task_id,attempt_number,metric_id,version,dataset_id) SELECT id,attempt,?,?,? FROM conversation_tasks WHERE id=? ON CONFLICT DO NOTHING",r.get("id"),r.get("version"),dataset,task);
   result.add(Map.of("metricId",r.get("id"),"version",r.get("version"),"definition",definition,"executionRequest",MetricPlan.ready(definition)?JSON.valueToTree(MetricPlan.request(definition,dataset,(UUID)r.get("snapshot_id"),(UUID)r.get("id"),(Integer)r.get("version"))):JSON.nullNode(),"authority",false));
  }
  return Map.of("items",result,"hasMore",rows.size()>3,"usage","治理数据必须使用已发布指标的 executionRequest 调用 compare_dataset；省略值为 null 的字段。不得修改其聚合、分组、日期或排除范围。无适用计划时说明口径待确认，不得从采样或自行写代码补算业务数字。会话和数据画报引用同一指标编号、版本及计算回执。","automaticExecution",false);
 }
}
