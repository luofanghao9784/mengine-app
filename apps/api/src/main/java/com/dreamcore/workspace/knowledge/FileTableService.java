package com.dreamcore.workspace.knowledge;

import com.dreamcore.workspace.collection.DatasetField;
import com.dreamcore.workspace.identity.IdentityAudit;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.json.JsonMapper;

/** Publishes only a complete file table inside the knowledge completion transaction. */
@Service
public class FileTableService {
 private final JdbcTemplate db; private final IdentityAudit audit; private final JsonMapper json=new JsonMapper();
 public FileTableService(JdbcTemplate db,IdentityAudit audit){this.db=db;this.audit=audit;}
 private UUID id(String key){return UUID.nameUUIDFromBytes(key.getBytes(StandardCharsets.UTF_8));}
 public static boolean valid(DocumentParser.Structured s){
  if(s==null||s.state()==null||s.reason()==null||!s.reason().matches("FILE_TABLE_[A-Z_]{1,55}")||s.columns()==null||s.rows()==null||s.types()==null)return false;
  if("DOCUMENT_ONLY".equals(s.state()))return s.columns().isEmpty()&&s.rows().isEmpty()&&s.types().isEmpty();
  if(!"READY".equals(s.state())||s.columns().isEmpty()||s.columns().size()>30||s.types().size()!=s.columns().size()||s.rows().isEmpty()||s.rows().size()>10000)return false;
  var names=new HashSet<String>();long bytes=0;
  for(String c:s.columns())if(c==null||c.isBlank()||c.length()>50||c.codePoints().anyMatch(Character::isISOControl)||!names.add(c.toLowerCase(Locale.ROOT)))return false;
  for(String t:s.types())if(t==null||!Set.of("text","number","boolean","date").contains(t))return false;
  for(var r:s.rows()){
   if(r==null||r.size()!=s.columns().size())return false;
   for(String v:r){if(v==null||v.length()>2000||v.codePoints().anyMatch(c->Character.isISOControl(c)&&c!='\n'&&c!='\r'&&c!='\t'))return false;bytes+=v.getBytes(StandardCharsets.UTF_8).length;}
  }
  return bytes<=1000000;
 }
 public void finish(KnowledgeService.Job job,DocumentParser.Result result){
  var s=result.structured();if(s==null)return;
  if(!valid(s))throw new IllegalArgumentException("FILE_TABLE_INVALID_RESULT");
  var versions=db.queryForList("SELECT v.filename,v.number,v.sha256,m.current_version,m.in_library,w.kind FROM material_versions v JOIN materials m ON m.id=v.material_id JOIN workspaces w ON w.id=m.workspace_id WHERE v.id=? AND v.tenant_id=? AND v.workspace_id=? AND v.material_id=? FOR UPDATE OF m",job.version(),job.tenant(),job.workspace(),job.material());
  if(versions.isEmpty())return;var v=versions.getFirst();
  String reason=s.reason();boolean ready=s.state().equals("READY")&&Set.of("READY","PARTIAL").contains(result.status());
  if(!v.get("number").equals(v.get("current_version"))){ready=false;reason="FILE_TABLE_SOURCE_CHANGED";}
  else if(!"SHARED".equals(v.get("kind"))||!Boolean.TRUE.equals(v.get("in_library"))){ready=false;reason="FILE_TABLE_PRIVATE_SCOPE";}
  else if(!Set.of("READY","PARTIAL").contains(result.status())){ready=false;reason="FILE_TABLE_PARSE_INCOMPLETE";}
  UUID dataset=null;
  if(ready){
   var old=db.queryForList("SELECT d.column_names,s.data_rows FROM business_datasets d JOIN dataset_snapshots s ON s.id=d.current_snapshot WHERE d.id=?",id("uploaded-table:"+job.version()));
   if(!old.isEmpty()&&(!json.readTree(old.getFirst().get("column_names").toString()).equals(json.valueToTree(s.columns()))||!json.readTree(old.getFirst().get("data_rows").toString()).equals(json.valueToTree(s.rows())))){ready=false;reason="FILE_TABLE_REPARSE_CHANGED";}
  }
  if(ready){
   UUID connection=id("uploaded-table:"+job.tenant()+":"+job.material());dataset=id("uploaded-table:"+job.version());
   String name=v.get("filename").toString();name=name.substring(0,Math.min(160,name.length()));
   db.update("INSERT INTO data_connections(id,tenant_id,name,route_label,access_summary,status,time_zone) VALUES (?,?,?,'资料原件完整解析','遵循原件企业、空间和资料权限','READY','Asia/Shanghai') ON CONFLICT(id) DO NOTHING",connection,job.tenant(),"文件表格 · "+name.substring(0,Math.min(140,name.length())));
   db.update("UPDATE business_datasets SET status='WITHDRAWN' WHERE connection_id=? AND id<>? AND status='ACTIVE'",connection,dataset);
   var fields=new ArrayList<DatasetField>();for(int i=0;i<s.columns().size();i++)fields.add(new DatasetField(s.columns().get(i),s.types().get(i),"原文件列；类型由完整列值校验，业务含义和单位未确认","","原文件版本 "+v.get("number"),"UNKNOWN"));
   String description="来源：上传文件第 "+v.get("number")+" 版；仅代表该文件内容，不代表源数据库实时状态。原件更新或权限撤销后停止提供旧表。";
   db.update("INSERT INTO business_datasets(id,tenant_id,connection_id,workspace_id,dataset_key,name,description,column_names,field_definitions) VALUES (?,?,?,?,?,?,?,?::jsonb,?::jsonb) ON CONFLICT(id) DO NOTHING",dataset,job.tenant(),connection,job.workspace(),job.version().toString(),name,description,json.writeValueAsString(s.columns()),json.writeValueAsString(fields));
   // Same immutable file version is idempotent. Do not revive explicitly withdrawn data.
   if(Boolean.TRUE.equals(db.queryForObject("SELECT status='ACTIVE' AND NOT scrubbed FROM business_datasets WHERE id=?",Boolean.class,dataset))){
    UUID run=id("uploaded-table-run:"+job.version()),snapshot=id("uploaded-table-snapshot:"+job.version());
    db.update("INSERT INTO collection_runs(id,tenant_id,connection_id,execution_epoch,trigger_kind,status,started_at,finished_at) SELECT ?,?,id,execution_epoch,'SCHEDULED','SUCCEEDED',now(),now() FROM data_connections WHERE id=? ON CONFLICT(id) DO NOTHING",run,job.tenant(),connection);
    db.update("INSERT INTO dataset_snapshots(id,tenant_id,connection_id,dataset_id,run_id,version,data_rows,row_count,collected_at) VALUES (?,?,?,?,?,1,?::jsonb,?,now()) ON CONFLICT(id) DO NOTHING",snapshot,job.tenant(),connection,dataset,run,json.writeValueAsString(s.rows()),s.rows().size());
    db.update("UPDATE business_datasets SET current_snapshot=? WHERE id=? AND current_snapshot IS NULL",snapshot,dataset);
   }
  }
  db.update("INSERT INTO file_table_sources(version_id,tenant_id,workspace_id,material_id,run_id,dataset_id,state,reason) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(version_id) DO UPDATE SET run_id=excluded.run_id,state=excluded.state,reason=excluded.reason,checked_at=now(),dataset_id=coalesce(file_table_sources.dataset_id,excluded.dataset_id)",job.version(),job.tenant(),job.workspace(),job.material(),job.id(),dataset,ready?"READY":"DOCUMENT_ONLY",reason);
  audit.record(job.actor(),job.tenant(),ready?"FILE_TABLE_ADMITTED":"FILE_TABLE_DOCUMENT_ONLY",job.material(),"SUCCESS");
 }
}
