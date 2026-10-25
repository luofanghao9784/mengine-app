package com.dreamcore.workspace.material;

import com.dreamcore.workspace.departure.DepartureAccess;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.identity.IdentityService;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@Service
public class SharedLibraryLifecycleService {
   private final JdbcTemplate db;
   private final IdentityService identities;
   private final LibraryPermissionService permissions;
   private final DepartureAccess departure;
   private final JsonMapper json = new JsonMapper();

   public SharedLibraryLifecycleService(JdbcTemplate db, IdentityService identities, LibraryPermissionService permissions, DepartureAccess departure) {
      this.db = db;
      this.identities = identities;
      this.permissions = permissions;
      this.departure = departure;
   }

   @Transactional
   public List<SharedLibraryLifecycleService.Space> list(UUID actor, UUID tenant) {
      String role = this.identities.member(actor, tenant, false);
      return this.db
         .query(
            "SELECT id,name,archived FROM workspaces WHERE tenant_id=? AND kind='SHARED' AND (? OR (responsibility_confirmed AND owner_id=?)) ORDER BY name,id",
            (r, n) -> new SharedLibraryLifecycleService.Space(r.getObject(1, UUID.class), r.getString(2), r.getBoolean(3)),
            new Object[]{tenant, role.equals("TENANT_ADMIN"), actor}
         );
   }

   private Map<String, Object> require(UUID actor, UUID tenant, UUID id, boolean lock) {
      String role = this.identities.member(actor, tenant, false, lock);
      List<Map<String, Object>> rows = this.db.queryForList("SELECT * FROM workspaces WHERE tenant_id=? AND id=? AND kind='SHARED'", new Object[]{tenant, id});
      if (rows.isEmpty()) {
         throw new IdentityException(404, "WORKSPACE_NOT_FOUND");
      } else {
         Map<String, Object> space = rows.getFirst();
         if (role.equals("TENANT_ADMIN") || Boolean.TRUE.equals(space.get("responsibility_confirmed")) && actor.equals(space.get("owner_id"))) {
            return space;
         } else {
            throw IdentityException.denied();
         }
      }
   }

   @Transactional
   public SharedLibraryLifecycleService.Preview preview(UUID actor, UUID tenant, UUID id) {
      return this.snapshot(tenant, id, this.require(actor, tenant, id, true));
   }

   private SharedLibraryLifecycleService.Preview snapshot(UUID tenant, UUID id, Map<String, Object> space) {
      ArrayList<Object> sources = new ArrayList<>();
      sources.add(space);

      for (String table : List.of("materials", "material_versions", "material_folders", "workspace_members", "library_policies")) {
         sources.add(
            this.db
               .queryForObject(
                  "SELECT md5(coalesce(string_agg(to_jsonb(s)::text,'' ORDER BY to_jsonb(s)::text),'')) FROM "
                     + table
                     + " s WHERE tenant_id=? AND workspace_id=?",
                  String.class,
                  new Object[]{tenant, id}
               )
         );
      }

      sources.add(
         this.db
            .queryForObject(
               "SELECT md5(coalesce(string_agg(to_jsonb(s)::text,'' ORDER BY id),'')) FROM (SELECT id,revision,status,attempt FROM conversation_tasks WHERE tenant_id=? AND workspace_id=?) s",
               String.class,
               new Object[]{tenant, id}
            )
      );
      String fingerprint = IdentityService.hash(this.json.writeValueAsString(sources));
      long files = (Long)this.db
         .queryForObject("SELECT count(*) FROM materials WHERE tenant_id=? AND workspace_id=? AND in_library", Long.class, new Object[]{tenant, id});
      long folders = (Long)this.db
         .queryForObject("SELECT count(*) FROM material_folders WHERE tenant_id=? AND workspace_id=?", Long.class, new Object[]{tenant, id});
      long members = (Long)this.db
         .queryForObject("SELECT count(*) FROM workspace_members WHERE tenant_id=? AND workspace_id=?", Long.class, new Object[]{tenant, id});
      return new SharedLibraryLifecycleService.Preview(
         id,
         (String)space.get("name"),
         (Boolean)space.get("archived"),
         ((Number)space.get("management_version")).longValue(),
         files,
         folders,
         members,
         fingerprint
      );
   }

   @Transactional
   public SharedLibraryLifecycleService.Preview change(UUID actor, UUID tenant, UUID id, SharedLibraryLifecycleService.Change change) {
      if (change != null && change.requestId() != null && change.fingerprint() != null && change.confirmedName() != null) {
         this.require(actor, tenant, id, false);
         String fingerprint = IdentityService.hash(this.json.writeValueAsString(new Object[]{tenant, id, change}));
         UUID prior = this.identities.priorRequest(actor, change.requestId(), "SHARED_LIBRARY_DELETE", fingerprint);
         this.db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE", new Object[]{tenant});
         this.departure.requireActiveBusiness(actor, tenant);
         Map<String, Object> space = this.require(actor, tenant, id, true);
         SharedLibraryLifecycleService.Preview before = this.snapshot(tenant, id, space);
         if (prior != null) {
            if (before.archived() != change.deleted()) {
               throw new IdentityException(409, "STATE_CONFLICT");
            } else {
               return before;
            }
         } else if (before.fingerprint().equals(change.fingerprint()) && before.name().equals(change.confirmedName()) && before.archived() != change.deleted()) {
            if (change.deleted()
               && Boolean.TRUE
                  .equals(
                     this.db
                        .queryForObject(
                           "SELECT EXISTS(SELECT 1 FROM conversation_tasks WHERE tenant_id=? AND workspace_id=? AND status IN ('QUEUED','RUNNING','CANCELLING'))",
                           Boolean.class,
                           new Object[]{tenant, id}
                        )
                  )) {
               throw new IdentityException(409, "SHARED_LIBRARY_BUSY");
            }

            this.db
               .update(
                  "UPDATE workspaces SET archived=?,management_version=management_version+1 WHERE tenant_id=? AND id=?",
                  new Object[]{change.deleted(), tenant, id}
               );
            this.identities.remember(actor, change.requestId(), "SHARED_LIBRARY_DELETE", fingerprint, id);
            this.permissions
               .event(
                  actor,
                  tenant,
                  id,
                  "WORKSPACE",
                  id,
                  change.deleted() ? "WORKSPACE_DELETE" : "WORKSPACE_RESTORE",
                  Map.of("archived", before.archived()),
                  Map.of("archived", change.deleted(), "files", before.files(), "folders", before.folders(), "members", before.members())
               );
            return this.snapshot(tenant, id, this.require(actor, tenant, id, true));
         } else {
            throw new IdentityException(409, "SHARED_LIBRARY_CHANGED");
         }
      } else {
         throw IdentityException.invalid();
      }
   }

   public record Change(UUID requestId, String fingerprint, String confirmedName, boolean deleted) {
   }

   public record Preview(UUID id, String name, boolean archived, long revision, long files, long folders, long members, String fingerprint) {
   }

   public record Space(UUID id, String name, boolean archived) {
   }
}
