package com.dreamcore.workspace.material;

import com.dreamcore.workspace.identity.IdentityAudit;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.identity.IdentityService;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@Service
public class LibraryPermissionService {
   private final JdbcTemplate db;
   private final IdentityService identities;
   private final JsonMapper json = new JsonMapper();

   public LibraryPermissionService(JdbcTemplate db, IdentityService identities) {
      this.db = db;
      this.identities = identities;
   }

   @Transactional
   public boolean enabled(UUID actor, UUID tenant) {
      this.identities.member(actor, tenant, false, false);
      return Boolean.TRUE.equals(this.db.queryForObject("SELECT library_any_permissions_enabled(?)", Boolean.class, new Object[]{tenant}));
   }

   private void requireEnabled(UUID actor, UUID tenant) {
      if (!this.enabled(actor, tenant)) {
         throw new IdentityException(409, "LIBRARY_PERMISSION_ROLLOUT_REQUIRED");
      }
   }

   public UUID workspace(UUID tenant, String kind, UUID id) {
      String table = switch (kind) {
         case "WORKSPACE" -> "workspaces";
         case "FOLDER" -> "material_folders";
         case "MATERIAL" -> "materials";
         default -> throw IdentityException.invalid();
      };
      List<UUID> rows = this.db
         .queryForList(
            "SELECT " + (kind.equals("WORKSPACE") ? "id" : "workspace_id") + " FROM " + table + " WHERE tenant_id=? AND id=?",
            UUID.class,
            new Object[]{tenant, id}
         );
      if (rows.isEmpty()) {
         throw new IdentityException(404, "MATERIAL_NOT_FOUND");
      } else {
         return rows.getFirst();
      }
   }

   public int mask(UUID actor, UUID tenant, String kind, UUID id) {
      return (Integer)this.db.queryForObject("SELECT library_mask(?,?,?,?)", Integer.class, new Object[]{actor, tenant, kind, id});
   }

   public boolean manages(UUID actor, UUID tenant, UUID space) {
      return Boolean.TRUE.equals(this.db.queryForObject("SELECT library_can_manage(?,?,?)", Boolean.class, new Object[]{actor, tenant, space}));
   }

   public LibraryPermissionService.Effective effective(UUID actor, UUID tenant, String kind, UUID id) {
      UUID space = this.workspace(tenant, kind, id);
      int m = this.mask(actor, tenant, kind, id);
      boolean manage = this.manages(actor, tenant, space);
      return new LibraryPermissionService.Effective((m & 1) != 0, (m & 2) != 0, (m & 4) != 0, (m & 1) != 0 && ((m & 8) != 0 || manage), manage);
   }

   public LibraryPermissionService.Effective require(UUID actor, UUID tenant, String kind, UUID id, String action) {
      this.identities.member(actor, tenant, false);
      LibraryPermissionService.Effective e = this.effective(actor, tenant, kind, id);

      boolean permitted = switch (action) {
         case "READ" -> e.canRead();
         case "EDIT" -> e.canEdit();
         case "DOWNLOAD" -> e.canDownload();
         case "MANAGE_FILES" -> e.canManageFiles();
         case "MANAGE" -> e.canManagePermissions();
         default -> false;
      };
      if (!permitted) {
         throw new IdentityException(action.equals("READ") ? 404 : 403, "LIBRARY_PERMISSION_DENIED");
      } else {
         return e;
      }
   }

   @Transactional
   public LibraryPermissionService.Policy policy(UUID actor, UUID tenant, String kind, UUID id) {
      this.identities.member(actor, tenant, false);
      UUID space = this.workspace(tenant, kind, id);
      LibraryPermissionService.Effective e = this.effective(actor, tenant, kind, id);
      if (!e.canRead() && !e.canManagePermissions()) {
         throw new IdentityException(404, "MATERIAL_NOT_FOUND");
      }

      List<Map<String, Object>> rows = this.db
         .queryForList("SELECT revision,inherit FROM library_policies WHERE tenant_id=? AND object_kind=? AND object_id=?", new Object[]{tenant, kind, id});
      return new LibraryPermissionService.Policy(
         kind,
         id,
         space,
         rows.isEmpty() ? 0 : (Integer)rows.getFirst().get("revision"),
         rows.isEmpty() || (Boolean)rows.getFirst().get("inherit"),
         e,
         e.canManagePermissions() ? this.grants(tenant, kind, id) : List.of()
      );
   }

   private List<LibraryPermissionService.Grant> grants(UUID tenant, String kind, UUID id) {
      return this.db
         .query(
            "SELECT * FROM library_grants WHERE tenant_id=? AND object_kind=? AND object_id=? ORDER BY principal_kind,principal_id",
            (r, n) -> new LibraryPermissionService.Grant(
               r.getString("principal_kind"),
               r.getObject("principal_id", UUID.class),
               r.getString("content"),
               r.getString("download"),
               r.getBoolean("manage_files"),
               r.getObject("role_department_id", UUID.class)
            ),
            new Object[]{tenant, kind, id}
         );
   }

   private String fingerprint(Object value) {
      return IdentityService.hash(this.json.writeValueAsString(value));
   }

   private String begin(UUID actor, UUID tenant, UUID request, String fingerprint) {
      if (request == null) {
         throw IdentityException.invalid();
      } else {
         this.identities.member(actor, tenant, false, false);
         this.db.queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", new Object[]{actor + ":" + request});
         this.db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE", new Object[]{tenant});
         this.identities.member(actor, tenant, false);
         List<Map<String, Object>> old = this.db
            .queryForList("SELECT fingerprint,receipt::text FROM library_change_receipts WHERE actor_id=? AND request_id=?", new Object[]{actor, request});
         if (old.isEmpty()) {
            return null;
         } else if (!fingerprint.equals(old.getFirst().get("fingerprint"))) {
            throw new IdentityException(409, "STATE_CONFLICT");
         } else {
            return (String)old.getFirst().get("receipt");
         }
      }
   }

   private void receipt(UUID actor, UUID request, String fingerprint, Object result) {
      this.db
         .update("INSERT INTO library_change_receipts VALUES (?,?,?,?::jsonb)", new Object[]{actor, request, fingerprint, this.json.writeValueAsString(result)});
   }

   public void event(UUID actor, UUID tenant, UUID space, String kind, UUID id, String action, Object before, Object after) {
      this.db
         .update(
            "INSERT INTO library_events(tenant_id,workspace_id,object_kind,object_id,actor_id,action,outcome,before_value,after_value,request_id) VALUES (?,?,?,?,?,?,'SUCCESS',?::jsonb,?::jsonb,?)",
            new Object[]{
               tenant,
               space,
               kind,
               id,
               actor,
               action,
               before == null ? null : this.json.writeValueAsString(before),
               after == null ? null : this.json.writeValueAsString(after),
               IdentityAudit.currentRequestId()
            }
         );
   }

   @Transactional
   public LibraryPermissionService.Policy save(UUID actor, UUID tenant, String kind, UUID id, LibraryPermissionService.Change change) {
      this.identities.member(actor, tenant, false, false);
      if (!Boolean.TRUE
         .equals(
            this.db.queryForObject("SELECT library_workspace_permissions_enabled(?,?)", Boolean.class, new Object[]{tenant, this.workspace(tenant, kind, id)})
         )) {
         throw new IdentityException(409, "LIBRARY_PERMISSION_ROLLOUT_REQUIRED");
      }

      if (change != null && change.revision() >= 0 && change.grants() != null && change.grants().size() <= 200) {
         String fp = this.fingerprint(new Object[]{tenant, kind, id, change});
         String old = this.begin(actor, tenant, change.requestId(), fp);
         this.require(actor, tenant, kind, id, "MANAGE");
         LibraryPermissionService.Policy before = this.policy(actor, tenant, kind, id);
         if (old != null) {
            return before;
         }

         if (before.revision() != change.revision()) {
            throw new IdentityException(409, "LIBRARY_POLICY_CONFLICT");
         }

         if (!"SHARED".equals(this.db.queryForObject("SELECT kind FROM workspaces WHERE id=?", String.class, new Object[]{before.workspaceId()}))) {
            throw IdentityException.invalid();
         }

         HashSet<String> keys = new HashSet<>();

         for (LibraryPermissionService.Grant g : change.grants()) {
            if (g != null
               && g.principalId() != null
               && g.principalKind() != null
               && g.content() != null
               && g.download() != null
               && Set.of("ACCOUNT", "DEPARTMENT").contains(g.principalKind())
               && Set.of("NONE", "READ", "EDIT").contains(g.content())
               && Set.of("INHERIT", "ALLOW", "DENY").contains(g.download())
               && keys.add(g.principalKind() + g.principalId())
               && (!g.content().equals("NONE") || !g.manageFiles())) {
               if (g.principalKind().equals("ACCOUNT")) {
                  this.validMember(tenant, g.principalId());
               } else {
                  this.validDepartment(tenant, g.principalId());
               }

               if (g.roleDepartmentId() == null) {
                  continue;
               }

               this.validDepartment(tenant, g.roleDepartmentId());
               if (g.principalKind().equals("ACCOUNT")
                  && Boolean.TRUE
                     .equals(
                        this.db
                           .queryForObject(
                              "SELECT EXISTS(SELECT 1 FROM library_department_members WHERE tenant_id=? AND department_id=? AND account_id=?)",
                              Boolean.class,
                              new Object[]{tenant, g.roleDepartmentId(), g.principalId()}
                           )
                     )) {
                  continue;
               }

               throw IdentityException.invalid();
            }

            throw IdentityException.invalid();
         }

         Map<String, Integer> beforeMasks = LibraryPrivilegeGuard.snapshot(this.db, actor, tenant);
         this.db
            .update(
               "INSERT INTO library_policies(tenant_id,object_kind,object_id,workspace_id,inherit,revision) VALUES (?,?,?,?,?,1) ON CONFLICT(tenant_id,object_kind,object_id) DO UPDATE SET inherit=EXCLUDED.inherit,revision=library_policies.revision+1",
               new Object[]{tenant, kind, id, before.workspaceId(), change.inherit()}
            );
         this.db.update("DELETE FROM library_grants WHERE tenant_id=? AND object_kind=? AND object_id=?", new Object[]{tenant, kind, id});

         for (LibraryPermissionService.Grant g : change.grants()) {
            this.db
               .update(
                  "INSERT INTO library_grants VALUES (?,?,?,?,?,?,?,?,?)",
                  new Object[]{tenant, kind, id, g.principalKind(), g.principalId(), g.content(), g.download(), g.manageFiles(), g.roleDepartmentId()}
               );
         }

         LibraryPrivilegeGuard.verify(this.db, actor, tenant, beforeMasks);
         LibraryPermissionService.Policy result = this.policy(actor, tenant, kind, id);
         this.event(actor, tenant, before.workspaceId(), kind, id, "PERMISSION_CHANGE", before, result);
         this.receipt(actor, change.requestId(), fp, result);
         return result;
      } else {
         throw IdentityException.invalid();
      }
   }

   private void validMember(UUID tenant, UUID account) {
      if (account == null
         || !Boolean.TRUE
            .equals(
               this.db
                  .queryForObject(
                     "SELECT EXISTS(SELECT 1 FROM tenant_memberships m JOIN accounts a ON a.id=m.account_id WHERE m.tenant_id=? AND m.account_id=? AND m.status='ACTIVE' AND a.status='ACTIVE')",
                     Boolean.class,
                     new Object[]{tenant, account}
                  )
            )) {
         throw IdentityException.invalid();
      }
   }

   private void validDepartment(UUID tenant, UUID id) {
      if (!Boolean.TRUE
         .equals(this.db.queryForObject("SELECT EXISTS(SELECT 1 FROM library_departments WHERE tenant_id=? AND id=?)", Boolean.class, new Object[]{tenant, id}))
         )
       {
         throw IdentityException.invalid();
      }
   }

   @Transactional
   public LibraryPermissionService.Directory directory(UUID actor, UUID tenant, UUID space) {
      this.identities.member(actor, tenant, false);
      if (space == null) {
         this.identities.member(actor, tenant, true);
      } else {
         this.require(actor, tenant, "WORKSPACE", space, "MANAGE");
      }

      List<LibraryPermissionService.Person> people = this.db
         .query(
            "SELECT a.id,a.display_name FROM accounts a JOIN tenant_memberships m ON m.account_id=a.id WHERE m.tenant_id=? AND m.status='ACTIVE' AND a.status='ACTIVE' ORDER BY a.display_name,a.id",
            (r, n) -> new LibraryPermissionService.Person(r.getObject(1, UUID.class), r.getString(2)),
            new Object[]{tenant}
         );
      List<LibraryPermissionService.Department> departments = this.db
         .query(
            "SELECT * FROM library_departments WHERE tenant_id=? ORDER BY name,id",
            (r, n) -> this.department(tenant, r.getObject("id", UUID.class)),
            new Object[]{tenant}
         );
      return new LibraryPermissionService.Directory(people, departments);
   }

   private LibraryPermissionService.Department department(UUID tenant, UUID id) {
      return (LibraryPermissionService.Department)this.db
         .queryForObject(
            "SELECT * FROM library_departments WHERE tenant_id=? AND id=?",
            (r, n) -> new LibraryPermissionService.Department(
               id,
               r.getString("name"),
               r.getInt("revision"),
               this.db
                  .queryForList(
                     "SELECT account_id FROM library_department_members WHERE tenant_id=? AND department_id=? ORDER BY account_id",
                     UUID.class,
                     new Object[]{tenant, id}
                  )
            ),
            new Object[]{tenant, id}
         );
   }

   @Transactional
   public LibraryPermissionService.Department saveDepartment(UUID actor, UUID tenant, UUID id, LibraryPermissionService.DepartmentChange change) {
      this.requireEnabled(actor, tenant);
      if (change != null
         && change.members() != null
         && change.members().size() <= 2000
         && change.revision() >= 0
         && change.members().stream().distinct().count() == change.members().size()) {
         this.identities.member(actor, tenant, true, false);
         String fp = this.fingerprint(new Object[]{tenant, id, change});
         String replay = this.begin(actor, tenant, change.requestId(), fp);
         this.identities.member(actor, tenant, true);
         if (replay != null) {
            return (LibraryPermissionService.Department)this.json.readValue(replay, LibraryPermissionService.Department.class);
         }

         String name = MaterialService.name(change.name());
         change.members().forEach(memberx -> this.validMember(tenant, memberx));
         boolean exists = Boolean.TRUE
            .equals(
               this.db.queryForObject("SELECT EXISTS(SELECT 1 FROM library_departments WHERE tenant_id=? AND id=?)", Boolean.class, new Object[]{tenant, id})
            );
         Map<String, Integer> beforeMasks = LibraryPrivilegeGuard.snapshot(this.db, actor, tenant);
         LibraryPermissionService.Department before = exists ? this.department(tenant, id) : null;
         if ((before == null ? 0 : before.revision()) != change.revision()) {
            throw new IdentityException(409, "LIBRARY_POLICY_CONFLICT");
         }

         this.db
            .update(
               "INSERT INTO library_departments(id,tenant_id,name,revision) VALUES (?,?,?,1) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,revision=library_departments.revision+1 WHERE library_departments.tenant_id=EXCLUDED.tenant_id",
               new Object[]{id, tenant, name}
            );

         for (UUID account : before == null ? List.<UUID>of() : before.members().stream().filter(m -> !change.members().contains(m)).toList()) {
            for (Map<String, Object> target : this.db
               .queryForList(
                  "SELECT object_kind,object_id FROM library_grants WHERE tenant_id=? AND principal_kind='ACCOUNT' AND principal_id=? AND role_department_id=?",
                  new Object[]{tenant, account, id}
               )) {
               String kind = (String)target.get("object_kind");
               UUID object = (UUID)target.get("object_id");
               List<LibraryPermissionService.Grant> grantsBefore = this.grants(tenant, kind, object);
               this.db
                  .update(
                     "DELETE FROM library_grants WHERE tenant_id=? AND object_kind=? AND object_id=? AND principal_kind='ACCOUNT' AND principal_id=? AND role_department_id=?",
                     new Object[]{tenant, kind, object, account, id}
                  );
               this.db
                  .update(
                     "UPDATE library_policies SET revision=revision+1 WHERE tenant_id=? AND object_kind=? AND object_id=?", new Object[]{tenant, kind, object}
                  );
               this.event(
                  actor, tenant, this.workspace(tenant, kind, object), kind, object, "ROLE_GRANT_REVOKED", grantsBefore, this.grants(tenant, kind, object)
               );
            }
         }

         this.db.update("DELETE FROM library_department_members WHERE tenant_id=? AND department_id=?", new Object[]{tenant, id});

         for (UUID member : change.members()) {
            this.db.update("INSERT INTO library_department_members VALUES (?,?,?)", new Object[]{tenant, id, member});
         }

         LibraryPrivilegeGuard.verify(this.db, actor, tenant, beforeMasks);
         LibraryPermissionService.Department result = this.department(tenant, id);
         this.event(actor, tenant, null, "DEPARTMENT", id, "DEPARTMENT_MEMBERS_CHANGE", before, result);
         this.receipt(actor, change.requestId(), fp, result);
         return result;
      } else {
         throw IdentityException.invalid();
      }
   }

   @Transactional
   public List<LibraryPermissionService.Event> events(UUID actor, UUID tenant, String kind, UUID id, int offset) {
      return this.events(actor, tenant, kind, id, offset, true);
   }

   @Transactional
   public List<LibraryPermissionService.Event> events(UUID actor, UUID tenant, String kind, UUID id, int offset, boolean audit) {
      if (offset >= 0 && offset <= 100000) {
         this.identities.member(actor, tenant, false);
         UUID space = this.workspace(tenant, kind, id);
         boolean manager = this.manages(actor, tenant, space);
         if (audit && !manager) {
            throw IdentityException.denied();
         }

         if (!manager) {
            this.require(actor, tenant, kind, id, "READ");
         }

         String filter = audit
            ? ""
            : " AND action IN ('MATERIAL_UPLOAD','MATERIAL_VERSION','MATERIAL_FOLDER_CREATE','MATERIAL_MOVE','MATERIAL_RENAME','MATERIAL_TRASH','MATERIAL_RESTORE') AND outcome='SUCCESS'";
         return this.db
            .query(
               "SELECT e.*,(SELECT a.display_name FROM accounts a JOIN tenant_memberships m ON m.account_id=a.id WHERE a.id=e.actor_id AND m.tenant_id=e.tenant_id) AS actor_name FROM library_events e WHERE tenant_id=? AND object_kind=? AND object_id=?"
                  + filter
                  + " ORDER BY occurred_at DESC,id DESC LIMIT 50 OFFSET ?",
               (r, n) -> new LibraryPermissionService.Event(
                  r.getLong("id"),
                  r.getObject("actor_id", UUID.class),
                  r.getString("actor_name"),
                  r.getString("action"),
                  r.getString("outcome"),
                  r.getTimestamp("occurred_at").toInstant(),
                  manager ? r.getString("before_value") : null,
                  manager ? r.getString("after_value") : null,
                  audit ? r.getObject("request_id", UUID.class) : null,
                  r.getObject("version_id", UUID.class),
                  r.getString("execution_source"),
                  audit ? r.getObject("http_status", Integer.class) : null
               ),
               new Object[]{tenant, kind, id, offset}
            );
      } else {
         throw IdentityException.invalid();
      }
   }

   public record Change(UUID requestId, int revision, boolean inherit, List<LibraryPermissionService.Grant> grants) {
   }

   public record Department(UUID id, String name, int revision, List<UUID> members) {
   }

   public record DepartmentChange(UUID requestId, int revision, String name, List<UUID> members) {
   }

   public record Directory(List<LibraryPermissionService.Person> people, List<LibraryPermissionService.Department> departments) {
   }

   public record Effective(boolean canRead, boolean canEdit, boolean canDownload, boolean canManageFiles, boolean canManagePermissions) {
   }

   public record Event(
      long id,
      UUID actorId,
      String actorName,
      String action,
      String outcome,
      Instant occurredAt,
      String beforeValue,
      String afterValue,
      UUID requestId,
      UUID versionId,
      String executionSource,
      Integer httpStatus
   ) {
   }

   public record Grant(String principalKind, UUID principalId, String content, String download, boolean manageFiles, UUID roleDepartmentId) {
   }

   public record Person(UUID id, String name) {
   }

   public record Policy(
      String kind,
      UUID id,
      UUID workspaceId,
      int revision,
      boolean inherit,
      LibraryPermissionService.Effective effective,
      List<LibraryPermissionService.Grant> grants
   ) {
   }
}
