package com.dreamcore.workspace.scene;
import com.dreamcore.workspace.identity.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Only the bound sync identity may publish. Never used by ordinary library or read paths. */
@Service
public class ScenePublication {
 private final JdbcTemplate db; private final IdentityService identities; private final IdentityAudit audit;
 private final JsonMapper json=new JsonMapper();
 public ScenePublication(JdbcTemplate db,IdentityService identities,IdentityAudit audit){this.db=db;this.identities=identities;this.audit=audit;}
 public record Change(int revision,List<UUID> workspaces){}
 public Object get(UUID actor,UUID tenant){identities.member(actor,tenant,true);var rows=db.queryForList("SELECT revision,workspaces::text FROM scene_publication_configs WHERE tenant_id=?",tenant);return Map.of("revision",rows.isEmpty()?0:rows.getFirst().get("revision"),"workspaces",rows.isEmpty()?json.createArrayNode():json.readTree(rows.getFirst().get("workspaces").toString()),"choices",db.queryForList("SELECT id,name FROM workspaces WHERE tenant_id=? AND kind='SHARED' AND NOT archived ORDER BY name",tenant));}
 @Transactional public Object replace(UUID actor,UUID tenant,Change c){
  identities.member(actor,tenant,true);db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",tenant);
  if(c==null||c.workspaces()==null||c.workspaces().size()>100||c.workspaces().stream().anyMatch(Objects::isNull))throw IdentityException.invalid();
  var binding=db.queryForList("SELECT maintainer_id FROM scene_bindings WHERE tenant_id=?",UUID.class,tenant);
  if(binding.isEmpty())throw new IdentityException(409,"SCENE_TENANT_NOT_BOUND");
  identities.member(binding.getFirst(),tenant,true);
  var rows=db.queryForList("SELECT revision,workspaces::text FROM scene_publication_configs WHERE tenant_id=?",tenant);
  if(c.revision()!=(rows.isEmpty()?0:(Integer)rows.getFirst().get("revision")))throw new IdentityException(409,"SCENE_PUBLICATION_CHANGED");
  var ids=c.workspaces().stream().distinct().sorted().toList();
  for(var id:ids)if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM workspaces WHERE tenant_id=? AND id=? AND kind='SHARED' AND NOT archived)",Boolean.class,tenant,id)))throw IdentityException.invalid();
  String value=json.writeValueAsString(ids);
  if(!rows.isEmpty()&&json.readTree(rows.getFirst().get("workspaces").toString()).equals(json.readTree(value)))return get(actor,tenant);
  db.update("INSERT INTO scene_publication_configs(tenant_id,workspaces) VALUES (?,?::jsonb) ON CONFLICT(tenant_id) DO UPDATE SET workspaces=excluded.workspaces,revision=scene_publication_configs.revision+1,updated_at=now()",tenant,value);
  db.update("UPDATE scene_bindings SET governance_valid_until=NULL,source_revision=NULL WHERE tenant_id=?",tenant);
  audit.record(actor,tenant,"SCENE_PUBLICATION_UPDATE",tenant,"SUCCESS");return get(actor,tenant);
 }
 public void require(UUID actor,UUID tenant,UUID workspace){
  identities.member(actor,tenant,true);
  if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM scene_bindings b JOIN workspaces w ON w.tenant_id=b.tenant_id LEFT JOIN scene_publication_configs p ON p.tenant_id=b.tenant_id WHERE b.tenant_id=? AND b.maintainer_id=? AND w.id=? AND w.kind='SHARED' AND NOT w.archived AND NOT EXISTS(SELECT 1 FROM departure_executions d WHERE d.tenant_id=b.tenant_id AND d.kind='TENANT_EXIT' AND d.state<>'CANCELLED') AND CASE WHEN p.tenant_id IS NOT NULL THEN jsonb_exists(p.workspaces,CAST(w.id AS text)) ELSE (library_mask(?,b.tenant_id,'WORKSPACE',w.id)&3)=3 END)",Boolean.class,tenant,actor,workspace,actor)))throw new IdentityException(403,"SCENE_PUBLICATION_REQUIRED");
 }
}
