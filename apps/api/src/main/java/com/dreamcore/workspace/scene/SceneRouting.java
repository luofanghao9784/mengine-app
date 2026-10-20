package com.dreamcore.workspace.scene;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.MaterialAccess;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Destination routing only narrows source permissions; it never grants source access. */
@Service
public class SceneRouting {
 public record Route(String sourceId, UUID workspaceId, List<UUID> readers) {}
 public record Change(int revision, List<Route> routes) {}
 private final JdbcTemplate db; private final MaterialAccess access; private final IdentityService identities; private final IdentityAudit audit;
 private final JsonMapper json=new JsonMapper();
 public SceneRouting(JdbcTemplate db,MaterialAccess access,IdentityService identities,IdentityAudit audit){this.db=db;this.access=access;this.identities=identities;this.audit=audit;}
 @org.springframework.beans.factory.annotation.Autowired private ScenePublication publication;
 public JsonNode snapshot(UUID tenant){
  var rows=db.queryForList("SELECT revision,routes::text FROM scene_routing_configs WHERE tenant_id=?",tenant);
  if(rows.isEmpty())return json.nullNode();
  var result=json.createObjectNode();result.put("revision",(Integer)rows.getFirst().get("revision"));result.set("routes",json.readTree(rows.getFirst().get("routes").toString()));return result;
 }
 @Transactional public JsonNode replace(UUID actor,UUID tenant,Change change){
  identities.member(actor,tenant,true);
  db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",tenant);
  var binding=db.queryForList("SELECT maintainer_id FROM scene_bindings WHERE tenant_id=?",tenant);
  if(binding.isEmpty())throw new IdentityException(409,"SCENE_TENANT_NOT_BOUND");
  if(change==null||change.routes()==null||change.routes().size()>100)throw IdentityException.invalid();
  var old=snapshot(tenant);if(change.revision()!=(old.isNull()?0:old.path("revision").asInt()))throw new IdentityException(409,"SCENE_ROUTING_CHANGED");
  var ids=new HashSet<String>();var canonical=new ArrayList<Route>();
  for(var r:change.routes()){
   if(r==null||r.sourceId()==null||r.sourceId().isBlank()||r.sourceId().length()>160||r.sourceId().chars().anyMatch(Character::isISOControl)||!ids.add(r.sourceId())||r.workspaceId()==null||r.readers()==null||r.readers().size()>100||r.readers().stream().anyMatch(Objects::isNull))throw IdentityException.invalid();
   publication.require((UUID)binding.getFirst().get("maintainer_id"),tenant,r.workspaceId());
   for(var person:r.readers())identities.member(person,tenant,false);
   canonical.add(new Route(r.sourceId(),r.workspaceId(),r.readers().stream().distinct().sorted().toList()));
  }
  canonical.sort(Comparator.comparing(Route::sourceId));var routes=json.valueToTree(canonical);
  if(!old.isNull()&&old.path("routes").equals(routes))return old;
  db.update("INSERT INTO scene_routing_configs(tenant_id,routes) VALUES (?,?::jsonb) ON CONFLICT(tenant_id) DO UPDATE SET routes=excluded.routes,revision=scene_routing_configs.revision+1,updated_at=now()",tenant,routes.toString());
  // Fail closed immediately, including old snapshots and cached task results, until sync succeeds.
  db.update("UPDATE scene_bindings SET governance_valid_until=NULL WHERE tenant_id=?",tenant);
  audit.record(actor,tenant,"SCENE_ROUTING_UPDATE",tenant,"SUCCESS");return snapshot(tenant);
 }
 public void lockAndCheck(UUID tenant,JsonNode expected){
  db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",tenant);
  if(!snapshot(tenant).equals(expected))throw new IdentityException(409,"SCENE_ROUTING_CHANGED");
 }
 public static JsonNode route(JsonNode config,String source){
  if(config.isNull())return null;
  for(var r:config.path("routes"))if(source.equals(r.path("sourceId").asText()))return r;
  return null;
 }
 public static UUID destination(JsonNode config,String source,UUID fallback){var r=route(config,source);return r==null?(config.isNull()?fallback:null):UUID.fromString(r.path("workspaceId").asText());}
 public static JsonNode metadata(JsonNode original,JsonNode config,String source){
  var copy=original.deepCopy();var route=route(config,source);
  if(route!=null)((tools.jackson.databind.node.ObjectNode)copy).set("routing",route.deepCopy());return copy;
 }
}
