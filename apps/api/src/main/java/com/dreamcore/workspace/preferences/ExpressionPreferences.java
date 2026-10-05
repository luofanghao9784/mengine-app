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
 public record RuleRecord(String id,String rule,String origin,String provenance,String state,int revision,java.time.Instant recordedAt) {}
 public record Records(String scope,List<RuleRecord> items,boolean hasMore) {}
 /** A revision is an event, not merely a current selector value. Preserve superseded and withdrawn history. */
 @Transactional public Records records(UUID actor,UUID tenant,String scope,int offset,int limit){
  if(offset<0||offset>100000||limit<1||limit>100)throw IdentityException.invalid();
  read(actor,tenant,scope); // Same realm, membership, private-owner and departure checks as effective settings.
  var result=new ArrayList<RuleRecord>();
  if(scope.equals("GLOBAL")){
   var rows=db.queryForList("SELECT * FROM (SELECT 'choice' AS kind,preference_key AS key,choice AS body,revision,changed_at,revision=(SELECT max(x.revision) FROM expression_preference_defaults x WHERE x.preference_key=d.preference_key) AS latest FROM expression_preference_defaults d UNION ALL SELECT 'book',target,body,revision,changed_at,revision=(SELECT max(x.revision) FROM expression_rule_books x WHERE x.target=b.target) FROM expression_rule_books b) r ORDER BY changed_at DESC,key,revision DESC LIMIT ? OFFSET ?",limit+1,offset);
   for(var row:rows){String key=(String)row.get("key"),body=(String)row.get("body");boolean book="book".equals(row.get("kind"));var c=TaskPreferenceCatalog.find(key,body);String state=!Boolean.TRUE.equals(row.get("latest"))?"SUPERSEDED":body.isEmpty()?"WITHDRAWN":book||c!=null?"EFFECTIVE":"RECORDED";
    String rule=book?(key.equals("TOPICS")?"画报选题规则：\n":key.equals("BRIEFING")?"画报表达规则：\n":"通用表达规则：\n")+(body.isEmpty()?"已撤回本层规则":body):body.isEmpty()?"恢复系统默认："+Map.of("RESPONSE_LENGTH","内容长短","RESPONSE_FORMAT","正文形式","TONE","表达语气","BRIEFING_ORDER","画报顺序").getOrDefault(key,"表达规则"):c==null?"未识别的历史规则":c.label();
    result.add(new RuleRecord((book?"book:":"")+key+":"+row.get("revision"),rule,"MANUAL","总部手动录入",state,(Integer)row.get("revision"),((java.sql.Timestamp)row.get("changed_at")).toInstant()));
   }
  }else{
   var sc=scope(scope);subject(actor,tenant,sc);
   var rows=db.queryForList("SELECT e.id,e.entry_key,e.revision AS current_revision,v.id AS version_id,v.revision,v.created_at,NOT v.scrubbed AND object_is_active('PROFILE_VERSION',v.id) AND company_profile_readable(v.id) AS available,EXISTS(SELECT 1 FROM task_preference_saves t WHERE t.tenant_id=e.tenant_id AND t.profile_id=e.id AND t.profile_revision=v.revision) AS conversational FROM profile_entries e JOIN profile_versions v ON v.entry_id=e.id AND v.tenant_id=e.tenant_id WHERE e.tenant_id=? AND e.scope=? AND e.account_id IS NOT DISTINCT FROM ?::uuid AND e.workspace_id IS NULL AND e.kind='PREFERENCE' ORDER BY v.created_at DESC,v.id DESC LIMIT ? OFFSET ?",tenant,scope,sc==ProfileService.Scope.PERSONAL?actor:null,limit+1,offset);
   for(var row:rows){String rule=null,provenance=null,state="UNAVAILABLE";int revision=(Integer)row.get("revision");
    if(Boolean.TRUE.equals(row.get("available"))){var v=profiles.get(actor,tenant,(UUID)row.get("id"),revision);rule=v.value();provenance=v.provenance();state=v.effectiveStatus().equals("WITHDRAWN")?"WITHDRAWN":v.effectiveStatus().equals("EXPIRED")?"EXPIRED":revision!=(Integer)row.get("current_revision")?"SUPERSEDED":"RECORDED";
     String key=(String)row.get("entry_key");if(state.equals("RECORDED")&&v.effectiveStatus().equals("ACTIVE")&&Set.of("ai.rules.ALL","ai.rules.BRIEFING","ai.rules.TOPICS").contains(key)&&v.value().length()<=4000)state="EFFECTIVE";if(state.equals("RECORDED")&&v.effectiveStatus().equals("ACTIVE")&&key.startsWith("ai.preference.")&&TaskPreferenceCatalog.CHOICES.stream().anyMatch(c->c.category().equals(key.substring("ai.preference.".length()))&&c.label().equals(v.value())))state="EFFECTIVE";
    }
    result.add(new RuleRecord(row.get("version_id").toString(),rule,Boolean.TRUE.equals(row.get("conversational"))?"CONVERSATION":"MANUAL",provenance,state,revision,((java.sql.Timestamp)row.get("created_at")).toInstant()));
   }
  }
  return new Records(scope,result.stream().limit(limit).toList(),result.size()>limit);
 }
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
