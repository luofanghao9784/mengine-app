package com.dreamcore.workspace.material;

import com.dreamcore.workspace.identity.IdentityAudit;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.identity.IdentityService;
import com.dreamcore.workspace.knowledge.KnowledgeService;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.text.Normalizer.Form;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.multipart.MultipartFile;

@Service
public class MaterialService {
   private final JdbcTemplate db;
   private final IdentityService identities;
   private final IdentityAudit audit;
   private final KnowledgeService knowledge;
   private final MaterialAccess access;
   private final ObjectStore store;
   private final int maxBytes;
   private static final String ENTRIES = "WITH entries AS (\n  SELECT f.id,f.tenant_id,f.workspace_id,f.parent_id,'FOLDER' AS kind,f.name,0 AS version,NULL::bigint AS size_bytes,f.created_at AS updated_at,f.created_by\n  FROM active_material_folders f\n  UNION ALL\n  SELECT m.id,m.tenant_id,m.workspace_id,m.folder_id,'DOCUMENT',m.name,m.current_version,v.size_bytes,m.updated_at,m.created_by\n  FROM active_materials m JOIN material_versions v ON v.tenant_id=m.tenant_id AND v.workspace_id=m.workspace_id AND v.material_id=m.id AND v.number=m.current_version\n  UNION ALL\n  SELECT d.id,d.tenant_id,d.workspace_id,NULL::uuid,'DRAFT',v.title,d.revision,octet_length(v.body)::bigint,d.updated_at,d.owner_id\n  FROM private_documents d JOIN private_document_versions v ON v.document_id=d.id AND v.number=d.revision\n  JOIN workspaces source ON source.id=d.source_workspace_id AND source.tenant_id=d.tenant_id\n  WHERE object_is_active('DOCUMENT',d.id) AND (d.source_artifact_id IS NULL OR object_is_active('ARTIFACT',d.source_artifact_id))\n    AND EXISTS(SELECT 1 FROM readable_source_tasks rt WHERE rt.id=d.source_task_id)\n    AND ((source.kind='PERSONAL' AND source.owner_id=d.owner_id) OR EXISTS(SELECT 1 FROM workspace_members g WHERE g.tenant_id=d.tenant_id AND g.workspace_id=d.source_workspace_id AND g.account_id=d.owner_id))\n)\nSELECT e.*,u.display_name AS uploader_name,w.name AS workspace_name,((w.kind='PERSONAL' OR coalesce(g.can_maintain,false)) AND NOT EXISTS(SELECT 1 FROM departure_executions d WHERE d.tenant_id=w.tenant_id AND d.kind='TENANT_EXIT' AND d.state<>'CANCELLED')) AS can_maintain\nFROM entries e JOIN workspaces w ON w.tenant_id=e.tenant_id AND w.id=e.workspace_id\nLEFT JOIN accounts u ON u.id=e.created_by\nLEFT JOIN workspace_members g ON g.tenant_id=w.tenant_id AND g.workspace_id=w.id AND g.account_id=headquarters_permission_actor(?,w.tenant_id)\nWHERE e.tenant_id=? AND (CASE WHEN e.kind='DRAFT' THEN (w.kind='PERSONAL' AND w.owner_id=headquarters_permission_actor(?,w.tenant_id)) ELSE (library_mask(headquarters_permission_actor(?,w.tenant_id),w.tenant_id,CASE WHEN e.kind='DOCUMENT' THEN 'MATERIAL' ELSE e.kind END,e.id)&1)=1 END)\n";

   public MaterialService(
      JdbcTemplate db,
      IdentityService identities,
      IdentityAudit audit,
      MaterialAccess access,
      ObjectStore store,
      KnowledgeService knowledge,
      @Value("${dreamcore.material.max-bytes:20971520}") int maxBytes
   ) {
      this.db = db;
      this.identities = identities;
      this.audit = audit;
      this.access = access;
      this.store = store;
      this.maxBytes = maxBytes;
      this.knowledge = knowledge;
   }

   public static String name(String value) {
      if (value == null) {
         throw IdentityException.invalid();
      } else {
         String cleaned = Normalizer.normalize(value.strip(), Form.NFC);
         if (!cleaned.isBlank()
            && cleaned.length() <= 180
            && !cleaned.equals(".")
            && !cleaned.equals("..")
            && !cleaned.codePoints().anyMatch(c -> c == 47 || c == 92 || Character.isISOControl(c) || Character.getType(c) == 16)) {
            return cleaned;
         } else {
            throw new IdentityException(400, "MATERIAL_NAME_INVALID");
         }
      }
   }

   private void paging(int offset, int limit) {
      if (offset < 0 || offset > 100000 || limit < 1 || limit > 100) {
         throw IdentityException.invalid();
      }
   }

   private IdentityException missing() {
      return new IdentityException(404, "MATERIAL_NOT_FOUND");
   }

   private List<MaterialService.Crumb> trail(UUID tenant, UUID workspace, UUID folder) {
      ArrayList<MaterialService.Crumb> result = new ArrayList<>();
      HashSet<UUID> seen = new HashSet<>();

      while (folder != null) {
         if (!seen.add(folder) || result.size() >= 32) {
            throw new IdentityException(409, "MATERIAL_FOLDER_DEPTH");
         }

         List<Map<String, Object>> rows = this.db
            .queryForList(
               "SELECT id,name,parent_id FROM active_material_folders WHERE tenant_id=? AND workspace_id=? AND id=?", new Object[]{tenant, workspace, folder}
            );
         if (rows.isEmpty()) {
            throw this.missing();
         }

         Map<String, Object> row = rows.getFirst();
         result.add(new MaterialService.Crumb((UUID)row.get("id"), (String)row.get("name")));
         folder = (UUID)row.get("parent_id");
      }

      Collections.reverse(result);
      return result;
   }

   private RowMapper<MaterialService.Entry> entry(UUID tenant, UUID actor) {
      return (r, n) -> {
         UUID workspace = r.getObject("workspace_id", UUID.class);
         UUID folder = r.getObject("parent_id", UUID.class);
         String kind = r.getString("kind");
         UUID id = r.getObject("id", UUID.class);
         String aclKind = kind.equals("DOCUMENT") ? "MATERIAL" : kind;
         int mask = kind.equals("DRAFT") ? 7 : this.access.mask(actor, tenant, aclKind, id);
         boolean rootVisible = (this.access.mask(actor, tenant, "WORKSPACE", workspace) & 1) != 0;
         ArrayList<String> path = new ArrayList<>();
         if (rootVisible) {
            path.add(r.getString("workspace_name"));
         }

         for (MaterialService.Crumb c : this.trail(tenant, workspace, folder)) {
            if ((this.access.mask(actor, tenant, "FOLDER", c.id()) & 1) != 0) {
               path.add(c.name());
            }
         }

         path.add(r.getString("name"));
         return new MaterialService.Entry(
            r.getObject("id", UUID.class),
            tenant,
            workspace,
            rootVisible ? r.getString("workspace_name") : "共享资料",
            folder,
            r.getString("kind"),
            r.getString("name"),
            r.getInt("version"),
            (Long)r.getObject("size_bytes"),
            r.getTimestamp("updated_at").toInstant(),
            path,
            kind.equals("DRAFT") ? r.getBoolean("can_maintain") : (mask & 2) != 0,
            (mask & 4) != 0,
            (mask & 1) != 0 && ((mask & 8) != 0 || this.access.manages(actor, tenant, workspace)),
            this.access.manages(actor, tenant, workspace)
               && Boolean.TRUE
                  .equals(this.db.queryForObject("SELECT library_workspace_permissions_enabled(?,?)", Boolean.class, new Object[]{tenant, workspace})),
            kind.equals("DOCUMENT") ? r.getObject("created_by", UUID.class) : null,
            kind.equals("DOCUMENT") ? r.getString("uploader_name") : null
         );
      };
   }

   @Transactional
   public MaterialService.Page list(UUID actor, UUID tenant, UUID workspace, UUID folder, String q, int offset, int limit) {
      return this.list(actor, tenant, workspace, folder, q, offset, limit, false);
   }

   @Transactional
   public MaterialService.Page list(UUID actor, UUID tenant, UUID workspace, UUID folder, String q, int offset, int limit, boolean includeUploads) {
      this.paging(offset, limit);
      if (q.length() <= 180 && (workspace != null || folder == null)) {
         this.identities.member(actor, tenant, false);
         MaterialAccess.Space space = workspace == null
            ? null
            : this.access.requireObject(actor, tenant, workspace, folder == null ? "WORKSPACE" : "FOLDER", folder == null ? workspace : folder, false);
         if (!includeUploads || space != null && space.kind().equals("PERSONAL") && folder == null) {
            List<MaterialService.Crumb> crumbs = workspace == null
               ? List.of()
               : this.trail(tenant, workspace, folder).stream().filter(c -> (this.access.mask(actor, tenant, "FOLDER", c.id()) & 1) != 0).toList();
            String query = q.strip();
            String within = folder == null
               ? "true"
               : "e.parent_id IN (WITH RECURSIVE subtree AS (SELECT id FROM active_material_folders WHERE id=? AND tenant_id=? AND workspace_id=? UNION ALL SELECT f.id FROM active_material_folders f JOIN subtree p ON f.parent_id=p.id WHERE f.tenant_id=? AND f.workspace_id=?) SELECT id FROM subtree)";
            ArrayList<Object> args = new ArrayList<>(List.of(actor, tenant, actor, actor));
            String filter = workspace == null ? "w.kind='SHARED' AND e.kind='DOCUMENT'" : "e.workspace_id=?";
            if (workspace != null) {
               args.add(workspace);
            }

            if (includeUploads) {
               filter = "(("
                  + filter
                  + (query.isEmpty() ? " AND e.parent_id IS NULL" : "")
                  + ") OR (w.kind='SHARED' AND e.kind='DOCUMENT' AND e.created_by=headquarters_permission_actor(?,w.tenant_id)))";
               args.add(actor);
            }

            filter = filter + " AND (e.kind IN ('FOLDER','DRAFT') OR EXISTS(SELECT 1 FROM materials m WHERE m.id=e.id AND m.in_library))";
            if (query.isEmpty()) {
               if (workspace != null && !includeUploads) {
                  filter = filter + " AND e.parent_id IS NOT DISTINCT FROM ?::uuid";
                  args.add(folder);
               }
            } else {
               filter = filter + " AND (" + within + ")";
               if (folder != null) {
                  args.addAll(List.of(folder, tenant, workspace, tenant, workspace));
               }

               filter = filter
                  + " AND (strpos(lower(e.name),lower(?))>0 OR EXISTS(SELECT 1 FROM material_versions v JOIN knowledge_runs r ON r.version_id=v.id JOIN knowledge_chunks c ON c.run_id=r.id WHERE v.material_id=e.id AND v.number=e.version AND r.status IN ('READY','PARTIAL') AND r.generation=(SELECT max(k.generation) FROM knowledge_runs k WHERE k.version_id=v.id) AND strpos(lower(c.content),lower(?))>0) OR EXISTS(SELECT 1 FROM private_document_versions d WHERE d.document_id=e.id AND d.number=e.version AND strpos(lower(d.body),lower(?))>0))";
               args.add(query);
               args.add(query);
               args.add(query);
            }

            args.add(limit + 1);
            args.add(offset);
            List<MaterialService.Entry> items = this.db
               .query(
                  "WITH entries AS (\n  SELECT f.id,f.tenant_id,f.workspace_id,f.parent_id,'FOLDER' AS kind,f.name,0 AS version,NULL::bigint AS size_bytes,f.created_at AS updated_at,f.created_by\n  FROM active_material_folders f\n  UNION ALL\n  SELECT m.id,m.tenant_id,m.workspace_id,m.folder_id,'DOCUMENT',m.name,m.current_version,v.size_bytes,m.updated_at,m.created_by\n  FROM active_materials m JOIN material_versions v ON v.tenant_id=m.tenant_id AND v.workspace_id=m.workspace_id AND v.material_id=m.id AND v.number=m.current_version\n  UNION ALL\n  SELECT d.id,d.tenant_id,d.workspace_id,NULL::uuid,'DRAFT',v.title,d.revision,octet_length(v.body)::bigint,d.updated_at,d.owner_id\n  FROM private_documents d JOIN private_document_versions v ON v.document_id=d.id AND v.number=d.revision\n  JOIN workspaces source ON source.id=d.source_workspace_id AND source.tenant_id=d.tenant_id\n  WHERE object_is_active('DOCUMENT',d.id) AND (d.source_artifact_id IS NULL OR object_is_active('ARTIFACT',d.source_artifact_id))\n    AND EXISTS(SELECT 1 FROM readable_source_tasks rt WHERE rt.id=d.source_task_id)\n    AND ((source.kind='PERSONAL' AND source.owner_id=d.owner_id) OR EXISTS(SELECT 1 FROM workspace_members g WHERE g.tenant_id=d.tenant_id AND g.workspace_id=d.source_workspace_id AND g.account_id=d.owner_id))\n)\nSELECT e.*,u.display_name AS uploader_name,w.name AS workspace_name,((w.kind='PERSONAL' OR coalesce(g.can_maintain,false)) AND NOT EXISTS(SELECT 1 FROM departure_executions d WHERE d.tenant_id=w.tenant_id AND d.kind='TENANT_EXIT' AND d.state<>'CANCELLED')) AS can_maintain\nFROM entries e JOIN workspaces w ON w.tenant_id=e.tenant_id AND w.id=e.workspace_id\nLEFT JOIN accounts u ON u.id=e.created_by\nLEFT JOIN workspace_members g ON g.tenant_id=w.tenant_id AND g.workspace_id=w.id AND g.account_id=headquarters_permission_actor(?,w.tenant_id)\nWHERE e.tenant_id=? AND (CASE WHEN e.kind='DRAFT' THEN (w.kind='PERSONAL' AND w.owner_id=headquarters_permission_actor(?,w.tenant_id)) ELSE (library_mask(headquarters_permission_actor(?,w.tenant_id),w.tenant_id,CASE WHEN e.kind='DOCUMENT' THEN 'MATERIAL' ELSE e.kind END,e.id)&1)=1 END)\n AND "
                     + filter
                     + " ORDER BY CASE WHEN e.kind='FOLDER' THEN 0 ELSE 1 END,e.updated_at DESC,e.id LIMIT ? OFFSET ?",
                  this.entry(tenant, actor),
                  args.toArray()
               );
            return new MaterialService.Page(
               tenant,
               workspace,
               folder,
               crumbs,
               space != null && space.canMaintain(),
               this.maxBytes,
               items.stream().limit(limit).toList(),
               items.size() > limit
            );
         } else {
            throw IdentityException.invalid();
         }
      } else {
         throw IdentityException.invalid();
      }
   }

   private MaterialService.Entry document(UUID actor, UUID tenant, UUID workspace, UUID id) {
      List<MaterialService.Entry> rows = this.db
         .query(
            "WITH entries AS (\n  SELECT f.id,f.tenant_id,f.workspace_id,f.parent_id,'FOLDER' AS kind,f.name,0 AS version,NULL::bigint AS size_bytes,f.created_at AS updated_at,f.created_by\n  FROM active_material_folders f\n  UNION ALL\n  SELECT m.id,m.tenant_id,m.workspace_id,m.folder_id,'DOCUMENT',m.name,m.current_version,v.size_bytes,m.updated_at,m.created_by\n  FROM active_materials m JOIN material_versions v ON v.tenant_id=m.tenant_id AND v.workspace_id=m.workspace_id AND v.material_id=m.id AND v.number=m.current_version\n  UNION ALL\n  SELECT d.id,d.tenant_id,d.workspace_id,NULL::uuid,'DRAFT',v.title,d.revision,octet_length(v.body)::bigint,d.updated_at,d.owner_id\n  FROM private_documents d JOIN private_document_versions v ON v.document_id=d.id AND v.number=d.revision\n  JOIN workspaces source ON source.id=d.source_workspace_id AND source.tenant_id=d.tenant_id\n  WHERE object_is_active('DOCUMENT',d.id) AND (d.source_artifact_id IS NULL OR object_is_active('ARTIFACT',d.source_artifact_id))\n    AND EXISTS(SELECT 1 FROM readable_source_tasks rt WHERE rt.id=d.source_task_id)\n    AND ((source.kind='PERSONAL' AND source.owner_id=d.owner_id) OR EXISTS(SELECT 1 FROM workspace_members g WHERE g.tenant_id=d.tenant_id AND g.workspace_id=d.source_workspace_id AND g.account_id=d.owner_id))\n)\nSELECT e.*,u.display_name AS uploader_name,w.name AS workspace_name,((w.kind='PERSONAL' OR coalesce(g.can_maintain,false)) AND NOT EXISTS(SELECT 1 FROM departure_executions d WHERE d.tenant_id=w.tenant_id AND d.kind='TENANT_EXIT' AND d.state<>'CANCELLED')) AS can_maintain\nFROM entries e JOIN workspaces w ON w.tenant_id=e.tenant_id AND w.id=e.workspace_id\nLEFT JOIN accounts u ON u.id=e.created_by\nLEFT JOIN workspace_members g ON g.tenant_id=w.tenant_id AND g.workspace_id=w.id AND g.account_id=headquarters_permission_actor(?,w.tenant_id)\nWHERE e.tenant_id=? AND (CASE WHEN e.kind='DRAFT' THEN (w.kind='PERSONAL' AND w.owner_id=headquarters_permission_actor(?,w.tenant_id)) ELSE (library_mask(headquarters_permission_actor(?,w.tenant_id),w.tenant_id,CASE WHEN e.kind='DOCUMENT' THEN 'MATERIAL' ELSE e.kind END,e.id)&1)=1 END)\n AND e.workspace_id=? AND e.id=? AND e.kind='DOCUMENT'",
            this.entry(tenant, actor),
            new Object[]{actor, tenant, actor, actor, workspace, id}
         );
      if (rows.isEmpty()) {
         throw this.missing();
      } else {
         return rows.getFirst();
      }
   }

   @Transactional
   public MaterialService.Detail detail(UUID actor, UUID tenant, UUID workspace, UUID id, int offset, int limit) {
      this.paging(offset, limit);
      this.access.requireObject(actor, tenant, workspace, "MATERIAL", id, false);
      MaterialService.Entry doc = this.document(actor, tenant, workspace, id);
      List<MaterialService.Version> versions = this.db
         .query(
            "SELECT v.*,CASE WHEN p.id IS NULL THEN 'UPLOAD' ELSE 'DOCUMENT_PUBLICATION' END AS origin FROM material_versions v LEFT JOIN document_publications p ON p.material_version_id=v.id WHERE v.tenant_id=? AND v.workspace_id=? AND v.material_id=? ORDER BY v.number DESC LIMIT ? OFFSET ?",
            (r, n) -> new MaterialService.Version(
               r.getObject("id", UUID.class),
               r.getInt("number"),
               r.getString("filename"),
               r.getLong("size_bytes"),
               r.getString("sha256"),
               r.getObject("created_by", UUID.class),
               r.getTimestamp("created_at").toInstant(),
               r.getString("origin"),
               (String)this.db
                  .queryForObject("SELECT display_name FROM accounts WHERE id=?", String.class, new Object[]{r.getObject("created_by", UUID.class)})
            ),
            new Object[]{tenant, workspace, id, limit + 1, offset}
         );
      return new MaterialService.Detail(
         doc,
         versions.stream().limit(limit).toList(),
         versions.size() > limit,
         (Boolean)this.db.queryForObject("SELECT in_library FROM materials WHERE id=?", Boolean.class, new Object[]{id})
      );
   }

   @Transactional
   public MaterialService.Version version(UUID actor, UUID tenant, UUID workspace, UUID material, UUID version) {
      this.access.requireObject(actor, tenant, workspace, "MATERIAL", material, false);
      this.document(actor, tenant, workspace, material);
      this.access.requireVersionActive(tenant, workspace, version);
      List<MaterialService.Version> rows = this.db
         .query(
            "SELECT v.*,CASE WHEN p.id IS NULL THEN 'UPLOAD' ELSE 'DOCUMENT_PUBLICATION' END origin FROM material_versions v LEFT JOIN document_publications p ON p.material_version_id=v.id WHERE v.id=? AND v.tenant_id=? AND v.workspace_id=? AND v.material_id=?",
            (r, n) -> new MaterialService.Version(
               r.getObject("id", UUID.class),
               r.getInt("number"),
               r.getString("filename"),
               r.getLong("size_bytes"),
               r.getString("sha256"),
               r.getObject("created_by", UUID.class),
               r.getTimestamp("created_at").toInstant(),
               r.getString("origin"),
               (String)this.db
                  .queryForObject("SELECT display_name FROM accounts WHERE id=?", String.class, new Object[]{r.getObject("created_by", UUID.class)})
            ),
            new Object[]{version, tenant, workspace, material}
         );
      if (rows.isEmpty()) {
         throw this.missing();
      } else {
         return rows.getFirst();
      }
   }

   @Transactional
   public MaterialService.Crumb createFolder(UUID actor, UUID tenant, UUID workspace, UUID parent, String suppliedName, UUID key) {
      String name = name(suppliedName);
      String fingerprint = IdentityService.hash(tenant + "\n" + workspace + "\n" + parent + "\n" + name);
      UUID prior = this.identities.priorRequest(actor, key, "MATERIAL_FOLDER_CREATE", fingerprint);
      this.access.requireObject(actor, tenant, workspace, parent == null ? "WORKSPACE" : "FOLDER", parent == null ? workspace : parent, true);
      if (prior != null) {
         return this.trail(tenant, workspace, prior).getLast();
      }

      if (this.trail(tenant, workspace, parent).size() >= 32) {
         throw new IdentityException(409, "MATERIAL_FOLDER_DEPTH");
      }

      UUID id = UUID.randomUUID();
      this.db
         .update(
            "INSERT INTO material_folders(id,tenant_id,workspace_id,parent_id,name,created_by) VALUES (?,?,?,?,?,?)",
            new Object[]{id, tenant, workspace, parent, name, actor}
         );
      this.identities.remember(actor, key, "MATERIAL_FOLDER_CREATE", fingerprint, id);
      this.audit.record(actor, tenant, "MATERIAL_FOLDER_CREATE", id, "SUCCESS");
      return new MaterialService.Crumb(id, name);
   }

   @Transactional
   public MaterialService.Entry upload(
      UUID actor, UUID tenant, UUID workspace, UUID folder, UUID material, Integer expectedVersion, UUID key, MultipartFile file
   ) {
      return this.uploadReceipt(actor, tenant, workspace, folder, material, expectedVersion, key, file).entry();
   }

   @Transactional
   public MaterialService.UploadReceipt uploadReceipt(
      UUID actor, UUID tenant, UUID workspace, UUID folder, UUID material, Integer expectedVersion, UUID key, MultipartFile file
   ) {
      this.access
         .checkObject(
            actor,
            tenant,
            workspace,
            material != null ? "MATERIAL" : (folder != null ? "FOLDER" : "WORKSPACE"),
            material != null ? material : (folder != null ? folder : workspace),
            true,
            false
         );
      String filename = name(file.getOriginalFilename());
      if (file.getSize() > this.maxBytes) {
         throw new IdentityException(413, "MATERIAL_TOO_LARGE");
      }

      byte[] bytes;
      try (InputStream input = file.getInputStream()) {
         bytes = input.readNBytes(this.maxBytes + 1);
      } catch (IOException error) {
         throw new IdentityException(503, "MATERIAL_UPLOAD_FAILED");
      }

      if (bytes.length > this.maxBytes) {
         throw new IdentityException(413, "MATERIAL_TOO_LARGE");
      }

      if ((material != null || expectedVersion == null) && (material == null || expectedVersion != null && expectedVersion >= 1 && folder == null)) {
         String hash = ObjectStore.sha256(bytes);
         String fingerprint = IdentityService.hash(
            tenant + "\n" + workspace + "\n" + folder + "\n" + material + "\n" + expectedVersion + "\n" + filename + "\n" + hash
         );
         UUID prior = this.identities.priorRequest(actor, key, "MATERIAL_UPLOAD", fingerprint);
         this.access
            .requireObject(
               actor,
               tenant,
               workspace,
               material != null ? "MATERIAL" : (folder != null ? "FOLDER" : "WORKSPACE"),
               material != null ? material : (folder != null ? folder : workspace),
               true
            );
         if (prior != null) {
            return this.uploadReceipt(actor, tenant, workspace, prior, key);
         }

         MaterialService.Entry result = this.storeGenerated(actor, tenant, workspace, folder, material, expectedVersion, filename, bytes);
         this.identities.remember(actor, key, "MATERIAL_UPLOAD", fingerprint, result.id());
         this.db
            .update(
               "INSERT INTO material_upload_receipts(actor_id,request_id,tenant_id,workspace_id,material_id,version_id) SELECT ?,?,tenant_id,workspace_id,material_id,id FROM material_versions WHERE tenant_id=? AND workspace_id=? AND material_id=? AND number=?",
               new Object[]{actor, key, tenant, workspace, result.id(), result.version()}
            );
         return this.uploadReceipt(actor, tenant, workspace, result.id(), key);
      } else {
         throw IdentityException.invalid();
      }
   }

   private MaterialService.UploadReceipt uploadReceipt(UUID actor, UUID tenant, UUID workspace, UUID material, UUID key) {
      MaterialService.Entry current = this.document(actor, tenant, workspace, material);
      List<MaterialService.Version> accepted = this.db
         .query(
            "SELECT v.* FROM material_upload_receipts r JOIN material_versions v ON v.id=r.version_id AND v.tenant_id=r.tenant_id AND v.workspace_id=r.workspace_id AND v.material_id=r.material_id WHERE r.actor_id=? AND r.request_id=? AND r.tenant_id=? AND r.workspace_id=? AND r.material_id=?",
            (r, n) -> new MaterialService.Version(
               r.getObject("id", UUID.class),
               r.getInt("number"),
               r.getString("filename"),
               r.getLong("size_bytes"),
               r.getString("sha256"),
               r.getObject("created_by", UUID.class),
               r.getTimestamp("created_at").toInstant(),
               "UPLOAD",
               (String)this.db
                  .queryForObject("SELECT display_name FROM accounts WHERE id=?", String.class, new Object[]{r.getObject("created_by", UUID.class)})
            ),
            new Object[]{actor, key, tenant, workspace, material}
         );
      return new MaterialService.UploadReceipt(current, accepted.isEmpty() ? null : accepted.getFirst());
   }

   @Transactional
   public MaterialService.Entry storeGenerated(
      UUID actor, UUID tenant, UUID workspace, UUID folder, UUID material, Integer expectedVersion, String suppliedFilename, byte[] bytes
   ) {
      this.access
         .requireObject(
            actor,
            tenant,
            workspace,
            material != null ? "MATERIAL" : (folder != null ? "FOLDER" : "WORKSPACE"),
            material != null ? material : (folder != null ? folder : workspace),
            true
         );
      String filename = name(suppliedFilename);
      if (bytes.length > this.maxBytes) {
         throw new IdentityException(413, "MATERIAL_TOO_LARGE");
      }

      if ((material != null || expectedVersion == null) && (material == null || expectedVersion != null && expectedVersion >= 1 && folder == null)) {
         String hash = ObjectStore.sha256(bytes);
         int number = 1;
         if (material != null) {
            this.db
               .queryForList("SELECT id FROM materials WHERE tenant_id=? AND workspace_id=? AND id=? FOR UPDATE", new Object[]{tenant, workspace, material});
            MaterialService.Entry current = this.document(actor, tenant, workspace, material);
            if (current.version() != expectedVersion) {
               throw new IdentityException(409, "MATERIAL_VERSION_CONFLICT");
            }

            number = Math.addExact(current.version(), 1);
         } else {
            this.trail(tenant, workspace, folder);
         }

         UUID id = material == null ? UUID.randomUUID() : material;
         final UUID object = this.store.put(bytes);
         TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            public void afterCompletion(int status) {
               if (status != 0) {
                  MaterialService.this.store.discard(object);
               }
            }
         });
         if (material == null) {
            this.db
               .update(
                  "INSERT INTO materials(id,tenant_id,workspace_id,folder_id,name,created_by) VALUES (?,?,?,?,?,?)",
                  new Object[]{id, tenant, workspace, folder, filename, actor}
               );
         } else {
            this.db
               .update(
                  "UPDATE materials SET current_version=?,updated_at=now() WHERE tenant_id=? AND workspace_id=? AND id=?",
                  new Object[]{number, tenant, workspace, id}
               );
         }

         UUID versionId = UUID.randomUUID();
         this.db
            .update(
               "INSERT INTO material_versions(id,tenant_id,workspace_id,material_id,number,filename,size_bytes,sha256,object_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
               new Object[]{versionId, tenant, workspace, id, number, filename, bytes.length, hash, object, actor}
            );
         this.knowledge.onUpload(actor, tenant, workspace, id, versionId);
         this.audit.record(actor, tenant, material == null ? "MATERIAL_UPLOAD" : "MATERIAL_VERSION", id, "SUCCESS");
         return this.document(actor, tenant, workspace, id);
      } else {
         throw IdentityException.invalid();
      }
   }

   @Transactional
   public MaterialService.Pipeline pipeline(UUID actor, UUID tenant, UUID workspace, UUID material) {
      this.access.requireObject(actor, tenant, workspace, "MATERIAL", material, false);
      this.access.requireMaterialActive(tenant, workspace, material);
      return (MaterialService.Pipeline)this.db
         .queryForObject(
            "SELECT m.id,v.number,v.created_at,coalesce(r.status,'NOT_STARTED') parsing,\nCASE WHEN g.id IS NULL THEN 'NOT_CHECKED' WHEN g.source='NO_TEXT' THEN 'NO_TEXT' ELSE 'CHECKED' END governance,\nCASE WHEN g.id IS NULL THEN 0 ELSE cardinality(array_remove(g.issues,'review'))+CASE WHEN g.review_at IS NULL OR g.review_at<(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date THEN 1 ELSE 0 END END issues,\nCASE WHEN a.id IS NULL THEN 'NOT_PUBLISHED' WHEN a.archived THEN 'ARCHIVED'\n  WHEN av.source_version_id=v.id AND av.source_run_id=r.id AND r.status IN('READY','PARTIAL') AND av.article IS NOT NULL AND m.in_library AND w.kind='SHARED' THEN 'PUBLISHED' ELSE 'STALE' END publication\nFROM active_materials m JOIN workspaces w ON w.id=m.workspace_id\nJOIN material_versions v ON v.material_id=m.id AND v.number=m.current_version\nLEFT JOIN LATERAL (SELECT id,status FROM knowledge_runs WHERE version_id=v.id ORDER BY generation DESC LIMIT 1) r ON true\nLEFT JOIN LATERAL (SELECT * FROM material_governance_reports WHERE material_id=m.id AND version_id=v.id AND (run_id IS NULL OR run_id=r.id) ORDER BY revision DESC LIMIT 1) g ON true\nLEFT JOIN wiki_articles a ON a.material_id=m.id AND a.tenant_id=m.tenant_id\nLEFT JOIN wiki_article_versions av ON av.article_id=a.id AND av.revision=a.revision\nWHERE m.tenant_id=? AND m.workspace_id=? AND m.id=?\n",
            (r, n) -> new MaterialService.Pipeline(
               material,
               r.getInt("number"),
               r.getTimestamp("created_at").toInstant(),
               r.getString("parsing"),
               r.getString("governance"),
               r.getInt("issues"),
               r.getString("publication")
            ),
            new Object[]{tenant, workspace, material}
         );
   }

   @Transactional
   public MaterialService.EditableText editableText(UUID actor, UUID tenant, UUID workspace, UUID material) {
      this.access.requireObject(actor, tenant, workspace, "MATERIAL", material, true);
      this.access.requireMaterialActive(tenant, workspace, material);
      List<Map<String, Object>> rows = this.db
         .queryForList(
            "SELECT v.* FROM materials m JOIN material_versions v ON v.material_id=m.id AND v.tenant_id=m.tenant_id AND v.number=m.current_version WHERE m.tenant_id=? AND m.workspace_id=? AND m.id=?",
            new Object[]{tenant, workspace, material}
         );
      if (rows.isEmpty()) {
         throw this.missing();
      }

      Map<String, Object> row = rows.getFirst();
      String filename = (String)row.get("filename");
      if (filename.toLowerCase(Locale.ROOT).matches(".*[.](txt|md|markdown)$") && (Long)row.get("size_bytes") <= 262144L) {
         byte[] bytes = this.store.read((UUID)row.get("object_id"), (Long)row.get("size_bytes"), (String)row.get("sha256"));

         String content;
         try {
            content = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
         } catch (CharacterCodingException e) {
            throw new IdentityException(409, "MATERIAL_TEXT_UNSUPPORTED");
         }

         if (content.indexOf(0) >= 0) {
            throw new IdentityException(409, "MATERIAL_TEXT_UNSUPPORTED");
         } else {
            return new MaterialService.EditableText(material, (UUID)row.get("id"), (Integer)row.get("number"), filename, content);
         }
      } else {
         throw new IdentityException(409, "MATERIAL_TEXT_UNSUPPORTED");
      }
   }

   @Transactional
   public MaterialService.Download download(UUID actor, UUID tenant, UUID workspace, UUID material, UUID version) {
      this.access.requireDownload(actor, tenant, workspace, material);
      this.access.requireMaterialActive(tenant, workspace, material);
      List<Map<String, Object>> rows = this.db
         .queryForList(
            "SELECT filename,object_id,size_bytes,sha256 FROM material_versions WHERE tenant_id=? AND workspace_id=? AND material_id=? AND id=?",
            new Object[]{tenant, workspace, material, version}
         );
      if (rows.isEmpty()) {
         throw this.missing();
      }

      Map<String, Object> row = rows.getFirst();
      byte[] bytes = this.store.read((UUID)row.get("object_id"), (Long)row.get("size_bytes"), (String)row.get("sha256"));
      this.audit.record(actor, tenant, "MATERIAL_DOWNLOAD", version, "SUCCESS");
      return new MaterialService.Download((String)row.get("filename"), bytes);
   }

   public record Crumb(UUID id, String name) {
   }

   public record Detail(MaterialService.Entry document, List<MaterialService.Version> versions, boolean hasMore, boolean inLibrary) {
   }

   public record Download(String filename, byte[] bytes) {
   }

   public record EditableText(UUID materialId, UUID versionId, int version, String filename, String content) {
   }

   public record Entry(
      UUID id,
      UUID tenantId,
      UUID workspaceId,
      String workspaceName,
      UUID folderId,
      String kind,
      String name,
      int version,
      Long sizeBytes,
      Instant updatedAt,
      List<String> path,
      boolean canMaintain,
      boolean canDownload,
      boolean canManageFiles,
      boolean canManagePermissions,
      UUID uploadedBy,
      String uploadedByName
   ) {
      public Entry(
         UUID id,
         UUID tenantId,
         UUID workspaceId,
         String workspaceName,
         UUID folderId,
         String kind,
         String name,
         int version,
         Long sizeBytes,
         Instant updatedAt,
         List<String> path,
         boolean canMaintain
      ) {
         this(id, tenantId, workspaceId, workspaceName, folderId, kind, name, version, sizeBytes, updatedAt, path, canMaintain, true, false, false, null, null);
      }
   }

   public record Page(
      UUID tenantId,
      UUID workspaceId,
      UUID folderId,
      List<MaterialService.Crumb> trail,
      boolean canMaintain,
      long maxUploadBytes,
      List<MaterialService.Entry> items,
      boolean hasMore
   ) {
   }

   public record Pipeline(UUID materialId, int version, Instant receivedAt, String parsing, String governance, int issues, String publication) {
   }

   public record UploadReceipt(
      UUID id,
      UUID tenantId,
      UUID workspaceId,
      String workspaceName,
      UUID folderId,
      String kind,
      String name,
      int version,
      Long sizeBytes,
      Instant updatedAt,
      List<String> path,
      boolean canMaintain,
      String receiptStatus,
      MaterialService.Version acceptedVersion,
      int currentVersion,
      boolean canDownload,
      boolean canManageFiles,
      boolean canManagePermissions,
      UUID uploadedBy,
      String uploadedByName
   ) {
      UploadReceipt(MaterialService.Entry current, MaterialService.Version accepted) {
         this(
            current.id(),
            current.tenantId(),
            current.workspaceId(),
            current.workspaceName(),
            current.folderId(),
            current.kind(),
            current.name(),
            accepted == null ? current.version() : accepted.number(),
            accepted == null ? current.sizeBytes() : accepted.sizeBytes(),
            accepted == null ? current.updatedAt() : accepted.createdAt(),
            current.path(),
            current.canMaintain(),
            accepted == null ? "HISTORICAL_UNKNOWN" : "EXACT",
            accepted,
            current.version(),
            current.canDownload(),
            current.canManageFiles(),
            current.canManagePermissions(),
            current.uploadedBy(),
            current.uploadedByName()
         );
      }

      public MaterialService.Entry entry() {
         return new MaterialService.Entry(
            this.id,
            this.tenantId,
            this.workspaceId,
            this.workspaceName,
            this.folderId,
            this.kind,
            this.name,
            this.version,
            this.sizeBytes,
            this.updatedAt,
            this.path,
            this.canMaintain,
            this.canDownload,
            this.canManageFiles,
            this.canManagePermissions,
            this.uploadedBy,
            this.uploadedByName
         );
      }
   }

   public record Version(
      UUID id, int number, String filename, long sizeBytes, String sha256, UUID createdBy, Instant createdAt, String origin, String createdByName
   ) {
   }
}
