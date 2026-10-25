package com.dreamcore.workspace.document;

import com.dreamcore.workspace.identity.IdentityAudit;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.identity.IdentityService;
import com.dreamcore.workspace.material.MaterialAccess;
import com.dreamcore.workspace.material.MaterialService;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@Service
public class DocumentPublicationService {
   private final JdbcTemplate db;
   private final DocumentService documents;
   private final MaterialService materials;
   private final MaterialAccess access;
   private final IdentityService identities;
   private final IdentityAudit audit;
   private final RowMapper<DocumentPublicationService.Publication> mapper = (r, n) -> new DocumentPublicationService.Publication(
      r.getObject("id", UUID.class),
      r.getObject("tenant_id", UUID.class),
      r.getObject("document_id", UUID.class),
      r.getInt("document_version"),
      r.getObject("workspace_id", UUID.class),
      r.getObject("destination_folder_id", UUID.class),
      r.getObject("material_id", UUID.class),
      r.getObject("material_version_id", UUID.class),
      r.getInt("material_version"),
      r.getString("filename"),
      r.getString("format"),
      r.getString("sha256"),
      r.getTimestamp("published_at").toInstant()
   );

   public DocumentPublicationService(
      JdbcTemplate db, DocumentService documents, MaterialService materials, MaterialAccess access, IdentityService identities, IdentityAudit audit
   ) {
      this.db = db;
      this.documents = documents;
      this.materials = materials;
      this.access = access;
      this.identities = identities;
      this.audit = audit;
   }

   private DocumentPublicationService.Publication receipt(UUID actor, UUID tenant, UUID id) {
      List<DocumentPublicationService.Publication> rows = this.db
         .query("SELECT * FROM document_publications WHERE tenant_id=? AND actor_id=? AND id=?", this.mapper, new Object[]{tenant, actor, id});
      if (rows.isEmpty()) {
         throw new IdentityException(404, "DOCUMENT_NOT_FOUND");
      }

      DocumentPublicationService.Publication value = rows.getFirst();
      this.access.requireObject(actor, tenant, value.workspaceId(), "MATERIAL", value.materialId(), false);
      return value;
   }

   @Transactional
   public DocumentPublicationService.Page list(UUID actor, UUID tenant, UUID document, int offset, int limit) {
      if (offset >= 0 && offset <= 10000 && limit >= 1 && limit <= 30) {
         this.documents.detail(actor, tenant, document, null);
         List<DocumentPublicationService.Publication> values = this.db
            .query(
               "SELECT p.* FROM document_publications p JOIN workspace_members g ON g.tenant_id=p.tenant_id AND g.workspace_id=p.workspace_id AND g.account_id=p.actor_id\nWHERE p.tenant_id=? AND p.actor_id=? AND p.document_id=? AND (library_mask(p.actor_id,p.tenant_id,'MATERIAL',p.material_id)&1)=1 ORDER BY p.published_at DESC,p.id LIMIT ? OFFSET ?\n",
               this.mapper,
               new Object[]{tenant, actor, document, limit + 1, offset}
            );
         return new DocumentPublicationService.Page(tenant, document, values.stream().limit(limit).toList(), values.size() > limit);
      } else {
         throw IdentityException.invalid();
      }
   }

   @Transactional
   public DocumentPublicationService.Publication publish(
      UUID actor,
      UUID tenant,
      UUID document,
      int version,
      UUID key,
      UUID workspace,
      UUID folder,
      UUID material,
      Integer expectedVersion,
      String format,
      boolean acknowledged
   ) {
      if (acknowledged
         && version >= 1
         && workspace != null
         && format != null
         && Set.of("docx", "pdf").contains(format)
         && (material != null || expectedVersion == null)
         && (material == null || folder == null && expectedVersion != null && expectedVersion >= 1)) {
         String fingerprint = IdentityService.hash(
            new JsonMapper().writeValueAsString(new Object[]{tenant, document, version, workspace, folder, material, expectedVersion, format})
         );
         UUID prior = this.identities.priorRequest(actor, key, "DOCUMENT_PUBLISH", fingerprint);
         MaterialAccess.Space destination = this.access
            .requireObject(
               actor,
               tenant,
               workspace,
               material != null ? "MATERIAL" : (folder != null ? "FOLDER" : "WORKSPACE"),
               material != null ? material : (folder != null ? folder : workspace),
               true
            );
         if (!destination.kind().equals("SHARED")) {
            throw new IdentityException(400, "DOCUMENT_PUBLISH_TARGET_INVALID");
         }

         if (prior != null) {
            this.documents.detail(actor, tenant, document, version);
            return this.receipt(actor, tenant, prior);
         }

         DocumentService.Export exported = this.documents.publicationContent(actor, tenant, document, version, format);
         DocumentService.Detail source = this.documents.detail(actor, tenant, document, version);
         if (Boolean.TRUE
            .equals(
               this.db
                  .queryForObject(
                     "SELECT library_permissions_enabled(?) OR library_task_has_scoped_sources(?)",
                     Boolean.class,
                     new Object[]{tenant, source.document().taskId()}
                  )
            )) {
            String targetKind = material != null ? "MATERIAL" : (folder != null ? "FOLDER" : "WORKSPACE");
            UUID target = material != null ? material : (folder != null ? folder : workspace);

            for (UUID recipient : this.db
               .queryForList(
                  "SELECT account_id FROM tenant_memberships WHERE tenant_id=? AND status='ACTIVE' AND (library_mask(account_id,tenant_id,?,?)&1)=1",
                  UUID.class,
                  new Object[]{tenant, targetKind, target}
               )) {
               this.access.requireTaskSources(recipient, tenant, source.document().taskId(), false);
            }
         }

         List<UUID> existing = this.db
            .queryForList(
               "SELECT id FROM document_publications WHERE tenant_id=? AND actor_id=? AND document_id=? AND document_version=? AND workspace_id=? AND folder_id IS NOT DISTINCT FROM ? AND update_material_id IS NOT DISTINCT FROM ? AND format=?",
               UUID.class,
               new Object[]{tenant, actor, document, version, workspace, folder, material, format}
            );
         UUID id;
         if (!existing.isEmpty()) {
            id = existing.getFirst();
         } else {
            String filename = MaterialService.name(source.version().title().replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}\\p{Cf}]", "_").strip() + "." + format);
            MaterialService.Entry stored = this.materials
               .storeGenerated(actor, tenant, workspace, folder, material, expectedVersion, filename, exported.bytes());
            UUID saved = (UUID)this.db
               .queryForObject(
                  "SELECT id FROM material_versions WHERE tenant_id=? AND workspace_id=? AND material_id=? AND number=?",
                  UUID.class,
                  new Object[]{tenant, workspace, stored.id(), stored.version()}
               );
            id = UUID.randomUUID();
            this.db
               .update(
                  "INSERT INTO document_publications(id,tenant_id,actor_id,document_id,document_version,workspace_id,folder_id,destination_folder_id,update_material_id,material_id,material_version_id,material_version,format,filename,sha256) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  new Object[]{
                     id,
                     tenant,
                     actor,
                     document,
                     version,
                     workspace,
                     folder,
                     stored.folderId(),
                     material,
                     stored.id(),
                     saved,
                     stored.version(),
                     format,
                     filename,
                     exported.sha256()
                  }
               );
            this.audit.record(actor, tenant, "DOCUMENT_PUBLISH", stored.id(), "SUCCESS");
         }

         this.identities.remember(actor, key, "DOCUMENT_PUBLISH", fingerprint, id);
         return this.receipt(actor, tenant, id);
      } else {
         throw IdentityException.invalid();
      }
   }

   public record Page(UUID tenantId, UUID documentId, List<DocumentPublicationService.Publication> items, boolean hasMore) {
   }

   public record Publication(
      UUID id,
      UUID tenantId,
      UUID documentId,
      int documentVersion,
      UUID workspaceId,
      UUID folderId,
      UUID materialId,
      UUID materialVersionId,
      int materialVersion,
      String filename,
      String format,
      String sha256,
      Instant publishedAt
   ) {
   }
}
