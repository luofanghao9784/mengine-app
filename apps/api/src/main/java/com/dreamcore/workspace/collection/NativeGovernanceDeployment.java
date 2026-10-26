package com.dreamcore.workspace.collection;

import com.dreamcore.workspace.governance.GovernanceReferencePolicy;
import com.dreamcore.workspace.governance.GovernanceSourceEvidence;
import com.dreamcore.workspace.identity.IdentityAudit;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.identity.IdentityService;
import com.dreamcore.workspace.profile.CompanyBackgroundSourceService;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Service
public class NativeGovernanceDeployment {
   private final JdbcTemplate db;
   private final TransactionTemplate tx;
   private final CollectionService collections;
   private final CompanyBackgroundSourceService background;
   private final IdentityAudit audit;
   private final Environment env;
   @Autowired
   private NativeMaterialGovernance materialGovernance;
   private final JsonMapper json = new JsonMapper();
   @org.springframework.beans.factory.annotation.Value("${dreamcore.governance.source-evidence:}")
   private String evidencePath = "";

   public NativeGovernanceDeployment(
      JdbcTemplate db, TransactionTemplate tx, CollectionService collections, CompanyBackgroundSourceService background, IdentityAudit audit, Environment env
   ) {
      this.db = db;
      this.tx = tx;
      this.collections = collections;
      this.background = background;
      this.audit = audit;
      this.env = env;
   }

   private void check(boolean ok) {
      if (!ok) {
         throw new IdentityException(409, "GOVERNANCE_BASIS_CHANGED");
      }
   }

   private void text(String s, int max) {
      this.check(s != null && !s.isBlank() && s.length() <= max);
   }

   private UUID subject(UUID actor, UUID tenant) {
      return (UUID)this.db.queryForObject("SELECT headquarters_permission_actor(?,?)", UUID.class, new Object[]{actor, tenant});
   }

   public NativeGovernanceDeployment.Context context(UUID actor, UUID tenant, List<UUID> ids) {
      return (NativeGovernanceDeployment.Context)this.tx.execute(t -> this.contextInside(actor, tenant, ids));
   }

   /** Stable definitions can be reused only while the declared source contract is unchanged. */
   public NativeGovernanceDeployment.Context definitionContext(UUID actor, UUID tenant, List<UUID> ids) {
      return this.tx.execute(t -> this.contextInside(actor, tenant, ids, null, true));
   }

   private NativeGovernanceDeployment.Context contextInside(UUID actor, UUID tenant, List<UUID> ids) {
      return this.contextInside(actor, tenant, ids, null);
   }

   private NativeGovernanceDeployment.Context contextInside(UUID actor, UUID tenant, List<UUID> ids, String knownBackground) {
      return this.contextInside(actor, tenant, ids, knownBackground, false);
   }

   private NativeGovernanceDeployment.Context contextInside(UUID actor, UUID tenant, List<UUID> ids, String knownBackground, boolean definitions) {
      this.check(ids != null && !ids.isEmpty() && ids.size() <= 20 && new HashSet<>(ids).size() == ids.size());
      String backgroundVersion = knownBackground;
      if (backgroundVersion == null) {
         CompanyBackgroundSourceService.Source bg = this.background.get(actor, tenant);
         this.check(!bg.entries().isEmpty());
         backgroundVersion = bg.version();
      }

      ArrayList<NativeGovernanceDeployment.Source> sources = new ArrayList<>();

      for (UUID id : ids) {
         if (!this.collections.readable(actor, tenant, id)) {
            throw new IdentityException(404, "DATASET_NOT_FOUND");
         }

         Map<String, Object> row = this.db
            .queryForMap(
               "SELECT d.workspace_id,d.connection_id,d.dataset_key,d.name,d.description,d.column_names,d.field_definitions,d.current_snapshot,s.row_count,s.data_rows::text data_content,s.coverage_through FROM business_datasets d JOIN dataset_snapshots s ON s.id=d.current_snapshot AND s.dataset_id=d.id WHERE d.id=? AND d.tenant_id=? AND d.status='ACTIVE' AND NOT d.scrubbed AND NOT s.scrubbed",
               new Object[]{id, tenant}
            );
         List<String> columns = (List<String>)this.json
            .readValue(row.get("column_names").toString(), this.json.getTypeFactory().constructCollectionType(List.class, String.class));
         UUID snapshot = (UUID)row.get("current_snapshot");
         UUID space = (UUID)row.get("workspace_id");
         String token = IdentityService.hash(
            this.json
               .writeValueAsString(
                  List.of(
                     definitions ? "DEFINITION_V1" : "CONTENT_V2",
                     tenant,
                     id,
                     space,
                     definitions ? this.definitionEvidence(tenant, id, row) : IdentityService.hash(row.get("data_content").toString()),
                     definitions ? "" : Objects.toString(row.get("coverage_through"), ""),
                     row.get("column_names").toString(),
                     row.get("field_definitions").toString(),
                     backgroundVersion
                  )
               )
         );
         sources.add(new NativeGovernanceDeployment.Source(id, snapshot, space, token, ((Number)row.get("row_count")).longValue(), columns));
      }

      return new NativeGovernanceDeployment.Context(tenant, this.subject(actor, tenant), backgroundVersion, sources);
   }

   private Object canonical(Object value) {
      if (value instanceof Map<?,?> map) {
         var result = new java.util.TreeMap<String,Object>();
         map.forEach((key,item) -> result.put(key.toString(), canonical(item)));
         return result;
      }
      if (value instanceof List<?> list) return list.stream().map(this::canonical).toList();
      return value;
   }

   private String definitionEvidence(UUID tenant, UUID dataset, Map<String,Object> row) {
      String name = row.get("name").toString();
      boolean unique = this.db.queryForObject("SELECT count(*) FROM business_datasets WHERE tenant_id=? AND name=? AND status='ACTIVE' AND NOT scrubbed", Integer.class, tenant, name) == 1;
      var entries = GovernanceSourceEvidence.read(evidencePath, tenant, dataset, name, "entries", unique);
      var schema = GovernanceSourceEvidence.read(evidencePath, tenant, dataset, name, "schema", unique).stream()
          .filter(item -> !"export-validation".equals(item.get("kind"))).toList();
      return IdentityService.hash(this.json.writeValueAsString(canonical(List.of(row.get("connection_id"), row.get("dataset_key"), name,
          Objects.toString(row.get("description"), ""), this.sourceScope(tenant, dataset, row), entries, schema))));
   }

   private String sourceScope(UUID tenant, UUID dataset, Map<String,Object> row) {
      var values = this.db.queryForList("SELECT receipt->>'scopeHash' FROM collection_snapshot_receipts WHERE snapshot_id=? AND tenant_id=? AND dataset_id=?", String.class,
          row.get("current_snapshot"), tenant, dataset);
      if (!values.isEmpty()) return values.getFirst();
      // Missing current proof blocks analysis separately; it does not erase the last declared source contract.
      var prior = this.db.queryForList("SELECT receipt->>'scopeHash' FROM collection_snapshot_receipts WHERE tenant_id=? AND dataset_id=? ORDER BY received_at DESC,snapshot_id DESC LIMIT 1", String.class, tenant, dataset);
      return prior.isEmpty() ? "UNATTESTED" : prior.getFirst();
   }

   public NativeGovernanceDeployment.Receipt submit(NativeGovernanceDeployment.Package p, boolean publish) {
      return (NativeGovernanceDeployment.Receipt)this.tx
         .execute(
            t -> {
               this.check(
                  p != null
                     && Set.of("1.0", "1.1", "1.2").contains(p.contractVersion())
                     && p.id() != null
                     && p.tenantId() != null
                     && p.recipientId() != null
                     && p.items() != null
                     && !p.items().isEmpty()
                     && p.items().size() <= 20
               );
               this.check(!this.db.queryForList("SELECT id FROM tenants WHERE id=? AND status='ACTIVE' FOR UPDATE", new Object[]{p.tenantId()}).isEmpty());

               for (String field : List.of("NAME", "INDUSTRY", "BUSINESS", "TERM")) {
                  this.db
                     .queryForList("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", new Object[]{"company-information:" + p.tenantId() + ":" + field});
               }

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
               List<NativeMaterialGovernance.Reference> refs = p.materials() == null ? List.of() : p.materials();
               if ("1.1".equals(p.contractVersion())) {
                  this.check(!refs.isEmpty());
               }

               for (NativeMaterialGovernance.Reference ref : refs.stream()
                  .sorted(Comparator.comparing(NativeMaterialGovernance.Reference::materialId))
                  .toList()) {
                  this.db.queryForList("SELECT id FROM materials WHERE id=? AND tenant_id=? FOR UPDATE", new Object[]{ref.materialId(), p.tenantId()});
               }

               this.materialGovernance.validateReferences(p.recipientId(), p.tenantId(), refs);
               List<UUID> ids = p.items().stream().map(NativeGovernanceDeployment.Item::datasetId).toList();
               this.check(!ids.contains(null) && new HashSet<>(ids).size() == ids.size());

               for (UUID id : ids.stream().sorted().toList()) {
                  this.db.queryForList("SELECT id FROM business_datasets WHERE id=? AND tenant_id=? FOR UPDATE", new Object[]{id, p.tenantId()});
               }

               NativeGovernanceDeployment.Context ctx = this.contextInside(p.recipientId(), p.tenantId(), ids, null, "1.2".equals(p.contractVersion()));
               this.check(ctx.backgroundVersion().equals(p.backgroundVersion()));

               for (int i = 0; i < p.items().size(); i++) {
                  NativeGovernanceDeployment.Item item = p.items().get(i);
                  this.check(ctx.sources().get(i).token().equals(item.token()));
                  this.check(item.fields() != null && !item.fields().isEmpty());
                  DatasetField.validate(ctx.sources().get(i).columns(), item.fields());
                  GovernanceReferencePolicy.validateRetiredText(this, item.knowledge(), 12000);
                  this.check(item.evidence() != null && !item.evidence().isEmpty() && item.evidence().size() <= 30);

                  for (String evidence : item.evidence()) {
                     this.text(evidence, 500);
                  }
               }

               String content = this.json.writeValueAsString(p);
               this.check(content.length() <= 900000);
               String fingerprint = IdentityService.hash(content);
               List<Map<String, Object>> prior = this.db
                  .queryForList("SELECT tenant_id,fingerprint FROM native_governance_releases WHERE id=?", new Object[]{p.id()});
               if (prior.isEmpty()) {
                  if (publish) {
                     this.db
                        .update(
                           "INSERT INTO native_governance_releases(id,tenant_id,recipient_id,fingerprint,package) VALUES (?,?,?,?,CAST(? AS jsonb))",
                           new Object[]{p.id(), p.tenantId(), p.recipientId(), fingerprint, content}
                        );
                     this.audit.record(p.recipientId(), p.tenantId(), "NATIVE_GOVERNANCE_DEPLOY", p.id(), "SUCCESS");
                  }

                  return new NativeGovernanceDeployment.Receipt(p.id(), fingerprint, p.items().size(), publish);
               } else {
                  this.check(p.tenantId().equals(prior.getFirst().get("tenant_id")) && fingerprint.equals(prior.getFirst().get("fingerprint")));
                  return new NativeGovernanceDeployment.Receipt(p.id(), fingerprint, p.items().size(), true);
               }
            }
         );
   }

   public Object read(UUID actor, UUID tenant, UUID id) {
      return this.tx
         .execute(
            t -> {
               List<Map<String, Object>> rows = this.db
                  .queryForList(
                     "SELECT package FROM native_governance_releases WHERE id=? AND tenant_id=? AND recipient_id=headquarters_permission_actor(?,?)",
                     new Object[]{id, tenant, actor, tenant}
                  );
               if (rows.isEmpty()) {
                  throw new IdentityException(404, "GOVERNANCE_RELEASE_NOT_FOUND");
               }

               NativeGovernanceDeployment.Package p = (NativeGovernanceDeployment.Package)this.json
                  .readValue(rows.getFirst().get("package").toString(), NativeGovernanceDeployment.Package.class);
               NativeGovernanceDeployment.Context ctx = this.contextInside(
                  actor, tenant, p.items().stream().map(NativeGovernanceDeployment.Item::datasetId).toList(), null, "1.2".equals(p.contractVersion())
               );
               boolean valid = ctx.backgroundVersion().equals(p.backgroundVersion()) && this.materialsCurrent(actor, tenant, p);

               for (int i = 0; i < p.items().size(); i++) {
                  valid &= ctx.sources().get(i).token().equals(p.items().get(i).token());
               }

               return valid ? Map.of("state", "CURRENT", "release", p) : Map.of("state", "STALE", "id", id);
            }
         );
   }

   private boolean materialsCurrent(UUID actor, UUID tenant, NativeGovernanceDeployment.Package p) {
      try {
         this.materialGovernance.validateReferences(actor, tenant, p.materials() == null ? List.of() : p.materials());
         return true;
      } catch (IdentityException e) {
         return false;
      }
   }

   public List<UUID> list(UUID actor, UUID tenant) {
      this.background.get(actor, tenant);
      return this.db
         .queryForList(
            "SELECT id FROM native_governance_releases WHERE tenant_id=? AND recipient_id=headquarters_permission_actor(?,?) ORDER BY created_at DESC LIMIT 10000",
            UUID.class,
            new Object[]{tenant, actor, tenant}
         );
   }

   public List<NativeGovernanceDeployment.Published> current(UUID actor, UUID tenant) {
      return this.currentFor(actor, tenant, null);
   }

   public List<NativeGovernanceDeployment.Published> currentFor(UUID actor, UUID tenant, UUID source) {
      return (List<NativeGovernanceDeployment.Published>)this.tx
         .execute(
            t -> {
               String backgroundVersion = this.background.get(actor, tenant).version();
               ArrayList<NativeGovernanceDeployment.Published> result = new ArrayList<>();
               HashSet<UUID> seen = new HashSet<>();

               for (UUID id : this.db.queryForList(
                     "SELECT id FROM native_governance_releases WHERE tenant_id=? AND (recipient_id=headquarters_permission_actor(?,?) OR package->>'contractVersion'='1.2') AND (?::text IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(package->'items') i WHERE i->>'datasetId'=?)) ORDER BY created_at DESC,id DESC",
                     UUID.class,tenant,actor,tenant,source==null?null:source.toString(),source==null?null:source.toString())) {
                  NativeGovernanceDeployment.Package p = (NativeGovernanceDeployment.Package)this.json
                     .readValue(
                        (String)this.db.queryForObject("SELECT package::text FROM native_governance_releases WHERE id=?", String.class, new Object[]{id}),
                        NativeGovernanceDeployment.Package.class
                     );
                  if (!p.items().stream().anyMatch(ix -> !this.collections.readable(actor, tenant, ix.datasetId()))) {
                     NativeGovernanceDeployment.Context ctx = this.contextInside(
                        actor, tenant, p.items().stream().map(NativeGovernanceDeployment.Item::datasetId).toList(), backgroundVersion, "1.2".equals(p.contractVersion())
                     );
                     boolean valid = ctx.backgroundVersion().equals(p.backgroundVersion()) && this.materialsCurrent(actor, tenant, p);

                     for (int i = 0; i < p.items().size(); i++) {
                        valid &= ctx.sources().get(i).token().equals(p.items().get(i).token());
                     }

                     for (NativeGovernanceDeployment.Item item : p.items()) {
                        if (seen.add(item.datasetId()) && valid) {
                           boolean owner = p.recipientId().equals(this.subject(actor, tenant));
                           result.add(new NativeGovernanceDeployment.Published(id, item.datasetId(), owner ? item.knowledge() : "", owner ? item.evidence() : List.of(), item.fields()));
                        }
                     }
                  }
               }

               return result;
            }
         );
   }

   /** A task keeps its accepted snapshot; only 1.2 definitions may survive a later collection. */
   public List<NativeGovernanceDeployment.Published> currentForSnapshot(UUID actor, UUID tenant, UUID dataset, UUID snapshot) {
      return this.tx.execute(t -> {
         this.background.get(actor, tenant);
         if (!this.collections.readable(actor, tenant, dataset)) return List.of();
         // Hold the source contract steady while resolving the publication and receipt scope.
         var rows = this.db.queryForList("SELECT d.current_snapshot FROM business_datasets d JOIN dataset_snapshots s ON s.dataset_id=d.id AND s.id=? WHERE d.id=? AND d.tenant_id=? AND d.status='ACTIVE' AND NOT d.scrubbed AND NOT s.scrubbed FOR SHARE OF d", snapshot, dataset, tenant);
         if (rows.isEmpty()) return List.of();
         var publications = this.currentFor(actor, tenant, dataset).stream().filter(p -> p.datasetId().equals(dataset)).toList();
         if (snapshot.equals(rows.getFirst().get("current_snapshot"))) return publications;
         var scopes = this.db.queryForList("SELECT receipt->>'scopeHash' FROM collection_snapshot_receipts WHERE snapshot_id=? AND tenant_id=? AND dataset_id=?", String.class, snapshot, tenant, dataset);
         if (scopes.isEmpty() || !Objects.equals(scopes.getFirst(), this.sourceScope(tenant, dataset, rows.getFirst()))) return List.of();
         return publications.stream().filter(p -> "1.2".equals(this.db.queryForObject("SELECT package->>'contractVersion' FROM native_governance_releases WHERE id=? AND tenant_id=?", String.class, p.releaseId(), tenant))).toList();
      });
   }

   public int pendingReview(UUID actor, UUID tenant) {
      return (Integer)this.tx
         .execute(
            t -> {
               int count = 0;
               HashSet<UUID> seen = new HashSet<>();

               for (UUID id : this.list(actor, tenant)) {
                  NativeGovernanceDeployment.Package p = (NativeGovernanceDeployment.Package)this.json
                     .readValue(
                        (String)this.db.queryForObject("SELECT package::text FROM native_governance_releases WHERE id=?", String.class, new Object[]{id}),
                        NativeGovernanceDeployment.Package.class
                     );
                  boolean fresh = false;

                  try {
                     fresh = "CURRENT".equals(((Map)this.read(actor, tenant, id)).get("state"));
                  } catch (IdentityException e) {
                     continue;
                  }

                  for (NativeGovernanceDeployment.Item item : p.items()) {
                     if (seen.add(item.datasetId()) && !fresh) {
                        count++;
                     }
                  }
               }

               return count;
            }
         );
   }

   public void run() throws Exception {
      Path input = Path.of(this.env.getRequiredProperty("GOVERNANCE_INPUT"));
      Path output = Path.of(this.env.getRequiredProperty("GOVERNANCE_OUTPUT"));
      this.check(
         input.isAbsolute()
            && output.isAbsolute()
            && Files.isRegularFile(input, LinkOption.NOFOLLOW_LINKS)
            && Files.size(input) <= 1000000L
            && !Files.exists(output)
      );
      this.check(Files.getPosixFilePermissions(input).stream().noneMatch(p -> p.name().startsWith("GROUP_") || p.name().startsWith("OTHERS_")));
      String action = this.env.getRequiredProperty("GOVERNANCE_ACTION");
      String raw = Files.readString(input);
      Object result;
      if (action.equals("material-context")) {
         JsonNode n = this.json.readTree(raw);
         ArrayList<UUID> ids = new ArrayList<>();

         for (JsonNode id : n.path("materials")) {
            ids.add(UUID.fromString(id.asText()));
         }

         result = this.materialGovernance.context(UUID.fromString(n.path("recipientId").asText()), UUID.fromString(n.path("tenantId").asText()), ids);
      } else if (Set.of("material-preview", "material-apply").contains(action)) {
         result = this.materialGovernance
            .submit((NativeMaterialGovernance.Package)this.json.readValue(raw, NativeMaterialGovernance.Package.class), action.equals("material-apply"));
      } else if (action.equals("context")) {
         JsonNode n = this.json.readTree(raw);
         ArrayList<UUID> ids = new ArrayList<>();

         for (JsonNode id : n.path("datasets")) {
            ids.add(UUID.fromString(id.asText()));
         }

         result = this.context(UUID.fromString(n.path("recipientId").asText()), UUID.fromString(n.path("tenantId").asText()), ids);
      } else {
         this.check(Set.of("preview", "apply").contains(action));
         result = this.submit((NativeGovernanceDeployment.Package)this.json.readValue(raw, NativeGovernanceDeployment.Package.class), action.equals("apply"));
      }

      Files.createFile(output, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
      Files.writeString(output, this.json.writeValueAsString(result));
   }

   public record Context(UUID tenantId, UUID recipientId, String backgroundVersion, List<NativeGovernanceDeployment.Source> sources) {
   }

   public record Item(UUID datasetId, String token, List<DatasetField> fields, String knowledge, List<String> evidence) {
   }

   public record Package(
      String contractVersion,
      UUID id,
      UUID tenantId,
      UUID recipientId,
      String backgroundVersion,
      List<NativeGovernanceDeployment.Item> items,
      List<NativeMaterialGovernance.Reference> materials
   ) {
      public Package(String version, UUID id, UUID tenant, UUID recipient, String bg, List<NativeGovernanceDeployment.Item> items) {
         this(version, id, tenant, recipient, bg, items, List.of());
      }
   }

   public record Published(UUID releaseId, UUID datasetId, String knowledge, List<String> evidence, List<DatasetField> fields) {
   }

   public record Receipt(UUID id, String fingerprint, int datasets, boolean published) {
   }

   public record Source(UUID datasetId, UUID snapshotId, UUID workspaceId, String token, long rows, List<String> columns) {
   }
}
