package com.dreamcore.workspace.conversation;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.dreamcore.workspace.identity.*;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.constructor.SafeConstructor;
@Service
public class NativeEnterpriseSkills {
 private final NativeConversationService sessions;private final IdentityService identities;private final JdbcTemplate db;
 public NativeEnterpriseSkills(NativeConversationService s,IdentityService i,JdbcTemplate d){sessions=s;identities=i;db=d;}
 public record Put(String markdown,boolean published,List<UUID> audience){}
 @Transactional public Object put(UUID actor,UUID tenant,String name,Put input){
  identities.member(actor,tenant,true);db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",tenant);
  if(!name.matches("[a-z0-9]+(?:-[a-z0-9]+)*")||name.length()>64||input==null||input.markdown()==null||input.markdown().length()>65536||input.audience()==null||input.audience().size()>500)throw IdentityException.invalid();
  String raw=input.markdown().replace("\r\n","\n");int end=raw.indexOf("\n---\n",4);if(!raw.startsWith("---\n")||end<4)throw IdentityException.invalid();
  Map<?,?> meta;try{var options=new LoaderOptions();options.setAllowDuplicateKeys(false);options.setMaxAliasesForCollections(0);options.setCodePointLimit(65536);Object v=new Yaml(new SafeConstructor(options)).load(raw.substring(4,end));if(!(v instanceof Map<?,?> m))throw IdentityException.invalid();meta=m;}catch(Exception e){throw IdentityException.invalid();}
  if(!name.equals(meta.get("name"))||!(meta.get("description") instanceof String description)||description.isBlank()||description.length()>1000||raw.substring(end+5).isBlank())throw IdentityException.invalid();
  // This slice supports instruction-only SKILL.md; invocation/sidecar settings cannot silently bypass review.
  if(!Set.of("name","description").containsAll(meta.keySet()))throw IdentityException.invalid();
  for(UUID account:input.audience())identities.member(account,tenant,false,false);
  db.update("INSERT INTO native_enterprise_skills(tenant_id,name,description,content,markdown,published,audience,reviewed_by) VALUES (?,?,?,?,?,?,?::uuid[],?) ON CONFLICT(tenant_id,name) DO UPDATE SET description=excluded.description,content=excluded.content,markdown=excluded.markdown,published=excluded.published,audience=excluded.audience,reviewed_by=excluded.reviewed_by,revision=native_enterprise_skills.revision+1,updated_at=now()",tenant,name,description,raw.substring(end+5),raw,input.published(),"{"+String.join(",",input.audience().stream().map(UUID::toString).toList())+"}",actor);
  return Map.of("name",name,"published",input.published());
 }
 @Transactional public List<Map<String,Object>> admin(UUID actor,UUID tenant){identities.member(actor,tenant,true);return db.query("SELECT name,description,markdown,published,audience,revision FROM native_enterprise_skills WHERE tenant_id=? ORDER BY name",(rs,n)->Map.<String,Object>of("name",rs.getString("name"),"description",rs.getString("description"),"markdown",rs.getString("markdown"),"published",rs.getBoolean("published"),"audience",Arrays.asList((UUID[])rs.getArray("audience").getArray()),"revision",rs.getLong("revision")),tenant);}
 @Transactional public List<Map<String,Object>> list(UUID actor,UUID tenant){sessions.requireMember(actor,tenant);return db.queryForList("SELECT name,description FROM native_enterprise_skills WHERE tenant_id=? AND published AND (cardinality(audience)=0 OR ?=ANY(audience)) ORDER BY name",tenant,actor);}
 @Transactional public Object runtime(UUID id,String token,String name){
  var s=sessions.check(id,token);if(name==null)return Map.of("items",list(s.ownerId(),s.tenantId()));
  var rows=db.queryForList("SELECT name,description,content FROM native_enterprise_skills WHERE tenant_id=? AND name=? AND published AND (cardinality(audience)=0 OR ?=ANY(audience))",s.tenantId(),name,s.ownerId());if(rows.isEmpty())throw new IdentityException(404,"NATIVE_SKILL_UNAVAILABLE");return rows.getFirst();
 }
}
