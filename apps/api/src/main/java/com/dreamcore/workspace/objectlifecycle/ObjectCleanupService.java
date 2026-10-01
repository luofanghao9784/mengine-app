package com.dreamcore.workspace.objectlifecycle;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
/** All selected object bytes live in PostgreSQL. Each erasure commits atomically with its receipt. */
@Service public class ObjectCleanupService {
 private final JdbcTemplate db;private final com.dreamcore.workspace.retention.RetentionClock clock;public ObjectCleanupService(JdbcTemplate db,com.dreamcore.workspace.retention.RetentionClock clock){this.db=db;this.clock=clock;}
 public List<UUID> pending(){return db.queryForList("SELECT id FROM object_lifecycle WHERE state='PURGE_PENDING' ORDER BY changed_at,id LIMIT 100",UUID.class);}
 @Transactional public void clean(UUID record){
  var info=db.queryForList("SELECT tenant_id FROM object_lifecycle WHERE id=?",record);if(info.isEmpty())return;UUID tenant=(UUID)info.getFirst().get("tenant_id");if(tenant!=null)db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE",tenant);else db.queryForList("SELECT pg_advisory_xact_lock(72133001)");
  var rows=db.queryForList("SELECT * FROM object_lifecycle WHERE id=? AND state='PURGE_PENDING' FOR UPDATE",record);if(rows.isEmpty())return;var r=rows.getFirst();db.update("UPDATE object_lifecycle SET attempts=attempts+1 WHERE id=?",record);
  if(((String)r.get("kind")).equals("PROFILE_VERSION"))db.queryForList("SELECT e.id FROM profile_entries e JOIN profile_versions v ON v.entry_id=e.id WHERE v.id=? FOR UPDATE OF e",r.get("object_id"));
  boolean dueScope=r.get("scope_execution")!=null&&Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM object_lifecycle_scopes WHERE execution_id=? AND state IN('PURGING','COMPLETE') AND deadline<=?)",Boolean.class,r.get("scope_execution"),java.sql.Timestamp.from(clock.now())));
  if(!dueScope&&db.queryForObject("SELECT cardinality(lifecycle_version_blockers(?,?))",Integer.class,r.get("kind"),r.get("object_id"))>0)throw new com.dreamcore.workspace.identity.IdentityException(409,"LIFECYCLE_DEPENDENCY_PRESENT");
  db.queryForList("SELECT scrub_lifecycle_object(?,?)",r.get("kind"),r.get("object_id"));
  if("EXPERIENCE_VERSION".equals(r.get("kind")))db.queryForList("SELECT scrub_departure_experience_version(?)",r.get("object_id"));
  db.update("INSERT INTO object_lifecycle_events(id,object_record,revision,action,created_at) SELECT ?,id,revision,'ONLINE_PURGED',now() FROM object_lifecycle WHERE id=? ON CONFLICT(object_record,revision) DO NOTHING",UUID.randomUUID(),record);
 }
 @Transactional public void fail(UUID record){db.update("UPDATE object_lifecycle SET state='PURGE_FAILED',revision=revision+1,attempts=attempts+1,error_code='ONLINE_BODY_CLEANUP_FAILED',changed_at=now() WHERE id=? AND state='PURGE_PENDING'",record);db.update("INSERT INTO object_lifecycle_events(id,object_record,revision,action,created_at) SELECT ?,id,revision,'CLEANUP_FAILED',now() FROM object_lifecycle WHERE id=? AND state='PURGE_FAILED' ON CONFLICT(object_record,revision) DO NOTHING",UUID.randomUUID(),record);}
}
