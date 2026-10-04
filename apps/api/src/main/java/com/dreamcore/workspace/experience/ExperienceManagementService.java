package com.dreamcore.workspace.experience;

import com.dreamcore.workspace.governance.GovernanceAccess;
import com.dreamcore.workspace.identity.*;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Management projection: content keeps its original authorization; processing exposes metadata only. */
@Service
public class ExperienceManagementService {
 public record Scope(UUID id,String name) {}
 public record Item(ExperienceService.Summary experience,UUID workspaceId,String workspaceName,Instant updatedAt) {}
 public record ContentPage(List<Scope> scopes,List<Item> items,boolean hasMore) {}
 public record Version(UUID id,int number,String origin,String evaluation,Instant createdAt,boolean current) {}
 public record History(List<Version> items,boolean hasMore) {}
 public record Processing(UUID id,String sourceKind,String state,String reason,Instant updatedAt,UUID entryId,UUID versionId,UUID workspaceId) {}
 public record ProcessingPage(boolean enabled,List<Scope> scopes,Map<String,Long> counts,List<Processing> items,boolean hasMore) {}
 private final JdbcTemplate db;private final GovernanceAccess governance;private final ExperienceService experiences;private final JsonMapper json=new JsonMapper();
 private static final Set<String> STATES=Set.of("WAITING","PROCESSING","RETRYING","ADMITTED","UPDATED","DUPLICATE","NOT_ADMITTED","UNAVAILABLE","FAILED","UNKNOWN");
 private static final Set<String> REASONS=Set.of("DUPLICATE","NO_REUSABLE_METHOD","PREFERENCE_ONLY","PRODUCT_ISSUE","INSUFFICIENT_EVIDENCE","QUALITY_NOT_ESTABLISHED","EXPERIENCE_TARGET_VERSION_UNAVAILABLE","MODEL_NOT_CONFIGURED","EXPERIENCE_VERIFICATION_ONLY","EXPERIENCE_RESULT_UNKNOWN");
 public ExperienceManagementService(JdbcTemplate db,GovernanceAccess governance,ExperienceService experiences){this.db=db;this.governance=governance;this.experiences=experiences;}
 private List<Scope> scopes(UUID actor,UUID tenant){
  boolean admin=governance.allows(actor,tenant,GovernanceAccess.Capability.TENANT_CONFIG,null);
  var scopes=db.query("SELECT w.id,w.name FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id AND m.tenant_id=w.tenant_id AND m.account_id=? WHERE w.tenant_id=? AND w.kind='SHARED' AND (? OR EXISTS(SELECT 1 FROM governance_capabilities g WHERE g.tenant_id=w.tenant_id AND g.workspace_id=w.id AND g.account_id=? AND g.capability='EXPERIENCE_MAINTAIN')) ORDER BY w.name,w.id",(r,n)->new Scope(r.getObject(1,UUID.class),r.getString(2)),actor,tenant,admin,actor);
  if(!admin&&scopes.isEmpty())throw new IdentityException(403,"CAPABILITY_REQUIRED");return scopes;
 }
 void requireLibraryAccess(UUID actor,UUID tenant){scopes(actor,tenant);}
 private UUID[] selected(List<Scope> scopes,UUID space){if(space!=null&&scopes.stream().noneMatch(s->s.id().equals(space)))throw new IdentityException(403,"WORKSPACE_ACCESS_DENIED");return scopes.stream().map(Scope::id).filter(id->space==null||id.equals(space)).toArray(UUID[]::new);}
 private void paging(int offset){if(offset<0||offset>100000)throw IdentityException.invalid();}
 @Transactional public ContentPage contents(UUID actor,UUID tenant,UUID space,String query,String state,int offset){
  paging(offset);if(query==null||query.length()>200||!Set.of("AVAILABLE","STOPPED").contains(state))throw IdentityException.invalid();var scopes=scopes(actor,tenant);UUID[] selected=selected(scopes,space);
  String version=state.equals("AVAILABLE")?"v.id=e.published_version AND e.status='PUBLISHED'":"e.status='WITHDRAWN' AND v.id=(SELECT event.version_id FROM experience_events event WHERE event.entry_id=e.id AND event.action='PUBLISHED' ORDER BY event.revision DESC,event.created_at DESC LIMIT 1)";
  var args=new ArrayList<Object>(List.of(actor,tenant,selected));String sql="WITH principal AS(SELECT ?::uuid actor) SELECT e.id entry_id,e.revision,e.status,e.workspace_id,w.name workspace_name,e.updated_at,v.* FROM experience_entries e JOIN experience_versions v ON v.entry_id=e.id AND "+version+" JOIN workspaces w ON w.id=e.workspace_id CROSS JOIN principal p WHERE e.tenant_id=? AND e.workspace_id=ANY(?::uuid[]) AND "+ExperienceService.VISIBLE;
  var tokens=ExperienceService.terms(query);if(!query.isBlank()&&tokens.isEmpty())return new ContentPage(scopes,List.of(),false);if(!tokens.isEmpty()){sql+=" AND v.search_terms @> ?::text[]";args.add(tokens.toArray(String[]::new));}
  sql+=" ORDER BY e.updated_at DESC,e.id LIMIT 21 OFFSET ?";args.add(offset);var rows=db.queryForList(sql,args.toArray());
  var items=rows.stream().limit(20).map(r->{var c=json.readValue(r.get("content").toString(),ExperienceService.Content.class);var summary=new ExperienceService.Summary((UUID)r.get("entry_id"),(UUID)r.get("id"),((Number)r.get("number")).intValue(),((Number)r.get("revision")).intValue(),(String)r.get("status"),c.title(),c.summary(),c.tags(),c.applicable(),c.excluded(),(String)r.get("origin"),(String)r.get("evaluation"));return new Item(summary,(UUID)r.get("workspace_id"),(String)r.get("workspace_name"),((java.sql.Timestamp)r.get("updated_at")).toInstant());}).toList();return new ContentPage(scopes,items,rows.size()>20);
 }
 @Transactional public History history(UUID actor,UUID tenant,UUID space,UUID entry,int offset){
  paging(offset);selected(scopes(actor,tenant),space);if(space==null)throw IdentityException.invalid();
  String base="WITH principal AS(SELECT ?::uuid actor) SELECT v.id,v.number,v.origin,v.evaluation,v.created_at,(v.id=e.published_version) is_current FROM experience_entries e JOIN experience_versions v ON v.entry_id=e.id CROSS JOIN principal p WHERE e.tenant_id=? AND e.workspace_id=? AND e.id=? AND EXISTS(SELECT 1 FROM experience_events event WHERE event.entry_id=e.id AND event.version_id=v.id AND event.action='PUBLISHED') AND "+ExperienceService.VISIBLE;
  if(db.queryForList(base+" LIMIT 1",actor,tenant,space,entry).isEmpty())throw new IdentityException(404,"EXPERIENCE_NOT_FOUND");
  var rows=db.query(base+" ORDER BY v.number DESC LIMIT 21 OFFSET ?",(r,n)->new Version(r.getObject(1,UUID.class),r.getInt(2),r.getString(3),r.getString(4),r.getTimestamp(5).toInstant(),r.getBoolean(6)),actor,tenant,space,entry,offset);return new History(rows.stream().limit(20).toList(),rows.size()>20);
 }
 static final String PROCESSING="""
 SELECT i.id,i.kind source_kind,i.workspace_id,a.entry_id,a.version_id,
 greatest(a.created_at,q.updated_at,i.invalidated_at,i.created_at) updated_at,
 CASE WHEN i.state='SOURCE_UNAVAILABLE' OR q.state='SOURCE_UNAVAILABLE' THEN 'UNAVAILABLE'
 WHEN a.outcome='CREATED' THEN 'ADMITTED' WHEN a.outcome='UPDATED' THEN 'UPDATED' WHEN a.outcome='DUPLICATE' THEN 'DUPLICATE'
 WHEN a.outcome='CONFLICT' THEN 'NOT_ADMITTED' WHEN a.outcome='SOURCE_UNAVAILABLE' THEN 'UNAVAILABLE'
 WHEN q.state IN('RUNNING','QUALIFIED') THEN 'PROCESSING' WHEN q.state='RETRY_WAIT' THEN 'RETRYING'
 WHEN q.state='SKIPPED' AND r.code='DUPLICATE' THEN 'DUPLICATE' WHEN q.state IN('SKIPPED','REJECTED') THEN 'NOT_ADMITTED'
 WHEN q.state='FAILED' THEN 'FAILED' WHEN q.state='UNKNOWN' THEN 'UNKNOWN' ELSE 'WAITING' END state,
 CASE WHEN a.outcome='CONFLICT' THEN 'VERSION_CONFLICT' ELSE coalesce(q.error_code,r.code) END reason
 FROM experience_intake_sources i LEFT JOIN experience_analysis_items q ON q.source_id=i.id
 LEFT JOIN experience_analysis_runs r ON r.id=q.run_id LEFT JOIN experience_admissions a ON a.run_id=r.id
 WHERE i.tenant_id=? AND i.workspace_id=ANY(?::uuid[])
 """;
 @Transactional public ProcessingPage processing(UUID actor,UUID tenant,UUID space,String state,int offset,boolean enabled){
  paging(offset);if(!state.equals("ALL")&&!STATES.contains(state))throw IdentityException.invalid();var scopes=scopes(actor,tenant);UUID[] selected=selected(scopes,space);
  var counts=new TreeMap<String,Long>();for(String key:STATES)counts.put(key,0L);
  for(var row:db.queryForList("SELECT state,count(*) total FROM ("+PROCESSING+") p GROUP BY state",tenant,selected))counts.put((String)row.get("state"),((Number)row.get("total")).longValue());
  var rows=db.queryForList("SELECT * FROM ("+PROCESSING+") p WHERE (?='ALL' OR state=?) ORDER BY updated_at DESC,id LIMIT 21 OFFSET ?",tenant,selected,state,state,offset);
  var items=new ArrayList<Processing>();for(var row:rows.stream().limit(20).toList()){
   UUID entry=(UUID)row.get("entry_id"),version=(UUID)row.get("version_id"),workspace=(UUID)row.get("workspace_id");
   if(entry==null||version==null){entry=null;version=null;}
   if(entry!=null&&version!=null)try{experiences.analysisEntry(actor,tenant,workspace,entry,version);}catch(IdentityException unavailable){entry=null;version=null;}
   String code=(String)row.get("reason");if(code!=null&&!REASONS.contains(code)&&!code.equals("VERSION_CONFLICT"))code=Set.of("FAILED","RETRYING").contains(row.get("state"))?"TECHNICAL_FAILURE":row.get("state").equals("NOT_ADMITTED")?"QUALITY_NOT_ESTABLISHED":null;
   items.add(new Processing((UUID)row.get("id"),(String)row.get("source_kind"),(String)row.get("state"),code,((java.sql.Timestamp)row.get("updated_at")).toInstant(),entry,version,workspace));
  }return new ProcessingPage(enabled,scopes,counts,items,rows.size()>20);
 }
}
