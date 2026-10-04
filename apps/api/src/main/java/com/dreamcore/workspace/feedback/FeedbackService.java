package com.dreamcore.workspace.feedback;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.departure.DepartureAccess;
import com.dreamcore.workspace.material.MaterialAccess;
import com.dreamcore.workspace.profile.ProfileService;
import com.dreamcore.workspace.experience.ExperienceService;
import com.dreamcore.workspace.conversation.ConversationService;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** A private opinion about an exact observed version; neither execution proof nor a capability grant. */
@Service
public class FeedbackService {
 @com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL)
 public record Target(String kind,UUID taskId,int taskRevision,int attempt,String presentationVersion,int presentationRevision,UUID publicationId,UUID materialVersionId,Integer materialVersion) {
  public Target(String kind,UUID taskId,int taskRevision,int attempt,String presentationVersion,int presentationRevision){this(kind,taskId,taskRevision,attempt,presentationVersion,presentationRevision,null,null,null);}
 }
 public record Assessment(String rating,List<String> reasons,String suggestion) {}
 public record Snapshot(String taskState,String executionClass,String contentSha256,int sourceVersionCount) {}
 public record Feedback(UUID id,UUID tenantId,UUID workspaceId,Target target,int revision,String status,Assessment assessment,Snapshot snapshot,Instant createdAt,Instant updatedAt) {}
 public record Lookup(Feedback feedback) {}
 public record Version(int revision,String status,Assessment assessment,Instant createdAt) {}
 public record History(List<Version> items,boolean hasMore) {}
 public record Preference(String scenario,String style,int expectedProfileRevision) {}
 public record PreferenceState(String scenario,UUID profileId,int revision,String status,String style) {}
 public record Preferences(List<PreferenceState> items) {}
 public record FollowUp(String kind,boolean confirmed,Preference preference,String correction,ExperienceService.Content candidate) {}
 public record Action(UUID id,UUID feedbackId,int feedbackRevision,String kind,String status,UUID targetId,UUID targetVersion,Integer targetRevision,UUID conversationId,String acceptedState,String executionClass,Instant createdAt,@com.fasterxml.jackson.annotation.JsonInclude(com.fasterxml.jackson.annotation.JsonInclude.Include.NON_NULL) UUID targetWorkspaceId) {
  public Action(UUID id,UUID feedbackId,int feedbackRevision,String kind,String status,UUID targetId,UUID targetVersion,Integer targetRevision,UUID conversationId,String acceptedState,String executionClass,Instant createdAt){this(id,feedbackId,feedbackRevision,kind,status,targetId,targetVersion,targetRevision,conversationId,acceptedState,executionClass,createdAt,null);}
 }
 public record Actions(List<Action> items,boolean hasMore) {}
 private final JdbcTemplate db;private final IdentityService identities;private final MaterialAccess access;private final ProfileService profiles;private final ExperienceService experiences;private final ConversationService conversations;private final IdentityAudit audit;private final DepartureAccess departure;private final JsonMapper json=new JsonMapper();
 public FeedbackService(JdbcTemplate db,IdentityService identities,MaterialAccess access,ProfileService profiles,ExperienceService experiences,ConversationService conversations,IdentityAudit audit,DepartureAccess departure){this.db=db;this.identities=identities;this.access=access;this.profiles=profiles;this.experiences=experiences;this.conversations=conversations;this.audit=audit;this.departure=departure;}
 private IdentityException missing(){return new IdentityException(404,"FEEDBACK_NOT_FOUND");}
 private String text(String s,int max,boolean required){if(s==null||s.length()>max||(required&&s.isBlank())||s.codePoints().anyMatch(c->Character.isISOControl(c)&&c!=10&&c!=13&&c!=9))throw IdentityException.invalid();return s.strip();}
 private void paging(int offset,int limit){if(offset<0||offset>100000||limit<1||limit>50)throw IdentityException.invalid();}
 private String hash(Object... items){return IdentityService.hash(json.writeValueAsString(items));}
 private int number(Map<String,Object> r,String key){return ((Number)r.get(key)).intValue();}
 private Instant instant(Object time){return ((java.sql.Timestamp)time).toInstant();}
 private Target target(Map<String,Object> r){return new Target((String)r.get("kind"),(UUID)r.get("task_id"),number(r,"task_revision"),number(r,"attempt"),(String)r.get("presentation_version"),number(r,"presentation_revision"),(UUID)r.get("publication_id"),(UUID)r.get("material_version_id"),(Integer)r.get("material_version"));}
 private Target validate(Target t){
  if(t==null||t.kind()==null||t.presentationVersion()==null||t.taskRevision()<0||t.attempt()<0||t.presentationRevision()<0)throw IdentityException.invalid();
  if(t.kind().equals("PUBLICATION")){
   if(t.taskId()!=null||t.taskRevision()!=0||t.attempt()!=0||t.publicationId()==null||t.materialVersionId()==null||t.materialVersion()==null||t.materialVersion()<1||!t.presentationVersion().equals("recommendation-v1")||t.presentationRevision()<1)throw IdentityException.invalid();
  }else if(t.taskId()==null||t.publicationId()!=null||t.materialVersionId()!=null||t.materialVersion()!=null||!Set.of("BRIEFING","TASK").contains(t.kind())||!(t.kind().equals("BRIEFING")?Set.of("briefing-basic-v1","recommendation-v1").contains(t.presentationVersion()):t.presentationVersion().equals("task-v1"))||t.kind().equals("TASK")&&t.presentationRevision()!=0)throw IdentityException.invalid();
  return t;
 }
 private Map<String,Object> publication(UUID actor,UUID tenant,Target t,boolean lock){
  identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);
  var rows=db.queryForList("SELECT p.id publication_id,v.id material_version_id,v.number material_version,v.workspace_id,v.sha256,v.tenant_id FROM document_publications p JOIN material_versions v ON v.id=p.material_version_id JOIN workspaces w ON w.id=v.workspace_id WHERE p.id=? AND v.id=? AND v.tenant_id=? AND w.kind='SHARED'",t.publicationId(),t.materialVersionId(),tenant);
  if(rows.isEmpty())throw new IdentityException(404,"FEEDBACK_TARGET_UNAVAILABLE");var r=rows.getFirst();access.require(actor,tenant,(UUID)r.get("workspace_id"),false);access.requireVersionActive(tenant,(UUID)r.get("workspace_id"),t.materialVersionId());
  if(number(r,"material_version")!=t.materialVersion())throw new IdentityException(409,"FEEDBACK_TARGET_CHANGED");
  r.put("feedback_actor",actor);
  if(lock)db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","publication-feedback:"+actor+":"+t.materialVersionId());
  return r;
 }
 private Map<String,Object> current(UUID actor,UUID tenant,Target t,boolean lock){return t.kind().equals("PUBLICATION")?publication(actor,tenant,t,lock):task(actor,tenant,t.taskId(),lock);}
 private List<UUID> targetSources(Target t){return t.kind().equals("PUBLICATION")?List.of(t.materialVersionId()):sourceVersions(t.taskId(),t.attempt());}
 private List<UUID> matching(UUID actor,UUID tenant,Target t){return db.queryForList("SELECT id FROM feedback_entries WHERE tenant_id=? AND actor_id=? AND kind=? AND task_id IS NOT DISTINCT FROM ?::uuid AND publication_id IS NOT DISTINCT FROM ?::uuid AND material_version_id IS NOT DISTINCT FROM ?::uuid AND task_revision=? AND attempt=? AND presentation_version=? AND presentation_revision=?",UUID.class,tenant,actor,t.kind(),t.taskId(),t.publicationId(),t.materialVersionId(),t.taskRevision(),t.attempt(),t.presentationVersion(),t.presentationRevision());}
 private UUID personalSpace(UUID actor,UUID tenant){var spaces=db.queryForList("SELECT id FROM workspaces WHERE tenant_id=? AND owner_id=? AND kind='PERSONAL'",UUID.class,tenant,actor);if(spaces.size()!=1)throw new IdentityException(409,"PERSONAL_WORKSPACE_REQUIRED");access.require(actor,tenant,spaces.getFirst(),false);return spaces.getFirst();}
 private Map<String,Object> task(UUID actor,UUID tenant,UUID task,boolean lock){
  identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);
  var rows=db.queryForList("SELECT t.* FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id WHERE t.id=? AND t.tenant_id=? AND c.owner_id=?"+(lock?" FOR NO KEY UPDATE OF t":""),task,tenant,actor);
  if(rows.isEmpty())throw new IdentityException(404,"FEEDBACK_TARGET_UNAVAILABLE");var r=rows.getFirst();access.require(actor,tenant,(UUID)r.get("workspace_id"),false);
  if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM readable_source_tasks WHERE id=?)",Boolean.class,task)))throw new IdentityException(404,"FEEDBACK_TARGET_UNAVAILABLE");return r;
 }
 private void exact(Target t,Map<String,Object> r){
  if(t.kind().equals("PUBLICATION")){
   if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM recommendation_presentations WHERE id=? AND tenant_id=? AND actor_id=? AND publication_id=? AND material_version_id=? AND task_id IS NULL)",Boolean.class,t.presentationRevision(),r.get("tenant_id"),r.get("feedback_actor"),t.publicationId(),t.materialVersionId())))throw new IdentityException(409,"FEEDBACK_TARGET_CHANGED");return;
  }
  if(number(r,"revision")!=t.taskRevision()||number(r,"attempt")!=t.attempt())throw new IdentityException(409,"FEEDBACK_TARGET_CHANGED");
  if(t.kind().equals("BRIEFING")){
   if(!"AGENT".equals(r.get("mode"))||!"SUCCEEDED".equals(r.get("status"))||r.get("reply")==null)throw new IdentityException(404,"FEEDBACK_TARGET_UNAVAILABLE");
   if(t.presentationVersion().equals("recommendation-v1")) {
    boolean issued=Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM recommendation_presentations WHERE id=? AND tenant_id=? AND actor_id=? AND task_id=? AND task_revision=? AND attempt=?)",Boolean.class,t.presentationRevision(),r.get("tenant_id"),r.get("requested_by"),t.taskId(),t.taskRevision(),t.attempt()));
    if(!issued)throw new IdentityException(409,"FEEDBACK_TARGET_CHANGED");
   }else{
    Integer revision=db.queryForObject("SELECT coalesce((SELECT revision FROM briefing_preferences WHERE conversation_id=?),0)",Integer.class,r.get("conversation_id"));
    if(revision!=t.presentationRevision())throw new IdentityException(409,"FEEDBACK_TARGET_CHANGED");
   }
  }
 }
 private List<UUID> sourceVersions(UUID task,int attempt){
  var ids=new TreeSet<UUID>(db.queryForList("SELECT version_id FROM conversation_originals WHERE task_id=? UNION SELECT c.version_id FROM conversation_sources s JOIN knowledge_chunks c ON c.id=s.chunk_id WHERE s.task_id=? AND s.attempt_number=? UNION SELECT c.version_id FROM conversation_agent_grants g JOIN knowledge_chunks c ON c.id=g.chunk_id WHERE g.task_id=? AND (g.attempt_id IN(SELECT attempt_id FROM conversation_attempts WHERE task_id=? AND attempt_number=?) OR g.attempt_id IN(SELECT lease_token FROM conversation_tasks WHERE id=? AND attempt=?)) UNION SELECT version_id FROM feedback_task_sources WHERE task_id=?",UUID.class,task,task,attempt,task,task,attempt,task,attempt,task));
  if(Boolean.TRUE.equals(db.queryForObject("SELECT to_regclass('task_context_materials') IS NOT NULL",Boolean.class)))ids.addAll(db.queryForList("SELECT version_id FROM task_context_materials WHERE task_id=? AND attempt_number=?",UUID.class,task,attempt));
  return List.copyOf(ids);
 }
 private List<UUID> storedSources(UUID feedback){return db.queryForList("SELECT version_id FROM feedback_source_versions WHERE feedback_id=? ORDER BY version_id",UUID.class,feedback);}
 private UUID sourceSpace(UUID actor,UUID tenant,UUID version){var spaces=db.queryForList("SELECT workspace_id FROM material_versions WHERE tenant_id=? AND id=?",UUID.class,tenant,version);if(spaces.isEmpty())throw new IdentityException(404,"FEEDBACK_SOURCE_UNAVAILABLE");UUID s=spaces.getFirst();access.require(actor,tenant,s,false);access.requireVersionActive(tenant,s,version);return s;}
 private void sources(UUID actor,UUID tenant,List<UUID> versions){for(UUID v:versions)sourceSpace(actor,tenant,v);}
 private Map<String,Object> row(UUID actor,UUID tenant,UUID id,boolean lock){
  identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);var rows=db.queryForList("SELECT * FROM feedback_entries WHERE tenant_id=? AND actor_id=? AND id=? AND EXISTS(SELECT 1 FROM readable_feedback f WHERE f.id=feedback_entries.id)"+(lock?" FOR UPDATE":""),tenant,actor,id);if(rows.isEmpty())throw missing();var r=rows.getFirst();current(actor,tenant,target(r),false);sources(actor,tenant,storedSources(id));return r;
 }
 private Assessment assessment(String kind,Assessment a){
  if(a==null||a.rating()==null||a.reasons()==null||a.reasons().size()>6)throw IdentityException.invalid();
  boolean briefing=!kind.equals("TASK");Set<String> ratings=briefing?Set.of("USEFUL","NOT_USEFUL"):Set.of("ACHIEVED","PARTIAL","NOT_ACHIEVED");Set<String> reasons=briefing?Set.of("IRRELEVANT","REDUNDANT","INACCURATE","UNHELPFUL","CUSTOM"):Set.of("FACT_ERROR","EXECUTION","GOAL_CHANGED","EXPRESSION","DATA_GAP","OTHER");
  if(!ratings.contains(a.rating())||a.reasons().stream().anyMatch(r->r==null||!reasons.contains(r))||new HashSet<>(a.reasons()).size()!=a.reasons().size())throw IdentityException.invalid();
  String suggestion=text(a.suggestion(),2000,false);if(briefing&&a.rating().equals("NOT_USEFUL")&&a.reasons().isEmpty()&&suggestion.isBlank()||a.reasons().contains("CUSTOM")&&suggestion.isBlank())throw IdentityException.invalid();
  return new Assessment(a.rating(),a.reasons().stream().sorted().toList(),suggestion);
 }
 private UUID append(UUID feedback,int revision,String status,Assessment assessment){UUID id=UUID.randomUUID();db.update("INSERT INTO feedback_versions(id,feedback_id,revision,status,assessment) VALUES (?,?,?,?,?::jsonb)",id,feedback,revision,status,json.writeValueAsString(assessment));return id;}
 private Feedback project(Map<String,Object> r,int revision){
  var v=db.queryForList("SELECT * FROM feedback_versions WHERE feedback_id=? AND revision=? AND object_is_active('FEEDBACK_VERSION',id)",r.get("id"),revision);if(v.isEmpty())throw missing();var version=v.getFirst();
  return new Feedback((UUID)r.get("id"),(UUID)r.get("tenant_id"),(UUID)r.get("workspace_id"),target(r),revision,(String)version.get("status"),json.readValue(version.get("assessment").toString(),Assessment.class),json.readValue(r.get("snapshot").toString(),Snapshot.class),instant(r.get("created_at")),instant(version.get("created_at")));
 }
 public record Reading(UUID workspaceId,UUID cardId,String cardKind,Target target,String title,String excerpt,boolean truncated,String presentation,List<UUID> sourceVersions,String contentSha256) {}
 /** The exact server-issued card projection. Opening this read never creates an opinion or work. */
 @Transactional public Reading reading(UUID actor,UUID tenant,Target supplied){
  Target t=validate(supplied);if(t.kind().equals("TASK"))throw IdentityException.invalid();var c=current(actor,tenant,t,false);exact(t,c);var versions=targetSources(t);sources(actor,tenant,versions);
  UUID card;String title,excerpt;boolean truncated=false;
  if(t.kind().equals("PUBLICATION")){var v=db.queryForMap("SELECT material_id,filename FROM material_versions WHERE id=?",t.materialVersionId());card=(UUID)v.get("material_id");title=(String)v.get("filename");excerpt="";}
  else{card=(UUID)c.get("conversation_id");title=db.queryForObject("SELECT CASE WHEN EXISTS(SELECT 1 FROM readable_source_tasks WHERE id=(SELECT id FROM conversation_tasks WHERE conversation_id=? ORDER BY created_at,id LIMIT 1)) THEN title ELSE '会话内容暂不可用' END FROM conversations WHERE id=?",String.class,card,card);excerpt=db.queryForObject("SELECT left(reply,600) FROM conversation_tasks WHERE id=?",String.class,t.taskId());truncated=((String)c.get("reply")).codePointCount(0,((String)c.get("reply")).length())>600;}
  String presentation=t.presentationVersion().equals("recommendation-v1")?db.queryForObject("SELECT jsonb_build_object('version','recommendation-v1','method',method,'presentation',presentation,'settingsRevision',settings_revision,'fingerprint',fingerprint)::text FROM recommendation_presentations WHERE id=?",String.class,t.presentationRevision()):json.writeValueAsString(db.queryForList("SELECT revision,pinned,hidden,size FROM briefing_preferences WHERE conversation_id=?",card));
  return new Reading((UUID)c.get("workspace_id"),card,t.kind(),t,title,excerpt,truncated,presentation,versions,hash(t,title,excerpt,presentation,versions));
 }
 @Transactional public Feedback version(UUID actor,UUID tenant,UUID id,int revision){return project(row(actor,tenant,id,false),revision);}
 @Transactional public Feedback get(UUID actor,UUID tenant,UUID id){var r=row(actor,tenant,id,false);return project(r,number(r,"revision"));}
 private Feedback replay(UUID actor,UUID tenant,UUID version){var v=db.queryForList("SELECT feedback_id,revision FROM feedback_versions WHERE id=?",version);if(v.isEmpty())throw missing();return project(row(actor,tenant,(UUID)v.getFirst().get("feedback_id"),false),number(v.getFirst(),"revision"));}
 @Transactional public Lookup lookup(UUID actor,UUID tenant,Target target){Target t=validate(target);var c=current(actor,tenant,t,false);var ids=matching(actor,tenant,t);if(ids.isEmpty()){exact(t,c);sources(actor,tenant,targetSources(t));return new Lookup(null);}return new Lookup(get(actor,tenant,ids.getFirst()));}
 @Transactional public Feedback create(UUID actor,UUID tenant,UUID key,Target target,Assessment assessment){
  Target t=validate(target);Assessment a=assessment(t.kind(),assessment);String h=hash(tenant,t,a);UUID prior=identities.priorRequest(actor,key,"FEEDBACK_CREATE",h);var c=current(actor,tenant,t,true);if(prior!=null)return replay(actor,tenant,prior);exact(t,c);
  if(!matching(actor,tenant,t).isEmpty())throw new IdentityException(409,"FEEDBACK_ALREADY_EXISTS");
  var versions=targetSources(t);sources(actor,tenant,versions);Snapshot snapshot;
  if(t.kind().equals("PUBLICATION"))snapshot=new Snapshot("PUBLISHED_COPY","none",hash(c.get("sha256"),t),1);
  else {var artifacts=db.queryForList("SELECT id,sha256 FROM conversation_artifacts WHERE task_id=? AND attempt_number=? ORDER BY id",t.taskId(),t.attempt());String mode=c.get("execution_class")==null?"none":(String)c.get("execution_class");snapshot=new Snapshot((String)c.get("status"),mode,hash(c.get("reply"),c.get("summary_code"),artifacts,versions,t),versions.size());}
  UUID id=UUID.randomUUID();db.update("INSERT INTO feedback_entries(id,tenant_id,workspace_id,actor_id,kind,task_id,task_revision,attempt,presentation_version,presentation_revision,snapshot,publication_id,material_version_id,material_version) VALUES (?,?,?,?,?,?,?,?,?,?,?::jsonb,?,?,?)",id,tenant,c.get("workspace_id"),actor,t.kind(),t.taskId(),t.taskRevision(),t.attempt(),t.presentationVersion(),t.presentationRevision(),json.writeValueAsString(snapshot),t.publicationId(),t.materialVersionId(),t.materialVersion());
  for(UUID v:versions)db.update("INSERT INTO feedback_source_versions(feedback_id,version_id) VALUES (?,?)",id,v);UUID v=append(id,1,"ACTIVE",a);identities.remember(actor,key,"FEEDBACK_CREATE",h,v);audit.record(actor,tenant,"FEEDBACK_CREATE",id,"SUCCESS");return get(actor,tenant,id);
 }
 @Transactional public Feedback edit(UUID actor,UUID tenant,UUID id,UUID key,int expected,Assessment assessment,boolean withdraw){
  var first=row(actor,tenant,id,false);Assessment a=withdraw?null:assessment((String)first.get("kind"),assessment);String h=hash(tenant,id,expected,a,withdraw);UUID prior=identities.priorRequest(actor,key,"FEEDBACK_EDIT",h);var r=row(actor,tenant,id,true);if(prior!=null)return replay(actor,tenant,prior);if(number(r,"revision")!=expected)throw new IdentityException(409,"FEEDBACK_STATE_CHANGED");
  var old=project(r,expected);if(withdraw&&old.status().equals("WITHDRAWN"))throw new IdentityException(409,"FEEDBACK_STATE_CHANGED");int next=expected+1;UUID v=append(id,next,withdraw?"WITHDRAWN":"ACTIVE",withdraw?old.assessment():a);db.update("UPDATE feedback_entries SET revision=?,updated_at=now() WHERE id=?",next,id);identities.remember(actor,key,"FEEDBACK_EDIT",h,v);audit.record(actor,tenant,withdraw?"FEEDBACK_WITHDRAW":"FEEDBACK_EDIT",id,"SUCCESS");return get(actor,tenant,id);
 }
 @Transactional public History history(UUID actor,UUID tenant,UUID id,int offset,int limit){paging(offset,limit);row(actor,tenant,id,false);var rows=db.query("SELECT revision,status,assessment,created_at FROM feedback_versions WHERE feedback_id=? AND object_is_active('FEEDBACK_VERSION',id) ORDER BY revision DESC LIMIT ? OFFSET ?",(r,n)->new Version(r.getInt(1),r.getString(2),json.readValue(r.getString(3),Assessment.class),r.getTimestamp(4).toInstant()),id,limit+1,offset);return new History(rows.stream().limit(limit).toList(),rows.size()>limit);}
 private static final Map<String,String> SCENARIOS=Map.of("GENERAL","一般工作内容","WEEKLY_REPORT","周报","TABLE_SUMMARY","表格汇总");
 private static final Map<String,String> STYLES=Map.of("CONCLUSION_FIRST","先给结论，再给依据","DETAIL_FIRST","先交代依据，再给结论","TABLE_FIRST","适合比较时优先使用表格","CONCISE","保持简洁，同时保留必要事实和限制");
 private String preferenceKey(String scenario){return "feedback.presentation."+scenario.toLowerCase(Locale.ROOT);}
 private UUID preferenceId(UUID actor,UUID tenant,String scenario){var ids=db.queryForList("SELECT id FROM profile_entries WHERE tenant_id=? AND scope='PERSONAL' AND account_id=? AND entry_key=? AND kind='PREFERENCE'",UUID.class,tenant,actor,preferenceKey(scenario));return ids.isEmpty()?null:ids.getFirst();}
 private String preferenceText(String scenario,String style){return "本人在"+SCENARIOS.get(scenario)+"中的表达偏好："+STYLES.get(style)+"。仅影响本人表达偏好，不覆盖业务事实、任务目标或权限。";}
 @Transactional public Preferences preferences(UUID actor,UUID tenant){identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);var result=new ArrayList<PreferenceState>();for(String scenario:List.of("GENERAL","WEEKLY_REPORT","TABLE_SUMMARY")){UUID id=preferenceId(actor,tenant,scenario);if(id==null)result.add(new PreferenceState(scenario,null,0,"UNSET",null));else{var meta=profiles.currentMetadata(actor,tenant,id);if(!meta.bodyAvailable()){result.add(new PreferenceState(scenario,id,meta.revision(),"UNAVAILABLE",null));continue;}var value=profiles.get(actor,tenant,id,null);String style=STYLES.keySet().stream().filter(s->preferenceText(scenario,s).equals(value.value())).findFirst().orElse(null);result.add(new PreferenceState(scenario,id,value.revision(),value.effectiveStatus(),style));}}return new Preferences(result);}
 private Action receipt(UUID id){return db.queryForObject("SELECT receipt FROM feedback_actions WHERE id=?",(r,n)->json.readValue(r.getString(1),Action.class),id);}
 @Transactional public Actions actions(UUID actor,UUID tenant,UUID id,int offset,int limit){paging(offset,limit);row(actor,tenant,id,false);var ids=db.queryForList("SELECT id FROM feedback_actions WHERE feedback_id=? ORDER BY created_at DESC,id LIMIT ? OFFSET ?",UUID.class,id,limit+1,offset);return new Actions(ids.stream().limit(limit).map(this::receipt).toList(),ids.size()>limit);}
 /** Client edition defers experience maintenance; filter before paging, preserve internal history. */
 @Transactional public Actions clientActions(UUID actor,UUID tenant,UUID id,int offset,int limit){paging(offset,limit);row(actor,tenant,id,false);var ids=db.queryForList("SELECT id FROM feedback_actions WHERE feedback_id=? AND kind<>'EXPERIENCE_CANDIDATE' ORDER BY created_at DESC,id LIMIT ? OFFSET ?",UUID.class,id,limit+1,offset);return new Actions(ids.stream().limit(limit).map(this::receipt).toList(),ids.size()>limit);}
 @Transactional public Action clientFollowUp(UUID actor,UUID tenant,UUID id,UUID key,int expected,FollowUp body){
  row(actor,tenant,id,false);
  if(body!=null&&"EXPERIENCE_CANDIDATE".equals(body.kind()))throw new IdentityException(410,"EXPERIENCE_MANUAL_WORKFLOW_RETIRED");
  return followUp(actor,tenant,id,key,expected,body);
 }
 @Transactional public Action followUp(UUID actor,UUID tenant,UUID id,UUID key,int expected,FollowUp body){
  if(body!=null&&"EXPERIENCE_CANDIDATE".equals(body.kind())){row(actor,tenant,id,false);throw new IdentityException(410,"EXPERIENCE_MANUAL_WORKFLOW_RETIRED");}
  if(body==null||!body.confirmed()||body.kind()==null||!Set.of("PREFERENCE","CORRECTION","EXPERIENCE_CANDIDATE").contains(body.kind()))throw IdentityException.invalid();
  if((body.preference()!=null?1:0)+(body.correction()!=null?1:0)+(body.candidate()!=null?1:0)!=1)throw IdentityException.invalid();
  var currentEntry=row(actor,tenant,id,false);project(currentEntry,expected);String h=hash(tenant,id,expected,body);UUID prior=identities.priorRequest(actor,key,"FEEDBACK_FOLLOW_UP",h);var r=row(actor,tenant,id,true);if(prior!=null)return receipt(prior);var f=project(r,number(r,"revision"));if(f.revision()!=expected||!f.status().equals("ACTIVE"))throw new IdentityException(409,"FEEDBACK_STATE_CHANGED");
  var old=db.queryForList("SELECT id,fingerprint FROM feedback_actions WHERE feedback_id=? AND feedback_revision=? AND kind=?",id,expected,body.kind());if(!old.isEmpty()){if(!h.equals(old.getFirst().get("fingerprint")))throw new IdentityException(409,"FEEDBACK_ACTION_EXISTS");UUID previous=(UUID)old.getFirst().get("id");identities.remember(actor,key,"FEEDBACK_FOLLOW_UP",h,previous);return receipt(previous);}
  UUID action=UUID.randomUUID(),inner=UUID.nameUUIDFromBytes(("feedback-action:"+action).getBytes(StandardCharsets.UTF_8));Action result;Instant now=Instant.now();
  switch(body.kind()){
   case "PREFERENCE" -> {var p=body.preference();if(p==null||p.scenario()==null||p.style()==null||!SCENARIOS.containsKey(p.scenario())||!STYLES.containsKey(p.style())||p.expectedProfileRevision()<0)throw IdentityException.invalid();UUID profile=preferenceId(actor,tenant,p.scenario());var content=new ProfileService.Content(preferenceText(p.scenario(),p.style()),"本人在反馈后另行明确选择的表达偏好；未复制原反馈或来源内容。",ProfileService.Status.ACTIVE,null);ProfileService.Value value;if(profile==null){if(p.expectedProfileRevision()!=0)throw new IdentityException(409,"PROFILE_VERSION_CONFLICT");value=profiles.create(actor,tenant,ProfileService.Scope.PERSONAL,actor,preferenceKey(p.scenario()),ProfileService.Kind.PREFERENCE,content,inner);}else value=profiles.save(actor,tenant,profile,p.expectedProfileRevision(),content,inner);result=new Action(action,id,expected,body.kind(),"APPLIED",value.id(),null,value.revision(),null,"ACTIVE","none",now);}
   case "CORRECTION" -> {String correction=text(body.correction(),1200,true);String prompt=f.target().kind().equals("PUBLICATION")?"对独立发布副本 "+f.target().publicationId()+" / 资料版本 "+f.target().materialVersionId()+" 提出本人独立纠正请求。未授权修改共享事实或读取发布者私人来源。用户明确要求：\n"+correction:"对原任务 "+f.target().taskId()+" 的第 "+f.target().attempt()+" 次执行、状态版本 "+f.target().taskRevision()+" 提出独立纠正请求。评价不代表原任务成功，也不要用此旧版本覆盖最新成果。用户明确要求：\n"+correction;var detail=conversations.submit(actor,tenant,null,f.target().kind().equals("PUBLICATION")?personalSpace(actor,tenant):f.workspaceId(),inner,prompt,"AGENT",null,List.of());var created=detail.tasks().getLast();if(f.target().taskId()!=null)db.update("INSERT INTO dataset_task_inheritance(task_id,source_task_id) VALUES (?,?) ON CONFLICT DO NOTHING",created.id(),f.target().taskId());for(UUID v:storedSources(id))db.update("INSERT INTO feedback_task_sources(task_id,version_id,feedback_id) VALUES (?,?,?)",created.id(),v,id);result=new Action(action,id,expected,body.kind(),"TASK_CREATED",created.id(),null,created.revision(),detail.conversation().id(),created.status(),created.executionClass()==null?"none":created.executionClass(),now);}
   default -> throw IdentityException.invalid();
  }
  if(f.target().kind().equals("PUBLICATION")&&!body.kind().equals("PREFERENCE"))result=new Action(result.id(),result.feedbackId(),result.feedbackRevision(),result.kind(),result.status(),result.targetId(),result.targetVersion(),result.targetRevision(),result.conversationId(),result.acceptedState(),result.executionClass(),result.createdAt(),personalSpace(actor,tenant));
  db.update("INSERT INTO feedback_actions(id,feedback_id,feedback_revision,kind,fingerprint,receipt) VALUES (?,?,?,?,?,?::jsonb)",action,id,expected,body.kind(),h,json.writeValueAsString(result));identities.remember(actor,key,"FEEDBACK_FOLLOW_UP",h,action);audit.record(actor,tenant,"FEEDBACK_"+body.kind(),id,"SUCCESS");return result;
 }
}
