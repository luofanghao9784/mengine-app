package com.dreamcore.workspace.scene;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.collection.*;
import com.dreamcore.workspace.material.MaterialService;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Service
public class SceneService {
 private static final JsonMapper JSON=new JsonMapper();
 private final FileTableSceneService files;
 private final SceneBridgeClient bridge;private final JdbcTemplate db;private final IdentityService identities;private final CollectionDeployment deployment;private final CollectionService collection;private final MaterialService materials;private final TransactionTemplate tx;
 public SceneService(SceneBridgeClient bridge,JdbcTemplate db,IdentityService identities,CollectionDeployment deployment,CollectionService collection,MaterialService materials,TransactionTemplate tx,FileTableSceneService files){this.files=files;this.bridge=bridge;this.db=db;this.identities=identities;this.deployment=deployment;this.collection=collection;this.materials=materials;this.tx=tx;}
 public static JsonNode metadata(JsonNode a){var copy=a.deepCopy();((tools.jackson.databind.node.ObjectNode)copy).remove(List.of("rows","content"));return copy;}
 public static JsonNode knowledgeMetadata(JsonNode card,int sourceKind){
  var meta=JSON.createObjectNode();meta.put("title",card.path("name").asText());
  // A library-wide revision changes when unrelated articles arrive. Only this article's
  // provenance (including its original source version and knowledge revision) belongs here.
  meta.set("provenance",card.path("kv").deepCopy());
  meta.set("tags",JSON.valueToTree(List.of(sourceKind==0?"业务知识":"资料知识","引擎输出")));return meta;
 }
 public static boolean sameMetadata(JsonNode a,String stored){return metadata(a).equals(JSON.readTree(stored));}
 private UUID id(String key){return UUID.nameUUIDFromBytes(key.getBytes(StandardCharsets.UTF_8));}
 private String trim(String s,int max){return s.length()>max?s.substring(0,max):s;}
 public void access(UUID actor,UUID tenant,boolean platform){if(platform){identities.platform(actor);if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM tenants WHERE id=? AND status='ACTIVE')",Boolean.class,tenant)))throw new IdentityException(404,"TENANT_NOT_FOUND");}else identities.member(actor,tenant,true);}
 public List<Map<String,Object>> bindings(UUID actor){identities.platform(actor);return db.queryForList("SELECT b.tenant_id,t.name,b.workspace_id,b.connection_id,(SELECT count(*) FROM scene_asset_links a WHERE a.tenant_id=b.tenant_id AND a.kind='TABLE' AND a.active) datasets,(SELECT count(*) FROM scene_asset_links a WHERE a.tenant_id=b.tenant_id AND a.kind<>'TABLE' AND a.active) materials FROM scene_bindings b JOIN tenants t ON t.id=b.tenant_id ORDER BY t.name");}
 public Object status(UUID actor,UUID tenant,boolean platform){access(actor,tenant,platform);if(!platform)requireSceneAdmin(actor,tenant);return Map.of("tenantId",tenant,"governance",db.queryForMap("SELECT source_revision,governance_valid_until,(SELECT status FROM collection_runs c WHERE c.connection_id=scene_bindings.connection_id ORDER BY created_at DESC LIMIT 1) collection_state,coalesce(governance_valid_until>now(),false) policy_current,(SELECT max(finished_at) FROM scene_processing_runs WHERE tenant_id=? AND operation='SYNC_INPUTS' AND state='SUCCEEDED') last_synced_at FROM scene_bindings WHERE tenant_id=?",tenant,tenant),"assets",db.queryForList("SELECT source_id,kind,target_id,revision,metadata,updated_at FROM scene_asset_links WHERE tenant_id=? AND active ORDER BY kind,source_id",tenant).stream().map(r->{var meta=JSON.readTree(r.get("metadata").toString());if(meta.path("governance").isObject())((tools.jackson.databind.node.ObjectNode)meta.path("governance")).remove("allowedActors");r.put("metadata",meta);return r;}).toList(),"runs",db.queryForList("SELECT id,operation,state,created_at,finished_at,error_code FROM scene_processing_runs WHERE tenant_id=? ORDER BY created_at DESC LIMIT 20",tenant));}
 public synchronized JsonNode dispatch(UUID actor,UUID tenant,boolean platform,String method,String path,Object body){
  if(platform)access(actor,tenant,true);else identities.member(actor,tenant,false);
  if(!path.matches("/scene-(foundation(?:/[^/?]+(?:/actions)?)?|knowledge(?:/sync|/[^/?]+/source)?|access(?:/audit|/policy|/departments|/members/[^/?]+|/proposals/[^/?]+/(?:resolve|withdraw)|/resources/[^/?]+/inspect)?)"))throw IdentityException.invalid();
  String delegated=platform?actor.toString():"customer:"+actor;
  if(path.startsWith("/scene-foundation/file-")){
   if(!method.equals("GET"))throw new IdentityException(409,"SCENE_READ_ONLY");
   return files.detail(actor,tenant,platform,path.substring("/scene-foundation/".length()));
  }
  if(method.equals("GET")){var result=bridge.call(tenant,delegated,method,path,null);if(platform)access(actor,tenant,true);else identities.member(actor,tenant,false);return path.equals("/scene-foundation")?files.merge(actor,tenant,platform,result):result;}
  UUID run=start(actor,tenant,path);
  boolean policyMutation=path.startsWith("/scene-access/")||path.startsWith("/scene-foundation/");
  if(policyMutation)db.update("UPDATE scene_bindings SET governance_valid_until=NULL WHERE tenant_id=?",tenant);
  try{var result=bridge.call(tenant,delegated,method,path,body);if(platform)access(actor,tenant,true);else identities.member(actor,tenant,false);if(path.equals("/scene-knowledge/sync")&&(platform||"admin".equals(bridge.call(tenant,delegated,"GET","/scene-access",null).path("user").path("role").asText())))synchronize(actor,tenant,platform);if(policyMutation)synchronize(db.queryForObject("SELECT maintainer_id FROM scene_bindings WHERE tenant_id=?",UUID.class,tenant),tenant,false);finish(run,null);return result;}catch(RuntimeException e){finish(run,"SCENE_PROCESSING_FAILED");throw e;}
 }
 private UUID start(UUID actor,UUID tenant,String op){UUID run=UUID.randomUUID();if(db.queryForList("SELECT tenant_id FROM scene_bindings WHERE tenant_id=?",tenant).isEmpty())throw new IdentityException(404,"SCENE_TENANT_NOT_BOUND");db.update("INSERT INTO scene_processing_runs(id,tenant_id,actor_id,operation,state) VALUES (?,?,?,?,'RUNNING')",run,tenant,actor,op);return run;}
 private void finish(UUID run,String error){db.update("UPDATE scene_processing_runs SET state=?,finished_at=now(),error_code=? WHERE id=?",error==null?"SUCCEEDED":"FAILED",error,run);}
 private void requireSceneAdmin(UUID actor,UUID tenant){if(!"admin".equals(bridge.call(tenant,"customer:"+actor,"GET","/scene-access",null).path("user").path("role").asText()))throw new IdentityException(403,"SCENE_OPERATION_FORBIDDEN");}
 public synchronized Object synchronize(UUID actor,UUID tenant,boolean platform){
  access(actor,tenant,platform);if(!platform)requireSceneAdmin(actor,tenant);UUID run=start(actor,tenant,"SYNC_INPUTS");
  try{
   var binding=db.queryForMap("SELECT * FROM scene_bindings WHERE tenant_id=?",tenant);
   UUID workspace=(UUID)binding.get("workspace_id"),connection=(UUID)binding.get("connection_id"),maintainer=(UUID)binding.get("maintainer_id");
   var export=bridge.call(tenant,maintainer.toString(),"GET","/scene-export",null);
   if(!tenant.toString().equals(export.path("tenantId").asText())||!"1.1".equals(export.path("contractVersion").asText()))throw new IdentityException(502,"SCENE_GOVERNANCE_CONTRACT_MISMATCH");
   var knowledge=bridge.call(tenant,maintainer.toString(),"GET","/scene-knowledge",null);
   var policies=new HashMap<String,JsonNode>();
   for(var asset:export.path("assets")){
    if(!asset.path("governance").path("allowedActors").isArray())throw new IdentityException(502,"SCENE_GOVERNANCE_CONTRACT_MISMATCH");
    policies.put(asset.path("id").asText(),asset.path("governance"));
   }
   String sourceRevision=IdentityService.hash(export.path("revision").asText()+knowledge.path("scopeRevision").asText()+knowledge.path("items").toString());
   if(sourceRevision.equals(binding.get("source_revision"))){
    var current=collection.detail(maintainer,tenant,connection);
    if(hasActiveTables(connection)&&current.currentRun()==null&&(current.lastRun()==null||!"SUCCEEDED".equals(current.lastRun().status())))collection.updateNow(maintainer,tenant,connection,UUID.randomUUID(),current.revision());
    refreshPolicyLease(tenant);finish(run,null);return status(actor,tenant,platform);
   }
   var sets=new ArrayList<CollectionDeployment.Dataset>();
   for(var a:export.path("assets"))if(a.path("kind").asText().equals("数据表")){
    var columns=new ArrayList<String>();var fields=new ArrayList<DatasetField>();
    for(var f:a.path("fields")){
     columns.add(f.path("name").asText());fields.add(SceneGovernance.field(a,f));
    }
    var meta=metadata(a);
    String scope=db.queryForObject("SELECT scene_table_scope(?::jsonb)::text",String.class,meta.toString());
    var prior=db.queryForList("SELECT d.id,d.field_definitions FROM scene_asset_links l JOIN business_datasets d ON d.id=l.target_id WHERE l.tenant_id=? AND l.source_id=? AND l.kind='TABLE' AND l.active AND d.status='ACTIVE' AND NOT d.scrubbed AND d.connection_id=? AND d.workspace_id=? AND scene_table_scope(l.metadata)=?::jsonb",tenant,a.path("id").asText(),connection,workspace,scope);
    UUID target=prior.isEmpty()?id(tenant+":"+a.path("id").asText()+":"+IdentityService.hash(scope)):(UUID)prior.getFirst().get("id");
    if(!prior.isEmpty()){fields.clear();fields.addAll(DatasetField.read(prior.getFirst().get("field_definitions")));}
    sets.add(new CollectionDeployment.Dataset(target,workspace,trim(a.path("id").asText(),160),trim(a.path("title").asText(),160),trim("标签："+a.path("tags")+"；"+a.path("dictionary").path("tableMeaning").asText(""),1000),columns,fields));
   }
   boolean tablesChanged=!new HashSet<>(db.queryForList("SELECT target_id FROM scene_asset_links WHERE tenant_id=? AND kind='TABLE' AND active",UUID.class,tenant)).equals(new HashSet<>(sets.stream().map(CollectionDeployment.Dataset::id).toList()));
   tx.executeWithoutResult(s->{access(actor,tenant,platform);identities.member(maintainer,tenant,true);
    refreshPolicyLease(tenant);db.update("UPDATE scene_asset_links SET active=false WHERE tenant_id=?",tenant);
    if(tablesChanged||db.queryForList("SELECT id FROM data_connections WHERE id=?",connection).isEmpty())deployment.apply(new CollectionDeployment.Manifest("1.0",tenant,connection,"企业数据基座","受控企业数据接口","仅接收本企业已治理的数据、标签和口径","READY","Asia/Shanghai",sets));
    int index=0;
    for(var a:export.path("assets")){
     String source=a.path("id").asText();var meta=metadata(a);
     if(a.path("kind").asText().equals("数据表")){link(tenant,source,"TABLE",sets.get(index++).id(),export.path("revision").asText(),meta);continue;}
     saveMaterial(maintainer,tenant,workspace,source,"DOCUMENT",a.path("title").asText(),a.path("content").asText(),meta);
    }
    for(var k:knowledge.path("items")){
     var meta=knowledgeMetadata(k,knowledge.path("sourceKind").path(k.path("id").asText()).asInt(1));
     var sourcePolicy=policies.get(k.path("sourceId").asText());
     if(sourcePolicy==null||sourcePolicy.path("sourceVersion").asInt(-1)!=k.path("sourceVersion").asInt(-2))continue;
     ((tools.jackson.databind.node.ObjectNode)meta).set("governance",sourcePolicy.deepCopy());
     StringBuilder body=new StringBuilder(k.path("verdict").asText());for(var evidence:k.path("kv"))body.append("\n\n").append(evidence.path(0).asText()).append("：").append(evidence.path(1).asText());
     saveMaterial(maintainer,tenant,workspace,k.path("id").asText(),"KNOWLEDGE",k.path("name").asText(),body.toString(),meta);
    }
    db.update("UPDATE materials SET in_library=false WHERE tenant_id=? AND id IN (SELECT target_id FROM scene_asset_links WHERE tenant_id=? AND NOT active AND kind<>'TABLE')",tenant,tenant);
    db.update("UPDATE scene_bindings SET source_revision=? WHERE tenant_id=?",sourceRevision,tenant);
   });
   var current=collection.detail(maintainer,tenant,connection);
   if(hasActiveTables(connection)&&current.currentRun()==null)collection.updateNow(maintainer,tenant,connection,UUID.randomUUID(),current.revision());
   refreshPolicyLease(tenant);finish(run,null);return status(actor,tenant,platform);
  }catch(RuntimeException e){finish(run,"SCENE_SYNC_FAILED");throw e;}
 }
 private void refreshPolicyLease(UUID tenant){db.update("UPDATE scene_bindings SET governance_valid_until=now()+interval '5 minutes' WHERE tenant_id=?",tenant);}
 private boolean hasActiveTables(UUID connection){return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM business_datasets WHERE connection_id=? AND status='ACTIVE')",Boolean.class,connection));}
 private void link(UUID tenant,String source,String kind,UUID target,String revision,JsonNode meta){db.update("INSERT INTO scene_asset_links(tenant_id,source_id,kind,target_id,revision,metadata) VALUES (?,?,?,?,?,?::jsonb) ON CONFLICT(tenant_id,source_id,kind) DO UPDATE SET target_id=excluded.target_id,revision=excluded.revision,metadata=excluded.metadata,active=true,updated_at=now()",tenant,source,kind,target,revision,meta.toString());db.update("INSERT INTO scene_asset_revisions(tenant_id,target_id,kind,revision,metadata) VALUES (?,?,?,?,?::jsonb) ON CONFLICT DO NOTHING",tenant,target,kind,revision,meta.toString());}
 private void saveMaterial(UUID actor,UUID tenant,UUID workspace,String source,String kind,String title,String content,JsonNode meta){
  String revision=IdentityService.hash(meta+"\n"+content);var old=db.queryForList("SELECT target_id,revision FROM scene_asset_links WHERE tenant_id=? AND source_id=? AND kind=?",tenant,source,kind);
  if(!old.isEmpty()&&revision.equals(old.getFirst().get("revision"))){db.update("UPDATE scene_asset_links SET active=true WHERE tenant_id=? AND source_id=? AND kind=?",tenant,source,kind);db.update("UPDATE materials SET in_library=true WHERE tenant_id=? AND id=?",tenant,old.getFirst().get("target_id"));return;}
  UUID target=old.isEmpty()?null:(UUID)old.getFirst().get("target_id");Integer version=target==null?null:db.queryForObject("SELECT current_version FROM materials WHERE tenant_id=? AND workspace_id=? AND id=?",Integer.class,tenant,workspace,target);
  if(target!=null)db.update("UPDATE scene_asset_links SET active=true,metadata=?::jsonb WHERE tenant_id=? AND source_id=? AND kind=?",meta.toString(),tenant,source,kind);
  String body="# "+title+"\n\n标签："+meta.path("tags")+"\n\n"+content;
  if(target!=null&&IdentityService.hash(body).equals(db.queryForObject("SELECT sha256 FROM material_versions WHERE tenant_id=? AND material_id=? AND number=?",String.class,tenant,target,version))){
   link(tenant,source,kind,target,revision,meta);db.update("UPDATE materials SET in_library=true WHERE tenant_id=? AND id=?",tenant,target);return;
  }
  var saved=materials.storeGenerated(actor,tenant,workspace,null,target,version,trim(title,170)+".md",body.getBytes(StandardCharsets.UTF_8));
  link(tenant,source,kind,saved.id(),revision,meta);
 }
}
