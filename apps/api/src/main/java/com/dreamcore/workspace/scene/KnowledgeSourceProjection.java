package com.dreamcore.workspace.scene;

import com.dreamcore.workspace.governance.GovernanceModelService;
import com.dreamcore.workspace.identity.IdentityException;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Read-time provenance. Metadata never substitutes for model readiness or grants source access. */
@Service
public class KnowledgeSourceProjection {
 private final JdbcTemplate db;
 private final GovernanceModelService models;
 public KnowledgeSourceProjection(JdbcTemplate db,GovernanceModelService models){this.db=db;this.models=models;}
 public record Source(String category,String kind,UUID sourceId,String name,UUID versionId,String version,
                      UUID runId,Integer generation,UUID releaseId,UUID materialId,UUID materialVersionId,String parseState) {}
 public static String category(List<Source> sources){
  if(sources.stream().anyMatch(s->s.category().equals("SHARED_UPLOAD")))return "SHARED_UPLOAD";
  return sources.stream().allMatch(s->s.category().equals("STRUCTURED"))?"STRUCTURED":"UNSTRUCTURED";
 }
 public static String label(String category){return switch(category){case "SHARED_UPLOAD"->"共享空间上传";case "STRUCTURED"->"结构化数据";default->"非结构化资料";};}
 public Optional<Source> material(UUID actor,UUID tenant,UUID id,UUID release){
  var rows=db.queryForList("""
   SELECT m.id,m.name,v.id version_id,v.number,r.id run_id,r.generation,coalesce(r.status,'NOT_STARTED') parse_state,
    CASE WHEN EXISTS(SELECT 1 FROM document_publications p WHERE p.material_version_id=v.id) THEN 'UNSTRUCTURED' ELSE 'SHARED_UPLOAD' END category
   FROM active_materials m JOIN workspaces w ON w.id=m.workspace_id AND w.tenant_id=m.tenant_id
   JOIN material_versions v ON v.tenant_id=m.tenant_id AND v.workspace_id=m.workspace_id AND v.material_id=m.id AND v.number=m.current_version
   LEFT JOIN LATERAL(SELECT id,generation,status FROM knowledge_runs WHERE tenant_id=m.tenant_id AND version_id=v.id ORDER BY generation DESC LIMIT 1) r ON true
   WHERE m.tenant_id=? AND m.id=? AND m.in_library AND w.kind='SHARED' AND NOT w.archived
    AND (library_mask(headquarters_permission_actor(?,m.tenant_id),m.tenant_id,'MATERIAL',m.id)&1)=1
   """,tenant,id,actor);
  if(rows.isEmpty())return Optional.empty();var row=rows.getFirst();
  return Optional.of(new Source(row.get("category").toString(),"MATERIAL",id,row.get("name").toString(),(UUID)row.get("version_id"),"v"+row.get("number"),(UUID)row.get("run_id"),(Integer)row.get("generation"),release,null,null,row.get("parse_state").toString()));
 }
 public boolean materialReady(UUID actor,UUID tenant,Source source){
  try{return "READY".equals(source.parseState())&&models.materialAnalysisReady(actor,tenant,source.sourceId());}
  catch(IdentityException unavailable){return false;}
 }
 public Optional<Source> dataset(UUID actor,UUID tenant,UUID id,UUID release){
  try{
   if(!models.analysisReadiness(actor,tenant,id).ready()||!models.datasetKnowledgeReady(actor,tenant,id))return Optional.empty();
   var rows=db.queryForList("""
    SELECT d.name,s.id snapshot_id,s.version,f.material_id,f.version_id file_version_id,f.run_id,k.generation
    FROM business_datasets d JOIN dataset_snapshots s ON s.id=d.current_snapshot AND s.tenant_id=d.tenant_id AND s.dataset_id=d.id
    LEFT JOIN file_table_sources f ON f.dataset_id=d.id AND f.tenant_id=d.tenant_id
    LEFT JOIN knowledge_runs k ON k.id=f.run_id AND k.tenant_id=d.tenant_id AND k.version_id=f.version_id
    WHERE d.tenant_id=? AND d.id=? AND d.status='ACTIVE' AND NOT d.scrubbed AND NOT s.scrubbed
     AND file_dataset_readable(?,d.id)
     AND (f.dataset_id IS NULL OR (f.state='READY' AND k.status='READY' AND k.generation=(SELECT max(generation) FROM knowledge_runs WHERE version_id=f.version_id)))
    """,tenant,id,actor);
   if(rows.isEmpty())return Optional.empty();var row=rows.getFirst();
   return Optional.of(new Source(row.get("material_id")==null?"STRUCTURED":"SHARED_UPLOAD","DATASET",id,row.get("name").toString(),(UUID)row.get("snapshot_id"),"v"+row.get("version"),(UUID)row.get("run_id"),(Integer)row.get("generation"),release,(UUID)row.get("material_id"),(UUID)row.get("file_version_id"),null));
  }catch(IdentityException unavailable){return Optional.empty();}
 }
 /** Authorized metadata catalog, including sources not yet eligible to publish knowledge. */
 public List<Source> datasetSources(UUID actor,UUID tenant){
  var sources=new ArrayList<Source>();
  for(int offset=0;offset<=9900;offset+=100){
   var page=datasetMetadata(actor,tenant,null,offset,101);sources.addAll(page.stream().limit(100).toList());
   if(page.size()<=100)return sources;
  }
  throw new IdentityException(409,"SCENE_ASSET_LIMIT");
 }
 public Optional<Source> datasetSource(UUID actor,UUID tenant,UUID id){
  return datasetMetadata(actor,tenant,id,0,1).stream().findFirst();
 }
 private List<Source> datasetMetadata(UUID actor,UUID tenant,UUID id,int offset,int limit){
  // Select identities and version lineage only: no source rows, model drafts or connection secrets.
  String sql="""
   SELECT d.id,d.name,s.id snapshot_id,s.version,f.material_id,f.version_id file_version_id,f.run_id,k.generation,
    coalesce(h.reason,CASE WHEN s.id IS NULL THEN 'NOT_COLLECTED' WHEN f.dataset_id IS NOT NULL THEN k.status ELSE 'READY' END,'NOT_STARTED') parse_state
   FROM business_datasets d JOIN workspaces w ON w.id=d.workspace_id AND w.tenant_id=d.tenant_id
   JOIN workspace_members g ON g.workspace_id=w.id AND g.tenant_id=w.tenant_id AND g.account_id=headquarters_permission_actor(?,g.tenant_id)
   LEFT JOIN dataset_snapshots s ON s.id=d.current_snapshot AND s.tenant_id=d.tenant_id AND s.dataset_id=d.id
   LEFT JOIN file_table_sources f ON f.dataset_id=d.id AND f.tenant_id=d.tenant_id
   LEFT JOIN knowledge_runs k ON k.id=f.run_id AND k.tenant_id=d.tenant_id AND k.version_id=f.version_id
   LEFT JOIN collection_delivery_waits h ON h.tenant_id=d.tenant_id AND h.dataset_id=d.id
   WHERE d.tenant_id=? AND d.status='ACTIVE' AND NOT d.scrubbed AND NOT w.archived
    AND (d.current_snapshot IS NULL OR (s.id IS NOT NULL AND NOT s.scrubbed))
    AND file_dataset_readable(g.account_id,d.id) AND (library_mask(g.account_id,d.tenant_id,'WORKSPACE',d.workspace_id)&1)=1
    AND departure_content_readable(headquarters_permission_actor(?,d.tenant_id),d.tenant_id,d.workspace_id)
   """;
  var args=new ArrayList<Object>(List.of(actor,tenant,actor));
  if(id!=null){sql+=" AND d.id=?";args.add(id);}
  sql+=" ORDER BY d.name,d.id LIMIT ? OFFSET ?";args.add(limit);args.add(offset);
  return db.queryForList(sql,args.toArray()).stream().map(row->new Source(
      row.get("material_id")==null?"STRUCTURED":"SHARED_UPLOAD","DATASET",(UUID)row.get("id"),row.get("name").toString(),
      (UUID)row.get("snapshot_id"),row.get("version")==null?"尚未采集":"v"+row.get("version"),
      (UUID)row.get("run_id"),(Integer)row.get("generation"),null,(UUID)row.get("material_id"),(UUID)row.get("file_version_id"),row.get("parse_state").toString())).toList();
 }
 public boolean datasetReady(UUID actor,UUID tenant,Source source){
  if(source.versionId()==null||!"READY".equals(source.parseState()))return false;
  try{return models.datasetKnowledgeReady(actor,tenant,source.sourceId());}
  catch(IdentityException unavailable){return false;}
 }
 public String waitingReason(Source source,boolean ready){
  if("DATASET".equals(source.kind()))return switch(Objects.toString(source.parseState(),"")){
   case "SOURCE_COLLECTION_PENDING"->"采集端尚未交付本批可核验数据，等待来源取数完成";
   case "WAITING_SOURCE_DEFINITION"->"来源字段含义与规则仍待核对，等待采集端交付新版本";
   case "SOURCE_DATA_REQUIRES_REVIEW"->"来源记录未通过已确认规则，等待修正并重新交付";
   case "NOT_COLLECTED"->"尚无当前数据快照，等待来源采集完成";
   case "PARTIAL"->"上传表格仅部分解析，等待完整解析后再进行模型审阅";
   case "FAILED","CANCELLED"->"上传表格解析未完成，请在来源中核对处理状态";
   case "READY"->ready?"当前快照已通过模型审阅与程序检查，等待生成并发布知识":"等待当前快照的模型审阅、程序检查及有效发布";
   default->"等待数据基座完成来源处理及当前版本核验";
  };
  return switch(source.parseState()){
   case "READY"->ready?"来源已通过当前版本核验，等待生成并发布知识":"完整解析已完成，等待当前版本的模型审阅及有效发布";
   case "PARTIAL"->"资料仅部分解析，等待完整解析后再进行模型审阅";
   case "FAILED","CANCELLED"->"解析未完成，请在来源中核对处理状态";
   case "RUNNING","QUEUED"->"资料正在解析，完成后进行模型审阅";
   default->"等待数据基座完整解析资料";
  };
 }
}
