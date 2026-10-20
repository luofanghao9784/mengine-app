package com.dreamcore.workspace.scene;
import com.dreamcore.workspace.collection.*;
import java.time.Instant;
import java.util.*;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
@Component @Primary
public class SceneCollectionAdapter implements CollectionAdapter {
 private final SceneBridgeClient bridge;private final ProcessCollectionAdapter fallback;private final JdbcTemplate db;
 public SceneCollectionAdapter(SceneBridgeClient bridge,ProcessCollectionAdapter fallback,JdbcTemplate db){this.bridge=bridge;this.fallback=fallback;this.db=db;}
 @org.springframework.beans.factory.annotation.Autowired private ScenePublication publication;
 private void requirePublication(Request r){
  UUID publisher=db.queryForObject("SELECT maintainer_id FROM scene_bindings WHERE tenant_id=? AND connection_id=?",UUID.class,r.tenantId(),r.connectionId());
  for(var d:r.datasets()){var spaces=db.queryForList("SELECT d.workspace_id FROM business_datasets d JOIN scene_asset_links l ON l.tenant_id=d.tenant_id AND l.target_id=d.id AND l.kind='TABLE' AND l.active WHERE d.tenant_id=? AND d.id=? AND d.connection_id=?",UUID.class,r.tenantId(),d.id(),r.connectionId());if(spaces.size()!=1)throw new IllegalStateException("SCENE_DATASET_MISSING");publication.require(publisher,r.tenantId(),spaces.getFirst());}
 }
 public boolean available(){return bridge.available()||fallback.available();}
 public Result collect(Request r)throws Exception{return collect(r,()->true);}
 public Result collect(Request r,java.util.function.BooleanSupplier active)throws Exception{
  if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM scene_bindings WHERE tenant_id=? AND connection_id=?)",Boolean.class,r.tenantId(),r.connectionId())))return fallback.collect(r,active);
  if(!active.getAsBoolean())throw new IllegalStateException("COLLECTION_INTERRUPTED");
  requirePublication(r);
  var sources=new ArrayList<String>();for(var d:r.datasets())sources.addAll(db.queryForList("SELECT source_id FROM scene_asset_links WHERE tenant_id=? AND target_id=? AND kind='TABLE' AND active",String.class,r.tenantId(),d.id()));
  boolean explicit=Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM scene_routing_configs WHERE tenant_id=?)",Boolean.class,r.tenantId()));
  var export=bridge.call(r.tenantId(),"collection-worker","GET","/scene-export",explicit?Map.of("restrictedSourceIds",sources):null);
  if(!r.tenantId().toString().equals(export.path("tenantId").asText()))throw new IllegalStateException("SCENE_TENANT_MISMATCH");
  var result=new ArrayList<Snapshot>();
  for(var d:r.datasets()){
   var links=db.queryForList("SELECT source_id,metadata FROM scene_asset_links WHERE tenant_id=? AND target_id=? AND kind='TABLE'",r.tenantId(),d.id());
   if(links.size()!=1)throw new IllegalStateException("SCENE_DATASET_MISSING");
   var link=links.getFirst();boolean found=false;
   for(var a:export.path("assets"))if(a.path("id").asText().equals(link.get("source_id"))){
    if(!SceneService.metadata(a).toString().equals(link.get("metadata").toString()) && !SceneService.sameMetadata(a,link.get("metadata").toString()))throw new IllegalStateException("SCENE_SOURCE_CHANGED");
    var rows=new ArrayList<List<String>>();for(var row:a.path("rows")){var values=new ArrayList<String>();for(var value:row)values.add(value.isNull()?null:value.asText());rows.add(values);}
    result.add(new Snapshot(d.id(),a.path("coverageThrough").isTextual()?Instant.parse(a.path("coverageThrough").asText()):null,rows));found=true;break;
   }
   if(!found)throw new IllegalStateException("SCENE_SOURCE_WITHDRAWN");
  }
  if(!active.getAsBoolean())throw new IllegalStateException("COLLECTION_INTERRUPTED");
  requirePublication(r);
  return new Result("1.0",result);
 }
}
