package com.dreamcore.workspace.experience;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.MaterialAccess;
import com.dreamcore.workspace.governance.GovernanceAccess;
import java.time.Instant;
import java.util.*;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Source-bounded reusable methods. Search hits and reported outcomes are never execution proof. */
@Service
public class ExperienceService {
 public record Content(String kind,String title,String summary,String body,List<String> tags,String applicable,String excluded,String dependencies,String basis,String accessMode) {}
 public record Evidence(String kind,UUID referenceId,UUID workspaceId) {}
 public record Version(UUID id,int number,int schemaVersion,Content content,List<Evidence> evidence,String origin,String evaluation,UUID createdBy,Instant createdAt) {}
 public record Entry(UUID id,UUID tenantId,UUID workspaceId,int revision,String status,int latestNumber,UUID publishedVersion,boolean canMaintain,Version version) {}
 public record Summary(UUID id,UUID versionId,int number,int revision,String status,String title,String summary,List<String> tags,String applicable,String excluded,String origin,String evaluation) {}
 public record Page(List<Summary> items,boolean hasMore,boolean canMaintain,String indexStatus) {}
 public record Versions(List<Version> items,boolean hasMore) {}
 public record UseInput(UUID versionId,UUID taskId,String contextKey,String decision,boolean adopted,String conditions,String adjustments) {}
 public record Use(UUID id,UUID entryId,UUID versionId,UUID taskId,String contextKey,String decision,boolean adopted,String conditions,String adjustments,Instant createdAt) {}
 public record Uses(List<Use> items,boolean hasMore) {}
 public record Feedback(UUID id,UUID useId,String result,String note,Instant createdAt) {}
 public record Feedbacks(List<Feedback> items,boolean hasMore) {}
 public record Event(UUID id,int revision,UUID versionId,String action,UUID actorId,Instant createdAt) {}
 public record Events(List<Event> items,boolean hasMore) {}
 private final JdbcTemplate db; private final MaterialAccess access; private final GovernanceAccess governance;
 private final IdentityService identities; private final IdentityAudit audit; private final JsonMapper json=new JsonMapper();
 private final com.dreamcore.workspace.departure.DepartureAccess departure;
    public ExperienceService(JdbcTemplate db,MaterialAccess access,GovernanceAccess governance,IdentityService identities,IdentityAudit audit,com.dreamcore.workspace.departure.DepartureAccess departure){this.departure=departure;this.db=db;this.access=access;this.governance=governance;this.identities=identities;this.audit=audit;}
 private IdentityException missing(){return new IdentityException(404,"EXPERIENCE_NOT_FOUND");}
 private void paging(int offset,int limit){if(offset<0||offset>100000||limit<1||limit>50)throw IdentityException.invalid();}
 private String text(String s,int max,boolean required){if(s==null||s.length()>max||(required&&s.isBlank())||s.codePoints().anyMatch(c->Character.isISOControl(c)&&c!=10&&c!=13&&c!=9))throw IdentityException.invalid();return s.strip();}
 private Content normalize(Content c){
  if(c==null||c.kind()==null||c.accessMode()==null||!Set.of("METHOD","CASE","CORRECTION","ASSET").contains(c.kind())||!Set.of("SOURCE_BOUND","INDEPENDENT_COPY").contains(c.accessMode())||c.tags()==null||c.tags().size()>20)throw IdentityException.invalid();
  var tags=c.tags().stream().map(t->text(t,40,true).toLowerCase(Locale.ROOT)).distinct().sorted().toList();
  return new Content(c.kind(),text(c.title(),160,true),text(c.summary(),600,true),text(c.body(),16000,true),tags,text(c.applicable(),2000,true),text(c.excluded(),2000,false),text(c.dependencies(),2000,false),text(c.basis(),2000,true),c.accessMode());
 }
 /** Bigrams make Chinese terms searchable without an external tokenizer; Latin words match normalized tokens. */
 public static List<String> terms(String value){
  var result=new TreeSet<String>();var m=Pattern.compile("[\\p{IsHan}]+|[\\p{L}\\p{N}_-]+").matcher(value.toLowerCase(Locale.ROOT));
  while(m.find()){String s=m.group();int[] chars=s.codePoints().toArray();if(Character.UnicodeScript.of(chars[0])==Character.UnicodeScript.HAN&&chars.length>1){for(int i=0;i<chars.length;i++){result.add(new String(chars,i,1));if(i<chars.length-1)result.add(new String(chars,i,2));}}else result.add(s);}
  return List.copyOf(result);
 }
 private boolean scope(UUID actor,UUID tenant,UUID space,boolean write){
  var s=access.require(actor,tenant,space,false);
  if(write)departure.requireActiveBusiness(actor,tenant);
  boolean allowed=s.kind().equals("PERSONAL")?s.canMaintain():governance.allows(actor,tenant,GovernanceAccess.Capability.EXPERIENCE_MAINTAIN,space);
  if(write&&!allowed)throw new IdentityException(403,"CAPABILITY_REQUIRED");return allowed&&!departure.exiting(tenant);
 }
 private Map<String,Object> row(UUID actor,UUID tenant,UUID space,UUID id,boolean write){scope(actor,tenant,space,write);var r=db.queryForList("SELECT * FROM experience_entries WHERE tenant_id=? AND workspace_id=? AND id=?"+(write?" FOR UPDATE":""),tenant,space,id);if(r.isEmpty())throw missing();return r.getFirst();}
 private int n(Map<String,Object> r,String key){return ((Number)r.get(key)).intValue();}
 private Instant time(Object t){return ((java.sql.Timestamp)t).toInstant();}
 // The same predicate protects summaries, history, body and all pagination before LIMIT.
 private static final String EVIDENCE_VISIBLE="""
 NOT EXISTS (SELECT 1 FROM experience_evidence r WHERE r.version_id=v.id AND NOT (
 EXISTS(SELECT 1 FROM workspaces w LEFT JOIN workspace_members g ON g.workspace_id=w.id AND g.tenant_id=w.tenant_id AND g.account_id=p.actor
 WHERE w.id=r.source_workspace_id AND w.tenant_id=e.tenant_id AND ((w.kind='PERSONAL' AND w.owner_id=p.actor) OR (w.kind='SHARED' AND g.account_id IS NOT NULL))
 AND ((r.kind='MATERIAL_VERSION' AND EXISTS(SELECT 1 FROM material_versions mv JOIN active_materials am ON am.id=mv.material_id WHERE mv.id=r.material_version_id AND mv.tenant_id=e.tenant_id AND mv.workspace_id=w.id))
 OR (r.kind='TASK' AND EXISTS(SELECT 1 FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id WHERE t.id=r.task_id AND t.tenant_id=e.tenant_id AND t.workspace_id=w.id AND c.owner_id=p.actor AND EXISTS(SELECT 1 FROM readable_source_tasks rt WHERE rt.id=t.id)))))))
 """;
 static final String VISIBLE="(object_is_active('EXPERIENCE_VERSION',v.id) AND NOT v.scrubbed AND (v.access_mode='INDEPENDENT_COPY' OR "+EVIDENCE_VISIBLE+"))";
 private boolean evidenceAllowed(UUID actor,UUID tenant,Evidence ref){
  try{access.require(actor,tenant,ref.workspaceId(),false);
   if(ref.kind().equals("MATERIAL_VERSION")){access.requireVersionActive(tenant,ref.workspaceId(),ref.referenceId());return true;}
   return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id WHERE t.id=? AND t.tenant_id=? AND t.workspace_id=? AND c.owner_id=? AND EXISTS(SELECT 1 FROM readable_source_tasks rt WHERE rt.id=t.id))",Boolean.class,ref.referenceId(),tenant,ref.workspaceId(),actor));
  }catch(IdentityException ex){if(ex.status==403||ex.status==404)return false;throw ex;}
 }
 private List<Evidence> refs(UUID version){return db.query("SELECT kind,reference_id,source_workspace_id FROM experience_evidence WHERE version_id=? ORDER BY kind,reference_id",(r,i)->new Evidence(r.getString(1),r.getObject(2,UUID.class),r.getObject(3,UUID.class)),version);}
 private void requireEvidence(UUID actor,UUID tenant,List<Evidence> refs){for(var ref:refs)if(!evidenceAllowed(actor,tenant,ref))throw new IdentityException(404,"EXPERIENCE_EVIDENCE_UNAVAILABLE");}
 private List<Evidence> normalizeRefs(UUID actor,UUID tenant,Content c,List<Evidence> evidence){
  if(evidence==null||evidence.size()>100||evidence.stream().anyMatch(r->r==null||r.referenceId()==null||r.workspaceId()==null||r.kind()==null||!Set.of("MATERIAL_VERSION","TASK").contains(r.kind())))throw IdentityException.invalid();
  var all=new LinkedHashSet<>(evidence);requireEvidence(actor,tenant,List.copyOf(all));
  for(var r:evidence)if(r.kind().equals("TASK")){
   String status=db.queryForObject("SELECT status FROM conversation_tasks WHERE id=?",String.class,r.referenceId());
   if(!Set.of("SUCCEEDED","FAILED","CANCELLED","INTERRUPTED").contains(status))throw new IdentityException(409,"EXPERIENCE_TASK_UNFINISHED");
   // Freeze only identifiers of source dependencies, never prompts, replies or raw content.
   var ids=new TreeSet<UUID>(db.queryForList("SELECT version_id FROM conversation_originals WHERE task_id=? UNION SELECT k.version_id FROM conversation_sources s JOIN knowledge_chunks k ON k.id=s.chunk_id WHERE s.task_id=? UNION SELECT k.version_id FROM conversation_agent_grants g JOIN knowledge_chunks k ON k.id=g.chunk_id WHERE g.task_id=?",UUID.class,r.referenceId(),r.referenceId(),r.referenceId()));
   for(String table:List.of("feedback_task_sources","task_context_materials"))if(Boolean.TRUE.equals(db.queryForObject("SELECT to_regclass(?) IS NOT NULL",Boolean.class,table)))ids.addAll(db.queryForList("SELECT version_id FROM "+table+" WHERE task_id=?",UUID.class,r.referenceId()));
   for(UUID v:ids){var spaces=db.queryForList("SELECT workspace_id FROM material_versions WHERE tenant_id=? AND id=?",UUID.class,tenant,v);if(spaces.isEmpty())throw new IdentityException(404,"EXPERIENCE_EVIDENCE_UNAVAILABLE");all.add(new Evidence("MATERIAL_VERSION",v,spaces.getFirst()));}
  }
  if(all.size()>100 || c.accessMode().equals("SOURCE_BOUND")&&all.isEmpty())throw IdentityException.invalid();
  var result=all.stream().sorted(Comparator.comparing(r->r.kind()+r.referenceId())).toList();requireEvidence(actor,tenant,result);return result;
 }
 private Map<String,Object> versionRow(UUID actor,UUID tenant,UUID space,UUID entry,UUID version){
  var rows=db.queryForList("WITH principal AS (SELECT ?::uuid actor) SELECT v.* FROM experience_versions v JOIN experience_entries e ON e.id=v.entry_id CROSS JOIN principal p WHERE e.id=? AND e.tenant_id=? AND e.workspace_id=? AND v.id=? AND "+VISIBLE,actor,entry,tenant,space,version);
  if(rows.isEmpty())throw missing();return rows.getFirst();
 }
 private Version projectVersion(UUID actor,UUID tenant,Map<String,Object> r){
  UUID id=(UUID)r.get("id");var refs=refs(id);String mode=(String)r.get("access_mode");
  if(mode.equals("SOURCE_BOUND"))requireEvidence(actor,tenant,refs);
  return new Version(id,n(r,"number"),1,json.readValue(r.get("content").toString(),Content.class),refs.stream().filter(ref->evidenceAllowed(actor,tenant,ref)).toList(),(String)r.get("origin"),(String)r.get("evaluation"),(UUID)r.get("created_by"),time(r.get("created_at")));
 }
 // Internal analysis runs in the caller transaction; expected read rejection must not poison its outcome record.
 Entry analysisEntry(UUID actor,UUID tenant,UUID space,UUID id,UUID version){return get(actor,tenant,space,id,version);}
 @Transactional public Entry get(UUID actor,UUID tenant,UUID space,UUID id,UUID version){
  var e=row(actor,tenant,space,id,false);boolean maintain=scope(actor,tenant,space,false);
  UUID selected=version;
  if(selected==null)selected=maintain?db.queryForObject("SELECT id FROM experience_versions WHERE entry_id=? AND number=?",UUID.class,id,n(e,"latest_number")):(UUID)e.get("published_version");
  if(selected==null)throw missing();
  // Historical versions are readable by authorized readers; candidate versions require maintenance.
  if(!maintain&&!Objects.equals(selected,e.get("published_version"))&&!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM experience_events WHERE entry_id=? AND version_id=? AND action='PUBLISHED')",Boolean.class,id,selected)))throw missing();
  return new Entry(id,tenant,space,n(e,"revision"),(String)e.get("status"),n(e,"latest_number"),(UUID)e.get("published_version"),maintain,projectVersion(actor,tenant,versionRow(actor,tenant,space,id,selected)));
 }
 @Transactional public Page list(UUID actor,UUID tenant,UUID space,String query,String tag,boolean maintenance,int offset,int limit){
  paging(offset,limit);boolean can=scope(actor,tenant,space,maintenance);query=text(query,200,false);tag=text(tag,40,false).toLowerCase(Locale.ROOT);
  var args=new ArrayList<Object>(List.of(actor,tenant,space));
  String sql="WITH principal AS (SELECT ?::uuid actor) SELECT e.id entry_id,e.revision,e.status,v.* FROM experience_entries e JOIN experience_versions v ON v.entry_id=e.id AND "+(maintenance?"v.number=e.latest_number":"v.id=e.published_version AND e.status='PUBLISHED'")+" CROSS JOIN principal p WHERE e.tenant_id=? AND e.workspace_id=? AND "+VISIBLE;
  var tokens=terms(query);if(!query.isBlank()&&tokens.isEmpty())return new Page(List.of(),false,can,"READY");
  if(!tokens.isEmpty()){sql+=" AND v.search_terms @> ?::text[]";args.add(tokens.toArray(String[]::new));}
  if(!tag.isBlank()){sql+=" AND v.tags @> ?::text[]";args.add(new String[]{tag});}
  sql+=" ORDER BY e.updated_at DESC,e.id LIMIT ? OFFSET ?";args.add(limit+1);args.add(offset);
  var rows=db.queryForList(sql,args.toArray());
  var summaries=rows.stream().limit(limit).map(r->{var c=json.readValue(r.get("content").toString(),Content.class);return new Summary((UUID)r.get("entry_id"),(UUID)r.get("id"),n(r,"number"),n(r,"revision"),(String)r.get("status"),c.title(),c.summary(),c.tags(),c.applicable(),c.excluded(),(String)r.get("origin"),(String)r.get("evaluation"));}).toList();
  return new Page(summaries,rows.size()>limit,can,"READY");
 }
 @Transactional public Versions versions(UUID actor,UUID tenant,UUID space,UUID id,int offset,int limit){
  paging(offset,limit);row(actor,tenant,space,id,true);
  var rows=db.queryForList("WITH principal AS (SELECT ?::uuid actor) SELECT v.* FROM experience_versions v JOIN experience_entries e ON e.id=v.entry_id CROSS JOIN principal p WHERE e.id=? AND "+VISIBLE+" ORDER BY v.number DESC LIMIT ? OFFSET ?",actor,id,limit+1,offset);
  return new Versions(rows.stream().limit(limit).map(r->projectVersion(actor,tenant,r)).toList(),rows.size()>limit);
 }
 private String hash(Object... args){return IdentityService.hash(json.writeValueAsString(args));}
 private UUID append(UUID actor,UUID id,int number,Content c,List<Evidence> refs){
  UUID v=UUID.randomUUID();var terms=terms(c.title()+" "+c.summary()+" "+c.body()+" "+c.applicable()+" "+String.join(" ",c.tags()));
  db.update("INSERT INTO experience_versions(id,entry_id,number,content,access_mode,search_terms,tags,created_by) VALUES (?,?,?,?::jsonb,?,?::text[],?::text[],?)",v,id,number,json.writeValueAsString(c),c.accessMode(),terms.toArray(String[]::new),c.tags().toArray(String[]::new),actor);
  for(var r:refs)db.update("INSERT INTO experience_evidence(version_id,kind,reference_id,source_workspace_id,material_version_id,task_id) VALUES (?,?,?,?,?,?)",v,r.kind(),r.referenceId(),r.workspaceId(),r.kind().equals("MATERIAL_VERSION")?r.referenceId():null,r.kind().equals("TASK")?r.referenceId():null);
  return v;
 }
 Content automaticContent(Content c){return normalize(c);}
 List<Evidence> automaticEvidence(UUID actor,UUID tenant,Content c,List<Evidence> refs){return normalizeRefs(actor,tenant,normalize(c),refs);}
 UUID appendAutomatic(UUID actor,UUID entry,int number,Content c,List<Evidence> refs,String fingerprint){UUID version=append(actor,entry,number,normalize(c),refs);db.update("UPDATE experience_versions SET origin='AUTOMATIC',evaluation='AUTOMATIC_CHECKED',content_fingerprint=? WHERE id=?",fingerprint,version);return version;}
 private void forbidAutomaticWrite(UUID entry){if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM experience_versions WHERE entry_id=? AND origin='AUTOMATIC')",Boolean.class,entry)))throw new IdentityException(409,"EXPERIENCE_AUTOMATIC_MANAGED");}
 private void event(UUID actor,UUID tenant,UUID entry,UUID version,int revision,String action){db.update("INSERT INTO experience_events(id,entry_id,version_id,revision,action,actor_id) VALUES (?,?,?,?,?,?)",UUID.randomUUID(),entry,version,revision,action,actor);audit.record(actor,tenant,"EXPERIENCE_"+action,entry,"SUCCESS");}
 @Transactional public Entry create(UUID actor,UUID tenant,UUID space,UUID key,Content body,List<Evidence> evidence){
  scope(actor,tenant,space,true);var c=normalize(body);var refs=normalizeRefs(actor,tenant,c,evidence);String h=hash(tenant,space,c,refs);UUID prior=identities.priorRequest(actor,key,"EXPERIENCE_CREATE",h);
  if(prior!=null){UUID id=db.queryForObject("SELECT entry_id FROM experience_versions WHERE id=?",UUID.class,prior);return get(actor,tenant,space,id,prior);}
  UUID id=UUID.randomUUID();db.update("INSERT INTO experience_entries(id,tenant_id,workspace_id,created_by) VALUES (?,?,?,?)",id,tenant,space,actor);UUID v=append(actor,id,1,c,refs);event(actor,tenant,id,v,1,"CREATED");identities.remember(actor,key,"EXPERIENCE_CREATE",h,v);return get(actor,tenant,space,id,v);
 }
 @Transactional public Entry revise(UUID actor,UUID tenant,UUID space,UUID id,UUID key,int expected,Content body,List<Evidence> evidence){
  scope(actor,tenant,space,true);var c=normalize(body);var refs=normalizeRefs(actor,tenant,c,evidence);String h=hash(tenant,space,id,expected,c,refs);UUID prior=identities.priorRequest(actor,key,"EXPERIENCE_REVISE",h);var e=row(actor,tenant,space,id,true);
  if(prior!=null)return get(actor,tenant,space,id,prior);forbidAutomaticWrite(id);if(n(e,"revision")!=expected)throw new IdentityException(409,"EXPERIENCE_STATE_CHANGED");
  versionRow(actor,tenant,space,id,db.queryForObject("SELECT id FROM experience_versions WHERE entry_id=? AND number=?",UUID.class,id,n(e,"latest_number")));
  UUID v=append(actor,id,n(e,"latest_number")+1,c,refs);db.update("UPDATE experience_entries SET latest_number=latest_number+1,revision=revision+1,updated_at=now() WHERE id=?",id);event(actor,tenant,id,v,expected+1,"REVISED");identities.remember(actor,key,"EXPERIENCE_REVISE",h,v);return get(actor,tenant,space,id,v);
 }
 @Transactional public Entry publish(UUID actor,UUID tenant,UUID space,UUID id,UUID key,int expected,UUID version,boolean independentCopyConfirmed){
  scope(actor,tenant,space,true);String h=hash(tenant,space,id,expected,version,independentCopyConfirmed);UUID prior=identities.priorRequest(actor,key,"EXPERIENCE_PUBLISH",h);var e=row(actor,tenant,space,id,true);
  if(prior!=null)return get(actor,tenant,space,id,prior);forbidAutomaticWrite(id);if(n(e,"revision")!=expected)throw new IdentityException(409,"EXPERIENCE_STATE_CHANGED");
  var v=versionRow(actor,tenant,space,id,version);requireEvidence(actor,tenant,refs(version));
  if("INDEPENDENT_COPY".equals(v.get("access_mode"))&&!independentCopyConfirmed)throw new IdentityException(409,"EXPERIENCE_COPY_CONFIRMATION_REQUIRED");
  db.update("UPDATE experience_entries SET status='PUBLISHED',published_version=?,revision=revision+1,updated_at=now() WHERE id=?",version,id);event(actor,tenant,id,version,expected+1,"PUBLISHED");identities.remember(actor,key,"EXPERIENCE_PUBLISH",h,version);return get(actor,tenant,space,id,version);
 }
 @Transactional public Entry withdraw(UUID actor,UUID tenant,UUID space,UUID id,UUID key,int expected){
  scope(actor,tenant,space,true);String h=hash(tenant,space,id,expected);UUID prior=identities.priorRequest(actor,key,"EXPERIENCE_WITHDRAW",h);var e=row(actor,tenant,space,id,true);
  if(prior!=null)return get(actor,tenant,space,id,prior);if(n(e,"revision")!=expected)throw new IdentityException(409,"EXPERIENCE_STATE_CHANGED");
  UUID v=(UUID)e.get("published_version");if(v==null)throw new IdentityException(409,"EXPERIENCE_NOT_PUBLISHED");
  db.update("UPDATE experience_entries SET status='WITHDRAWN',published_version=NULL,automation_stopped=true,revision=revision+1,updated_at=now() WHERE id=?",id);event(actor,tenant,id,v,expected+1,"WITHDRAWN");identities.remember(actor,key,"EXPERIENCE_WITHDRAW",h,v);return get(actor,tenant,space,id,v);
 }
 @Transactional public Events events(UUID actor,UUID tenant,UUID space,UUID id,int offset,int limit){
  paging(offset,limit);row(actor,tenant,space,id,true);
  var rows=db.query("SELECT id,revision,version_id,action,actor_id,created_at FROM experience_events WHERE entry_id=? ORDER BY revision DESC,id LIMIT ? OFFSET ?",(r,n)->new Event(r.getObject(1,UUID.class),r.getInt(2),r.getObject(3,UUID.class),r.getString(4),r.getObject(5,UUID.class),r.getTimestamp(6).toInstant()),id,limit+1,offset);return new Events(rows.stream().limit(limit).toList(),rows.size()>limit);
 }
 private Use projectUse(Map<String,Object> r){return new Use((UUID)r.get("id"),(UUID)r.get("entry_id"),(UUID)r.get("version_id"),(UUID)r.get("task_id"),(String)r.get("context_key"),(String)r.get("decision"),(Boolean)r.get("adopted"),(String)r.get("conditions"),(String)r.get("adjustments"),time(r.get("created_at")));}
 private void requireUseTask(UUID actor,UUID tenant,Object task) {
  if(task==null)return;
  var spaces=db.queryForList("SELECT workspace_id FROM conversation_tasks WHERE tenant_id=? AND id=?",UUID.class,tenant,task);
  if(spaces.isEmpty()||!evidenceAllowed(actor,tenant,new Evidence("TASK",(UUID)task,spaces.getFirst())))throw new IdentityException(404,"EXPERIENCE_EVIDENCE_UNAVAILABLE");
 }
 private Use use(UUID actor,UUID tenant,UUID space,UUID entry,UUID use){row(actor,tenant,space,entry,false);var rows=db.queryForList("SELECT * FROM experience_uses WHERE id=? AND entry_id=? AND actor_id=?",use,entry,actor);if(rows.isEmpty())throw missing();var r=rows.getFirst();requireUseTask(actor,tenant,r.get("task_id"));versionRow(actor,tenant,space,entry,(UUID)r.get("version_id"));return projectUse(r);}
 @Transactional public Use recordUse(UUID actor,UUID tenant,UUID space,UUID entry,UUID key,UseInput input){
  scope(actor,tenant,space,false);if(input==null||input.versionId()==null||input.decision()==null||!Set.of("DIRECT","ADAPTED","UNKNOWN","NOT_APPLICABLE").contains(input.decision())||input.adopted()&&!Set.of("DIRECT","ADAPTED").contains(input.decision()))throw IdentityException.invalid();
  var b=new UseInput(input.versionId(),input.taskId(),text(input.contextKey(),100,true),input.decision(),input.adopted(),text(input.conditions(),2000,true),text(input.adjustments(),2000,false));
  if(b.taskId()!=null){var ts=db.queryForList("SELECT workspace_id FROM conversation_tasks WHERE tenant_id=? AND id=?",UUID.class,tenant,b.taskId());if(ts.isEmpty()||!evidenceAllowed(actor,tenant,new Evidence("TASK",b.taskId(),ts.getFirst())))throw new IdentityException(404,"EXPERIENCE_EVIDENCE_UNAVAILABLE");}
  String h=hash(tenant,space,entry,b);UUID prior=identities.priorRequest(actor,key,"EXPERIENCE_USE",h);row(actor,tenant,space,entry,false);var e=db.queryForList("SELECT * FROM experience_entries WHERE id=? FOR UPDATE",entry).getFirst();if(prior!=null)return use(actor,tenant,space,entry,prior);
  if(!"PUBLISHED".equals(e.get("status"))||!b.versionId().equals(e.get("published_version")))throw new IdentityException(409,"EXPERIENCE_NOT_CURRENT");
  versionRow(actor,tenant,space,entry,b.versionId());
  if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM experience_uses WHERE actor_id=? AND version_id=? AND (context_key=? OR (?::uuid IS NOT NULL AND task_id=?)))",Boolean.class,actor,b.versionId(),b.contextKey(),b.taskId(),b.taskId())))throw new IdentityException(409,"EXPERIENCE_USE_EXISTS");
  UUID id=UUID.randomUUID();db.update("INSERT INTO experience_uses(id,entry_id,version_id,actor_id,task_id,context_key,decision,adopted,conditions,adjustments) VALUES (?,?,?,?,?,?,?,?,?,?)",id,entry,b.versionId(),actor,b.taskId(),b.contextKey(),b.decision(),b.adopted(),b.conditions(),b.adjustments());identities.remember(actor,key,"EXPERIENCE_USE",h,id);audit.record(actor,tenant,"EXPERIENCE_USE",entry,"SUCCESS");return use(actor,tenant,space,entry,id);
 }
 @Transactional public Uses uses(UUID actor,UUID tenant,UUID space,UUID entry,int offset,int limit){
  paging(offset,limit);row(actor,tenant,space,entry,false);
  var rows=db.queryForList("WITH principal AS (SELECT ?::uuid actor) SELECT u.* FROM experience_uses u JOIN experience_versions v ON v.id=u.version_id JOIN experience_entries e ON e.id=u.entry_id CROSS JOIN principal p WHERE u.entry_id=? AND u.actor_id=? AND (u.task_id IS NULL OR EXISTS(SELECT 1 FROM conversation_tasks ut JOIN workspaces uw ON uw.id=ut.workspace_id LEFT JOIN workspace_members ug ON ug.tenant_id=ut.tenant_id AND ug.workspace_id=uw.id AND ug.account_id=p.actor WHERE ut.id=u.task_id AND ut.tenant_id=e.tenant_id AND ut.requested_by=p.actor AND EXISTS(SELECT 1 FROM readable_source_tasks rt WHERE rt.id=ut.id) AND ((uw.kind='PERSONAL' AND uw.owner_id=p.actor) OR (uw.kind='SHARED' AND ug.account_id IS NOT NULL)))) AND "+VISIBLE+" ORDER BY u.created_at DESC,u.id LIMIT ? OFFSET ?",actor,entry,actor,limit+1,offset);return new Uses(rows.stream().limit(limit).map(this::projectUse).toList(),rows.size()>limit);
 }
 private Feedback feedback(UUID id){return db.queryForObject("SELECT * FROM experience_feedback WHERE id=?",(r,n)->new Feedback(r.getObject("id",UUID.class),r.getObject("use_id",UUID.class),r.getString("result"),r.getString("note"),r.getTimestamp("created_at").toInstant()),id);}
 @Transactional public Feedback feedback(UUID actor,UUID tenant,UUID space,UUID entry,UUID use,UUID key,String result,String note){
  use(actor,tenant,space,entry,use);if(result==null||!Set.of("UNKNOWN","COMPLETED","FAILED","CORRECTED").contains(result))throw IdentityException.invalid();note=text(note,2000,true);String h=hash(tenant,space,entry,use,result,note);UUID prior=identities.priorRequest(actor,key,"EXPERIENCE_FEEDBACK",h);if(prior!=null)return feedback(prior);
  UUID id=UUID.randomUUID();db.update("INSERT INTO experience_feedback(id,use_id,result,note) VALUES (?,?,?,?)",id,use,result,note);identities.remember(actor,key,"EXPERIENCE_FEEDBACK",h,id);return feedback(id);
 }
 @Transactional public Feedbacks feedbacks(UUID actor,UUID tenant,UUID space,UUID entry,UUID use,int offset,int limit){paging(offset,limit);use(actor,tenant,space,entry,use);var ids=db.queryForList("SELECT id FROM experience_feedback WHERE use_id=? ORDER BY created_at DESC,id LIMIT ? OFFSET ?",UUID.class,use,limit+1,offset);return new Feedbacks(ids.stream().limit(limit).map(this::feedback).toList(),ids.size()>limit);}
}
