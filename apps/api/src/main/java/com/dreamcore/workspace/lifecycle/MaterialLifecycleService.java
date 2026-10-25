package com.dreamcore.workspace.lifecycle;

import com.dreamcore.workspace.conversation.ConversationService;
import com.dreamcore.workspace.governance.GovernanceAccess;
import com.dreamcore.workspace.identity.IdentityAudit;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.identity.IdentityService;
import com.dreamcore.workspace.material.MaterialAccess;
import com.dreamcore.workspace.retention.RetentionService;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@Service
public class MaterialLifecycleService {
   private final ConversationService conversations;
   private final JdbcTemplate db;
   private final MaterialAccess access;
   private final IdentityService identities;
   private final GovernanceAccess governance;
   private final IdentityAudit audit;
   private final RetentionService retention;
   private final JsonMapper json = new JsonMapper();

   public MaterialLifecycleService(
      ConversationService conversations,
      JdbcTemplate db,
      MaterialAccess access,
      IdentityService identities,
      GovernanceAccess governance,
      IdentityAudit audit,
      RetentionService retention
   ) {
      this.retention = retention;
      this.conversations = conversations;
      this.db = db;
      this.access = access;
      this.identities = identities;
      this.governance = governance;
      this.audit = audit;
   }

   private IdentityException missing() {
      return new IdentityException(404, "LIFECYCLE_NOT_FOUND");
   }

   private String table(String kind) {
      return switch (kind) {
         case "MATERIAL" -> "materials";
         case "FOLDER" -> "material_folders";
         default -> throw IdentityException.invalid();
      };
   }

   private Instant time(Map<String, Object> r, String key) {
      return r.get(key) == null ? null : ((Timestamp)r.get(key)).toInstant();
   }

   private boolean canPurge(UUID actor, UUID tenant, UUID space) {
      return "PERSONAL".equals(this.db.queryForObject("SELECT kind FROM workspaces WHERE tenant_id=? AND id=?", String.class, new Object[]{tenant, space}))
         || this.governance.allows(actor, tenant, GovernanceAccess.Capability.LIFECYCLE_PURGE, space);
   }

   private Map<String, Object> object(UUID tenant, UUID space, String kind, UUID id) {
      List<Map<String, Object>> rows = this.db
         .queryForList("SELECT * FROM " + this.table(kind) + " WHERE tenant_id=? AND workspace_id=? AND id=?", new Object[]{tenant, space, id});
      if (rows.isEmpty()) {
         throw this.missing();
      } else {
         return rows.getFirst();
      }
   }

   private MaterialLifecycleService.Item item(UUID actor, UUID tenant, UUID space, String kind, UUID id) {
      Map<String, Object> original = this.object(tenant, space, kind, id);
      List<Map<String, Object>> states = this.db.queryForList("SELECT * FROM content_lifecycle WHERE object_kind=? AND object_id=?", new Object[]{kind, id});
      boolean purge = this.canPurge(actor, tenant, space);
      UUID parent = (UUID)original.get(kind.equals("MATERIAL") ? "folder_id" : "parent_id");
      List<String> path = this.originalPath(actor, tenant, space, parent);
      boolean parentAvailable = parent == null
         || !this.db
            .queryForList("SELECT id FROM active_material_folders WHERE tenant_id=? AND workspace_id=? AND id=?", new Object[]{tenant, space, parent})
            .isEmpty();
      if (states.isEmpty()) {
         return new MaterialLifecycleService.Item(id, kind, (String)original.get("name"), "ACTIVE", 0, null, null, null, purge, path, parentAvailable);
      }

      Map<String, Object> l = states.getFirst();
      return new MaterialLifecycleService.Item(
         id,
         kind,
         (String)original.get("name"),
         (String)l.get("state"),
         (Integer)l.get("revision"),
         this.time(l, "trashed_at"),
         this.time(l, "purge_after"),
         (UUID)l.get("purge_job_id"),
         purge,
         path,
         parentAvailable
      );
   }

   private void ancestorActive(UUID tenant, UUID space, String kind, UUID id) {
      Map<String, Object> obj = this.object(tenant, space, kind, id);
      UUID parent = (UUID)obj.get(kind.equals("MATERIAL") ? "folder_id" : "parent_id");
      if (parent != null
         && this.db
            .queryForList("SELECT id FROM active_material_folders WHERE tenant_id=? AND workspace_id=? AND id=?", new Object[]{tenant, space, parent})
            .isEmpty()) {
         throw new IdentityException(409, "LIFECYCLE_PARENT_UNAVAILABLE");
      }
   }

   private List<UUID> folders(UUID tenant, UUID space, UUID id) {
      return this.db
         .queryForList(
            "WITH RECURSIVE tree AS (SELECT id FROM material_folders WHERE tenant_id=? AND workspace_id=? AND id=? UNION ALL SELECT f.id FROM material_folders f JOIN tree t ON f.parent_id=t.id) SELECT id FROM tree",
            UUID.class,
            new Object[]{tenant, space, id}
         );
   }

   private List<UUID> materials(UUID tenant, UUID space, String kind, UUID id) {
      return kind.equals("MATERIAL")
         ? List.of(id)
         : this.db
            .queryForList(
               "WITH RECURSIVE tree AS (SELECT id FROM material_folders WHERE tenant_id=? AND workspace_id=? AND id=? UNION ALL SELECT f.id FROM material_folders f JOIN tree t ON f.parent_id=t.id) SELECT m.id FROM materials m JOIN tree t ON m.folder_id=t.id",
               UUID.class,
               new Object[]{tenant, space, id}
            );
   }

   @Transactional
   public MaterialLifecycleService.Preview preview(UUID actor, UUID tenant, UUID space, String kind, UUID id) {
      this.access.requireManageFiles(actor, tenant, space, kind, id);
      MaterialLifecycleService.Item item = this.item(actor, tenant, space, kind, id);
      List<UUID> docs = this.materials(tenant, space, kind, id);

      for (UUID m : docs) {
         this.access.requireManageFiles(actor, tenant, space, "MATERIAL", m);
      }

      if (kind.equals("FOLDER")) {
         for (UUID f : this.folders(tenant, space, id)) {
            this.access.requireManageFiles(actor, tenant, space, "FOLDER", f);
         }
      }

      long count = 0L;

      for (UUID material : docs) {
         count += this.db.queryForObject("SELECT count(*) FROM material_versions WHERE material_id=?", Long.class, new Object[]{material});
      }

      return new MaterialLifecycleService.Preview(
         item, docs.size(), count, kind.equals("FOLDER") ? this.folders(tenant, space, id).size() : 0L, "CURRENT_PERMISSIONS_NO_TASK_RESTART"
      );
   }

   private List<String> originalPath(UUID actor, UUID tenant, UUID space, UUID parent) {
      ArrayList<String> path = new ArrayList<>();
      if ((this.access.mask(actor, tenant, "WORKSPACE", space) & 1) != 0) {
         path.add((String)this.db.queryForObject("SELECT name FROM workspaces WHERE tenant_id=? AND id=?", String.class, new Object[]{tenant, space}));
      }

      if (parent != null) {
         path.addAll(
            this.db
               .queryForList(
                  "WITH RECURSIVE trail AS (\n  SELECT id,parent_id,name,0 AS depth FROM material_folders WHERE tenant_id=? AND workspace_id=? AND id=?\n  UNION ALL SELECT f.id,f.parent_id,f.name,t.depth+1 FROM material_folders f JOIN trail t ON t.parent_id=f.id\n    WHERE f.tenant_id=? AND f.workspace_id=? AND t.depth<128\n) SELECT name FROM trail WHERE (library_mask(?,?,'FOLDER',id)&1)=1 ORDER BY depth DESC\n",
                  String.class,
                  new Object[]{tenant, space, parent, tenant, space, actor, tenant}
               )
         );
      }

      return List.copyOf(path);
   }

   @Transactional
   public MaterialLifecycleService.Page list(UUID actor, UUID tenant, UUID space, int offset, int limit) {
      return this.list(actor, tenant, space, offset, limit, "ALL", "");
   }

   @Transactional
   public MaterialLifecycleService.Page list(UUID actor, UUID tenant, UUID space, int offset, int limit, String view, String query) {
      if (offset >= 0
         && offset <= 100000
         && limit >= 1
         && limit <= 50
         && view != null
         && Set.of("ALL", "TRASH", "RECORDS").contains(view)
         && query != null
         && query.length() <= 180) {
         this.access
            .require(
               actor,
               tenant,
               space,
               !Boolean.TRUE.equals(this.db.queryForObject("SELECT library_workspace_permissions_enabled(?,?)", Boolean.class, new Object[]{tenant, space}))
            );

         String filter = switch (view) {
            case "TRASH" -> "l.state='TRASHED' AND l.purge_after>now()";
            case "RECORDS" -> "(l.state IN ('PURGING','PURGED') OR (l.state='TRASHED' AND l.purge_after<=now()))";
            default -> "l.state<>'ACTIVE'";
         };
         List<Map<String, Object>> rows = this.db
            .queryForList(
               "SELECT l.object_kind,l.object_id FROM content_lifecycle l\nLEFT JOIN materials m ON l.object_kind='MATERIAL' AND m.id=l.object_id AND m.tenant_id=l.tenant_id AND m.workspace_id=l.workspace_id\nLEFT JOIN material_folders f ON l.object_kind='FOLDER' AND f.id=l.object_id AND f.tenant_id=l.tenant_id AND f.workspace_id=l.workspace_id\nWHERE l.tenant_id=? AND l.workspace_id=? AND\n"
                  + filter
                  + " AND (library_mask(?::uuid,l.tenant_id,l.object_kind,l.object_id)&1)=1 AND ((library_mask(?::uuid,l.tenant_id,l.object_kind,l.object_id)&8)=8 OR library_can_manage(?::uuid,l.tenant_id,l.workspace_id)) AND strpos(lower(coalesce(m.name,f.name,'')),lower(?))>0 ORDER BY l.changed_at DESC,l.object_kind,l.object_id LIMIT ? OFFSET ?",
               new Object[]{tenant, space, actor, actor, actor, query.trim(), limit + 1, offset}
            );
         return new MaterialLifecycleService.Page(
            rows.stream().limit(limit).map(r -> this.item(actor, tenant, space, (String)r.get("object_kind"), (UUID)r.get("object_id"))).toList(),
            rows.size() > limit
         );
      } else {
         throw IdentityException.invalid();
      }
   }

   @Transactional
   public MaterialLifecycleService.Receipt act(UUID actor, UUID tenant, UUID space, String kind, UUID id, UUID key, int revision, String action) {
      this.table(kind);
      if (Set.of("TRASH", "RESTORE", "PURGE", "RETRY_CLEANUP").contains(action) && revision >= 0) {
         String fingerprint = IdentityService.hash(this.json.writeValueAsString(new Object[]{tenant, space, kind, id, revision, action}));
         UUID prior = this.identities.priorRequest(actor, key, "MATERIAL_LIFECYCLE", fingerprint);
         this.identities.member(actor, tenant, false, false);
         this.db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE", new Object[]{tenant});
         this.access.requireManageFiles(actor, tenant, space, kind, id);
         if (kind.equals("FOLDER")) {
            for (UUID f : this.folders(tenant, space, id)) {
               this.access.requireManageFiles(actor, tenant, space, "FOLDER", f);
            }

            for (UUID m : this.materials(tenant, space, kind, id)) {
               this.access.requireManageFiles(actor, tenant, space, "MATERIAL", m);
            }
         }

         MaterialLifecycleService.Item before = this.item(actor, tenant, space, kind, id);
         if ((action.equals("PURGE") || action.equals("RETRY_CLEANUP")) && !before.canPurge()) {
            throw new IdentityException(403, "CAPABILITY_REQUIRED");
         }

         if (prior != null) {
            return (MaterialLifecycleService.Receipt)this.json
               .readValue(
                  (String)this.db
                     .queryForObject(
                        "SELECT receipt::text FROM content_lifecycle_receipts WHERE actor_id=? AND request_id=?", String.class, new Object[]{actor, key}
                     ),
                  MaterialLifecycleService.Receipt.class
               );
         }

         if (before.revision() != revision) {
            throw new IdentityException(409, "LIFECYCLE_REVISION_CONFLICT");
         }

         Instant now = (Instant)this.db.queryForObject("SELECT now()", (r, n) -> r.getTimestamp(1).toInstant());
         UUID job = null;
         String state;
         if (action.equals("TRASH")) {
            if (!before.state().equals("ACTIVE")) {
               throw new IdentityException(409, "LIFECYCLE_STATE_CONFLICT");
            }

            this.ancestorActive(tenant, space, kind, id);
            RetentionService.Deadline deadline = this.retention.resolveDeadline(tenant, "TRASH", now);
            this.db
               .update(
                  "INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state,changed_by,trashed_at,purge_after,retention_policy_revision) VALUES (?,?,?,?,'TRASHED',?,?,?,?) ON CONFLICT(object_kind,object_id) DO UPDATE SET state='TRASHED',revision=content_lifecycle.revision+1,changed_by=EXCLUDED.changed_by,changed_at=now(),trashed_at=EXCLUDED.trashed_at,purge_after=EXCLUDED.purge_after,retention_policy_revision=EXCLUDED.retention_policy_revision,purge_job_id=NULL",
                  new Object[]{tenant, space, kind, id, actor, Timestamp.from(deadline.anchor()), Timestamp.from(deadline.dueAt()), deadline.policyRevision()}
               );
            this.invalidate(this.materials(tenant, space, kind, id));
            state = "TRASHED";
         } else if (action.equals("RESTORE")) {
            if (!before.state().equals("TRASHED") || !now.isBefore(before.purgeAfter())) {
               throw new IdentityException(409, "LIFECYCLE_NOT_RESTORABLE");
            }

            this.ancestorActive(tenant, space, kind, id);
            this.db
               .update(
                  "UPDATE content_lifecycle SET state='ACTIVE',revision=revision+1,changed_by=?,changed_at=now(),trashed_at=NULL,purge_after=NULL WHERE object_kind=? AND object_id=?",
                  new Object[]{actor, kind, id}
               );
            state = "ACTIVE";
         } else if (action.equals("PURGE")) {
            if (!before.state().equals("TRASHED")) {
               throw new IdentityException(409, "LIFECYCLE_STATE_CONFLICT");
            }

            job = this.enqueue(tenant, space, kind, id, actor);
            state = "PURGING";
         } else {
            if (!before.state().equals("PURGING") || before.cleanupJobId() == null) {
               throw new IdentityException(409, "LIFECYCLE_STATE_CONFLICT");
            }

            job = before.cleanupJobId();
            if (this.db
                  .update("UPDATE content_cleanup_jobs SET state='QUEUED',revision=revision+1,error_code=NULL WHERE id=? AND state='FAILED'", new Object[]{job})
               != 1) {
               throw new IdentityException(409, "LIFECYCLE_STATE_CONFLICT");
            }

            this.db
               .update(
                  "UPDATE content_lifecycle SET revision=revision+1,changed_by=?,changed_at=now() WHERE object_kind=? AND object_id=?",
                  new Object[]{actor, kind, id}
               );
            state = "PURGING";
         }

         MaterialLifecycleService.Item after = this.item(actor, tenant, space, kind, id);
         MaterialLifecycleService.Receipt receipt = new MaterialLifecycleService.Receipt(
            id, kind, action, state, after.revision(), now, after.purgeAfter(), job
         );
         this.identities.remember(actor, key, "MATERIAL_LIFECYCLE", fingerprint, id);
         this.db
            .update(
               "INSERT INTO content_lifecycle_receipts(actor_id,request_id,receipt) VALUES (?,?,CAST(? AS jsonb))",
               new Object[]{actor, key, this.json.writeValueAsString(receipt)}
            );
         this.audit.record(actor, tenant, "MATERIAL_" + action, id, "SUCCESS");
         return receipt;
      } else {
         throw IdentityException.invalid();
      }
   }

   private void invalidate(List<UUID> docs) {
      if (!docs.isEmpty()) {
         UUID tenant = (UUID)this.db.queryForObject("SELECT tenant_id FROM materials WHERE id=?", UUID.class, new Object[]{docs.getFirst()});
         this.conversations.invalidateMaterials(tenant, docs);
      }

      for (UUID id : docs) {
         this.db
            .update(
               "UPDATE knowledge_runs SET status='CANCELLED',warnings='SOURCE_REMOVED',lease_token=NULL,lease_until=NULL,finished_at=now() WHERE material_id=? AND status IN ('QUEUED','RUNNING')",
               new Object[]{id}
            );
      }
   }

   UUID enqueue(UUID tenant, UUID space, String kind, UUID id, UUID actor) {
      List<UUID> docs = this.materials(tenant, space, kind, id);
      List<UUID> fs = kind.equals("FOLDER") ? this.folders(tenant, space, id) : List.of();

      for (UUID d : docs) {
         if (Boolean.TRUE
            .equals(
               this.db
                  .queryForObject(
                     "SELECT EXISTS(SELECT 1 FROM content_lifecycle WHERE object_kind='MATERIAL' AND object_id=? AND state='PURGING')",
                     Boolean.class,
                     new Object[]{d}
                  )
            )) {
            throw new IdentityException(409, "LIFECYCLE_CLEANUP_IN_PROGRESS");
         }
      }

      for (UUID f : fs) {
         if (Boolean.TRUE
            .equals(
               this.db
                  .queryForObject(
                     "SELECT EXISTS(SELECT 1 FROM content_lifecycle WHERE object_kind='FOLDER' AND object_id=? AND state='PURGING')",
                     Boolean.class,
                     new Object[]{f}
                  )
            )) {
            throw new IdentityException(409, "LIFECYCLE_CLEANUP_IN_PROGRESS");
         }
      }

      UUID job = UUID.randomUUID();
      this.db
         .update(
            "INSERT INTO content_cleanup_jobs(id,tenant_id,workspace_id,object_kind,object_id,requested_by,state) VALUES (?,?,?,?,?,?,'QUEUED')",
            new Object[]{job, tenant, space, kind, id, actor}
         );

      for (UUID d : docs) {
         this.markPurging(tenant, space, "MATERIAL", d, actor, job);
         this.db.update("INSERT INTO content_cleanup_materials(job_id,material_id) VALUES (?,?)", new Object[]{job, d});
         this.db
            .update("INSERT INTO content_cleanup_blobs(job_id,object_id) SELECT ?,object_id FROM material_versions WHERE material_id=?", new Object[]{job, d});
      }

      for (UUID f : fs) {
         this.markPurging(tenant, space, "FOLDER", f, actor, job);
      }

      this.invalidate(docs);
      return job;
   }

   private void markPurging(UUID tenant, UUID space, String kind, UUID id, UUID actor, UUID job) {
      this.db
         .update(
            "INSERT INTO content_lifecycle(tenant_id,workspace_id,object_kind,object_id,state,changed_by,purge_job_id) VALUES (?,?,?,?,'PURGING',?,?) ON CONFLICT(object_kind,object_id) DO UPDATE SET state='PURGING',revision=content_lifecycle.revision+1,changed_by=EXCLUDED.changed_by,changed_at=now(),purge_job_id=EXCLUDED.purge_job_id",
            new Object[]{tenant, space, kind, id, actor, job}
         );
   }

   @Transactional
   public MaterialLifecycleService.Cleanup cleanup(UUID actor, UUID tenant, UUID space, UUID id) {
      this.access.require(actor, tenant, space, true);
      List<Map<String, Object>> rows = this.db
         .queryForList("SELECT * FROM content_cleanup_jobs WHERE id=? AND tenant_id=? AND workspace_id=?", new Object[]{id, tenant, space});
      if (rows.isEmpty()) {
         throw this.missing();
      }

      Map<String, Object> r = rows.getFirst();
      long count = (Long)this.db.queryForObject("SELECT count(*) FROM content_cleanup_blobs WHERE job_id=?", Long.class, new Object[]{id});
      long deleted = (Long)this.db
         .queryForObject("SELECT count(*) FROM content_cleanup_blobs WHERE job_id=? AND deleted_at IS NOT NULL", Long.class, new Object[]{id});
      return new MaterialLifecycleService.Cleanup(
         id,
         (String)r.get("state"),
         (Integer)r.get("revision"),
         (Integer)r.get("attempts"),
         (String)r.get("error_code"),
         count,
         deleted,
         this.time(r, "completed_at"),
         "NOT_COVERED_BY_ONLINE_CLEANUP"
      );
   }

   @Transactional
   public boolean enqueueDue() {
      List<Map<String, Object>> rows = this.db
         .queryForList(
            "SELECT l.tenant_id,l.workspace_id,l.object_kind,l.object_id FROM content_lifecycle l\nWHERE l.state='TRASHED' AND l.purge_after<=now() AND (l.object_kind<>'FOLDER' OR NOT EXISTS(\n  WITH RECURSIVE tree AS (SELECT id FROM material_folders WHERE id=l.object_id\n    UNION ALL SELECT f.id FROM material_folders f JOIN tree t ON f.parent_id=t.id)\n  SELECT 1 FROM content_lifecycle child WHERE child.state='PURGING' AND\n    ((child.object_kind='FOLDER' AND child.object_id IN (SELECT id FROM tree)) OR\n     (child.object_kind='MATERIAL' AND child.object_id IN (SELECT m.id FROM materials m JOIN tree t ON t.id=m.folder_id)))\n)) ORDER BY l.purge_after,l.object_id LIMIT 1\n"
         );
      if (rows.isEmpty()) {
         return false;
      }

      Map<String, Object> r = rows.getFirst();
      UUID tenant = (UUID)r.get("tenant_id");
      UUID space = (UUID)r.get("workspace_id");
      UUID id = (UUID)r.get("object_id");
      String kind = (String)r.get("object_kind");
      this.db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE", new Object[]{tenant});
      if (this.db
         .queryForList(
            "SELECT object_id FROM content_lifecycle WHERE object_kind=? AND object_id=? AND state='TRASHED' AND purge_after<=now()", new Object[]{kind, id}
         )
         .isEmpty()) {
         return false;
      }

      this.enqueue(tenant, space, kind, id, null);
      return true;
   }

   public record Cleanup(
      UUID id, String state, int revision, int attempts, String errorCode, long originals, long originalsRemoved, Instant completedAt, String backupState
   ) {
   }

   public record Item(
      UUID id,
      String kind,
      String name,
      String state,
      int revision,
      Instant trashedAt,
      Instant purgeAfter,
      UUID cleanupJobId,
      boolean canPurge,
      List<String> path,
      boolean parentAvailable
   ) {
   }

   public record Page(List<MaterialLifecycleService.Item> items, boolean hasMore) {
   }

   public record Preview(MaterialLifecycleService.Item item, long documents, long versions, long folders, String restoration) {
   }

   public record Receipt(
      UUID objectId, String kind, String action, String resultingState, int revision, Instant occurredAt, Instant purgeAfter, UUID cleanupJobId
   ) {
   }
}
