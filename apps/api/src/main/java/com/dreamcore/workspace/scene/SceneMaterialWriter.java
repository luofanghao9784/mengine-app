package com.dreamcore.workspace.scene;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.*;

/** Internal scene-only writer: no controller accepts caller supplied content through this path. */
@Service
public class SceneMaterialWriter {
 private final JdbcTemplate db;private final ObjectStore objects;private final ScenePublication permission;private final IdentityAudit audit;
 public SceneMaterialWriter(JdbcTemplate db,ObjectStore objects,ScenePublication permission,IdentityAudit audit){this.db=db;this.objects=objects;this.permission=permission;this.audit=audit;}
 @org.springframework.beans.factory.annotation.Autowired private com.dreamcore.workspace.knowledge.KnowledgeService knowledge;
 @Transactional public UUID store(UUID actor,UUID tenant,UUID space,String source,String kind,UUID target,Integer expected,String title,byte[] bytes){
  db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",tenant);permission.require(actor,tenant,space);
  if(!Set.of("DOCUMENT","KNOWLEDGE").contains(kind)||source==null||source.isBlank()||bytes.length>20971520)throw IdentityException.invalid();
  String filename=MaterialService.name(title);int number=1;
  if(target!=null){
   var rows=db.queryForList("SELECT m.current_version FROM scene_asset_links l JOIN materials m ON m.id=l.target_id AND m.tenant_id=l.tenant_id WHERE l.tenant_id=? AND l.source_id=? AND l.kind=? AND l.target_id=? AND m.workspace_id=? FOR UPDATE OF m",tenant,source,kind,target,space);
   if(rows.size()!=1||!Objects.equals(rows.getFirst().get("current_version"),expected))throw new IdentityException(409,"MATERIAL_VERSION_CONFLICT");
   number=expected+1;
  }else if(expected!=null)throw IdentityException.invalid();
  UUID id=target==null?UUID.randomUUID():target,object=objects.put(bytes);
  TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization(){@Override public void afterCompletion(int status){if(status!=STATUS_COMMITTED)objects.discard(object);}});
  if(target==null)db.update("INSERT INTO materials(id,tenant_id,workspace_id,name,created_by) VALUES (?,?,?,?,?)",id,tenant,space,filename,actor);
  else db.update("UPDATE materials SET current_version=?,updated_at=now() WHERE tenant_id=? AND id=?",number,tenant,id);
  UUID versionId=UUID.randomUUID();
  db.update("INSERT INTO material_versions(id,tenant_id,workspace_id,material_id,number,filename,size_bytes,sha256,object_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)",versionId,tenant,space,id,number,filename,bytes.length,ObjectStore.sha256(bytes),object,actor);
  knowledge.onSceneUpload(actor,tenant,space,id,versionId);
  audit.record(actor,tenant,"SCENE_MATERIAL_PUBLISH",id,"SUCCESS");return id;
 }
}
