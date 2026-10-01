package com.dreamcore.workspace.evaluation;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.objectlifecycle.ObjectLifecycleAccess;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Immutable, attributable checks and reviews. No operation executes or rewrites a business task. */
@Service
public class EvaluationService {
 public record Criterion(String key,String dimension,String strength,String check,String requirement) {}
 public record Content(String title,String purpose,String description,List<Criterion> criteria,String input,String expected,String observed,String unknowns) {}
 public record EvidenceSet(List<EvaluationAccess.Evidence> items) {}
 public record Version(UUID id,int revision,Content content,List<EvaluationAccess.Evidence> evidence,String originKey,String mode,Instant createdAt) {}
 public record Asset(UUID id,UUID tenantId,UUID workspaceId,String kind,int revision,String status,Version version) {}
 public record Assets(List<Asset> items,boolean hasMore,int nextOffset) {}
 public record Finding(UUID sampleVersion,String criterion,String dimension,String strength,String verdict,String basis,String note) {}
 public record Judgment(UUID sampleVersion,String criterion,String verdict,String note) {}
 public record Coverage(String dimension,int denominator,int pass,int fail,int unknown) {}
 public record Evaluation(UUID id,UUID tenantId,UUID workspaceId,UUID standardVersion,List<UUID> sampleVersions,UUID supersedes,UUID evaluator,Instant createdAt,String validity,List<String> modes,int uniqueOrigins,List<Coverage> coverage,List<Finding> findings,String businessQuality,String adoptionDecision) {}
 public record Evaluations(List<Evaluation> items,boolean hasMore,int nextOffset) {}
 public record EvidenceOption(EvaluationAccess.Evidence evidence,String title,String state,String mode) {}
 public record EvidenceOptions(List<EvidenceOption> items,boolean hasMore) {}
 public record Scope(UUID tenantId,UUID workspaceId,boolean canMaintain) {}
 public record AttemptResource(int attempt,String mode,String status,boolean meteringEnabled,Instant startedAt,Instant finishedAt,int registeredRequests,int reportedUsage,int pendingRequests,Long knownInputTokens,Long knownOutputTokens) {}
 public record EvidenceDetails(EvaluationAccess.Evidence evidence,String mode,String state,boolean exact,int sourceVersions,String resourceCoverage,List<AttemptResource> attempts,String costStatus) {}
 private final JdbcTemplate db;private final IdentityService identities;private final EvaluationAccess access;private final IdentityAudit audit;private final ObjectLifecycleAccess lifecycle;private final JsonMapper json=new JsonMapper();
 public EvaluationService(JdbcTemplate db,IdentityService identities,EvaluationAccess access,IdentityAudit audit,ObjectLifecycleAccess lifecycle){this.db=db;this.identities=identities;this.access=access;this.audit=audit;this.lifecycle=lifecycle;}
 public static String text(String s,int max,boolean required){if(s==null||s.length()>max||required&&s.isBlank()||s.codePoints().anyMatch(c->Character.isISOControl(c)&&c!=10&&c!=13&&c!=9))throw IdentityException.invalid();return s.strip();}
 private static int num(Map<String,Object> r,String key){return ((Number)r.get(key)).intValue();}
 private static Instant time(Object o){return ((java.sql.Timestamp)o).toInstant();}
 public static void bounds(int offset,int limit){if(offset<0||offset>100000||limit<1||limit>50)throw IdentityException.invalid();}
 private String hash(Object... x){return IdentityService.hash(json.writeValueAsString(x));}
 @Transactional public Scope scope(UUID actor,UUID tenant,UUID workspace){access.scope(actor,tenant,workspace,false);boolean write=true;try{access.scope(actor,tenant,workspace,true);}catch(IdentityException e){if(e.status!=403&&!e.code.equals("DEPARTURE_BUSINESS_STOPPED"))throw e;write=false;}return new Scope(tenant,workspace,write);}
 @Transactional public EvidenceDetails details(UUID actor,UUID tenant,UUID workspace,EvaluationAccess.Evidence e){access.scope(actor,tenant,workspace,false);var fact=access.evidence(actor,tenant,workspace,e);UUID task=e.kind().equals("TASK")?e.id():e.kind().equals("FEEDBACK")?db.queryForObject("SELECT task_id FROM feedback_entries WHERE id=?",UUID.class,e.id()):null;int attempt=e.kind().equals("FEEDBACK")?db.queryForObject("SELECT attempt FROM feedback_entries WHERE id=?",Integer.class,e.id()):e.attempt();var attempts=task==null?List.<AttemptResource>of():db.query("""
  SELECT a.*,count(r.sequence) registered,count(r.input_tokens) reported,count(*) FILTER(WHERE r.outcome='PENDING') pending,
   sum(r.input_tokens)::bigint known_input,sum(r.output_tokens)::bigint known_output
  FROM agent_attempt_usage a LEFT JOIN agent_model_requests r ON r.attempt_id=a.attempt_id
  WHERE a.task_id=? AND a.attempt_number=? GROUP BY a.attempt_id ORDER BY a.attempt_number
  """,(r,n)->new AttemptResource(r.getInt("attempt_number"),r.getString("execution_class"),r.getString("status"),r.getBoolean("metering_enabled"),r.getTimestamp("started_at").toInstant(),r.getTimestamp("finished_at")==null?null:r.getTimestamp("finished_at").toInstant(),r.getInt("registered"),r.getInt("reported"),r.getInt("pending"),r.getObject("known_input",Long.class),r.getObject("known_output",Long.class)),task,attempt);return new EvidenceDetails(e,fact.mode(),fact.state(),fact.exact(),fact.sources().size(),attempts.isEmpty()?"NOT_RECORDED":"ATTEMPT_LEDGER",attempts,"NOT_A_BILL");}
 private Content validate(String kind,Content c){
  if(c==null||c.criteria()==null||c.criteria().size()>20||!Set.of("STANDARD","SAMPLE").contains(kind)||c.purpose()==null||!Set.of("REGRESSION","DEVELOPMENT").contains(c.purpose()))throw IdentityException.invalid();
  var keys=new HashSet<String>();for(var k:c.criteria()){if(k==null||k.key()==null||!k.key().matches("[a-z][a-z0-9_]{0,39}")||!keys.add(k.key())||k.dimension()==null||!Set.of("FACT","CONTENT_QUALITY","USER_EFFECT","RUNTIME").contains(k.dimension())||k.strength()==null||!Set.of("REQUIRED","QUALITY","PREFERENCE").contains(k.strength())||k.check()==null||!Set.of("EVIDENCE_AVAILABLE","TASK_SUCCEEDED","SYNTHETIC_EQUALS","MANUAL").contains(k.check()))throw IdentityException.invalid();text(k.requirement(),1000,true);
   if(!k.check().equals("MANUAL")&&!((k.check().equals("TASK_SUCCEEDED")&&k.dimension().equals("RUNTIME"))||(k.check().equals("EVIDENCE_AVAILABLE")&&k.dimension().equals("FACT"))||(k.check().equals("SYNTHETIC_EQUALS")&&Set.of("FACT","CONTENT_QUALITY").contains(k.dimension()))))throw IdentityException.invalid();
  }
  if(kind.equals("STANDARD")==c.criteria().isEmpty())throw IdentityException.invalid();
  return new Content(text(c.title(),180,true),c.purpose(),text(c.description(),2000,true),List.copyOf(c.criteria()),text(c.input(),4000,false),text(c.expected(),4000,false),text(c.observed(),4000,false),text(c.unknowns(),2000,false));
 }
 private List<EvaluationAccess.Evidence> evidence(List<EvaluationAccess.Evidence> e){if(e==null||e.size()>20||new HashSet<>(e).size()!=e.size())throw IdentityException.invalid();return List.copyOf(e);}
 private Map<String,Object> row(UUID actor,UUID tenant,UUID id,boolean write,boolean lock){
  var rows=db.queryForList("SELECT * FROM evaluation_assets WHERE id=? AND tenant_id IS NOT DISTINCT FROM ?::uuid"+(lock?" FOR UPDATE":""),id,tenant);if(rows.isEmpty())throw access.missing();var r=rows.getFirst();access.scope(actor,tenant,(UUID)r.get("workspace_id"),write);return r;
 }
 private Version version(UUID actor,UUID tenant,UUID workspace,UUID id){
  var rows=db.queryForList("SELECT * FROM evaluation_asset_versions WHERE id=? AND NOT scrubbed AND object_is_active('EVALUATION_VERSION',id)",id);if(rows.isEmpty())throw access.missing();var r=rows.getFirst();var refs=json.readValue(r.get("evidence").toString(),EvidenceSet.class).items();for(var ref:refs)access.evidence(actor,tenant,workspace,ref);
  return new Version(id,num(r,"revision"),json.readValue(r.get("content").toString(),Content.class),refs,(String)r.get("origin_key"),(String)r.get("mode"),time(r.get("created_at")));
 }
 @Transactional public Asset get(UUID actor,UUID tenant,UUID id,Integer revision){var r=row(actor,tenant,id,false,false);int n=revision==null?num(r,"revision"):revision;var ids=db.queryForList("SELECT id FROM evaluation_asset_versions WHERE asset_id=? AND revision=?",UUID.class,id,n);if(ids.isEmpty())throw access.missing();return new Asset(id,tenant,(UUID)r.get("workspace_id"),(String)r.get("kind"),num(r,"revision"),(String)r.get("status"),version(actor,tenant,(UUID)r.get("workspace_id"),ids.getFirst()));}
 @Transactional public Asset byVersion(UUID actor,UUID tenant,UUID version){var refs=db.queryForList("SELECT asset_id,revision FROM evaluation_asset_versions WHERE id=?",version);if(refs.isEmpty())throw access.missing();var r=refs.getFirst();return get(actor,tenant,(UUID)r.get("asset_id"),num(r,"revision"));}
 private UUID append(UUID actor,UUID tenant,UUID workspace,UUID id,int revision,Content c,List<EvaluationAccess.Evidence> refs){
  var facts=refs.stream().map(e->access.evidence(actor,tenant,workspace,e)).toList();if(facts.stream().anyMatch(f->!f.exact()))throw new IdentityException(409,"EVALUATION_EVIDENCE_CHANGED");
  String origin=facts.isEmpty()?"synthetic:"+hash(c.input()):facts.stream().map(EvaluationAccess.Fact::origin).sorted().distinct().reduce((a,b)->a+"|"+b).orElseThrow();if(origin.length()>100)origin="combined:"+IdentityService.hash(origin);
  String mode=facts.isEmpty()?"SYNTHETIC":facts.stream().anyMatch(f->f.mode().equals("VERIFICATION"))?"VERIFICATION":facts.stream().allMatch(f->f.mode().equals("LIVE"))?"LIVE":facts.stream().allMatch(f->f.mode().equals("NO_MODEL"))?"NO_MODEL":"UNKNOWN";
  UUID v=UUID.randomUUID();db.update("INSERT INTO evaluation_asset_versions(id,asset_id,revision,content,evidence,origin_key,mode,created_by) VALUES (?,?,?,?::jsonb,?::jsonb,?,?,?)",v,id,revision,json.writeValueAsString(c),json.writeValueAsString(new EvidenceSet(refs)),origin,mode,actor);
  for(UUID source:facts.stream().flatMap(f->f.sources().stream()).distinct().toList())db.update("INSERT INTO evaluation_source_versions(asset_version,material_version) VALUES (?,?)",v,source);return v;
 }
 @Transactional public Asset create(UUID actor,UUID tenant,UUID workspace,UUID key,String kind,Content body,List<EvaluationAccess.Evidence> supplied){
  Content c=validate(kind,body);var refs=evidence(supplied);access.scope(actor,tenant,workspace,true);if(tenant==null&&!refs.isEmpty())throw IdentityException.invalid();String h=hash(tenant,workspace,kind,c,refs);UUID prior=identities.priorRequest(actor,key,"EVAL_CREATE",h);access.scope(actor,tenant,workspace,true);if(prior!=null)return byVersion(actor,tenant,prior);
  UUID id=UUID.randomUUID();db.update("INSERT INTO evaluation_assets(id,tenant_id,workspace_id,kind,created_by) VALUES (?,?,?,?,?)",id,tenant,workspace,kind,actor);UUID v=append(actor,tenant,workspace,id,1,c,refs);identities.remember(actor,key,"EVAL_CREATE",h,v);audit.record(actor,tenant,"EVALUATION_CREATE",id,"SUCCESS");return get(actor,tenant,id,null);
 }
 @Transactional public Asset revise(UUID actor,UUID tenant,UUID id,UUID key,int expected,Content body,List<EvaluationAccess.Evidence> supplied,boolean withdraw){
  var first=row(actor,tenant,id,true,false);get(actor,tenant,id,null);Content c=withdraw?get(actor,tenant,id,null).version().content():validate((String)first.get("kind"),body);var refs=withdraw?get(actor,tenant,id,null).version().evidence():evidence(supplied);String h=hash(tenant,id,expected,c,refs,withdraw);UUID prior=identities.priorRequest(actor,key,"EVAL_REVISE",h);var r=row(actor,tenant,id,true,true);if(prior!=null)return byVersion(actor,tenant,prior);if(num(r,"revision")!=expected)throw new IdentityException(409,"EVALUATION_VERSION_CONFLICT");
  UUID v;if(withdraw){ // Withdrawing stale evidence is permitted; it never adopts a new assertion.
   var old=get(actor,tenant,id,null).version();v=UUID.randomUUID();db.update("INSERT INTO evaluation_asset_versions(id,asset_id,revision,content,evidence,origin_key,mode,created_by) VALUES (?,?,?,?::jsonb,?::jsonb,?,?,?)",v,id,expected+1,json.writeValueAsString(c),json.writeValueAsString(new EvidenceSet(refs)),old.originKey(),old.mode(),actor);db.update("INSERT INTO evaluation_source_versions SELECT ?,material_version FROM evaluation_source_versions WHERE asset_version=?",v,old.id());
  }else v=append(actor,tenant,(UUID)r.get("workspace_id"),id,expected+1,c,refs);
  db.update("UPDATE evaluation_assets SET revision=?,status=? WHERE id=?",expected+1,withdraw?"WITHDRAWN":"ACTIVE",id);identities.remember(actor,key,"EVAL_REVISE",h,v);audit.record(actor,tenant,withdraw?"EVALUATION_WITHDRAW":"EVALUATION_REVISE",id,"SUCCESS");return get(actor,tenant,id,null);
 }
 @Transactional public Assets list(UUID actor,UUID tenant,UUID workspace,String kind,int offset,int limit){
  bounds(offset,limit);access.scope(actor,tenant,workspace,false);if(!Set.of("STANDARD","SAMPLE").contains(kind))throw IdentityException.invalid();var ids=db.queryForList("SELECT id FROM evaluation_assets WHERE tenant_id IS NOT DISTINCT FROM ?::uuid AND workspace_id IS NOT DISTINCT FROM ?::uuid AND kind=? ORDER BY created_at DESC,id LIMIT 1001",UUID.class,tenant,workspace,kind);if(ids.size()>1000)throw new IdentityException(409,"EVALUATION_SCOPE_WINDOW_LIMIT");var out=new ArrayList<Asset>();for(UUID id:ids)try{out.add(get(actor,tenant,id,null));}catch(IdentityException ex){if(ex.status!=404&&ex.status!=403)throw ex;}return new Assets(out.stream().skip(offset).limit(limit).toList(),out.size()>offset+limit,Math.min(out.size(),offset+limit));
 }
 private void same(UUID workspace,Asset a,String kind){if(!Objects.equals(workspace,a.workspaceId())||!kind.equals(a.kind()))throw IdentityException.invalid();}
 private boolean current(UUID actor,UUID tenant,Asset a){return a.status().equals("ACTIVE")&&a.revision()==a.version().revision()&&a.version().evidence().stream().allMatch(e->access.evidence(actor,tenant,a.workspaceId(),e).exact());}
 private Finding check(UUID actor,UUID tenant,UUID workspace,Version s,Criterion c){
  String verdict="UNKNOWN",basis="MISSING",note="尚无足够依据；未调用评价模型。";
  switch(c.check()){
   case "EVIDENCE_AVAILABLE"->{if(!s.evidence().isEmpty()){verdict=s.evidence().stream().allMatch(e->access.evidence(actor,tenant,workspace,e).exact())?"PASS":"UNKNOWN";basis="PROGRAM";note="仅核对引用可读及所选版本当前有效，不证明资料真实性。";}}
   case "TASK_SUCCEEDED"->{var tasks=s.evidence().stream().filter(e->e.kind().equals("TASK")).toList();if(!tasks.isEmpty()){verdict=tasks.stream().allMatch(e->access.evidence(actor,tenant,workspace,e).state().equals("SUCCEEDED"))?"PASS":"FAIL";basis="PROGRAM";note="仅检查原任务运行状态，不表示内容正确或业务目标达成。";}}
   case "SYNTHETIC_EQUALS"->{if(s.mode().equals("SYNTHETIC")&&!s.content().expected().isBlank()){verdict=s.content().expected().equals(s.content().observed())?"PASS":"FAIL";basis="PROGRAM";note="合成固定样例的确切文本核对；不代表模型能力或业务质量。";}}
   default->{}
  }
  return new Finding(s.id(),c.key(),c.dimension(),c.strength(),verdict,basis,note);
 }
 @Transactional public Evaluation evaluate(UUID actor,UUID tenant,UUID workspace,UUID key,UUID standard,List<UUID> sampleVersions,UUID supersedes,List<Judgment> judgments){
  access.scope(actor,tenant,workspace,true);if(sampleVersions==null||sampleVersions.isEmpty()||sampleVersions.size()>50||new HashSet<>(sampleVersions).size()!=sampleVersions.size()||judgments==null||judgments.size()>1000)throw IdentityException.invalid();String h=hash(tenant,workspace,standard,sampleVersions,supersedes,judgments);UUID prior=identities.priorRequest(actor,key,"EVAL_RUN",h);access.scope(actor,tenant,workspace,true);if(prior!=null)return evaluation(actor,tenant,prior);
  Asset a=byVersion(actor,tenant,standard);same(workspace,a,"STANDARD");if(!current(actor,tenant,a))throw new IdentityException(409,"EVALUATION_STANDARD_CHANGED");var samples=sampleVersions.stream().map(v->byVersion(actor,tenant,v)).toList();var origins=new HashSet<String>();for(var s:samples){same(workspace,s,"SAMPLE");if(!current(actor,tenant,s))throw new IdentityException(409,"EVALUATION_SAMPLE_CHANGED");var keys=s.version().evidence().isEmpty()?List.of(s.version().originKey()):s.version().evidence().stream().map(e->access.evidence(actor,tenant,workspace,e).origin()).distinct().toList();for(String origin:keys)if(!origins.add(origin))throw new IdentityException(409,"EVALUATION_DUPLICATE_ORIGIN");}
  if(supersedes!=null){var old=evaluation(actor,tenant,supersedes);if(!old.standardVersion().equals(standard)||!new HashSet<>(old.sampleVersions()).equals(new HashSet<>(sampleVersions)))throw new IdentityException(409,"EVALUATION_REVIEW_NOT_COMPARABLE");}
  var decisions=new HashMap<String,Judgment>();for(var j:judgments){if(j==null||j.verdict()==null||!Set.of("PASS","FAIL","UNKNOWN").contains(j.verdict())||!sampleVersions.contains(j.sampleVersion())||a.version().content().criteria().stream().noneMatch(c->c.key().equals(j.criterion())&&c.check().equals("MANUAL"))||decisions.put(j.sampleVersion()+":"+j.criterion(),j)!=null)throw IdentityException.invalid();text(j.note(),2000,true);}
  UUID id=UUID.randomUUID();db.update("INSERT INTO evaluation_runs(id,tenant_id,workspace_id,standard_version,supersedes,created_by) VALUES (?,?,?,?,?,?)",id,tenant,workspace,standard,supersedes,actor);
  for(var s:samples){db.update("INSERT INTO evaluation_run_samples(run_id,version_id) VALUES (?,?)",id,s.version().id());for(var c:a.version().content().criteria()){var f=check(actor,tenant,workspace,s.version(),c);var j=decisions.get(s.version().id()+":"+c.key());if(j!=null)f=new Finding(s.version().id(),c.key(),c.dimension(),c.strength(),j.verdict(),"HUMAN",j.note());db.update("INSERT INTO evaluation_findings(run_id,sample_version,criterion,dimension,strength,verdict,basis,note) VALUES (?,?,?,?,?,?,?,?)",id,f.sampleVersion(),f.criterion(),f.dimension(),f.strength(),f.verdict(),f.basis(),f.note());}}
  identities.remember(actor,key,"EVAL_RUN",h,id);audit.record(actor,tenant,"EVALUATION_RUN",id,"SUCCESS");return evaluation(actor,tenant,id);
 }
 @Transactional public Evaluation evaluation(UUID actor,UUID tenant,UUID id){
  var rows=db.queryForList("SELECT * FROM evaluation_runs WHERE id=? AND tenant_id IS NOT DISTINCT FROM ?::uuid",id,tenant);if(rows.isEmpty())throw access.missing();var r=rows.getFirst();UUID workspace=(UUID)r.get("workspace_id");access.scope(actor,tenant,workspace,false);
  var sampleIds=db.queryForList("SELECT version_id FROM evaluation_run_samples WHERE run_id=? ORDER BY version_id",UUID.class,id);var all=new ArrayList<>(sampleIds);all.add((UUID)r.get("standard_version"));
  boolean details=Boolean.TRUE.equals(db.queryForObject("SELECT object_is_active('EVALUATION_RUN',?)",Boolean.class,id));for(UUID v:all)details&=Boolean.TRUE.equals(db.queryForObject("SELECT NOT scrubbed AND object_is_active('EVALUATION_VERSION',id) FROM evaluation_asset_versions WHERE id=?",Boolean.class,v));
  boolean valid=true;var modes=new TreeSet<String>();var origins=new HashSet<String>();
  if(details){var standard=byVersion(actor,tenant,(UUID)r.get("standard_version"));valid=current(actor,tenant,standard);for(UUID v:sampleIds){var asset=byVersion(actor,tenant,v);valid&=current(actor,tenant,asset);modes.add(asset.version().mode());origins.add(asset.version().originKey());}}
  else { // Minimal historical verdicts remain, but never restore removed text or private-source authority.
   lifecycle.require(actor,tenant,lifecycle.source("EVALUATION_RUN",id),false);
   for(UUID v:sampleIds){var meta=db.queryForMap("SELECT mode,origin_key FROM evaluation_asset_versions WHERE id=?",v);modes.add((String)meta.get("mode"));origins.add((String)meta.get("origin_key"));}
  }
  final boolean includeNotes=details;
  var findings=db.query("SELECT * FROM evaluation_findings WHERE run_id=? ORDER BY sample_version,criterion",(f,n)->new Finding(f.getObject("sample_version",UUID.class),f.getString("criterion"),f.getString("dimension"),f.getString("strength"),f.getString("verdict"),f.getString("basis"),includeNotes?f.getString("note"):""),id);
  var coverage=new ArrayList<Coverage>();for(String d:List.of("FACT","CONTENT_QUALITY","USER_EFFECT","RUNTIME")){var fs=findings.stream().filter(f->f.dimension().equals(d)).toList();coverage.add(new Coverage(d,fs.size(),(int)fs.stream().filter(f->f.verdict().equals("PASS")).count(),(int)fs.stream().filter(f->f.verdict().equals("FAIL")).count(),(int)fs.stream().filter(f->f.verdict().equals("UNKNOWN")).count()));}
  boolean revised=Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM evaluation_runs WHERE supersedes=?)",Boolean.class,id));return new Evaluation(id,tenant,workspace,(UUID)r.get("standard_version"),sampleIds,(UUID)r.get("supersedes"),(UUID)r.get("created_by"),time(r.get("created_at")),!details?"DETAILS_UNAVAILABLE":!valid?"STALE":revised?"SUPERSEDED":"CURRENT",List.copyOf(modes),origins.size(),coverage,findings,"NOT_VALIDATED","NOT_MADE");
 }
 @Transactional public Evaluations evaluations(UUID actor,UUID tenant,UUID workspace,int offset,int limit){bounds(offset,limit);access.scope(actor,tenant,workspace,false);var ids=db.queryForList("SELECT id FROM evaluation_runs WHERE tenant_id IS NOT DISTINCT FROM ?::uuid AND workspace_id IS NOT DISTINCT FROM ?::uuid ORDER BY created_at DESC,id LIMIT 1001",UUID.class,tenant,workspace);if(ids.size()>1000)throw new IdentityException(409,"EVALUATION_SCOPE_WINDOW_LIMIT");var out=new ArrayList<Evaluation>();for(UUID id:ids)try{out.add(evaluation(actor,tenant,id));}catch(IdentityException ex){if(ex.status!=403&&ex.status!=404)throw ex;}return new Evaluations(out.stream().skip(offset).limit(limit).toList(),out.size()>offset+limit,Math.min(out.size(),offset+limit));}
 @Transactional public EvidenceOptions options(UUID actor,UUID tenant,UUID workspace,String kind,int offset,int limit){
  bounds(offset,limit);access.scope(actor,tenant,workspace,false);if(tenant==null)throw IdentityException.invalid();List<Map<String,Object>> rows;
  switch(kind){
   case "TASK"->rows=db.queryForList("SELECT t.id,t.revision,t.attempt,t.prompt title FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id WHERE t.tenant_id=? AND t.workspace_id=? AND c.owner_id=? AND EXISTS(SELECT 1 FROM readable_source_tasks rst WHERE rst.id=t.id) ORDER BY t.created_at DESC,t.id LIMIT 1001",tenant,workspace,actor);
   case "FEEDBACK"->rows=db.queryForList("SELECT id,revision,0 attempt,'本人针对确切内容版本的反馈' title FROM feedback_entries WHERE tenant_id=? AND workspace_id=? AND actor_id=? AND EXISTS(SELECT 1 FROM readable_feedback rf WHERE rf.id=feedback_entries.id) AND (kind='PUBLICATION' OR EXISTS(SELECT 1 FROM readable_source_tasks rt WHERE rt.id=feedback_entries.task_id)) ORDER BY created_at DESC,id LIMIT 1001",tenant,workspace,actor);
   case "MATERIAL_VERSION"->rows=db.queryForList("SELECT v.id,v.number revision,0 attempt,v.filename title FROM material_versions v JOIN active_materials m ON m.id=v.material_id WHERE v.tenant_id=? AND v.workspace_id=? ORDER BY v.created_at DESC,v.id LIMIT 1001",tenant,workspace);
   default->throw IdentityException.invalid();
  }
  if(rows.size()>1000)throw new IdentityException(409,"EVALUATION_SCOPE_WINDOW_LIMIT");var result=new ArrayList<EvidenceOption>();for(var r:rows)try{var e=new EvaluationAccess.Evidence(kind,(UUID)r.get("id"),num(r,"revision"),num(r,"attempt"));var f=access.evidence(actor,tenant,workspace,e);if(f.exact())result.add(new EvidenceOption(e,(String)r.get("title"),f.state(),f.mode()));}catch(IdentityException ex){if(ex.status!=403&&ex.status!=404)throw ex;}return new EvidenceOptions(result.stream().skip(offset).limit(limit).toList(),result.size()>offset+limit);
 }
}
