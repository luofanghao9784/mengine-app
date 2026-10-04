package com.dreamcore.workspace.context;

import com.dreamcore.workspace.conversation.AgentTaskService;
import com.dreamcore.workspace.conversation.BriefingContentService;
import com.dreamcore.workspace.experience.ExperienceService;
import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.material.MaterialAccess;
import com.dreamcore.workspace.profile.ProfileService;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Bounded, optional reference reads. Task identity and scope never come from model arguments. */
@Service
public class TaskContextService {
 public record Request(String action,String scope,String query,Integer offset,UUID referenceId,UUID versionId,Integer revision,UUID requestId,String decision,String conditions,String adjustments,Integer columnOffset,Integer columnLimit) {
  public Request(String action,String scope,String query,Integer offset,UUID referenceId,UUID versionId,Integer revision,UUID requestId,String decision,String conditions,String adjustments){this(action,scope,query,offset,referenceId,versionId,revision,requestId,decision,conditions,adjustments,null,null);}
 }
 private record Task(UUID id,UUID actor,UUID tenant,UUID space,UUID conversation,int attempt) {}
 private final JdbcTemplate db; private final AgentTaskService agents; private final ProfileService profiles;
 private final ExperienceService experiences; private final MaterialAccess materials; private final TaskContextGuard guard;
 private final JsonMapper json=new JsonMapper();private final BriefingContentService briefings;private final DatasetTaskContext datasets;private final GeneralExperienceTaskContext general;
 public TaskContextService(JdbcTemplate db,AgentTaskService agents,ProfileService profiles,ExperienceService experiences,MaterialAccess materials,TaskContextGuard guard,BriefingContentService briefings,DatasetTaskContext datasets,GeneralExperienceTaskContext general){this.general=general;this.datasets=datasets;this.briefings=briefings;this.db=db;this.agents=agents;this.profiles=profiles;this.experiences=experiences;this.materials=materials;this.guard=guard;}
 private IdentityException missing(){return new IdentityException(404,"TASK_CONTEXT_NOT_FOUND");}
 private String text(String s,int max,boolean required){if(s==null)s="";if(s.length()>max||required&&s.isBlank()||s.codePoints().anyMatch(c->Character.isISOControl(c)&&c!=10&&c!=13&&c!=9))throw IdentityException.invalid();return s.strip();}
 private int offset(Request r){int n=r.offset()==null?0:r.offset();if(n<0||n>1000)throw IdentityException.invalid();return n;}
 private int methodSplit(String body){return body.length()>8000&&Character.isHighSurrogate(body.charAt(7999))?8001:8000;}
 private String clip(String value,int limit){if(value==null)return "";if(value.length()<=limit)return value;int end=Character.isHighSurrogate(value.charAt(limit-1))?limit-1:limit;return value.substring(0,end);}
 private Map<String,Object> map(Object... values){var out=new LinkedHashMap<String,Object>();for(int i=0;i<values.length;i+=2)out.put((String)values[i],values[i+1]);return out;}
 private Task task(UUID task,UUID token){agents.check(task,token);guard.requireCurrent(task);return db.queryForObject("SELECT requested_by,tenant_id,workspace_id,conversation_id,attempt FROM conversation_tasks WHERE id=?",(r,n)->new Task(task,r.getObject(1,UUID.class),r.getObject(2,UUID.class),r.getObject(3,UUID.class),r.getObject(4,UUID.class),r.getInt(5)),task);}
 @Transactional public Map<String,Object> context(UUID task,UUID token,Request r){
  var t=task(task,token);if(r==null||r.action()==null)throw IdentityException.invalid();
  Object result=switch(r.action()){
   case "bootstrap" -> bootstrap(t);
   case "dataset_search", "dataset_read" -> datasets.read(task,r);
   case "general_experience_search", "general_experience_read", "general_experience_use" -> general.read(task,r);
   case "profiles" -> profilesSelectedOnly(t)?map("items",List.of(),"hasMore",false,"reason","SELECTED_ONLY"):profileList(t,r);
   case "profile_read" -> profilesSelectedOnly(t)?map("unavailable",true,"reason","SELECTED_ONLY"):profile(t,r);
   case "history" -> selectedOnly(t)?map("items",List.of(),"hasMore",false,"reason","SELECTED_ONLY"):history(t,r);
   case "experience_search" -> selectedOnly(t)?map("items",List.of(),"hasMore",false,"reason","SELECTED_ONLY"):search(t,r);
   case "experience_read" -> selectedOnly(t)?map("unavailable",true,"reason","SELECTED_ONLY"):experience(t,r,true);
   case "experience_use" -> selectedOnly(t)?map("unavailable",true,"reason","SELECTED_ONLY"):review(t,r);
   default -> throw IdentityException.invalid();
  };
  agents.check(task,token);guard.requireCurrent(task);
  var response=map("contractVersion","1.0","action",r.action(),"referenceOnly",true,"result",result);
  if(json.writeValueAsString(response).getBytes(StandardCharsets.UTF_8).length>57344)throw new IdentityException(413,"TASK_CONTEXT_LIMIT");
  return response;
 }
 private void record(Task t,String kind,UUID ref,String version,Object content){
  var old=db.queryForList("SELECT version_key FROM task_context_reads WHERE task_id=? AND attempt_number=? AND kind=? AND reference_id=?",String.class,t.id(),t.attempt(),kind,ref);
  if(!old.isEmpty()){if(!old.getFirst().equals(version))throw new IdentityException(409,"TASK_CONTEXT_CHANGED");return;}
  if(db.queryForObject("SELECT (SELECT count(*) FROM task_context_reads WHERE task_id=? AND attempt_number=?)+(SELECT count(*) FROM task_general_experience_reads WHERE task_id=? AND attempt_number=?)",Integer.class,t.id(),t.attempt(),t.id(),t.attempt())>=32)throw new IdentityException(413,"TASK_CONTEXT_LIMIT");
  db.update("INSERT INTO task_context_reads(task_id,attempt_number,kind,reference_id,version_key,content_hash) VALUES (?,?,?,?,?,?)",t.id(),t.attempt(),kind,ref,version,IdentityService.hash(json.writeValueAsString(content)));
 }
 private void dependencies(Task target,Collection<UUID> versions){
  for(UUID version:new LinkedHashSet<>(versions)){
   var rows=db.queryForList("SELECT workspace_id FROM material_versions WHERE tenant_id=? AND id=?",UUID.class,target.tenant(),version);if(rows.isEmpty())throw missing();
   materials.require(target.actor(),target.tenant(),rows.getFirst(),false);materials.requireVersionActive(target.tenant(),rows.getFirst(),version);
   db.update("INSERT INTO task_context_materials(task_id,attempt_number,version_id) VALUES (?,?,?) ON CONFLICT DO NOTHING",target.id(),target.attempt(),version);
  }
  if(db.queryForObject("SELECT count(*) FROM task_context_materials WHERE task_id=? AND attempt_number=?",Integer.class,target.id(),target.attempt())>256)throw new IdentityException(413,"TASK_CONTEXT_LIMIT");
 }
 private List<UUID> sourceVersions(UUID task){
  var found=new LinkedHashSet<>(db.queryForList("""
   SELECT version_id FROM conversation_originals WHERE task_id=?
   UNION SELECT c.version_id FROM conversation_sources s JOIN knowledge_chunks c ON c.id=s.chunk_id WHERE s.task_id=?
   UNION SELECT c.version_id FROM conversation_agent_grants g JOIN knowledge_chunks c ON c.id=g.chunk_id WHERE g.task_id=?
   UNION SELECT version_id FROM task_context_materials WHERE task_id=?
   """,UUID.class,task,task,task,task));
  if(Boolean.TRUE.equals(db.queryForObject("SELECT to_regclass('feedback_task_sources') IS NOT NULL",Boolean.class)))found.addAll(db.queryForList("SELECT version_id FROM feedback_task_sources WHERE task_id=?",UUID.class,task));
  return List.copyOf(found);
 }
 private void readableTask(Task t,UUID source){
  if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM conversation_tasks s JOIN conversations c ON c.id=s.conversation_id JOIN readable_source_tasks v ON v.id=s.id WHERE s.id=? AND s.tenant_id=? AND c.owner_id=?)",Boolean.class,source,t.tenant(),t.actor())))throw missing();
  UUID space=db.queryForObject("SELECT workspace_id FROM conversation_tasks WHERE id=?",UUID.class,source);materials.require(t.actor(),t.tenant(),space,false);
 }
 private boolean selectedOnly(Task t){return "SELECTED".equals(db.queryForObject("SELECT source_scope FROM conversation_tasks WHERE id=?",String.class,t.id()));}
 private Object bootstrap(Task t){
  var previous=db.queryForList("SELECT * FROM conversation_attempts WHERE task_id=? AND attempt_number<? ORDER BY attempt_number DESC LIMIT 1",t.id(),t.attempt());
  return map("taskId",t.id(),"attempt",t.attempt(),"organization",map("name",db.queryForObject("SELECT name FROM tenants WHERE id=?",String.class,t.tenant()),"source","CURRENT_TENANT","authority",false),"historyScope","CURRENT_PRIVATE_CONVERSATION","profileScopes",List.of("TENANT","WORKSPACE","PERSONAL"),"experienceScope","CURRENT_WORKSPACE_PUBLISHED","generalExperienceScope","GENERAL_CLEANED","previousAttempt",previous.isEmpty()?null:historyItem(previous.getFirst(),false),"latestBriefing",selectedOnly(t)&&!hasDiscussion(t)?null:latestBriefing(t),"sourceScope",db.queryForObject("SELECT source_scope FROM conversation_tasks WHERE id=?",String.class,t.id()),"selectedMaterials",db.queryForList("SELECT v.filename,v.number AS version,v.id AS version_id FROM conversation_originals o JOIN material_versions v ON v.id=o.version_id WHERE o.task_id=? ORDER BY v.id",t.id()),"selectedDatasets",db.queryForList("SELECT d.id AS dataset_id,s.id AS snapshot_id,d.name,s.version FROM briefing_dataset_selections chosen JOIN business_datasets d ON d.id=chosen.dataset_id JOIN dataset_snapshots s ON s.id=chosen.snapshot_id WHERE chosen.task_id=? AND NOT chosen.invalidated ORDER BY d.id",t.id()),"backgroundIsAuthorization",false);
 }
 private boolean hasDiscussion(Task t){return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_discussions WHERE conversation_id=?)",Boolean.class,t.conversation()));}
 private Object latestBriefing(Task current){
  var found=db.queryForList("SELECT t.id,t.attempt FROM conversation_tasks t JOIN readable_source_tasks readable ON readable.id=t.id WHERE t.conversation_id=? AND t.tenant_id=? AND t.status='SUCCEEDED' AND t.created_at<(SELECT created_at FROM conversation_tasks WHERE id=?) AND EXISTS ("+BriefingContentService.ELIGIBLE+") ORDER BY t.created_at DESC LIMIT 1",current.conversation(),current.tenant(),current.id());
  if(hasDiscussion(current))found=db.queryForList("SELECT s.id,s.attempt FROM briefing_discussions d JOIN conversation_tasks s ON s.id=d.source_task_id JOIN readable_source_tasks r ON r.id=s.id WHERE d.conversation_id=? AND s.revision=d.source_revision AND s.attempt=d.source_attempt AND s.status='SUCCEEDED'",current.conversation());
  if(found.isEmpty())return null;var row=found.getFirst();UUID source=(UUID)row.get("id");readableTask(current,source);dependencies(current,sourceVersions(source));
  var doc=briefings.find(source,((Number)row.get("attempt")).intValue());if(doc==null)return null;var c=doc.content();var chart=c.chart();
  var reference=map("artifactId",doc.artifactId(),"title",c.title(),"summary",c.summary(),"analysis",c.analysis(),"source",c.source(),"datasetSource",c.datasetSource(),"datasetBasis",c.datasetBasis(),"generatedAt",c.generatedAt(),"chart",chart==null?null:map("metric",chart.metric(),"unit",chart.unit(),"baseline",chart.baseline(),"current",chart.current(),"rows",chart.rows().stream().limit(10).toList(),"totalGroups",chart.rows().size(),"rowsTruncated",chart.rows().size()>10,"totals",chart.totals()));
  record(current,"HISTORY",source,row.get("attempt").toString(),reference);return reference;
 }
 private boolean profilesSelectedOnly(Task t){return selectedOnly(t)&&!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM briefing_generation_batches WHERE task_id=? AND owner_id=? AND tenant_id=? AND workspace_id=?)",Boolean.class,t.id(),t.actor(),t.tenant(),t.space()));}
 private boolean usable(ProfileService.Value v){return (v.status()==ProfileService.Status.ACTIVE||v.kind()==ProfileService.Kind.INFERENCE&&v.status()==ProfileService.Status.PROPOSED)&&(v.expiresAt()==null||v.expiresAt().isAfter(Instant.now()));}
 private void profileScope(Task t,ProfileService.Value v){if(v.scope()==ProfileService.Scope.WORKSPACE&&!v.subjectId().equals(t.space())||v.scope()==ProfileService.Scope.PERSONAL&&!v.subjectId().equals(t.actor()))throw missing();if(!usable(v))throw missing();}
 private Object profileValue(Task t,ProfileService.Value v,int limit){
  profileScope(t,v);
  dependencies(t,db.queryForList("SELECT DISTINCT c.version_id FROM company_profile_inferences p JOIN company_inference_inputs i ON i.run_id=p.run_id JOIN knowledge_chunks c ON c.id=i.chunk_id WHERE p.version_id=?",UUID.class,v.versionId()));
  record(t,"PROFILE",v.id(),Integer.toString(v.revision()),v);
  return map("id",v.id(),"revision",v.revision(),"scope",v.scope(),"subjectId",v.subjectId(),"kind",v.kind(),"key",v.key(),"value",clip(v.value(),limit),"truncated",v.value().length()>limit,"provenance",v.provenance(),"effectiveStatus",v.effectiveStatus(),"expiresAt",v.expiresAt(),"authority",false);
 }
 private Object profileList(Task t,Request r){
  ProfileService.Scope scope;try{scope=ProfileService.Scope.valueOf(r.scope());}catch(Exception e){throw IdentityException.invalid();}
  String q=text(r.query(),200,false);
  var ids=db.queryForList("""
   SELECT e.id FROM profile_entries e JOIN profile_versions v ON v.entry_id=e.id AND v.revision=e.revision
   WHERE NOT v.scrubbed AND object_is_active('PROFILE_VERSION',v.id) AND company_profile_readable(v.id) AND e.tenant_id=? AND e.scope=? AND e.workspace_id IS NOT DISTINCT FROM ?::uuid AND e.account_id IS NOT DISTINCT FROM ?::uuid
   AND (v.status='ACTIVE' OR e.kind='INFERENCE' AND v.status='PROPOSED') AND (v.expires_at IS NULL OR v.expires_at>clock_timestamp())
   AND (?='' OR position(lower(?) in lower(e.entry_key||' '||v.value))>0) ORDER BY e.entry_key,e.id LIMIT 6 OFFSET ?
   """,UUID.class,t.tenant(),scope.name(),scope==ProfileService.Scope.WORKSPACE?t.space():null,scope==ProfileService.Scope.PERSONAL?t.actor():null,q,q,offset(r));
  return map("items",ids.stream().limit(5).map(id->profileValue(t,profiles.get(t.actor(),t.tenant(),id,null),1200)).toList(),"hasMore",ids.size()>5);
 }
 private Object profile(Task t,Request r){if(r.referenceId()==null||r.revision()==null||r.revision()<1)throw IdentityException.invalid();var current=profiles.get(t.actor(),t.tenant(),r.referenceId(),null);if(current.revision()!=r.revision())throw new IdentityException(409,"TASK_CONTEXT_CHANGED");return profileValue(t,current,4000);}
 @SuppressWarnings("unchecked") private Map<String,Object> historyItem(Map<String,Object> row,boolean includePrompt){
  var snapshot=json.readValue(row.get("snapshot").toString(),Map.class);String reply=Objects.toString(snapshot.get("reply"),"");String prompt=Objects.toString(row.get("input"),"");
  return map("taskId",row.get("task_id"),"attempt",row.get("attempt_number"),"status",row.get("status"),"prompt",includePrompt?clip(prompt,1200):null,"reply",clip(reply,3500),"truncated",reply.length()>3500||includePrompt&&prompt.length()>1200,"waitReason",snapshot.get("wait_reason"),"requiredInput",snapshot.get("required_input"),"errorCode",snapshot.get("error_code"),"reconciliationRequired",snapshot.get("reconciliation_required"),"tools",snapshot.getOrDefault("tool_receipts",List.of()),"provenance",row.get("provenance"),"businessOutcome","UNKNOWN");
 }
 private Object history(Task t,Request r){
  String q=text(r.query(),200,false);
  var rows=db.queryForList("""
   SELECT h.* FROM conversation_tasks s JOIN LATERAL
    (SELECT * FROM conversation_attempts h WHERE h.task_id=s.id AND h.finished_at IS NOT NULL ORDER BY attempt_number DESC LIMIT 1) h ON true
   JOIN readable_source_tasks v ON v.id=s.id JOIN conversation_tasks current ON current.id=?
   WHERE s.conversation_id=? AND s.tenant_id=? AND s.origin='USER' AND s.id<>current.id AND s.created_at<current.created_at
   AND (?='' OR position(lower(?) in lower(h.input||' '||coalesce(h.snapshot->>'reply','')))>0)
   ORDER BY s.created_at DESC,s.id DESC LIMIT 3 OFFSET ?
   """,t.id(),t.conversation(),t.tenant(),q,q,offset(r));
  var items=new ArrayList<Object>();for(var row:rows.stream().limit(2).toList()){
   UUID source=(UUID)row.get("task_id");readableTask(t,source);dependencies(t,sourceVersions(source));
   var item=historyItem(row,true);record(t,"HISTORY",source,row.get("attempt_number").toString(),item);items.add(item);
  }
  return map("items",items,"hasMore",rows.size()>2,"scope","CURRENT_PRIVATE_CONVERSATION","completeHistory",false);
 }
 private Object search(Task t,Request r){
  var found=experiences.engineList(t.actor(),t.tenant(),t.space(),text(r.query(),200,true),offset(r),3);
  // Even summaries can contain source data; track their dependencies before exposing them.
  var items=new ArrayList<Object>();for(var s:found.items()){
   if(!Boolean.TRUE.equals(db.queryForObject("SELECT experience_general_dependencies_current(?,?)",Boolean.class,t.tenant(),s.versionId())))continue;
   var exact=experienceEntry(t,s.id(),s.versionId());trackExperience(t,exact);record(t,"EXPERIENCE",exact.id(),exact.version().id().toString(),exact.version());items.add(s);
  }
  return map("items",items,"hasMore",found.hasMore(),"scope","CURRENT_WORKSPACE_PUBLISHED","applicationOutcome","UNKNOWN");
 }
 private ExperienceService.Entry experienceEntry(Task t,UUID id,UUID version){
  if(id==null||version==null)throw IdentityException.invalid();var e=experiences.get(t.actor(),t.tenant(),t.space(),id,version);
  if(!Boolean.TRUE.equals(db.queryForObject("SELECT experience_general_dependencies_current(?,?)",Boolean.class,t.tenant(),version)))throw new IdentityException(409,"EXPERIENCE_NOT_CURRENT");
  if(!e.version().origin().equals("AUTOMATIC")||!e.version().evaluation().equals("AUTOMATIC_CHECKED"))throw new IdentityException(409,"EXPERIENCE_NOT_CHECKED");
  if(!e.status().equals("PUBLISHED")||!version.equals(e.publishedVersion()))throw new IdentityException(409,"EXPERIENCE_NOT_CURRENT");
  if(e.version().content().accessMode().equals("SOURCE_BOUND"))for(var ref:e.version().evidence())if(ref.kind().equals("TASK"))readableTask(t,ref.referenceId());
  return e;
 }
 private void trackExperience(Task t,ExperienceService.Entry e){
  if(e.version().content().accessMode().equals("SOURCE_BOUND")){
   for(var ref:e.version().evidence())if(ref.kind().equals("TASK"))datasets.inherit(t.id(),ref.referenceId());
   var deps=new LinkedHashSet<UUID>();for(var ref:e.version().evidence())if(ref.kind().equals("MATERIAL_VERSION"))deps.add(ref.referenceId());else deps.addAll(sourceVersions(ref.referenceId()));dependencies(t,deps);
  }
 }
 private Object experience(Task t,Request r,boolean record){
  var e=experienceEntry(t,r.referenceId(),r.versionId());trackExperience(t,e);
  if(record)record(t,"EXPERIENCE",e.id(),e.version().id().toString(),e.version());
  var c=e.version().content();int split=methodSplit(c.body());int offset=r.offset()==null?0:r.offset();if(offset!=0&&offset!=split||offset>=c.body().length())throw IdentityException.invalid();
  db.update("UPDATE task_context_reads SET read_parts=read_parts|? WHERE task_id=? AND attempt_number=? AND kind='EXPERIENCE' AND reference_id=?",offset==0?1:2,t.id(),t.attempt(),e.id());
  // Exact-version body pages keep even the largest editor value below callback limits.
  return map("entryId",e.id(),"versionId",e.version().id(),"number",e.version().number(),"kind",c.kind(),"title",c.title(),"summary",c.summary(),"body",c.body().substring(offset,Math.min(c.body().length(),offset==0?split:c.body().length())),"offset",offset,"nextOffset",offset==0&&split<c.body().length()?split:null,"truncated",offset>0||c.body().length()>8000,"applicable",c.applicable(),"excluded",c.excluded(),"dependencies",c.dependencies(),"basis",c.basis(),"origin",e.version().origin(),"evaluation",e.version().evaluation(),"authority",false,"requiresApplicabilityCheck",true);
 }
 private Object review(Task t,Request r){
  if(r.requestId()==null||r.decision()==null||!Set.of("DIRECT","ADAPTED","UNKNOWN","NOT_APPLICABLE").contains(r.decision()))throw IdentityException.invalid();
  String conditions=text(r.conditions(),1000,true),adjustments=text(r.adjustments(),1000,false);var e=experienceEntry(t,r.referenceId(),r.versionId());trackExperience(t,e);
  if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM task_context_reads WHERE task_id=? AND attempt_number=? AND kind='EXPERIENCE' AND reference_id=? AND version_key=?)",Boolean.class,t.id(),t.attempt(),e.id(),e.version().id().toString())))throw new IdentityException(409,"EXPERIENCE_READ_REQUIRED");
  int parts=db.queryForObject("SELECT read_parts FROM task_context_reads WHERE task_id=? AND attempt_number=? AND kind='EXPERIENCE' AND reference_id=?",Integer.class,t.id(),t.attempt(),e.id());
  if(Set.of("DIRECT","ADAPTED").contains(r.decision())&&(parts&1)==0 || Set.of("DIRECT","ADAPTED").contains(r.decision())&&e.version().content().body().length()>methodSplit(e.version().content().body())&&parts!=3)throw new IdentityException(409,"EXPERIENCE_METHOD_INCOMPLETE");
  String hash=IdentityService.hash(json.writeValueAsString(List.of(e.id(),r.versionId(),r.decision(),conditions,adjustments)));
  var prior=db.queryForList("SELECT * FROM task_context_reviews WHERE task_id=? AND attempt_number=? AND request_id=?",t.id(),t.attempt(),r.requestId());
  if(!prior.isEmpty()){if(!hash.equals(prior.getFirst().get("request_hash")))throw new IdentityException(409,"IDEMPOTENCY_CONFLICT");return reviewResult(prior.getFirst());}
  if(db.queryForObject("SELECT (SELECT count(*) FROM task_context_reviews WHERE task_id=? AND attempt_number=?)+(SELECT count(*) FROM task_general_experience_reviews WHERE task_id=? AND attempt_number=?)",Integer.class,t.id(),t.attempt(),t.id(),t.attempt())>=8)throw new IdentityException(413,"TASK_CONTEXT_LIMIT");
  UUID use=null;
  if(Set.of("DIRECT","ADAPTED").contains(r.decision())){
   var existing=db.queryForList("SELECT id,adopted FROM experience_uses WHERE actor_id=? AND task_id=? AND version_id=?",t.actor(),t.id(),r.versionId());
   if(existing.isEmpty())use=experiences.recordUse(t.actor(),t.tenant(),t.space(),e.id(),r.requestId(),new ExperienceService.UseInput(r.versionId(),t.id(),"task:"+t.id(),r.decision(),true,conditions,adjustments)).id();
   else if(Boolean.TRUE.equals(existing.getFirst().get("adopted")))use=(UUID)existing.getFirst().get("id");
   // A prior human "not adopted" report is immutable. The new attempt review records the new selection separately.
  }
  UUID id=UUID.randomUUID();db.update("INSERT INTO task_context_reviews(id,task_id,attempt_number,version_id,request_id,request_hash,decision,conditions,adjustments,use_id) VALUES (?,?,?,?,?,?,?,?,?,?)",id,t.id(),t.attempt(),r.versionId(),r.requestId(),hash,r.decision(),conditions,adjustments,use);
  return reviewResult(db.queryForList("SELECT * FROM task_context_reviews WHERE id=?",id).getFirst());
 }
 private Object reviewResult(Map<String,Object> r){return map("id",r.get("id"),"versionId",r.get("version_id"),"attempt",r.get("attempt_number"),"decision",r.get("decision"),"conditions",r.get("conditions"),"adjustments",r.get("adjustments"),"useId",r.get("use_id"),"selectionRecorded",Set.of("DIRECT","ADAPTED").contains(r.get("decision")),"libraryUseLinked",r.get("use_id")!=null,"assessmentSource","MODEL_REPORTED","applicationOutcome","UNKNOWN","businessActionPerformed",false);}
}
