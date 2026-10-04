package com.dreamcore.workspace.experience;
import com.dreamcore.workspace.identity.*;
import java.util.*;import java.time.Instant;
import org.springframework.jdbc.core.JdbcTemplate;import org.springframework.stereotype.Service;import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** A maintainer's correction is an input to automatic checking, never an approval or a published version. */
@Service
public class ExperienceAdjustmentService {
 public record Proposal(String title,String summary,String body,List<String> tags,String applicable,String excluded,String reason) {}
 public record Adjustment(UUID id,UUID versionId,String state,UUID resultVersionId,Instant createdAt) {}
 public record Page(boolean enabled,List<Adjustment> items) {}
 private final JdbcTemplate db;private final ExperienceService experiences;private final IdentityService identities;private final IdentityAudit audit;private final JsonMapper json=new JsonMapper();
 public ExperienceAdjustmentService(JdbcTemplate db,ExperienceService experiences,IdentityService identities,IdentityAudit audit){this.db=db;this.experiences=experiences;this.identities=identities;this.audit=audit;}
 private Proposal normalize(Proposal p){
  if(p==null||p.reason()==null||p.reason().isBlank()||p.reason().length()>2000||p.reason().codePoints().anyMatch(c->Character.isISOControl(c)&&c!=10&&c!=13&&c!=9))throw IdentityException.invalid();
  var c=experiences.automaticContent(new ExperienceService.Content("METHOD",p.title(),p.summary(),p.body(),p.tags(),p.applicable(),p.excluded(),"","待系统核验的调整建议","SOURCE_BOUND"));
  return new Proposal(c.title(),c.summary(),c.body(),c.tags(),c.applicable(),c.excluded(),p.reason().strip());
 }
 private Adjustment project(UUID actor,UUID tenant,UUID space,UUID entry,UUID id){
  var rows=db.queryForList("SELECT * FROM experience_adjustments WHERE id=? AND actor_id=? AND tenant_id=? AND workspace_id=? AND entry_id=?",id,actor,tenant,space,entry);if(rows.isEmpty())throw new IdentityException(404,"EXPERIENCE_ADJUSTMENT_NOT_FOUND");var a=rows.getFirst();
  var r=db.queryForMap("SELECT * FROM ("+ExperienceManagementService.PROCESSING+") p WHERE id=?",tenant,new UUID[]{space},id);UUID result=(UUID)r.get("version_id");
  if(result!=null)try{experiences.analysisEntry(actor,tenant,space,entry,result);}catch(IdentityException unavailable){result=null;}
  return new Adjustment(id,(UUID)a.get("version_id"),(String)r.get("state"),result,((java.sql.Timestamp)a.get("created_at")).toInstant());
 }
 @Transactional public Page list(UUID actor,UUID tenant,UUID space,UUID entry,boolean enabled){
  experiences.adjustmentScope(actor,tenant,space);
  var versions=db.queryForList("SELECT coalesce(e.published_version,(SELECT x.version_id FROM experience_events x WHERE x.entry_id=e.id AND x.action='PUBLISHED' ORDER BY x.revision DESC,x.created_at DESC LIMIT 1)) FROM experience_entries e WHERE e.id=? AND e.tenant_id=? AND e.workspace_id=?",UUID.class,entry,tenant,space);
  if(versions.isEmpty()||versions.getFirst()==null)throw new IdentityException(404,"EXPERIENCE_NOT_FOUND");
  experiences.analysisEntry(actor,tenant,space,entry,versions.getFirst());
  var ids=db.queryForList("SELECT id FROM experience_adjustments WHERE tenant_id=? AND workspace_id=? AND entry_id=? AND actor_id=? ORDER BY created_at DESC,id DESC LIMIT 10",UUID.class,tenant,space,entry,actor);
  return new Page(enabled,ids.stream().map(id->project(actor,tenant,space,entry,id)).toList());
 }
 @Transactional public Adjustment submit(UUID actor,UUID tenant,UUID space,UUID entry,UUID request,int expected,UUID version,Proposal proposal){
  experiences.adjustmentScope(actor,tenant,space);if(!Boolean.TRUE.equals(db.queryForObject("SELECT kind='SHARED' FROM workspaces WHERE id=?",Boolean.class,space)))throw IdentityException.invalid();var p=normalize(proposal);String fingerprint=IdentityService.hash(json.writeValueAsString(List.of(tenant,space,entry,expected,version,p)));UUID prior=identities.priorRequest(actor,request,"EXPERIENCE_ADJUSTMENT",fingerprint);
  if(prior!=null){experiences.analysisEntry(actor,tenant,space,entry,version);return project(actor,tenant,space,entry,prior);}
  var current=experiences.adjustmentTarget(actor,tenant,space,entry,version,expected);
  if(json.writeValueAsString(p).length()+json.writeValueAsString(current.version().content()).length()>56000)throw IdentityException.invalid();
  if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM experience_adjustments WHERE entry_id=? AND NOT finished)",Boolean.class,entry)))throw new IdentityException(409,"EXPERIENCE_ADJUSTMENT_PENDING");
  UUID id=UUID.randomUUID();db.update("INSERT INTO experience_adjustments(id,tenant_id,workspace_id,actor_id,entry_id,version_id,expected_revision,content) VALUES (?,?,?,?,?,?,?,?::jsonb)",id,tenant,space,actor,entry,version,expected,json.writeValueAsString(p));
  db.update("INSERT INTO experience_intake_sources(id,tenant_id,owner_id,workspace_id,kind,source_id,source_revision,source_attempt,adjustment_id) VALUES (?,?,?,?,'ADJUSTMENT',?,?,0,?)",id,tenant,actor,space,id,expected,id);
  if(!Boolean.TRUE.equals(db.queryForObject("SELECT experience_intake_available(?)",Boolean.class,id)))throw new IdentityException(409,"EXPERIENCE_EVIDENCE_UNAVAILABLE");
  db.update("INSERT INTO experience_analysis_items(source_id,tenant_id) VALUES (?,?)",id,tenant);
  identities.remember(actor,request,"EXPERIENCE_ADJUSTMENT",fingerprint,id);audit.record(actor,tenant,"EXPERIENCE_ADJUSTMENT_SUBMITTED",entry,"SUCCESS");return project(actor,tenant,space,entry,id);
 }
}
