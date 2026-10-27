package com.dreamcore.workspace.conversation;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import com.dreamcore.workspace.identity.*;
import tools.jackson.databind.json.JsonMapper;
@Service
public class NativePluginPolicy {
 private final JdbcTemplate db;private final IdentityService identities;private final JsonMapper json=new JsonMapper();private final Map<String,Object> manifest;
 @SuppressWarnings("unchecked") public NativePluginPolicy(JdbcTemplate db,IdentityService identities)throws Exception{this.db=db;this.identities=identities;try(var in=getClass().getResourceAsStream("/preinstalled-plugins.json")){manifest=json.readValue(in,Map.class);}}
 @SuppressWarnings("unchecked") public List<Map<String,Object>> entries(){return (List<Map<String,Object>>)manifest.get("preinstalled");}
 @SuppressWarnings("unchecked") public Map<String,Object> snapshot(UUID tenant){
  var rows=db.queryForList("SELECT revision,enabled::text FROM native_plugin_policy WHERE tenant_id=?",tenant);Map<String,Object> overrides=rows.isEmpty()?Map.of():json.readValue(rows.getFirst().get("enabled").toString(),Map.class);var enabled=new TreeMap<String,Boolean>();for(var e:entries())enabled.put(e.get("id").toString(),Boolean.TRUE.equals(e.get("required"))||Boolean.TRUE.equals(overrides.getOrDefault(e.get("id"),e.get("defaultEnabled"))));
  return Map.of("revision",rows.isEmpty()?0L:rows.getFirst().get("revision"),"enabled",enabled);
 }
 @SuppressWarnings("unchecked") public void require(UUID tenant,String id){if(!Boolean.TRUE.equals(((Map<String,Object>)snapshot(tenant).get("enabled")).get(id)))throw new IdentityException(403,"NATIVE_PLUGIN_DISABLED");}
 @Transactional public Object list(UUID actor,UUID tenant,boolean admin){identities.member(actor,tenant,admin);return Map.of("manifest",manifest,"policy",snapshot(tenant));}
 public record Toggle(boolean enabled,long revision){}
 @Transactional public Object toggle(UUID actor,UUID tenant,String id,Toggle change){
  identities.member(actor,tenant,true);db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",tenant);
  var entry=entries().stream().filter(e->id.equals(e.get("id"))).findFirst().orElseThrow(IdentityException::invalid);if(Boolean.TRUE.equals(entry.get("required")))throw new IdentityException(409,"NATIVE_PLUGIN_REQUIRED");
  var current=snapshot(tenant);if(((Number)current.get("revision")).longValue()!=change.revision())throw new IdentityException(409,"NATIVE_PLUGIN_REVISION_CONFLICT");
  db.update("INSERT INTO native_plugin_policy(tenant_id,revision,enabled,changed_by) VALUES (?,1,jsonb_build_object(?::text,?::boolean),?) ON CONFLICT(tenant_id) DO UPDATE SET enabled=native_plugin_policy.enabled||excluded.enabled,revision=native_plugin_policy.revision+1,changed_by=excluded.changed_by,updated_at=now()",tenant,id,change.enabled(),actor);return snapshot(tenant);
 }
}
