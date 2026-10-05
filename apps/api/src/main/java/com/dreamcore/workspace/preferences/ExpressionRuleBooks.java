package com.dreamcore.workspace.preferences;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.profile.ProfileService;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Human-authored expression instructions; never an authorization or evidence source. */
@Service
public class ExpressionRuleBooks {
 public record Book(String target,String body,int revision,UUID id) {}
 public record Rule(String target,String body,String source,int revision) {}
 public record Page(String scope,boolean canMaintain,List<Book> books) {}
 public record Change(UUID requestId,String target,String body,int expectedRevision) {}
 private final JdbcTemplate db;private final ExpressionPreferences permissions;private final ProfileService profiles;private final IdentityService identities;private final IdentityAudit audit;
 public ExpressionRuleBooks(JdbcTemplate db,ExpressionPreferences permissions,ProfileService profiles,IdentityService identities,IdentityAudit audit){this.db=db;this.permissions=permissions;this.profiles=profiles;this.identities=identities;this.audit=audit;}
 private void target(String value){if(value==null||!Set.of("ALL","BRIEFING").contains(value))throw IdentityException.invalid();}
 private List<Book> layer(UUID actor,UUID tenant,String scope){
  var books=new ArrayList<Book>();
  for(String target:List.of("ALL","BRIEFING")){
   if(scope.equals("GLOBAL")){
    var rows=db.queryForList("SELECT body,revision FROM expression_rule_books WHERE target=? ORDER BY revision DESC LIMIT 1",target);
    books.add(rows.isEmpty()?new Book(target,"",0,null):new Book(target,(String)rows.getFirst().get("body"),(Integer)rows.getFirst().get("revision"),null));
   }else{
    var rows=db.queryForList("SELECT id,revision,kind FROM profile_entries WHERE tenant_id=? AND scope=? AND account_id IS NOT DISTINCT FROM ?::uuid AND workspace_id IS NULL AND entry_key=?",tenant,scope,scope.equals("PERSONAL")?actor:null,"ai.rules."+target);
    if(rows.isEmpty()){books.add(new Book(target,"",0,null));continue;}
    var row=rows.getFirst();UUID id=(UUID)row.get("id");int revision=(Integer)row.get("revision");
    boolean readable=Boolean.TRUE.equals(db.queryForObject("SELECT NOT scrubbed AND object_is_active('PROFILE_VERSION',id) AND company_profile_readable(id) FROM profile_versions WHERE entry_id=? AND revision=?",Boolean.class,id,revision));
    String body="";
    if(readable&&"PREFERENCE".equals(row.get("kind"))){var v=profiles.get(actor,tenant,id,null);if(v.effectiveStatus().equals("ACTIVE")&&v.value().length()<=4000)body=v.value();}
    books.add(new Book(target,body,revision,id));
   }
  }
  return books;
 }
 @Transactional public Page read(UUID actor,UUID tenant,String scope){var p=permissions.read(actor,tenant,scope);return new Page(scope,p.canMaintain(),layer(actor,tenant,scope));}
 @Transactional public List<Rule> effective(UUID actor,UUID tenant){
  permissions.read(actor,tenant,"TENANT");var out=new ArrayList<Rule>();
  for(String scope:List.of("GLOBAL","TENANT","PERSONAL")){
   if(scope.equals("PERSONAL")&&!identities.permissionActor(actor,tenant).equals(actor))continue;
   if(!scope.equals("GLOBAL"))permissions.read(actor,tenant,scope);
   for(var b:layer(actor,tenant,scope))if(!b.body().isBlank())out.add(new Rule(b.target(),b.body(),scope,b.revision()));
  }
  return out;
 }
 @Transactional public Object taskSnapshot(UUID actor,UUID tenant,UUID task){
  // Caller has already authorized task/attempt. Replays use the same immutable selected rules.
  String existing=db.queryForList("SELECT rules::text FROM expression_rule_task_snapshots WHERE task_id=?",String.class,task).stream().findFirst().orElse(null);
  var mapper=new tools.jackson.databind.json.JsonMapper();
  if(existing==null){String value=mapper.writeValueAsString(effective(actor,tenant));db.update("INSERT INTO expression_rule_task_snapshots(task_id,rules) VALUES (?,?::jsonb) ON CONFLICT DO NOTHING",task,value);existing=db.queryForObject("SELECT rules::text FROM expression_rule_task_snapshots WHERE task_id=?",String.class,task);}
  var snapshot=mapper.readValue(existing,List.class);
  permissions.read(actor,tenant,"TENANT");
  for(Object value:snapshot){var r=(Map<?,?>)value;String source=(String)r.get("source");if(source.equals("GLOBAL"))continue;if(source.equals("PERSONAL"))permissions.read(actor,tenant,"PERSONAL");
   boolean available=Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM profile_entries e JOIN profile_versions v ON v.entry_id=e.id AND v.tenant_id=e.tenant_id WHERE e.tenant_id=? AND e.scope=? AND e.account_id IS NOT DISTINCT FROM ?::uuid AND e.workspace_id IS NULL AND e.kind='PREFERENCE' AND e.entry_key=? AND v.revision=? AND v.status='ACTIVE' AND (v.expires_at IS NULL OR v.expires_at>clock_timestamp()) AND NOT v.scrubbed AND object_is_active('PROFILE_VERSION',v.id) AND company_profile_readable(v.id))",Boolean.class,tenant,source,source.equals("PERSONAL")?actor:null,"ai.rules."+r.get("target"),r.get("revision")));
   if(!available)throw new IdentityException(403,"PROFILE_READ_ONLY");
  }
  return snapshot;
 }
 @Transactional public Page save(UUID actor,UUID tenant,String scope,Change c){
  if(c==null||c.requestId()==null||c.body()==null||c.body().length()>4000||c.body().indexOf('\0')>=0||c.expectedRevision()<0)throw IdentityException.invalid();target(c.target());
  var p=read(actor,tenant,scope);if(!p.canMaintain())throw new IdentityException(403,"PROFILE_READ_ONLY");
  db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","expression-rule-book:"+scope+":"+tenant+":"+(scope.equals("PERSONAL")?actor:"shared")+":"+c.target());
  String body=c.body().trim();String hash=IdentityService.hash(new tools.jackson.databind.json.JsonMapper().writeValueAsString(List.of(scope,tenant==null?"GLOBAL":tenant.toString(),c.target(),body,c.expectedRevision())));
  if(identities.priorRequest(actor,c.requestId(),"EXPRESSION_RULE_BOOK",hash)!=null)return read(actor,tenant,scope);
  var old=layer(actor,tenant,scope).stream().filter(b->b.target().equals(c.target())).findFirst().orElseThrow();
  if(old.revision()!=c.expectedRevision())throw new IdentityException(409,"PROFILE_VERSION_CONFLICT");
  if(body.equals(old.body())){identities.remember(actor,c.requestId(),"EXPRESSION_RULE_BOOK",hash,c.requestId());return read(actor,tenant,scope);}
  UUID profileRequest=UUID.nameUUIDFromBytes((c.requestId()+":profile-rule-book").getBytes(java.nio.charset.StandardCharsets.UTF_8));
  if(scope.equals("GLOBAL")){
   db.update("INSERT INTO expression_rule_books(target,revision,body,changed_by,request_id) VALUES (?,?,?,?,?)",c.target(),old.revision()+1,body,actor,c.requestId());audit.record(actor,null,"EXPRESSION_RULE_BOOK_CHANGED",c.requestId(),"SUCCESS");
  }else if(body.isEmpty())profiles.withdraw(actor,tenant,old.id(),old.revision(),profileRequest);
  else{
   var content=new ProfileService.Content(body,"用户在AI内容偏好中明确录入"+(c.target().equals("BRIEFING")?"画报规则":"通用表达规则"),ProfileService.Status.ACTIVE,null);
   if(old.id()==null)profiles.create(actor,tenant,ProfileService.Scope.valueOf(scope),scope.equals("PERSONAL")?actor:tenant,"ai.rules."+c.target(),ProfileService.Kind.PREFERENCE,content,profileRequest);
   else{if(!"PREFERENCE".equals(db.queryForObject("SELECT kind FROM profile_entries WHERE id=?",String.class,old.id())))throw new IdentityException(409,"PROFILE_KIND_CONFLICT");profiles.save(actor,tenant,old.id(),old.revision(),content,profileRequest);}
  }
  identities.remember(actor,c.requestId(),"EXPRESSION_RULE_BOOK",hash,c.requestId());return read(actor,tenant,scope);
 }
}
