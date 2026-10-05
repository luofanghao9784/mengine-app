package com.dreamcore.workspace.preferences;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.profile.ProfileService;
import com.dreamcore.workspace.taskwork.TaskPreferenceCatalog;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Expression settings only. Values are allowlisted and never grant authority or supply business facts. */
@Service
public class ExpressionPreferences {
 public record Setting(String choice,int revision,UUID id) {}
 public record Effective(String choice,String source,int revision) {}
 public record Page(String scope,boolean canMaintain,Map<String,Setting> settings,Map<String,Effective> effective,List<TaskPreferenceCatalog.Choice> choices) {}
 public record Change(UUID requestId,Map<String,String> choices,Map<String,Integer> expectedRevisions) {}
 private final JdbcTemplate db;private final IdentityService identities;private final IdentityAudit audit;private final ProfileService profiles;
 public ExpressionPreferences(JdbcTemplate db,IdentityService identities,IdentityAudit audit,ProfileService profiles){this.db=db;this.identities=identities;this.audit=audit;this.profiles=profiles;}
 public static final Map<String,String> BASE=Map.of("RESPONSE_LENGTH","CONCISE","RESPONSE_FORMAT","PARAGRAPHS","TONE","DIRECT","BRIEFING_ORDER","CONCLUSION_FIRST");
 private Map<String,Setting> global(){var out=new LinkedHashMap<String,Setting>();BASE.keySet().stream().sorted().forEach(k->out.put(k,new Setting("",0,null)));db.queryForList("SELECT DISTINCT ON(preference_key) preference_key,choice,revision FROM expression_preference_defaults ORDER BY preference_key,revision DESC").forEach(r->out.put((String)r.get("preference_key"),new Setting((String)r.get("choice"),(Integer)r.get("revision"),null)));return out;}
 private ProfileService.Scope scope(String scope){if(!Set.of("TENANT","PERSONAL").contains(scope))throw IdentityException.invalid();return ProfileService.Scope.valueOf(scope);}
 private UUID subject(UUID actor,UUID tenant,ProfileService.Scope scope){if(scope==ProfileService.Scope.PERSONAL&&!identities.permissionActor(actor,tenant).equals(actor))throw new IdentityException(403,"PRIVATE_PREFERENCE_DENIED");return scope==ProfileService.Scope.TENANT?tenant:actor;}
 private Map<String,Setting> layer(UUID actor,UUID tenant,ProfileService.Scope scope){
  UUID subject=subject(actor,tenant,scope);profiles.list(actor,tenant,scope,subject,0,1);
  var out=new LinkedHashMap<String,Setting>();BASE.keySet().forEach(k->out.put(k,new Setting("",0,null)));
  var rows=db.queryForList("SELECT e.id,e.entry_key,e.revision,CASE WHEN e.kind='PREFERENCE' AND v.status='ACTIVE' AND (v.expires_at IS NULL OR v.expires_at>clock_timestamp()) AND NOT v.scrubbed AND object_is_active('PROFILE_VERSION',v.id) AND company_profile_readable(v.id) THEN v.value ELSE NULL END AS value FROM profile_entries e JOIN profile_versions v ON v.entry_id=e.id AND v.revision=e.revision WHERE e.tenant_id=? AND e.scope=? AND e.account_id IS NOT DISTINCT FROM ?::uuid AND e.workspace_id IS NULL AND e.entry_key IN ('ai.preference.RESPONSE_LENGTH','ai.preference.RESPONSE_FORMAT','ai.preference.TONE','ai.preference.BRIEFING_ORDER')",tenant,scope.name(),scope==ProfileService.Scope.PERSONAL?actor:null);
  for(var row:rows){String k=((String)row.get("entry_key")).substring("ai.preference.".length());String choice=TaskPreferenceCatalog.CHOICES.stream().filter(c->c.category().equals(k)&&c.label().equals(row.get("value"))).map(TaskPreferenceCatalog.Choice::choice).findFirst().orElse("");out.put(k,new Setting(choice,(Integer)row.get("revision"),(UUID)row.get("id")));}
  return out;
 }
 private void merge(Map<String,Effective> out,Map<String,Setting> layer,String source){layer.forEach((k,v)->{if(!v.choice().isEmpty()&&TaskPreferenceCatalog.find(k,v.choice())!=null)out.put(k,new Effective(v.choice(),source,v.revision()));});}
 @Transactional public Map<String,Effective> effective(UUID actor,UUID tenant){var out=new LinkedHashMap<String,Effective>();BASE.forEach((k,v)->out.put(k,new Effective(v,"SYSTEM",0)));merge(out,global(),"GLOBAL");merge(out,layer(actor,tenant,ProfileService.Scope.TENANT),"TENANT");if(identities.permissionActor(actor,tenant).equals(actor))merge(out,layer(actor,tenant,ProfileService.Scope.PERSONAL),"PERSONAL");return out;}
 @Transactional public Page read(UUID actor,UUID tenant,String scope){if(scope.equals("GLOBAL")){if(tenant!=null)throw IdentityException.invalid();identities.platform(actor);var values=global();var eff=new LinkedHashMap<String,Effective>();BASE.forEach((k,v)->eff.put(k,new Effective(v,"SYSTEM",0)));merge(eff,values,"GLOBAL");return new Page(scope,true,values,eff,TaskPreferenceCatalog.CHOICES);}var s=scope(scope);UUID subject=subject(actor,tenant,s);var page=profiles.list(actor,tenant,s,subject,0,1);var eff=new LinkedHashMap<String,Effective>();BASE.forEach((k,v)->eff.put(k,new Effective(v,"SYSTEM",0)));merge(eff,global(),"GLOBAL");merge(eff,layer(actor,tenant,ProfileService.Scope.TENANT),"TENANT");var values=layer(actor,tenant,s);if(s==ProfileService.Scope.PERSONAL)merge(eff,values,"PERSONAL");return new Page(scope,page.canMaintain(),values,eff,TaskPreferenceCatalog.CHOICES);}
 @Transactional public Page save(UUID actor,UUID tenant,String scope,Change change){if(change==null||change.requestId()==null||change.choices()==null||change.expectedRevisions()==null||!change.choices().keySet().equals(BASE.keySet())||!change.expectedRevisions().keySet().equals(BASE.keySet()))throw IdentityException.invalid();change.choices().forEach((k,v)->{if(v==null||!v.isEmpty()&&TaskPreferenceCatalog.find(k,v)==null||change.expectedRevisions().get(k)==null||change.expectedRevisions().get(k)<0)throw IdentityException.invalid();});
  Page before=read(actor,tenant,scope);if(!before.canMaintain())throw new IdentityException(403,"PROFILE_READ_ONLY");db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","expression-preferences:"+scope+":"+tenant+":"+(scope.equals("PERSONAL")?actor:"shared"));before=read(actor,tenant,scope);
  String fingerprint=IdentityService.hash(new tools.jackson.databind.json.JsonMapper().writeValueAsString(List.of(scope,tenant==null?"GLOBAL":tenant.toString(),new TreeMap<>(change.choices()),new TreeMap<>(change.expectedRevisions()))));
  if(identities.priorRequest(actor,change.requestId(),"EXPRESSION_PREFERENCES",fingerprint)!=null)return before;
  for(String k:BASE.keySet()){Setting old=before.settings().get(k);String next=change.choices().get(k);if(old.choice().equals(next))continue;if(old.revision()!=change.expectedRevisions().get(k))throw new IdentityException(409,"PROFILE_VERSION_CONFLICT");UUID request=UUID.nameUUIDFromBytes((change.requestId()+":"+k).getBytes(java.nio.charset.StandardCharsets.UTF_8));
   if(scope.equals("GLOBAL")){db.update("INSERT INTO expression_preference_defaults(preference_key,revision,choice,changed_by,request_id) VALUES (?,?,?,?,?)",k,old.revision()+1,next,actor,request);audit.record(actor,null,"EXPRESSION_DEFAULT_CHANGED",request,"SUCCESS");}
   else{var s=scope(scope);if(old.id()!=null&&!"PREFERENCE".equals(db.queryForObject("SELECT kind FROM profile_entries WHERE id=?",String.class,old.id())))throw new IdentityException(409,"PROFILE_KIND_CONFLICT");if(next.isEmpty()){profiles.withdraw(actor,tenant,old.id(),old.revision(),request);}else{var c=new ProfileService.Content(TaskPreferenceCatalog.find(k,next).label(),"用户在AI内容偏好维护中明确设置",ProfileService.Status.ACTIVE,null);if(old.id()==null)profiles.create(actor,tenant,s,subject(actor,tenant,s),"ai.preference."+k,ProfileService.Kind.PREFERENCE,c,request);else profiles.save(actor,tenant,old.id(),old.revision(),c,request);}}
  }identities.remember(actor,change.requestId(),"EXPRESSION_PREFERENCES",fingerprint,change.requestId());return read(actor,tenant,scope);
 }
}
