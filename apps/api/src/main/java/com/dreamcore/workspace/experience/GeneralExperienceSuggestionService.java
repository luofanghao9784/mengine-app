package com.dreamcore.workspace.experience;
import com.dreamcore.workspace.identity.*;
import java.util.*;import java.time.Instant;
import org.springframework.jdbc.core.JdbcTemplate;import org.springframework.stereotype.Service;import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Private input for automatic checking. Only a qualified, cleaned result is shared into the selected workspace. */
@Service
public class GeneralExperienceSuggestionService {
 public record Change(UUID requestId,UUID versionId,UUID workspaceId,String intent,String content) {}
 public record Suggestion(UUID id,UUID versionId,UUID workspaceId,String intent,String state,UUID resultEntryId,UUID resultVersionId,Instant createdAt) {}
 public record Page(boolean enabled,boolean canSubmit,List<ExperienceManagementService.Scope> scopes,List<Suggestion> items) {}
 private final JdbcTemplate db;private final ExperienceService experiences;private final GeneralExperienceLibrary library;private final IdentityService identities;private final IdentityAudit audit;private final JsonMapper json=new JsonMapper();
 public GeneralExperienceSuggestionService(JdbcTemplate db,ExperienceService experiences,GeneralExperienceLibrary library,IdentityService identities,IdentityAudit audit){this.db=db;this.experiences=experiences;this.library=library;this.identities=identities;this.audit=audit;}
 private List<ExperienceManagementService.Scope> scopes(UUID actor,UUID tenant){return db.query("SELECT w.id,w.name FROM workspaces w JOIN workspace_members m ON m.tenant_id=w.tenant_id AND m.workspace_id=w.id AND m.account_id=? JOIN governance_capabilities g ON g.tenant_id=w.tenant_id AND g.workspace_id=w.id AND g.account_id=m.account_id AND g.capability='EXPERIENCE_MAINTAIN' WHERE w.tenant_id=? AND w.kind='SHARED' ORDER BY w.name,w.id",(r,n)->new ExperienceManagementService.Scope(r.getObject(1,UUID.class),r.getString(2)),actor,tenant);}
 private Suggestion project(UUID actor,UUID tenant,UUID entry,UUID id){
  var rows=db.queryForList("SELECT * FROM general_experience_suggestions WHERE id=? AND actor_id=? AND tenant_id=? AND entry_id=?",id,actor,tenant,entry);if(rows.isEmpty())throw new IdentityException(404,"EXPERIENCE_SUGGESTION_NOT_FOUND");var s=rows.getFirst();UUID space=(UUID)s.get("workspace_id");
  var r=db.queryForMap("SELECT * FROM ("+ExperienceManagementService.PROCESSING+") p WHERE id=?",tenant,new UUID[]{space},id);UUID result=(UUID)r.get("version_id"),resultEntry=(UUID)r.get("entry_id");
  if(result==null)resultEntry=null;
  if(result!=null)try{experiences.analysisEntry(actor,tenant,space,resultEntry,result);}catch(IdentityException unavailable){result=null;resultEntry=null;}
  return new Suggestion(id,(UUID)s.get("version_id"),space,(String)s.get("intent"),(String)r.get("state"),resultEntry,result,((java.sql.Timestamp)s.get("created_at")).toInstant());
 }
 @Transactional public Page list(UUID actor,UUID tenant,UUID entry,UUID version,boolean enabled){
  library.detail(actor,tenant,entry,version);var scopes=scopes(actor,tenant);UUID[] ids=scopes.stream().map(ExperienceManagementService.Scope::id).toArray(UUID[]::new);
  var records=db.queryForList("SELECT id FROM general_experience_suggestions WHERE tenant_id=? AND entry_id=? AND actor_id=? AND workspace_id=ANY(?::uuid[]) ORDER BY created_at DESC,id DESC LIMIT 10",UUID.class,tenant,entry,actor,ids);
  return new Page(enabled,!scopes.isEmpty()&&Boolean.TRUE.equals(db.queryForObject("SELECT general_experience_dependencies_enabled(?,?)",Boolean.class,tenant,version)),scopes,records.stream().map(id->project(actor,tenant,entry,id)).toList());
 }
 @Transactional public Suggestion submit(UUID actor,UUID tenant,UUID entry,Change change){
  if(change==null||change.requestId()==null||change.versionId()==null||change.workspaceId()==null||change.intent()==null||!Set.of("FEEDBACK","ADAPTATION").contains(change.intent())||change.content()==null||change.content().isBlank()||change.content().length()>12000||change.content().codePoints().anyMatch(c->Character.isISOControl(c)&&c!=10&&c!=13&&c!=9))throw IdentityException.invalid();
  experiences.adjustmentScope(actor,tenant,change.workspaceId());if(!Boolean.TRUE.equals(db.queryForObject("SELECT kind='SHARED' FROM workspaces WHERE id=? AND tenant_id=?",Boolean.class,change.workspaceId(),tenant)))throw IdentityException.invalid();
  db.queryForList("SELECT pg_advisory_xact_lock_shared(hashtextextended('general-use:'||?::text,0))",tenant);
  String body=change.content().strip(),fingerprint=IdentityService.hash(json.writeValueAsString(List.of(tenant,entry,change.versionId(),change.workspaceId(),change.intent(),body)));UUID prior=identities.priorRequest(actor,change.requestId(),"GENERAL_EXPERIENCE_SUGGESTION",fingerprint);
  if(prior!=null)return project(actor,tenant,entry,prior);
  db.queryForList("SELECT e.id FROM general_experience_ancestry a JOIN general_experience_versions v ON v.id=a.base_version JOIN general_experience_entries e ON e.id=v.entry_id WHERE a.version_id=? ORDER BY e.id,v.id FOR SHARE OF e,v",change.versionId());
  var original=library.detail(actor,tenant,entry,change.versionId());if(json.writeValueAsString(original.method()).length()+body.length()>56000)throw IdentityException.invalid();
  db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","general-suggestion:"+tenant+":"+entry+":"+actor);
  if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM general_experience_suggestions WHERE tenant_id=? AND workspace_id=? AND entry_id=? AND actor_id=? AND NOT finished)",Boolean.class,tenant,change.workspaceId(),entry,actor)))throw new IdentityException(409,"EXPERIENCE_SUGGESTION_PENDING");
  UUID id=UUID.randomUUID();db.update("INSERT INTO general_experience_suggestions(id,tenant_id,workspace_id,actor_id,entry_id,version_id,intent,content) VALUES (?,?,?,?,?,?,?,?::jsonb)",id,tenant,change.workspaceId(),actor,entry,change.versionId(),change.intent(),json.writeValueAsString(Map.of("intent",change.intent(),"text",body)));
  db.update("INSERT INTO experience_intake_sources(id,tenant_id,owner_id,workspace_id,kind,source_id,source_revision,source_attempt,general_suggestion_id) VALUES (?,?,?,?,'GENERAL_SUGGESTION',?,1,0,?)",id,tenant,actor,change.workspaceId(),id,id);
  if(!Boolean.TRUE.equals(db.queryForObject("SELECT experience_intake_available(?)",Boolean.class,id)))throw new IdentityException(409,"EXPERIENCE_EVIDENCE_UNAVAILABLE");
  db.update("INSERT INTO experience_analysis_items(source_id,tenant_id) VALUES (?,?)",id,tenant);identities.remember(actor,change.requestId(),"GENERAL_EXPERIENCE_SUGGESTION",fingerprint,id);audit.record(actor,tenant,"GENERAL_EXPERIENCE_SUGGESTION_SUBMITTED",entry,"SUCCESS");return project(actor,tenant,entry,id);
 }
}
