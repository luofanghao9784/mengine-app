package com.dreamcore.workspace.collection;

import com.dreamcore.workspace.identity.IdentityAudit;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.identity.IdentityService;
import com.dreamcore.workspace.profile.CompanyBackgroundSourceService;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

@Service
public class NativeMaterialGovernance {
   private final JdbcTemplate db;
   private final TransactionTemplate tx;
   private final CompanyBackgroundSourceService background;
   private final IdentityAudit audit;
   private final JsonMapper json = new JsonMapper();

   public NativeMaterialGovernance(JdbcTemplate db, TransactionTemplate tx, CompanyBackgroundSourceService background, IdentityAudit audit) {
      this.db = db;
      this.tx = tx;
      this.background = background;
      this.audit = audit;
   }

   private void check(boolean valid) {
      if (!valid) {
         throw new IdentityException(409, "MATERIAL_GOVERNANCE_BASIS_CHANGED");
      }
   }

   private void text(String s, int max) {
      this.check(s != null && !s.isBlank() && s.length() <= max);
   }

   public NativeMaterialGovernance.Reference reference(UUID actor, UUID tenant, UUID id) {
      this.background.get(actor, tenant);
      return this.referenceInside(actor, tenant, id);
   }

   private NativeMaterialGovernance.Reference referenceInside(UUID actor, UUID tenant, UUID id) {
      List<Map<String, Object>> rows = this.db
         .queryForList(
            "SELECT m.workspace_id,v.id version_id,r.id run_id,v.sha256,r.status,\n (SELECT string_agg(c.id::text||':'||c.locator||':'||c.content,chr(10) ORDER BY c.ordinal,c.id) FROM knowledge_chunks c WHERE c.run_id=r.id) body\nFROM active_materials m JOIN workspaces w ON w.id=m.workspace_id AND w.tenant_id=m.tenant_id\nJOIN material_versions v ON v.material_id=m.id AND v.number=m.current_version\nJOIN LATERAL (SELECT id,status FROM knowledge_runs WHERE version_id=v.id ORDER BY generation DESC LIMIT 1) r ON true\nWHERE m.id=? AND m.tenant_id=? AND m.in_library AND w.kind='SHARED' AND NOT w.archived\n AND (library_mask(?,m.tenant_id,'MATERIAL',m.id)&1)=1 AND r.status IN ('READY','PARTIAL')\n",
            new Object[]{id, tenant, actor}
         );
      if (rows.isEmpty()) {
         throw new IdentityException(404, "MATERIAL_NOT_FOUND");
      }

      Map<String, Object> r = rows.getFirst();
      this.check(r.get("body") != null);
      return new NativeMaterialGovernance.Reference(
         id, (UUID)r.get("version_id"), (UUID)r.get("run_id"), IdentityService.hash(this.json.writeValueAsString(List.of(tenant, id, r)))
      );
   }

   public void validateReferences(UUID actor, UUID tenant, List<NativeMaterialGovernance.Reference> refs) {
      if (refs != null && !refs.isEmpty()) {
         this.background.get(actor, tenant);
      }

      this.validateReferencesInside(actor, tenant, refs);
   }

   private void validateReferencesInside(UUID actor, UUID tenant, List<NativeMaterialGovernance.Reference> refs) {
      this.check(refs != null && refs.size() <= 30 && refs.stream().allMatch(Objects::nonNull));
      this.check(refs.stream().map(NativeMaterialGovernance.Reference::materialId).distinct().count() == refs.size());

      for (NativeMaterialGovernance.Reference ref : refs) {
         this.check(ref.equals(this.referenceInside(actor, tenant, ref.materialId())));
      }
   }

   public NativeMaterialGovernance.Context context(UUID actor, UUID tenant, List<UUID> ids) {
      return (NativeMaterialGovernance.Context)this.tx.execute(t -> {
         this.check(ids != null && !ids.isEmpty() && ids.size() <= 20 && new HashSet<>(ids).size() == ids.size());
         CompanyBackgroundSourceService.Source bg = this.background.get(actor, tenant);
         this.check(!bg.entries().isEmpty());
         return new NativeMaterialGovernance.Context(bg.version(), ids.stream().map(id -> this.referenceInside(actor, tenant, id)).toList());
      });
   }

   public Object submit(NativeMaterialGovernance.Package p, boolean publish) {
      return this.tx
         .execute(
            t -> {
               this.check(
                  p != null
                     && "1.0".equals(p.contractVersion())
                     && p.id() != null
                     && p.items() != null
                     && !p.items().isEmpty()
                     && p.items().size() <= 20
                     && java.util.Set.of("CODEX_OPERATOR","SYSTEM_MODEL").contains(p.producer())
               );
               this.check(!this.db.queryForList("SELECT id FROM tenants WHERE id=? AND status='ACTIVE' FOR UPDATE", new Object[]{p.tenantId()}).isEmpty());
               this.check(
                  Boolean.TRUE
                     .equals(
                        this.db
                           .queryForObject(
                              "SELECT EXISTS(SELECT 1 FROM tenant_governance WHERE tenant_id=? AND owner_id=?)",
                              Boolean.class,
                              new Object[]{p.tenantId(), p.recipientId()}
                           )
                     )
               );

               for (String field : List.of("NAME", "INDUSTRY", "BUSINESS", "TERM")) {
                  this.db
                     .queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", new Object[]{"company-information:" + p.tenantId() + ":" + field});
               }

               for (UUID id : p.items().stream().map(i -> i.source().materialId()).sorted().toList()) {
                  this.db.queryForList("SELECT id FROM materials WHERE id=? AND tenant_id=? FOR UPDATE", new Object[]{id, p.tenantId()});
               }

               this.check(this.background.get(p.recipientId(), p.tenantId()).version().equals(p.backgroundVersion()));
               this.validateReferences(p.recipientId(), p.tenantId(), p.items().stream().map(NativeMaterialGovernance.Item::source).toList());

               for (NativeMaterialGovernance.Item i : p.items()) {
                  this.text(i.title(), 160);
                  this.text(i.content(), 20000);
                  this.check(i.evidence() != null && !i.evidence().isEmpty() && i.evidence().size() <= 30);

                  for (NativeMaterialGovernance.Quote q : i.evidence()) {
                     this.check(q != null && q.chunkId() != null);
                     this.text(q.text(), 500);
                     this.check(q.text().length() >= 6);
                     this.check(
                        Boolean.TRUE
                           .equals(
                              this.db
                                 .queryForObject(
                                    "SELECT EXISTS(SELECT 1 FROM knowledge_chunks WHERE id=? AND run_id=? AND strpos(content,?)>0)",
                                    Boolean.class,
                                    new Object[]{q.chunkId(), i.source().runId(), q.text()}
                                 )
                           )
                     );
                  }
               }

               String raw = this.json.writeValueAsString(p);
               this.check(raw.length() <= 900000);
               String fingerprint = IdentityService.hash(raw);
               List<Map<String, Object>> prior = this.db
                  .queryForList("SELECT fingerprint,tenant_id FROM native_material_releases WHERE id=?", new Object[]{p.id()});
               if (prior.isEmpty()) {
                  if (publish) {
                     this.db
                        .update(
                           "INSERT INTO native_material_releases(id,tenant_id,recipient_id,fingerprint,package) VALUES (?,?,?,?,?::jsonb)",
                           new Object[]{p.id(), p.tenantId(), p.recipientId(), fingerprint, raw}
                        );
                     this.audit.record(p.recipientId(), p.tenantId(), "NATIVE_MATERIAL_GOVERNANCE_DEPLOY", p.id(), "SUCCESS");
                  }

                  return Map.of("id", p.id(), "published", publish);
               } else {
                  this.check(fingerprint.equals(prior.getFirst().get("fingerprint")) && p.tenantId().equals(prior.getFirst().get("tenant_id")));
                  return Map.of("id", p.id(), "published", true);
               }
            }
         );
   }

   public List<NativeMaterialGovernance.Published> current(UUID actor, UUID tenant) {
      return this.currentFor(actor, tenant, null);
   }

   public List<NativeMaterialGovernance.Published> currentFor(UUID actor, UUID tenant, UUID source) {
      return (List<NativeMaterialGovernance.Published>)this.tx
         .execute(
            t -> {
               String backgroundVersion = this.background.get(actor, tenant).version();
               ArrayList<NativeMaterialGovernance.Published> result = new ArrayList<>();
               HashSet<UUID> seen = new HashSet<>();

               for (String raw : this.db
                  .queryForList(
                     "SELECT package::text FROM native_material_releases WHERE tenant_id=? AND recipient_id=headquarters_permission_actor(?,?) AND (?::text IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(package->'items') i WHERE i->'source'->>'materialId'=?)) ORDER BY created_at DESC,id DESC",
                     String.class,
                     new Object[]{tenant, actor, tenant, source == null ? null : source.toString(), source == null ? null : source.toString()}
                  )) {
                  NativeMaterialGovernance.Package p = (NativeMaterialGovernance.Package)this.json.readValue(raw, NativeMaterialGovernance.Package.class);
                  boolean valid = true;

                  try {
                     this.check(backgroundVersion.equals(p.backgroundVersion()));
                     this.validateReferencesInside(actor, tenant, p.items().stream().map(NativeMaterialGovernance.Item::source).toList());
                  } catch (IdentityException e) {
                     valid = false;
                  }

                  for (NativeMaterialGovernance.Item item : p.items()) {
                     if (seen.add(item.source().materialId()) && valid) {
                        result.add(new NativeMaterialGovernance.Published(p.id(), item.source().materialId(), item.title(), item.content()));
                     }
                  }
               }

               return result;
            }
         );
   }

   public record Context(String backgroundVersion, List<NativeMaterialGovernance.Reference> materials) {
   }

   public record Item(NativeMaterialGovernance.Reference source, String title, String content, List<NativeMaterialGovernance.Quote> evidence) {
   }

   public record Package(
      String contractVersion, UUID id, UUID tenantId, UUID recipientId, String backgroundVersion, String producer, List<NativeMaterialGovernance.Item> items
   ) {
   }

   public record Published(UUID releaseId, UUID materialId, String title, String content) {
   }

   public record Quote(UUID chunkId, String text) {
   }

   public record Reference(UUID materialId, UUID versionId, UUID runId, String token) {
   }
}
