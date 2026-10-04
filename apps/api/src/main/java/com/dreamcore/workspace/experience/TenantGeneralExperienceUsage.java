package com.dreamcore.workspace.experience;

import com.dreamcore.workspace.governance.GovernanceAccess;
import com.dreamcore.workspace.identity.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TenantGeneralExperienceUsage {
 public record State(UUID entryId,UUID versionId,boolean enabled,boolean usable,int revision,boolean canManage) {}
 public record Change(UUID requestId,UUID versionId,Integer expectedRevision,Boolean enabled) {}
 public record Receipt(UUID requestId,UUID entryId,UUID versionId,boolean enabled,int revision) {}
 private final JdbcTemplate db;private final GeneralExperienceLibrary library;private final GovernanceAccess governance;private final IdentityAudit audit;
 public TenantGeneralExperienceUsage(JdbcTemplate db,GeneralExperienceLibrary library,GovernanceAccess governance,IdentityAudit audit){this.db=db;this.library=library;this.governance=governance;this.audit=audit;}
 private Map<String,Object> current(UUID tenant,UUID entry){var rows=db.queryForList("SELECT enabled,revision FROM tenant_general_experience_usage WHERE tenant_id=? AND entry_id=?",tenant,entry);return rows.isEmpty()?Map.of("enabled",true,"revision",0):rows.getFirst();}
 @Transactional public State state(UUID actor,UUID tenant,UUID entry,UUID version){
  library.detail(actor,tenant,entry,version);var r=current(tenant,entry);
  return new State(entry,version,(Boolean)r.get("enabled"),Boolean.TRUE.equals(db.queryForObject("SELECT general_experience_dependencies_enabled(?,?)",Boolean.class,tenant,version)),((Number)r.get("revision")).intValue(),governance.allows(actor,tenant,GovernanceAccess.Capability.TENANT_CONFIG,null));
 }
 @Transactional public Receipt change(UUID actor,UUID tenant,UUID entry,Change change){
  governance.require(actor,tenant,GovernanceAccess.Capability.TENANT_CONFIG,null);
  if(change==null||change.requestId()==null||change.versionId()==null||change.expectedRevision()==null||change.expectedRevision()<0||change.enabled()==null)throw IdentityException.invalid();
  // Shared counterpart lives in the task guard, including final commit. Covers the default (no row) state.
  db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended('general-use:'||?::text,0))",tenant);
  var previous=db.queryForList("SELECT * FROM tenant_general_experience_usage_events WHERE tenant_id=? AND request_id=?",tenant,change.requestId());
  if(!previous.isEmpty()){
   var p=previous.getFirst();
   if(!actor.equals(p.get("actor_id"))||!entry.equals(p.get("entry_id"))||!change.versionId().equals(p.get("version_id"))||!change.expectedRevision().equals(((Number)p.get("expected_revision")).intValue())||!change.enabled().equals(p.get("enabled")))throw new IdentityException(409,"IDEMPOTENCY_CONFLICT");
   // Receipt records the prior action only; it is not a current availability claim or content read.
   return new Receipt(change.requestId(),entry,change.versionId(),change.enabled(),((Number)p.get("revision")).intValue());
  }
  db.queryForList("SELECT e.id FROM general_experience_entries e JOIN general_experience_versions v ON v.id=e.published_version WHERE e.id=? ORDER BY e.id FOR SHARE OF e,v",entry);
  library.detail(actor,tenant,entry,change.versionId());
  var state=current(tenant,entry);int revision=((Number)state.get("revision")).intValue();
  if(revision!=change.expectedRevision())throw new IdentityException(409,"REVISION_CONFLICT");
  if(change.enabled().equals(state.get("enabled")))throw new IdentityException(409,"EXPERIENCE_USE_UNCHANGED");
  revision++;
  db.update("INSERT INTO tenant_general_experience_usage(tenant_id,entry_id,enabled,revision) VALUES (?,?,?,?) ON CONFLICT(tenant_id,entry_id) DO UPDATE SET enabled=excluded.enabled,revision=excluded.revision,updated_at=clock_timestamp()",tenant,entry,change.enabled(),revision);
  db.update("INSERT INTO tenant_general_experience_usage_events(tenant_id,request_id,actor_id,entry_id,version_id,expected_revision,enabled,revision) VALUES (?,?,?,?,?,?,?,?)",tenant,change.requestId(),actor,entry,change.versionId(),change.expectedRevision(),change.enabled(),revision);
  audit.record(actor,tenant,change.enabled()?"GENERAL_EXPERIENCE_USE_RESTORE":"GENERAL_EXPERIENCE_USE_STOP",entry,"SUCCESS");
  return new Receipt(change.requestId(),entry,change.versionId(),change.enabled(),revision);
 }
}
