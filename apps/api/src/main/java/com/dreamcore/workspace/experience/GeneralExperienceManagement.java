package com.dreamcore.workspace.experience;

import com.dreamcore.workspace.identity.*;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Platform-only control of an already admitted method; never an admission/review workflow. */
@Service
public class GeneralExperienceManagement {
 public record State(UUID entryId,UUID versionId,String status,int revision,String reason,Instant changedAt) {}
 public record Change(UUID requestId,UUID versionId,Integer expectedRevision,String status,String reason) {}
 public record Receipt(UUID requestId,UUID entryId,UUID versionId,String status,int revision) {}
 private final JdbcTemplate db;private final IdentityService identities;private final GeneralExperienceLibrary library;private final IdentityAudit audit;
 public GeneralExperienceManagement(JdbcTemplate db,IdentityService identities,GeneralExperienceLibrary library,IdentityAudit audit){this.db=db;this.identities=identities;this.library=library;this.audit=audit;}
 @Transactional public State state(UUID actor,UUID entry,UUID version){
  identities.platform(actor);
  db.queryForList("SELECT id FROM general_experience_entries WHERE id=? FOR SHARE",entry);
  library.detail(actor,null,entry,version);
  var row=db.queryForMap("SELECT status,revision,updated_at FROM general_experience_entries WHERE id=?",entry);
  var reasons=db.queryForList("SELECT reason FROM general_experience_management_events WHERE entry_id=? AND revision=?",String.class,entry,row.get("revision"));
  return new State(entry,version,(String)row.get("status"),((Number)row.get("revision")).intValue(),reasons.isEmpty()?null:reasons.getFirst(),((java.sql.Timestamp)row.get("updated_at")).toInstant());
 }
 private String reason(String input){
  if(input==null)throw IdentityException.invalid();String value=input.strip();
  if(value.isEmpty()||value.length()>500||value.codePoints().anyMatch(c->Character.isISOControl(c)&&c!=10&&c!=13&&c!=9))throw IdentityException.invalid();return value;
 }
 @Transactional public Receipt change(UUID actor,UUID entry,Change change){
  identities.platform(actor);
  // Serialize with staff revocation and account disabling; recheck after a blocked lock is acquired.
  db.queryForList("SELECT pg_advisory_xact_lock_shared(hashtextextended('platform-staff-management',0))");
  if(db.queryForList("SELECT a.id FROM accounts a WHERE a.id=? FOR SHARE OF a",actor).isEmpty())throw IdentityException.denied();
  identities.platform(actor);
  if(change==null||change.requestId()==null||change.versionId()==null||change.expectedRevision()==null||change.expectedRevision()<1||change.status()==null||!Set.of("AVAILABLE","STOPPED").contains(change.status()))throw IdentityException.invalid();
  String reason=reason(change.reason());
  // Per-actor request lock prevents one request racing across two different entry locks.
  db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","general-management-request:"+actor+":"+change.requestId());
  var previous=db.queryForList("SELECT * FROM general_experience_management_events WHERE actor_id=? AND request_id=?",actor,change.requestId());
  if(!previous.isEmpty()){
   var p=previous.getFirst();
   if(!entry.equals(p.get("entry_id"))||!change.versionId().equals(p.get("version_id"))||change.expectedRevision()!=((Number)p.get("expected_revision")).intValue()||!change.status().equals(p.get("status"))||!reason.equals(p.get("reason")))throw new IdentityException(409,"IDEMPOTENCY_CONFLICT");
   // Historical action receipt only. It does not claim the body or current status remains available.
   return new Receipt(change.requestId(),entry,change.versionId(),change.status(),((Number)p.get("revision")).intValue());
  }
  var fingerprints=db.queryForList("SELECT content_fingerprint FROM general_experience_versions WHERE id=? AND entry_id=?",String.class,change.versionId(),entry);
  if(fingerprints.isEmpty())throw new IdentityException(404,"EXPERIENCE_NOT_FOUND");
  // Same order as automatic exact-dedup admission: fingerprint then entry.
  db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))","general-experience:"+fingerprints.getFirst());
  db.queryForList("SELECT id FROM general_experience_entries WHERE id=? FOR UPDATE",entry);
  library.detail(actor,null,entry,change.versionId()); // only the current actually published, still source-valid version
  var current=db.queryForMap("SELECT revision,status FROM general_experience_entries WHERE id=?",entry);
  int revision=((Number)current.get("revision")).intValue();
  if(revision!=change.expectedRevision())throw new IdentityException(409,"REVISION_CONFLICT");
  if(change.status().equals(current.get("status")))throw new IdentityException(409,"EXPERIENCE_USE_UNCHANGED");
  revision++;UUID event=UUID.randomUUID();
  db.update("UPDATE general_experience_entries SET status=?,revision=?,updated_at=clock_timestamp() WHERE id=?",change.status(),revision,entry);
  db.update("INSERT INTO general_experience_management_events(id,actor_id,request_id,entry_id,version_id,expected_revision,revision,status,reason) VALUES (?,?,?,?,?,?,?,?,?)",event,actor,change.requestId(),entry,change.versionId(),change.expectedRevision(),revision,change.status(),reason);
  audit.record(actor,null,change.status().equals("STOPPED")?"GENERAL_EXPERIENCE_STOP":"GENERAL_EXPERIENCE_RESTORE",event,"SUCCESS");
  return new Receipt(change.requestId(),entry,change.versionId(),change.status(),revision);
 }
}
