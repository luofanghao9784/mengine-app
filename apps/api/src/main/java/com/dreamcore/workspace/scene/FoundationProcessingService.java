package com.dreamcore.workspace.scene;

import com.dreamcore.workspace.collection.*;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.*;
import com.dreamcore.workspace.knowledge.KnowledgeService;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/** Read-only, version-bound view of real processing products. Never generates business fields. */
@Service
public class FoundationProcessingService {
 public record Field(String name,String type,String meaning,String unit,String origin,String evidence) {}
 public record Stage(String key,String name,String state,String at,String detail,List<String> outputs,List<String> fields) {}
 public record History(String id,String stage,String state,String createdAt,String finishedAt,String detail) {}
 public record Result(String assetId,String name,int version,String revision,String recordKind,int recordCount,
   List<Field> fields,List<List<String>> records,int offset,boolean hasMore,List<Stage> stages,List<History> history,List<String> notes) {}
 private final JdbcTemplate db;private final CollectionService collections;private final MaterialService materials;
 private final MaterialAccess access;private final IdentityService identities;private final KnowledgeService knowledge;
 private final org.springframework.core.env.Environment environment;
 public FoundationProcessingService(JdbcTemplate db,CollectionService collections,MaterialService materials,MaterialAccess access,IdentityService identities,KnowledgeService knowledge,org.springframework.core.env.Environment environment){this.db=db;this.collections=collections;this.materials=materials;this.access=access;this.identities=identities;this.knowledge=knowledge;this.environment=environment;}
 private IdentityException missing(){return new IdentityException(404,"FOUNDATION_ASSET_NOT_FOUND");}
 private String time(Object value){return value instanceof java.sql.Timestamp t?t.toInstant().toString():value==null?null:value.toString();}
 private Stage stage(String key,String name,String state,Object at,String detail,List<String> outputs,List<String> fields){return new Stage(key,name,state,time(at),detail,outputs,fields);}
 private void revision(String expected,String actual){if(expected!=null&&!expected.equals(actual))throw new IdentityException(409,"FOUNDATION_VERSION_CHANGED");}

 @Transactional(isolation=Isolation.REPEATABLE_READ)
 public Result read(UUID actor,UUID tenant,String asset,int offset,int limit,String expected){
  identities.member(actor,tenant,false);
  if(asset==null||asset.length()>200||offset<0||offset>100000||limit<1||limit>20||expected!=null&&expected.length()>160)throw IdentityException.invalid();
  String kind;UUID target;
  try{
   if(asset.startsWith("dataset-")){kind="TABLE";target=UUID.fromString(asset.substring(8));}
   else if(asset.startsWith("material-")||asset.startsWith("file-")){
    kind="DOCUMENT";target=UUID.fromString(asset.substring(asset.indexOf('-')+1));
   }else{
    var links=db.queryForList("SELECT kind,target_id FROM scene_asset_links WHERE tenant_id=? AND source_id=? AND active",tenant,asset);
    if(links.size()!=1)throw missing();kind=links.getFirst().get("kind").toString();target=(UUID)links.getFirst().get("target_id");
   }
  }catch(IllegalArgumentException invalid){throw IdentityException.invalid();}
  if("TABLE".equals(kind))return dataset(actor,tenant,asset,target,offset,limit,expected);
  var scopes=db.queryForList("SELECT workspace_id FROM active_materials WHERE tenant_id=? AND id=?",tenant,target);
  if(scopes.isEmpty())throw missing();UUID workspace=(UUID)scopes.getFirst().get("workspace_id");
  access.requireObject(actor,tenant,workspace,"MATERIAL",target,false);access.requireMaterialActive(tenant,workspace,target);
  // A structurally admitted file uses its full table, retaining the original file ACL.
  var admitted=db.queryForList("SELECT f.dataset_id FROM file_table_sources f JOIN material_versions v ON v.id=f.version_id JOIN active_materials m ON m.id=f.material_id AND m.current_version=v.number WHERE f.tenant_id=? AND f.material_id=? AND f.state='READY' AND f.dataset_id IS NOT NULL",tenant,target);
  if(!admitted.isEmpty()){
   var table=dataset(actor,tenant,asset,(UUID)admitted.getFirst().get("dataset_id"),offset,limit,null);
   var original=materials.detail(actor,tenant,workspace,target,0,1);var version=original.versions().getFirst();
   String stamp=IdentityService.hash(version.id()+":"+table.revision());revision(expected,stamp);
   var stages=new ArrayList<>(table.stages());
   stages.set(0,stage("received","原件接入","READY",version.createdAt(),"保留原件权限与文件版本；表格快照为该版本的派生产物",List.of(version.filename(),"来源文件 v"+version.number()),List.of()));
   var history=new ArrayList<>(table.history());
   for(var run:db.queryForList("SELECT id,status,generation,created_at,finished_at FROM knowledge_runs WHERE tenant_id=? AND version_id=? ORDER BY generation DESC LIMIT 20",tenant,version.id()))history.add(new History(run.get("id").toString(),"原件解析",run.get("status").toString(),time(run.get("created_at")),time(run.get("finished_at")),"文件 v"+version.number()+" · 第 "+run.get("generation")+" 次解析"));
   history.sort(Comparator.comparing(History::createdAt).reversed());
   return new Result(asset,original.document().name(),version.number(),stamp,table.recordKind(),table.recordCount(),table.fields(),table.records(),offset,table.hasMore(),stages,history,table.notes());
  }
  return document(actor,tenant,workspace,asset,target,offset,limit,expected);
 }

 private Result dataset(UUID actor,UUID tenant,String asset,UUID id,int offset,int limit,String expected){
  var preview=collections.preview(actor,tenant,id,offset,limit);var d=preview.dataset();
  var heads=db.queryForMap("SELECT current_snapshot,field_definitions::text FROM business_datasets WHERE tenant_id=? AND id=?",tenant,id);
  String stamp=IdentityService.hash(String.valueOf(heads.get("current_snapshot"))+heads.get("field_definitions"));revision(expected,stamp);
  var fields=new ArrayList<Field>();
  for(String column:d.columns()){
   var f=d.fieldDefinitions().stream().filter(x->column.equals(x.column())).findFirst().orElse(null);
   fields.add(new Field(column,f==null?"未标注":f.type(),f==null?"尚未提供业务含义":f.meaning(),f==null?"":f.unit(),"SOURCE_COLUMN",f==null?"来源列名；尚无字段说明":f.evidence()));
  }
  boolean ready=d.version()!=null;
  boolean explained=!d.fieldDefinitions().isEmpty()&&d.fieldDefinitions().stream().allMatch(f->"SOURCE_DOCUMENTED".equals(f.status()));
  var history=db.queryForList("SELECT r.id,r.status,r.created_at,r.finished_at,s.version,s.row_count FROM dataset_snapshots s JOIN collection_runs r ON r.id=s.run_id WHERE s.tenant_id=? AND s.dataset_id=? ORDER BY s.version DESC LIMIT 20",tenant,id).stream().map(r->new History(r.get("id").toString(),"数据采集",r.get("status").toString(),time(r.get("created_at")),time(r.get("finished_at")),"快照 v"+r.get("version")+" · "+r.get("row_count")+" 条记录")).toList();
  var stages=List.of(
   stage("received","数据接入",ready?"READY":"WAITING",d.collectedAt(),"按来源授权范围采集并保存独立快照",ready?List.of("数据快照 v"+d.version()):List.of(),List.of()),
   stage("structure","解析与结构化",ready?"READY":"WAITING",d.collectedAt(),"沿用来源字段，将记录按列保存；没有新增推测字段",List.of((d.rowCount()==null?0:d.rowCount())+" 条记录",fields.size()+" 个来源字段"),d.columns()),
   stage("dictionary","字段口径",explained?"READY":d.fieldDefinitions().isEmpty()?"WAITING":"PARTIAL",null,"字段解释随部署定义保存；推断或未知项仍需核实，未单独记录生成时间",List.of(d.fieldDefinitions().size()+" 项字段说明"),d.fieldDefinitions().stream().map(DatasetField::column).toList()),
   stage("checks","结构检查",ready?"READY":"WAITING",d.collectedAt(),"快照入库经过采集结构与范围约束；此处没有独立的业务事实复核记录",ready?List.of("已保存的结构化快照"):List.of(),List.of()),
   stage("available","AI 读取",ready?"READY":"WAITING",null,"当前获权工具可读取快照；统计计算还需相应的已发布指标口径",ready?List.of("获权数据读取"):List.of(),List.of()));
  return new Result(asset,d.name(),d.version()==null?0:d.version(),stamp,"DATASET_ROWS",d.rowCount()==null?0:d.rowCount(),fields,preview.rows(),offset,preview.hasMore(),stages,history,List.of("字段来自来源表或原文件表头；字段含义的解释不改写原始记录。","记录分页读取，空值与重复值按来源保留。"));
 }

 private Result document(UUID actor,UUID tenant,UUID workspace,String asset,UUID material,int offset,int limit,String expected){
  var m=materials.detail(actor,tenant,workspace,material,0,1);var current=m.versions().getFirst();
  var pipeline=materials.pipeline(actor,tenant,workspace,material);
  var analysis=knowledge.analysis(actor,tenant,workspace,material,current.id(),offset,limit);
  var runs=db.queryForList("SELECT id,generation,status,parser_version,created_at,finished_at FROM knowledge_runs WHERE tenant_id=? AND version_id=? ORDER BY generation DESC LIMIT 20",tenant,current.id());
  var latest=runs.isEmpty()?null:runs.getFirst();Object runId=latest==null?null:latest.get("id");
  String stamp=IdentityService.hash(current.id()+":"+runId);revision(expected,stamp);
  int count=runId==null?0:db.queryForObject("SELECT count(*) FROM knowledge_chunks WHERE tenant_id=? AND version_id=? AND run_id=?",Integer.class,tenant,current.id(),runId);
  var fields=List.of(
   new Field("id","UUID","解析记录标识","","PARSER_OUTPUT","knowledge_chunks.id"),
   new Field("ordinal","INTEGER","片段顺序，从 0 开始","","PARSER_OUTPUT","knowledge_chunks.ordinal"),
   new Field("locator","TEXT","原文位置，例如页码、段落或表格范围","","PARSER_OUTPUT","解析器定位结果"),
   new Field("method","ENUM","处理方式：TEXT 文本、TABLE 表格、OCR 识别","","PARSER_OUTPUT","解析器处理结果"),
   new Field("content","TEXT","该记录保存的正文片段","","PARSER_OUTPUT","解析后的来源内容"),
   new Field("material_id","UUID","来源资料标识","","SOURCE_METADATA","绑定原资料"),
   new Field("version_id","UUID","来源文件版本标识","","SOURCE_METADATA","绑定确切文件版本"),
   new Field("run_id","UUID","产生该记录的解析批次标识","","SOURCE_METADATA","绑定确切解析任务"));
  var ordinals=new HashMap<UUID,Integer>();
  if(parsedStatus(analysis.status()))for(var row:db.queryForList("SELECT id,ordinal FROM knowledge_chunks WHERE tenant_id=? AND run_id=? ORDER BY ordinal LIMIT ? OFFSET ?",tenant,runId,limit,offset))ordinals.put((UUID)row.get("id"),(Integer)row.get("ordinal"));
  var records=analysis.chunks().stream().map(c->List.of(c.id().toString(),String.valueOf(ordinals.get(c.id())),c.locator(),c.method(),c.content(),c.materialId().toString(),c.versionId().toString(),c.runId().toString())).toList();
  var governance=db.queryForList("SELECT id,checked_at,tags,review_at,revision FROM material_governance_reports WHERE tenant_id=? AND version_id=? AND (run_id IS NULL OR run_id=?::uuid) ORDER BY revision DESC LIMIT 20",tenant,current.id(),runId);
  var report=governance.isEmpty()?null:governance.getFirst();
  boolean parsed=Set.of("READY","PARTIAL").contains(analysis.status());
  boolean indexed=parsed&&count>0&&searchReady(tenant,material);
  boolean tagged=report!=null&&db.queryForObject("SELECT cardinality(tags)>0 FROM material_governance_reports WHERE id=?",Boolean.class,report.get("id"));
  var stages=List.of(
   stage("received","数据接入","READY",current.createdAt(),"来源原件已保存，保留版本与校验依据",List.of(current.filename(),"来源版本 v"+current.number()),List.of("material_id","version_id")),
   stage("structure","解析与结构化",analysis.status(),latest==null?null:latest.get("finished_at"),"解析器将正文拆成带位置与来源版本的片段记录",List.of(count+" 条解析记录",analysis.parserVersion()==null?"尚无解析器回执":"解析器 "+analysis.parserVersion()),parsed?fields.stream().map(Field::name).toList():List.of()),
   stage("dictionary","标注与口径",tagged?"READY":"WAITING",report==null?null:report.get("checked_at"),"资料标签与复核信息来自治理记录；尚未生成额外业务实体字段",report==null?List.of():List.of("标签 "+String.valueOf(report.get("tags")),"复核日期 "+String.valueOf(report.get("review_at"))),report==null?List.of():List.of("tags","review_at")),
   stage("checks","治理检查","CHECKED".equals(pipeline.governance())?(pipeline.issues()==0?"READY":"ATTENTION"):"WAITING",report==null?null:report.get("checked_at"),"按当前版本与解析批次核对规则，检查不改变原资料权限",report==null?List.of():List.of(pipeline.issues()+" 项需关注"),List.of()),
   stage("available","AI 检索",indexed?"READY":"WAITING",null,"检查当前片段与索引就绪状态；每次实际读取仍核验权限",indexed?List.of(count+" 条当前解析记录可检索"):List.of(),List.of()),
   stage("publication","正式知识发布",pipeline.publication(),null,"独立于解析和检索，由来源版本绑定的 Wiki 发布记录确定",List.of(),List.of()));
  var history=new ArrayList<History>();
  for(var r:runs)history.add(new History(r.get("id").toString(),"内容解析",r.get("status").toString(),time(r.get("created_at")),time(r.get("finished_at")),"第 "+r.get("generation")+" 次解析 · "+(r.get("parser_version")==null?"尚无解析器回执":r.get("parser_version"))));
  for(var r:governance)history.add(new History(r.get("id").toString(),"治理检查","CHECKED",time(r.get("checked_at")),time(r.get("checked_at")),"治理报告第 "+r.get("revision")+" 版"));
  history.sort(Comparator.comparing(History::createdAt).reversed());
  return new Result(asset,m.document().name(),current.number(),stamp,"DOCUMENT_CHUNKS",count,parsed?fields:List.of(),records,offset,analysis.hasMore(),stages,history,List.of("文档当前的结构化产物是正文片段记录；没有把片段冒充会员、订单等业务实体。","展示当前文件版本的最新解析结果；历史解析批次单独保留。"));
 }
 private boolean parsedStatus(String state){return Set.of("READY","PARTIAL").contains(state);}
 private boolean searchReady(UUID tenant,UUID material){
  boolean remote=environment.getProperty("dreamcore.weknora.enabled",Boolean.class,false)&&Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM knowledge_index_targets WHERE tenant_id=? AND enabled)",Boolean.class,tenant));
  return Boolean.TRUE.equals(db.queryForObject("""
   SELECT count(*)>0 AND bool_and(NOT ? OR (coalesce(i.state='READY',false) AND i.remote_id IS NOT NULL AND coalesce(t.enabled,false)))
   FROM active_materials m JOIN material_versions v ON v.material_id=m.id AND v.number=m.current_version
   JOIN LATERAL(SELECT id FROM knowledge_runs WHERE version_id=v.id ORDER BY generation DESC LIMIT 1) r ON true
   JOIN knowledge_chunks c ON c.run_id=r.id LEFT JOIN knowledge_remote_index i ON i.chunk_id=c.id AND i.tenant_id=c.tenant_id
   LEFT JOIN knowledge_index_targets t ON t.tenant_id=i.tenant_id AND t.knowledge_base_id=i.knowledge_base_id
   WHERE m.tenant_id=? AND m.id=?
   """,Boolean.class,remote,tenant,material));
 }
}
