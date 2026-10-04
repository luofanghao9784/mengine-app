package com.dreamcore.workspace.profile;

import com.dreamcore.workspace.identity.*;
import com.dreamcore.workspace.governance.GovernanceAccess;
import com.dreamcore.workspace.departure.DepartureAccess;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** Internal extraction receipts and human conflict choices; model text never grants authority. */
@Service
public class CompanyInferenceService {
 public record Input(UUID chunkId,UUID versionId,String filename,String locator,String text) {}
 public record Job(UUID id,UUID lease,UUID tenant,List<Input> inputs,List<CompanyInformationService.Group> groups) {}
 public record Evidence(UUID chunkId,String quote) {}
 public record Candidate(CompanyInformationService.Field field,UUID targetId,String label,String meaning,List<Evidence> evidence) {}
 public record Source(UUID chunkId,UUID versionId,String filename,String locator,String quote) {}
 public record Suggestion(UUID id,int revision,CompanyInformationService.Field field,UUID targetId,String label,String meaning,Instant createdAt,List<Source> evidence) {}
 public record Decision(UUID requestId,Integer expectedRevision,Integer expectedGroupRevision,String action) {}
 public record Receipt(UUID requestId,UUID suggestionId,String action,int revision) {}
 private final JdbcTemplate db;private final IdentityService identities;private final GovernanceAccess access;private final DepartureAccess departure;private final CompanyInformationService information;private final IdentityAudit audit;
 private final JsonMapper json=new JsonMapper();
 public CompanyInferenceService(JdbcTemplate db,IdentityService identities,GovernanceAccess access,DepartureAccess departure,CompanyInformationService information,IdentityAudit audit){this.db=db;this.identities=identities;this.access=access;this.departure=departure;this.information=information;this.audit=audit;}
 private void read(UUID actor,UUID tenant){identities.member(actor,tenant,false);departure.requirePrivateRead(actor,tenant);}
 private void write(UUID actor,UUID tenant){read(actor,tenant);departure.requireActiveBusiness(actor,tenant);access.require(actor,tenant,GovernanceAccess.Capability.PROFILE_MAINTAIN,null);}
 private void lock(UUID tenant,CompanyInformationService.Field field){db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","company-information:"+tenant+":"+field);db.update("INSERT INTO company_information_groups(tenant_id,field) VALUES (?,?) ON CONFLICT DO NOTHING",tenant,field.name());}
 private IdentityException unavailable(){return new IdentityException(409,"COMPANY_INFERENCE_UNAVAILABLE");}
 private boolean readable(UUID run){return Boolean.TRUE.equals(db.queryForObject("SELECT company_inference_readable(?)",Boolean.class,run));}

 /** Called by a platform worker, not a client endpoint. All model inputs are fixed here. */
 @Transactional public Job begin(UUID actor,UUID tenant,List<UUID> chunks){
  write(actor,tenant);
  if(chunks==null||chunks.isEmpty()||chunks.size()>5||chunks.stream().anyMatch(Objects::isNull)||new HashSet<>(chunks).size()!=chunks.size())throw IdentityException.invalid();
  var inputs=new ArrayList<Input>();
  for(UUID chunk:chunks){
   var values=db.query("SELECT c.*,v.filename FROM knowledge_chunks c JOIN material_versions v ON v.id=c.version_id WHERE c.id=? AND c.tenant_id=? AND company_chunk_eligible(c.id)",(r,n)->new Input(r.getObject("id",UUID.class),r.getObject("version_id",UUID.class),r.getString("filename"),r.getString("locator"),r.getString("content")),chunk,tenant);
   if(values.isEmpty())throw unavailable();inputs.add(values.getFirst());
  }
  var groups=information.get(actor,tenant).groups();var revisions=new LinkedHashMap<String,Integer>();for(var g:groups)revisions.put(g.field().name(),g.revision());
  UUID id=UUID.randomUUID(),lease=UUID.randomUUID();
  db.update("INSERT INTO company_inference_runs(id,tenant_id,actor_id,state,lease_token,lease_until,group_revisions) VALUES (?,?,?,'RUNNING',?,now()+interval '90 seconds',?::jsonb)",id,tenant,actor,lease,json.writeValueAsString(revisions));
  for(UUID chunk:chunks)db.update("INSERT INTO company_inference_inputs(run_id,chunk_id) VALUES (?,?)",id,chunk);
  // Current AI labels supplied to the model carry their own sources even when those raw texts are not sent.
  db.update("INSERT INTO company_inference_inputs(run_id,chunk_id,model_visible) SELECT ?,i.chunk_id,false FROM company_information_tags t JOIN profile_entries e ON e.id=t.profile_id JOIN profile_versions v ON v.entry_id=e.id AND v.revision=e.revision JOIN company_profile_inferences p ON p.version_id=v.id JOIN company_inference_inputs i ON i.run_id=p.run_id WHERE t.tenant_id=? AND v.status='ACTIVE' AND NOT v.scrubbed AND object_is_active('PROFILE_VERSION',v.id) AND company_profile_readable(v.id) ON CONFLICT DO NOTHING",id,tenant);
  if(!readable(id)||db.queryForObject("SELECT count(*) FROM company_inference_inputs WHERE run_id=?",Integer.class,id)>256)throw unavailable();
  return new Job(id,lease,tenant,inputs,groups);
 }
 private String text(String v,int max){if(v==null)return "";v=v.strip();if(v.length()>max||v.codePoints().anyMatch(c->Character.isISOControl(c)&&c!=10))throw IdentityException.invalid();return v;}
 private UUID apply(UUID actor,UUID tenant,UUID run,Candidate c,boolean human){
  UUID target=c.targetId(),version=UUID.randomUUID();int revision=1;
  if(target==null){
   target=UUID.randomUUID();
   db.update("INSERT INTO profile_entries(id,tenant_id,scope,entry_key,kind,created_by) VALUES (?,?,'TENANT',?,'INFERENCE',?)",target,tenant,"company."+c.field().name().toLowerCase(Locale.ROOT)+"."+target,actor);
   db.update("INSERT INTO company_information_tags(profile_id,tenant_id,field,origin,human_protected) VALUES (?,?,?,'AI',?)",target,tenant,c.field().name(),human);
  }else{
   revision=db.queryForObject("SELECT revision FROM profile_entries WHERE id=? FOR UPDATE",Integer.class,target)+1;
   db.update("UPDATE profile_entries SET revision=?,kind='INFERENCE' WHERE id=?",revision,target);
   db.update("UPDATE company_information_tags SET origin='AI',human_protected=? WHERE profile_id=?",human,target);
  }
  db.update("INSERT INTO profile_versions(id,tenant_id,entry_id,revision,value,provenance,status,changed_by) VALUES (?,?,?,?,?,?,'ACTIVE',?)",version,tenant,target,revision,json.writeValueAsString(Map.of("label",c.label(),"meaning",c.meaning())),human?"人工采用 AI 建议":"AI 根据获准资料整理",actor);
  db.update("INSERT INTO company_profile_inferences(version_id,run_id) VALUES (?,?)",version,run);
  db.update("UPDATE company_information_groups SET revision=revision+1,manually_cleared=false,protect_new_inferences=protect_new_inferences OR ? WHERE tenant_id=? AND field=?",human,tenant,c.field().name());
  return target;
 }
 private boolean room(UUID tenant,CompanyInformationService.Field field){return db.queryForObject("SELECT count(*) FROM company_information_tags t JOIN profile_entries e ON e.id=t.profile_id JOIN profile_versions v ON v.entry_id=e.id AND v.revision=e.revision WHERE t.tenant_id=? AND t.field=? AND v.status='ACTIVE' AND NOT v.scrubbed AND object_is_active('PROFILE_VERSION',v.id) AND company_profile_readable(v.id)",Integer.class,tenant,field.name())<(field==CompanyInformationService.Field.NAME?1:30);}

 @Transactional public void finish(UUID run,UUID lease,List<Candidate> candidates){
  var rows=db.queryForList("SELECT * FROM company_inference_runs WHERE id=?",run);if(rows.isEmpty())throw unavailable();var row=rows.getFirst();
  UUID tenant=(UUID)row.get("tenant_id"),actor=(UUID)row.get("actor_id");write(actor,tenant);
  // Match manual edits' lock order: tenant identity, group, profile. Never call the model in a transaction.
  for(var f:CompanyInformationService.Field.values())lock(tenant,f);
  row=db.queryForMap("SELECT *,lease_until>clock_timestamp() AS valid_lease FROM company_inference_runs WHERE id=? FOR UPDATE",run);
  if(!lease.equals(row.get("lease_token"))||!"RUNNING".equals(row.get("state"))||!Boolean.TRUE.equals(row.get("valid_lease"))||!readable(run))throw unavailable();
  if(candidates==null||candidates.size()>12)throw IdentityException.invalid();
  var baseline=json.readTree(row.get("group_revisions").toString());
  var changed=new HashMap<CompanyInformationService.Field,Boolean>();
  for(var f:CompanyInformationService.Field.values())changed.put(f,db.queryForObject("SELECT revision FROM company_information_groups WHERE tenant_id=? AND field=?",Integer.class,tenant,f.name())!=baseline.get(f.name()).asInt());
  var seen=new HashSet<String>();
  for(Candidate raw:candidates){
   if(raw==null||raw.field()==null||raw.evidence()==null||raw.evidence().isEmpty()||raw.evidence().size()>5)throw IdentityException.invalid();
   var current=information.get(actor,tenant).groups().stream().filter(g->g.field()==raw.field()).findFirst().orElseThrow();
   UUID targetId=raw.targetId();
   if(targetId==null&&raw.field()==CompanyInformationService.Field.NAME&&!current.tags().isEmpty())targetId=current.tags().getFirst().id();
   var c=new Candidate(raw.field(),targetId,text(raw.label(),160),text(raw.meaning(),1000),raw.evidence());
   if(c.label().isBlank()||c.field()!=CompanyInformationService.Field.TERM&&!c.meaning().isEmpty()||!seen.add(c.field()+":"+(c.targetId()==null?c.label().toLowerCase(Locale.ROOT):c.targetId())))throw IdentityException.invalid();
   var evidence=new ArrayList<Object[]>();var seenChunks=new HashSet<UUID>();
   for(var e:c.evidence()){
    if(e==null||e.chunkId()==null||e.quote()==null||e.quote().isBlank()||e.quote().length()>1000||!seenChunks.add(e.chunkId()))throw IdentityException.invalid();
    var text=db.queryForList("SELECT c.content FROM company_inference_inputs i JOIN knowledge_chunks c ON c.id=i.chunk_id WHERE i.run_id=? AND c.id=? AND i.model_visible",String.class,run,e.chunkId());
    int position=text.isEmpty()?-1:text.getFirst().indexOf(e.quote());if(position<0)throw new IdentityException(422,"COMPANY_EVIDENCE_INVALID");
    evidence.add(new Object[]{e.chunkId(),text.getFirst().codePointCount(0,position),e.quote().codePointCount(0,e.quote().length())});
   }
   var target=c.targetId()==null?null:current.tags().stream().filter(t->t.id().equals(c.targetId())).findFirst().orElse(null);
   // No resurrection of removed targets or invented cross-field identities.
   if(c.targetId()!=null&&target==null)continue;
   if(current.tags().stream().anyMatch(t->!t.id().equals(c.targetId())&&t.label().equalsIgnoreCase(c.label())&&t.meaning().equals(c.meaning())))continue;
   if(target!=null&&target.label().equals(c.label())&&target.meaning().equals(c.meaning()))continue;
   boolean protectedNew=Boolean.TRUE.equals(db.queryForObject("SELECT protect_new_inferences FROM company_information_groups WHERE tenant_id=? AND field=?",Boolean.class,tenant,c.field().name()));
   boolean automatic=!changed.get(c.field())&&!current.manuallyCleared()&&(target==null?!protectedNew&&room(tenant,c.field()):target.origin().equals("AI")&&!target.humanProtected());
   UUID suggestion=UUID.randomUUID();
   db.update("INSERT INTO company_information_suggestions(id,tenant_id,run_id,field,target_id,label,meaning,state) VALUES (?,?,?,?,?,?,?,?)",suggestion,tenant,run,c.field().name(),c.targetId(),c.label(),c.meaning(),automatic?"APPLIED":"PENDING");
   for(var e:evidence)db.update("INSERT INTO company_suggestion_evidence(suggestion_id,chunk_id,quote_start,quote_length) VALUES (?,?,?,?)",suggestion,e[0],e[1],e[2]);
   if(automatic){UUID profile=apply(actor,tenant,run,c,false);db.update("UPDATE company_information_suggestions SET target_id=? WHERE id=?",profile,suggestion);}
  }
  db.update("UPDATE company_inference_runs SET state='SUCCEEDED',finished_at=now() WHERE id=?",run);
 }
 @Transactional public List<Suggestion> suggestions(UUID actor,UUID tenant){
  write(actor,tenant);
  return db.query("SELECT * FROM company_information_suggestions WHERE tenant_id=? AND state='PENDING' AND NOT scrubbed AND company_inference_readable(run_id) ORDER BY created_at,id LIMIT 100",(r,n)->{
   UUID id=r.getObject("id",UUID.class);var evidence=db.query("SELECT c.id,c.version_id,v.filename,c.locator,substring(c.content from e.quote_start+1 for e.quote_length) AS quote FROM company_suggestion_evidence e JOIN knowledge_chunks c ON c.id=e.chunk_id JOIN material_versions v ON v.id=c.version_id WHERE e.suggestion_id=? ORDER BY c.id",(s,j)->new Source(s.getObject("id",UUID.class),s.getObject("version_id",UUID.class),s.getString("filename"),s.getString("locator"),s.getString("quote")),id);
   return new Suggestion(id,r.getInt("revision"),CompanyInformationService.Field.valueOf(r.getString("field")),r.getObject("target_id",UUID.class),r.getString("label"),r.getString("meaning"),r.getTimestamp("created_at").toInstant(),evidence);
  },tenant);
 }
 @Transactional public List<Source> evidence(UUID actor,UUID tenant,UUID tag,int revision){
  read(actor,tenant);
  if(revision<1)throw IdentityException.invalid();
  var version=db.queryForList("SELECT v.id FROM company_information_tags t JOIN profile_versions v ON v.entry_id=t.profile_id WHERE t.tenant_id=? AND t.profile_id=? AND v.revision=? AND NOT v.scrubbed AND object_is_active('PROFILE_VERSION',v.id) AND company_profile_readable(v.id)",UUID.class,tenant,tag,revision);
  if(version.isEmpty())throw new IdentityException(404,"PROFILE_VERSION_NOT_FOUND");
  return db.query("SELECT DISTINCT c.id,c.version_id,v.filename,c.locator,substring(c.content from e.quote_start+1 for e.quote_length) AS quote FROM company_profile_inferences p JOIN company_information_suggestions s ON s.run_id=p.run_id AND s.target_id=? JOIN company_suggestion_evidence e ON e.suggestion_id=s.id JOIN knowledge_chunks c ON c.id=e.chunk_id JOIN material_versions v ON v.id=c.version_id WHERE p.version_id=? AND NOT s.scrubbed ORDER BY c.id",(r,n)->new Source(r.getObject("id",UUID.class),r.getObject("version_id",UUID.class),r.getString("filename"),r.getString("locator"),r.getString("quote")),tag,version.getFirst());
 }
 @Transactional public Receipt decide(UUID actor,UUID tenant,UUID suggestion,Decision d){
  if(d==null||d.requestId()==null||d.expectedRevision()==null||d.expectedGroupRevision()==null||d.expectedRevision()<1||d.expectedGroupRevision()<0||!Set.of("ADOPT","KEEP").contains(Objects.toString(d.action(),"")))throw IdentityException.invalid();write(actor,tenant);
  var found=db.queryForList("SELECT * FROM company_information_suggestions WHERE tenant_id=? AND id=?",tenant,suggestion);if(found.isEmpty())throw new IdentityException(404,"COMPANY_SUGGESTION_NOT_FOUND");
  var field=CompanyInformationService.Field.valueOf((String)found.getFirst().get("field"));lock(tenant,field);
  String hash=IdentityService.hash(json.writeValueAsString(new Object[]{tenant,suggestion,d.expectedRevision(),d.expectedGroupRevision(),d.action()}));
  UUID prior=identities.priorRequest(actor,d.requestId(),"COMPANY_SUGGESTION",hash);if(prior!=null)return new Receipt(d.requestId(),suggestion,d.action(),d.expectedRevision()+1);
  var row=db.queryForMap("SELECT * FROM company_information_suggestions WHERE id=? FOR UPDATE",suggestion);
  UUID run=(UUID)row.get("run_id"),target=(UUID)row.get("target_id");
  if(!"PENDING".equals(row.get("state"))||!Objects.equals(row.get("revision"),d.expectedRevision())||Boolean.TRUE.equals(row.get("scrubbed"))||!readable(run))throw unavailable();
  var group=information.get(actor,tenant).groups().stream().filter(g->g.field()==field).findFirst().orElseThrow();
  if(group.revision()!=d.expectedGroupRevision())throw new IdentityException(409,"PROFILE_VERSION_CONFLICT");
  if(target!=null&&group.tags().stream().noneMatch(t->t.id().equals(target)))throw unavailable();
  if(d.action().equals("ADOPT")){
   if(target==null&&!room(tenant,field))throw new IdentityException(409,"COMPANY_TAG_LIMIT");
   UUID applied=apply(actor,tenant,run,new Candidate(field,target,(String)row.get("label"),(String)row.get("meaning"),List.of()),true);db.update("UPDATE company_information_suggestions SET target_id=? WHERE id=?",applied,suggestion);
  }else{
   if(target!=null)db.update("UPDATE company_information_tags SET human_protected=true WHERE profile_id=?",target);
   db.update("UPDATE company_information_groups SET revision=revision+1,protect_new_inferences=true WHERE tenant_id=? AND field=?",tenant,field.name());
  }
  db.update("UPDATE company_information_suggestions SET state=?,revision=revision+1 WHERE id=?",d.action().equals("ADOPT")?"APPLIED":"KEPT",suggestion);
  identities.remember(actor,d.requestId(),"COMPANY_SUGGESTION",hash,suggestion);audit.record(actor,tenant,"COMPANY_INFORMATION_"+d.action(),suggestion,"SUCCESS");
  return new Receipt(d.requestId(),suggestion,d.action(),d.expectedRevision()+1);
 }
}
