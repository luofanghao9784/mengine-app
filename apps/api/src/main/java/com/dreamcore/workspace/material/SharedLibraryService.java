package com.dreamcore.workspace.material;

import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.identity.IdentityService;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.json.JsonMapper;

@Service
public class SharedLibraryService {
   private final JdbcTemplate db;
   private final IdentityService identities;
   private final MaterialService materials;
   private final LibraryPermissionService permissions;
   private final long maxBytes;
   private final JsonMapper json = new JsonMapper();

   public SharedLibraryService(
      JdbcTemplate db,
      IdentityService identities,
      MaterialService materials,
      LibraryPermissionService permissions,
      @Value("${dreamcore.material.max-bytes:20971520}") long maxBytes
   ) {
      this.db = db;
      this.identities = identities;
      this.materials = materials;
      this.permissions = permissions;
      this.maxBytes = maxBytes;
   }

   @Transactional
   public SharedLibraryService.Setup setup(UUID actor, UUID tenant) {
      this.identities.member(actor, tenant, false);
      return new SharedLibraryService.Setup(
         true,
         this.maxBytes,
         62914560L,
         200,
         this.db
            .query(
               "SELECT a.id,a.display_name FROM accounts a JOIN tenant_memberships m ON m.account_id=a.id WHERE m.tenant_id=? AND m.status='ACTIVE' AND a.status='ACTIVE' ORDER BY a.display_name,a.id",
               (r, n) -> new LibraryPermissionService.Person(r.getObject(1, UUID.class), r.getString(2)),
               new Object[]{tenant}
            )
      );
   }

   @Transactional
   public SharedLibraryService.Result create(UUID actor, UUID tenant, SharedLibraryService.Command command, List<MultipartFile> files) {
      this.identities.member(actor, tenant, false, false);
      if (command != null
         && command.requestId() != null
         && command.members() != null
         && command.files() != null
         && command.files().size() <= 200
         && command.files().size() == files.size()
         && command.members().size() <= 199) {
         String name = MaterialService.name(command.name());
         if (name.length() > 100) {
            throw IdentityException.invalid();
         }

         LinkedHashSet<UUID> members = new LinkedHashSet<>(command.members());
         if (!members.contains(null) && !members.contains(actor) && members.size() == command.members().size()) {
            HashSet<String> paths = new HashSet<>();
            ArrayList<String> hashes = new ArrayList<>();
            long total = 0L;
            int i = 0;

            while (i < files.size()) {
               SharedLibraryService.FilePlan plan = command.files().get(i);
               if (plan != null && plan.path() != null && plan.access() != null && plan.access().size() == members.size()) {
                  String[] parts = plan.path().split("/", -1);
                  if (parts.length > 32) {
                     throw IdentityException.invalid();
                  }

                  for (String part : parts) {
                     if (!MaterialService.name(part).equals(part)) {
                        throw IdentityException.invalid();
                     }
                  }

                  if (paths.add(plan.path()) && parts[parts.length - 1].equals(files.get(i).getOriginalFilename())) {
                     HashSet<UUID> accounts = new HashSet<>();

                     for (SharedLibraryService.Access a : plan.access()) {
                        if (a == null
                           || !members.contains(a.accountId())
                           || !accounts.add(a.accountId())
                           || a.content() == null
                           || !Set.of("NONE", "READ", "EDIT").contains(a.content())
                           || a.content().equals("NONE") && a.download()) {
                           throw IdentityException.invalid();
                        }
                     }

                     total += files.get(i).getSize();
                     if (files.get(i).getSize() <= this.maxBytes && total <= 62914560L) {
                        try {
                           hashes.add(ObjectStore.sha256(files.get(i).getBytes()));
                        } catch (IOException e) {
                           throw new IdentityException(503, "MATERIAL_UPLOAD_FAILED");
                        }

                        i++;
                        continue;
                     }

                     throw new IdentityException(413, "MATERIAL_TOO_LARGE");
                  }

                  throw IdentityException.invalid();
               }

               throw IdentityException.invalid();
            }

            for (String path : paths) {
               for (int slash = path.indexOf(47); slash >= 0; slash = path.indexOf(47, slash + 1)) {
                  if (paths.contains(path.substring(0, slash))) {
                     throw IdentityException.invalid();
                  }
               }
            }

            String fingerprint = IdentityService.hash(this.json.writeValueAsString(new Object[]{tenant, command, hashes}));
            UUID prior = this.identities.priorRequest(actor, command.requestId(), "CREATE_SHARED_LIBRARY", fingerprint);
            this.db.queryForList("SELECT id FROM tenants WHERE id=? FOR UPDATE", new Object[]{tenant});
            this.identities.member(actor, tenant, false);
            if (prior != null) {
               this.permissions.require(actor, tenant, "WORKSPACE", prior, "MANAGE");
               return new SharedLibraryService.Result(prior, name, files.size());
            }

            for (UUID member : members) {
               if (!Boolean.TRUE
                  .equals(
                     this.db
                        .queryForObject(
                           "SELECT EXISTS(SELECT 1 FROM tenant_memberships m JOIN accounts a ON a.id=m.account_id WHERE m.tenant_id=? AND m.account_id=? AND m.status='ACTIVE' AND a.status='ACTIVE')",
                           Boolean.class,
                           new Object[]{tenant, member}
                        )
                  )) {
                  throw IdentityException.invalid();
               }
            }

            UUID space = UUID.randomUUID();
            this.db
               .update(
                  "INSERT INTO workspaces(id,tenant_id,owner_id,name,kind,responsibility_confirmed,library_acl_enabled) VALUES (?,?,?,?,'SHARED',true,true)",
                  new Object[]{space, tenant, actor, name}
               );
            this.db
               .update("INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,true)", new Object[]{tenant, space, actor});

            for (UUID member : members) {
               this.db
                  .update(
                     "INSERT INTO workspace_members(tenant_id,workspace_id,account_id,can_maintain) VALUES (?,?,?,false)", new Object[]{tenant, space, member}
                  );
            }

            ArrayList<LibraryPermissionService.Grant> root = new ArrayList<>();
            root.add(this.grant(actor, "EDIT", true));

            for (UUID member : members) {
               root.add(new LibraryPermissionService.Grant("ACCOUNT", member, "READ", "INHERIT", false, null));
            }

            this.permissions.save(actor, tenant, "WORKSPACE", space, new LibraryPermissionService.Change(UUID.randomUUID(), 0, false, root));
            HashMap<String, UUID> folders = new HashMap<>();

            for (int ix = 0; ix < files.size(); ix++) {
               SharedLibraryService.FilePlan plan = command.files().get(ix);
               String[] parts = plan.path().split("/");
               UUID parent = null;
               String path = "";

               for (int j = 0; j < parts.length - 1; j++) {
                  path = path + (path.isEmpty() ? "" : "/") + parts[j];
                  UUID folder = folders.get(path);
                  if (folder == null) {
                     folder = this.materials.createFolder(actor, tenant, space, parent, parts[j], UUID.randomUUID()).id();
                     folders.put(path, folder);
                  }

                  parent = folder;
               }

               MaterialService.Entry entry = this.materials.upload(actor, tenant, space, parent, null, null, UUID.randomUUID(), files.get(ix));
               ArrayList<LibraryPermissionService.Grant> grants = new ArrayList<>();
               grants.add(this.grant(actor, "EDIT", true));

               for (SharedLibraryService.Access a : plan.access()) {
                  grants.add(this.grant(a.accountId(), a.content(), a.download()));
               }

               this.permissions.save(actor, tenant, "MATERIAL", entry.id(), new LibraryPermissionService.Change(UUID.randomUUID(), 0, false, grants));
            }

            this.identities.remember(actor, command.requestId(), "CREATE_SHARED_LIBRARY", fingerprint, space);
            this.permissions
               .event(actor, tenant, space, "WORKSPACE", space, "WORKSPACE_CREATE", null, Map.of("name", name, "members", members, "files", files.size()));
            return new SharedLibraryService.Result(space, name, files.size());
         } else {
            throw IdentityException.invalid();
         }
      } else {
         throw IdentityException.invalid();
      }
   }

   private LibraryPermissionService.Grant grant(UUID id, String content, boolean download) {
      return new LibraryPermissionService.Grant("ACCOUNT", id, content, download ? "ALLOW" : "DENY", false, null);
   }

   public record Access(UUID accountId, String content, boolean download) {
   }

   public record Command(UUID requestId, String name, List<UUID> members, List<SharedLibraryService.FilePlan> files) {
   }

   public record FilePlan(String path, List<SharedLibraryService.Access> access) {
   }

   public record Result(UUID workspaceId, String name, int fileCount) {
   }

   public record Setup(boolean enabled, long maxFileBytes, long maxTotalBytes, int maxFiles, List<LibraryPermissionService.Person> people) {
   }
}
