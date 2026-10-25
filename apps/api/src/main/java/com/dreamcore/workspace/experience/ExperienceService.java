package com.dreamcore.workspace.experience;

import com.dreamcore.workspace.departure.DepartureAccess;
import com.dreamcore.workspace.governance.GovernanceAccess;
import com.dreamcore.workspace.identity.IdentityAudit;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.identity.IdentityService;
import com.dreamcore.workspace.material.MaterialAccess;
import java.lang.Character.UnicodeScript;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@Service
public class ExperienceService {
   private final JdbcTemplate db;
   private final MaterialAccess access;
   private final GovernanceAccess governance;
   private final IdentityService identities;
   private final IdentityAudit audit;
   private final JsonMapper json = new JsonMapper();
   private final DepartureAccess departure;
   private static final String EVIDENCE_VISIBLE = "NOT EXISTS (SELECT 1 FROM experience_evidence r WHERE r.version_id=v.id AND NOT (\nEXISTS(SELECT 1 FROM workspaces w LEFT JOIN workspace_members g ON g.workspace_id=w.id AND g.tenant_id=w.tenant_id AND g.account_id=headquarters_permission_actor(p.actor,w.tenant_id)\nWHERE w.id=r.source_workspace_id AND w.tenant_id=e.tenant_id AND ((w.kind='PERSONAL' AND w.owner_id=headquarters_permission_actor(p.actor,w.tenant_id)) OR (w.kind='SHARED' AND g.account_id IS NOT NULL))\nAND ((r.kind='MATERIAL_VERSION' AND EXISTS(SELECT 1 FROM material_versions mv JOIN active_materials am ON am.id=mv.material_id WHERE mv.id=r.material_version_id AND mv.tenant_id=e.tenant_id AND mv.workspace_id=w.id AND (library_mask(p.actor,e.tenant_id,'MATERIAL',am.id)&1)=1))\nOR (r.kind='TASK' AND EXISTS(SELECT 1 FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id WHERE t.id=r.task_id AND t.tenant_id=e.tenant_id AND t.workspace_id=w.id AND c.owner_id=headquarters_permission_actor(p.actor,e.tenant_id) AND EXISTS(SELECT 1 FROM readable_source_tasks rt WHERE rt.id=t.id)))))))\n";
   static final String VISIBLE = "(object_is_active('EXPERIENCE_VERSION',v.id) AND NOT v.scrubbed AND ((v.access_mode='INDEPENDENT_COPY' AND NOT library_experience_permissions_enabled(e.tenant_id,v.id)) OR NOT EXISTS (SELECT 1 FROM experience_evidence r WHERE r.version_id=v.id AND NOT (\nEXISTS(SELECT 1 FROM workspaces w LEFT JOIN workspace_members g ON g.workspace_id=w.id AND g.tenant_id=w.tenant_id AND g.account_id=headquarters_permission_actor(p.actor,w.tenant_id)\nWHERE w.id=r.source_workspace_id AND w.tenant_id=e.tenant_id AND ((w.kind='PERSONAL' AND w.owner_id=headquarters_permission_actor(p.actor,w.tenant_id)) OR (w.kind='SHARED' AND g.account_id IS NOT NULL))\nAND ((r.kind='MATERIAL_VERSION' AND EXISTS(SELECT 1 FROM material_versions mv JOIN active_materials am ON am.id=mv.material_id WHERE mv.id=r.material_version_id AND mv.tenant_id=e.tenant_id AND mv.workspace_id=w.id AND (library_mask(p.actor,e.tenant_id,'MATERIAL',am.id)&1)=1))\nOR (r.kind='TASK' AND EXISTS(SELECT 1 FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id WHERE t.id=r.task_id AND t.tenant_id=e.tenant_id AND t.workspace_id=w.id AND c.owner_id=headquarters_permission_actor(p.actor,e.tenant_id) AND EXISTS(SELECT 1 FROM readable_source_tasks rt WHERE rt.id=t.id)))))))\n))";

   public ExperienceService(
      JdbcTemplate db, MaterialAccess access, GovernanceAccess governance, IdentityService identities, IdentityAudit audit, DepartureAccess departure
   ) {
      this.departure = departure;
      this.db = db;
      this.access = access;
      this.governance = governance;
      this.identities = identities;
      this.audit = audit;
   }

   private IdentityException missing() {
      return new IdentityException(404, "EXPERIENCE_NOT_FOUND");
   }

   private void paging(int offset, int limit) {
      if (offset < 0 || offset > 100000 || limit < 1 || limit > 50) {
         throw IdentityException.invalid();
      }
   }

   private String text(String s, int max, boolean required) {
      if (s != null
         && s.length() <= max
         && (!required || !s.isBlank())
         && !s.codePoints().anyMatch(c -> Character.isISOControl(c) && c != 10 && c != 13 && c != 9)) {
         return s.strip();
      } else {
         throw IdentityException.invalid();
      }
   }

   private ExperienceService.Content normalize(ExperienceService.Content c) {
      if (c != null
         && c.kind() != null
         && c.accessMode() != null
         && Set.of("METHOD", "CASE", "CORRECTION", "ASSET").contains(c.kind())
         && Set.of("SOURCE_BOUND", "INDEPENDENT_COPY").contains(c.accessMode())
         && c.tags() != null
         && c.tags().size() <= 20) {
         List<String> tags = c.tags().stream().map(t -> this.text(t, 40, true).toLowerCase(Locale.ROOT)).distinct().sorted().toList();
         return new ExperienceService.Content(
            c.kind(),
            this.text(c.title(), 160, true),
            this.text(c.summary(), 600, true),
            this.text(c.body(), 16000, true),
            tags,
            this.text(c.applicable(), 2000, true),
            this.text(c.excluded(), 2000, false),
            this.text(c.dependencies(), 2000, false),
            this.text(c.basis(), 2000, true),
            c.accessMode()
         );
      } else {
         throw IdentityException.invalid();
      }
   }

   public static List<String> terms(String value) {
      TreeSet<String> result = new TreeSet<>();
      Matcher m = Pattern.compile("[\\p{IsHan}]+|[\\p{L}\\p{N}_-]+").matcher(value.toLowerCase(Locale.ROOT));

      while (m.find()) {
         String s = m.group();
         int[] chars = s.codePoints().toArray();
         if (UnicodeScript.of(chars[0]) == UnicodeScript.HAN && chars.length > 1) {
            for (int i = 0; i < chars.length; i++) {
               result.add(new String(chars, i, 1));
               if (i < chars.length - 1) {
                  result.add(new String(chars, i, 2));
               }
            }
         } else {
            result.add(s);
         }
      }

      return List.copyOf(result);
   }

   private boolean scope(UUID actor, UUID tenant, UUID space, boolean write) {
      MaterialAccess.Space s = this.access.require(actor, tenant, space, false);
      if (write) {
         this.departure.requireActiveBusiness(actor, tenant);
      }

      boolean allowed = s.kind().equals("PERSONAL")
         ? s.canMaintain()
         : this.governance.allows(actor, tenant, GovernanceAccess.Capability.EXPERIENCE_MAINTAIN, space);
      if (write && !allowed) {
         throw new IdentityException(403, "CAPABILITY_REQUIRED");
      } else {
         return allowed && !this.departure.exiting(tenant);
      }
   }

   private Map<String, Object> row(UUID actor, UUID tenant, UUID space, UUID id, boolean write) {
      this.scope(actor, tenant, space, write);
      List<Map<String, Object>> r = this.db
         .queryForList(
            "SELECT * FROM experience_entries WHERE tenant_id=? AND workspace_id=? AND id=?" + (write ? " FOR UPDATE" : ""), new Object[]{tenant, space, id}
         );
      if (r.isEmpty()) {
         throw this.missing();
      } else {
         return r.getFirst();
      }
   }

   private int n(Map<String, Object> r, String key) {
      return ((Number)r.get(key)).intValue();
   }

   private Instant time(Object t) {
      return ((Timestamp)t).toInstant();
   }

   private boolean evidenceAllowed(UUID actor, UUID tenant, ExperienceService.Evidence ref) {
      try {
         this.access.require(actor, tenant, ref.workspaceId(), false);
         if (ref.kind().equals("MATERIAL_VERSION")) {
            this.access.requireVersion(actor, tenant, ref.referenceId(), false);
            return true;
         } else {
            return Boolean.TRUE
               .equals(
                  this.db
                     .queryForObject(
                        "SELECT EXISTS(SELECT 1 FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id WHERE t.id=? AND t.tenant_id=? AND t.workspace_id=? AND c.owner_id=? AND EXISTS(SELECT 1 FROM readable_source_tasks rt WHERE rt.id=t.id))",
                        Boolean.class,
                        new Object[]{ref.referenceId(), tenant, ref.workspaceId(), actor}
                     )
               );
         }
      } catch (IdentityException ex) {
         if (ex.status != 403 && ex.status != 404) {
            throw ex;
         } else {
            return false;
         }
      }
   }

   private List<ExperienceService.Evidence> refs(UUID version) {
      return this.db
         .query(
            "SELECT kind,reference_id,source_workspace_id FROM experience_evidence WHERE version_id=? ORDER BY kind,reference_id",
            (r, i) -> new ExperienceService.Evidence(r.getString(1), r.getObject(2, UUID.class), r.getObject(3, UUID.class)),
            new Object[]{version}
         );
   }

   private void requireEvidence(UUID actor, UUID tenant, List<ExperienceService.Evidence> refs) {
      for (ExperienceService.Evidence ref : refs) {
         if (!this.evidenceAllowed(actor, tenant, ref)) {
            throw new IdentityException(404, "EXPERIENCE_EVIDENCE_UNAVAILABLE");
         }
      }
   }

   private List<ExperienceService.Evidence> normalizeRefs(UUID actor, UUID tenant, ExperienceService.Content c, List<ExperienceService.Evidence> evidence) {
      if (evidence != null
         && evidence.size() <= 100
         && !evidence.stream()
            .anyMatch(
               rx -> rx == null
                  || rx.referenceId() == null
                  || rx.workspaceId() == null
                  || rx.kind() == null
                  || !Set.of("MATERIAL_VERSION", "TASK").contains(rx.kind())
            )) {
         LinkedHashSet<ExperienceService.Evidence> all = new LinkedHashSet<>(evidence);
         this.requireEvidence(actor, tenant, List.copyOf(all));

         for (ExperienceService.Evidence r : evidence) {
            if (r.kind().equals("TASK")) {
               String status = (String)this.db.queryForObject("SELECT status FROM conversation_tasks WHERE id=?", String.class, new Object[]{r.referenceId()});
               if (!Set.of("SUCCEEDED", "FAILED", "CANCELLED", "INTERRUPTED").contains(status)) {
                  throw new IdentityException(409, "EXPERIENCE_TASK_UNFINISHED");
               }

               for (UUID v : this.db.queryForList("SELECT version_id FROM library_task_versions(?)", UUID.class, new Object[]{r.referenceId()})) {
                  List<UUID> spaces = this.db
                     .queryForList("SELECT workspace_id FROM material_versions WHERE tenant_id=? AND id=?", UUID.class, new Object[]{tenant, v});
                  if (spaces.isEmpty()) {
                     throw new IdentityException(404, "EXPERIENCE_EVIDENCE_UNAVAILABLE");
                  }

                  all.add(new ExperienceService.Evidence("MATERIAL_VERSION", v, spaces.getFirst()));
               }
            }
         }

         if (all.size() <= 100 && (!c.accessMode().equals("SOURCE_BOUND") || !all.isEmpty())) {
            List<ExperienceService.Evidence> result = all.stream().sorted(Comparator.comparing(rx -> rx.kind() + rx.referenceId())).toList();
            this.requireEvidence(actor, tenant, result);
            return result;
         } else {
            throw IdentityException.invalid();
         }
      } else {
         throw IdentityException.invalid();
      }
   }

   private Map<String, Object> versionRow(UUID actor, UUID tenant, UUID space, UUID entry, UUID version) {
      List<Map<String, Object>> rows = this.db
         .queryForList(
            "WITH principal AS (SELECT ?::uuid actor) SELECT v.* FROM experience_versions v JOIN experience_entries e ON e.id=v.entry_id CROSS JOIN principal p WHERE e.id=? AND e.tenant_id=? AND e.workspace_id=? AND v.id=? AND (object_is_active('EXPERIENCE_VERSION',v.id) AND NOT v.scrubbed AND ((v.access_mode='INDEPENDENT_COPY' AND NOT library_experience_permissions_enabled(e.tenant_id,v.id)) OR NOT EXISTS (SELECT 1 FROM experience_evidence r WHERE r.version_id=v.id AND NOT (\nEXISTS(SELECT 1 FROM workspaces w LEFT JOIN workspace_members g ON g.workspace_id=w.id AND g.tenant_id=w.tenant_id AND g.account_id=headquarters_permission_actor(p.actor,w.tenant_id)\nWHERE w.id=r.source_workspace_id AND w.tenant_id=e.tenant_id AND ((w.kind='PERSONAL' AND w.owner_id=headquarters_permission_actor(p.actor,w.tenant_id)) OR (w.kind='SHARED' AND g.account_id IS NOT NULL))\nAND ((r.kind='MATERIAL_VERSION' AND EXISTS(SELECT 1 FROM material_versions mv JOIN active_materials am ON am.id=mv.material_id WHERE mv.id=r.material_version_id AND mv.tenant_id=e.tenant_id AND mv.workspace_id=w.id AND (library_mask(p.actor,e.tenant_id,'MATERIAL',am.id)&1)=1))\nOR (r.kind='TASK' AND EXISTS(SELECT 1 FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id WHERE t.id=r.task_id AND t.tenant_id=e.tenant_id AND t.workspace_id=w.id AND c.owner_id=headquarters_permission_actor(p.actor,e.tenant_id) AND EXISTS(SELECT 1 FROM readable_source_tasks rt WHERE rt.id=t.id)))))))\n))",
            new Object[]{actor, entry, tenant, space, version}
         );
      if (rows.isEmpty()) {
         throw this.missing();
      } else {
         return rows.getFirst();
      }
   }

   private ExperienceService.Version projectVersion(UUID actor, UUID tenant, Map<String, Object> r) {
      UUID id = (UUID)r.get("id");
      List<ExperienceService.Evidence> refs = this.refs(id);
      String mode = (String)r.get("access_mode");
      if (mode.equals("SOURCE_BOUND")) {
         this.requireEvidence(actor, tenant, refs);
      }

      return new ExperienceService.Version(
         id,
         this.n(r, "number"),
         1,
         (ExperienceService.Content)this.json.readValue(r.get("content").toString(), ExperienceService.Content.class),
         refs.stream().filter(ref -> this.evidenceAllowed(actor, tenant, ref)).toList(),
         (String)r.get("origin"),
         (String)r.get("evaluation"),
         (UUID)r.get("created_by"),
         this.time(r.get("created_at"))
      );
   }

   ExperienceService.Entry analysisEntry(UUID actor, UUID tenant, UUID space, UUID id, UUID version) {
      return this.get(actor, tenant, space, id, version);
   }

   @Transactional
   public ExperienceService.Entry get(UUID actor, UUID tenant, UUID space, UUID id, UUID version) {
      Map<String, Object> e = this.row(actor, tenant, space, id, false);
      boolean maintain = this.scope(actor, tenant, space, false);
      UUID selected = version;
      if (selected == null) {
         selected = maintain
            ? (UUID)this.db
               .queryForObject("SELECT id FROM experience_versions WHERE entry_id=? AND number=?", UUID.class, new Object[]{id, this.n(e, "latest_number")})
            : (UUID)e.get("published_version");
      }

      if (selected == null) {
         throw this.missing();
      } else if (!maintain
         && !Objects.equals(selected, e.get("published_version"))
         && !Boolean.TRUE
            .equals(
               this.db
                  .queryForObject(
                     "SELECT EXISTS(SELECT 1 FROM experience_events WHERE entry_id=? AND version_id=? AND action='PUBLISHED')",
                     Boolean.class,
                     new Object[]{id, selected}
                  )
            )) {
         throw this.missing();
      } else {
         return new ExperienceService.Entry(
            id,
            tenant,
            space,
            this.n(e, "revision"),
            (String)e.get("status"),
            this.n(e, "latest_number"),
            (UUID)e.get("published_version"),
            maintain,
            this.projectVersion(actor, tenant, this.versionRow(actor, tenant, space, id, selected)),
            maintain && "WITHDRAWN".equals(e.get("status")) && selected.equals(this.lastPublished(id)) && this.restoreSourcesAvailable(selected)
         );
      }
   }

   @Transactional
   public <T> T retiredManualWrite(UUID actor, UUID tenant, UUID space, boolean maintain) {
      this.scope(actor, tenant, space, maintain);
      throw new IdentityException(410, "EXPERIENCE_MANUAL_WORKFLOW_RETIRED");
   }

   @Transactional
   public ExperienceService.Page engineList(UUID actor, UUID tenant, UUID space, String query, int offset, int limit) {
      return this.listContent(actor, tenant, space, query, "", false, offset, limit, true);
   }

   @Transactional
   public ExperienceService.Page list(UUID actor, UUID tenant, UUID space, String query, String tag, boolean maintenance, int offset, int limit) {
      return this.listContent(actor, tenant, space, query, tag, maintenance, offset, limit, false);
   }

   private ExperienceService.Page listContent(
      UUID actor, UUID tenant, UUID space, String query, String tag, boolean maintenance, int offset, int limit, boolean qualifiedOnly
   ) {
      this.paging(offset, limit);
      boolean can = this.scope(actor, tenant, space, maintenance);
      query = this.text(query, 200, false);
      tag = this.text(tag, 40, false).toLowerCase(Locale.ROOT);
      ArrayList<Object> args = new ArrayList<>(List.of(actor, tenant, space));
      String sql = "WITH principal AS (SELECT ?::uuid actor) SELECT e.id entry_id,e.revision,e.status,v.* FROM experience_entries e JOIN experience_versions v ON v.entry_id=e.id AND "
         + (maintenance ? "v.number=e.latest_number" : "v.id=e.published_version AND e.status='PUBLISHED'")
         + " CROSS JOIN principal p WHERE e.tenant_id=? AND e.workspace_id=? AND (object_is_active('EXPERIENCE_VERSION',v.id) AND NOT v.scrubbed AND ((v.access_mode='INDEPENDENT_COPY' AND NOT library_experience_permissions_enabled(e.tenant_id,v.id)) OR NOT EXISTS (SELECT 1 FROM experience_evidence r WHERE r.version_id=v.id AND NOT (\nEXISTS(SELECT 1 FROM workspaces w LEFT JOIN workspace_members g ON g.workspace_id=w.id AND g.tenant_id=w.tenant_id AND g.account_id=headquarters_permission_actor(p.actor,w.tenant_id)\nWHERE w.id=r.source_workspace_id AND w.tenant_id=e.tenant_id AND ((w.kind='PERSONAL' AND w.owner_id=headquarters_permission_actor(p.actor,w.tenant_id)) OR (w.kind='SHARED' AND g.account_id IS NOT NULL))\nAND ((r.kind='MATERIAL_VERSION' AND EXISTS(SELECT 1 FROM material_versions mv JOIN active_materials am ON am.id=mv.material_id WHERE mv.id=r.material_version_id AND mv.tenant_id=e.tenant_id AND mv.workspace_id=w.id AND (library_mask(p.actor,e.tenant_id,'MATERIAL',am.id)&1)=1))\nOR (r.kind='TASK' AND EXISTS(SELECT 1 FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id WHERE t.id=r.task_id AND t.tenant_id=e.tenant_id AND t.workspace_id=w.id AND c.owner_id=headquarters_permission_actor(p.actor,e.tenant_id) AND EXISTS(SELECT 1 FROM readable_source_tasks rt WHERE rt.id=t.id)))))))\n))";
      if (qualifiedOnly) {
         sql = sql + " AND v.origin='AUTOMATIC' AND v.evaluation='AUTOMATIC_CHECKED'";
      }

      List<String> tokens = terms(query);
      if (!query.isBlank() && tokens.isEmpty()) {
         return new ExperienceService.Page(List.of(), false, can, "READY");
      }

      if (!tokens.isEmpty()) {
         sql = sql + " AND v.search_terms @> ?::text[]";
         args.add(tokens.toArray(String[]::new));
      }

      if (!tag.isBlank()) {
         sql = sql + " AND v.tags @> ?::text[]";
         args.add(new String[]{tag});
      }

      sql = sql + " ORDER BY e.updated_at DESC,e.id LIMIT ? OFFSET ?";
      args.add(limit + 1);
      args.add(offset);
      List<Map<String, Object>> rows = this.db.queryForList(sql, args.toArray());
      List<ExperienceService.Summary> summaries = rows.stream()
         .limit(limit)
         .map(
            r -> {
               ExperienceService.Content c = (ExperienceService.Content)this.json.readValue(r.get("content").toString(), ExperienceService.Content.class);
               return new ExperienceService.Summary(
                  (UUID)r.get("entry_id"),
                  (UUID)r.get("id"),
                  this.n((Map<String, Object>)r, "number"),
                  this.n((Map<String, Object>)r, "revision"),
                  (String)r.get("status"),
                  c.title(),
                  c.summary(),
                  c.tags(),
                  c.applicable(),
                  c.excluded(),
                  (String)r.get("origin"),
                  (String)r.get("evaluation")
               );
            }
         )
         .toList();
      return new ExperienceService.Page(summaries, rows.size() > limit, can, "READY");
   }

   @Transactional
   public ExperienceService.Versions versions(UUID actor, UUID tenant, UUID space, UUID id, int offset, int limit) {
      this.paging(offset, limit);
      this.row(actor, tenant, space, id, true);
      List<Map<String, Object>> rows = this.db
         .queryForList(
            "WITH principal AS (SELECT ?::uuid actor) SELECT v.* FROM experience_versions v JOIN experience_entries e ON e.id=v.entry_id CROSS JOIN principal p WHERE e.id=? AND (object_is_active('EXPERIENCE_VERSION',v.id) AND NOT v.scrubbed AND ((v.access_mode='INDEPENDENT_COPY' AND NOT library_experience_permissions_enabled(e.tenant_id,v.id)) OR NOT EXISTS (SELECT 1 FROM experience_evidence r WHERE r.version_id=v.id AND NOT (\nEXISTS(SELECT 1 FROM workspaces w LEFT JOIN workspace_members g ON g.workspace_id=w.id AND g.tenant_id=w.tenant_id AND g.account_id=headquarters_permission_actor(p.actor,w.tenant_id)\nWHERE w.id=r.source_workspace_id AND w.tenant_id=e.tenant_id AND ((w.kind='PERSONAL' AND w.owner_id=headquarters_permission_actor(p.actor,w.tenant_id)) OR (w.kind='SHARED' AND g.account_id IS NOT NULL))\nAND ((r.kind='MATERIAL_VERSION' AND EXISTS(SELECT 1 FROM material_versions mv JOIN active_materials am ON am.id=mv.material_id WHERE mv.id=r.material_version_id AND mv.tenant_id=e.tenant_id AND mv.workspace_id=w.id AND (library_mask(p.actor,e.tenant_id,'MATERIAL',am.id)&1)=1))\nOR (r.kind='TASK' AND EXISTS(SELECT 1 FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id WHERE t.id=r.task_id AND t.tenant_id=e.tenant_id AND t.workspace_id=w.id AND c.owner_id=headquarters_permission_actor(p.actor,e.tenant_id) AND EXISTS(SELECT 1 FROM readable_source_tasks rt WHERE rt.id=t.id)))))))\n)) ORDER BY v.number DESC LIMIT ? OFFSET ?",
            new Object[]{actor, id, limit + 1, offset}
         );
      return new ExperienceService.Versions(
         rows.stream().limit(limit).map(r -> this.projectVersion(actor, tenant, (Map<String, Object>)r)).toList(), rows.size() > limit
      );
   }

   private String hash(Object... args) {
      return IdentityService.hash(this.json.writeValueAsString(args));
   }

   private UUID append(UUID actor, UUID id, int number, ExperienceService.Content c, List<ExperienceService.Evidence> refs) {
      UUID v = UUID.randomUUID();
      List<String> terms = terms(c.title() + " " + c.summary() + " " + c.body() + " " + c.applicable() + " " + String.join(" ", c.tags()));
      this.db
         .update(
            "INSERT INTO experience_versions(id,entry_id,number,content,access_mode,search_terms,tags,created_by) VALUES (?,?,?,?::jsonb,?,?::text[],?::text[],?)",
            new Object[]{v, id, number, this.json.writeValueAsString(c), c.accessMode(), terms.toArray(String[]::new), c.tags().toArray(String[]::new), actor}
         );

      for (ExperienceService.Evidence r : refs) {
         this.db
            .update(
               "INSERT INTO experience_evidence(version_id,kind,reference_id,source_workspace_id,material_version_id,task_id) VALUES (?,?,?,?,?,?)",
               new Object[]{
                  v,
                  r.kind(),
                  r.referenceId(),
                  r.workspaceId(),
                  r.kind().equals("MATERIAL_VERSION") ? r.referenceId() : null,
                  r.kind().equals("TASK") ? r.referenceId() : null
               }
            );
      }

      return v;
   }

   void adjustmentScope(UUID actor, UUID tenant, UUID space) {
      this.scope(actor, tenant, space, true);
   }

   ExperienceService.Entry adjustmentTarget(UUID actor, UUID tenant, UUID space, UUID id, UUID version, int expected) {
      Map<String, Object> row = this.row(actor, tenant, space, id, true);
      ExperienceService.Entry e = this.get(actor, tenant, space, id, version);
      if (!e.status().equals("PUBLISHED")
         || !version.equals(e.publishedVersion())
         || e.revision() != expected
         || Boolean.TRUE.equals(row.get("automation_stopped"))) {
         throw new IdentityException(409, "EXPERIENCE_STATE_CHANGED");
      } else if (!e.version().content().kind().equals("METHOD")) {
         throw IdentityException.invalid();
      } else {
         return e;
      }
   }

   ExperienceService.Content automaticContent(ExperienceService.Content c) {
      return this.normalize(c);
   }

   List<ExperienceService.Evidence> automaticEvidence(UUID actor, UUID tenant, ExperienceService.Content c, List<ExperienceService.Evidence> refs) {
      return this.normalizeRefs(actor, tenant, this.normalize(c), refs);
   }

   UUID appendAutomatic(UUID actor, UUID entry, int number, ExperienceService.Content c, List<ExperienceService.Evidence> refs, String fingerprint) {
      UUID version = this.append(actor, entry, number, this.normalize(c), refs);
      this.db
         .update(
            "UPDATE experience_versions SET origin='AUTOMATIC',evaluation='AUTOMATIC_CHECKED',content_fingerprint=? WHERE id=?",
            new Object[]{fingerprint, version}
         );
      return version;
   }

   private void forbidAutomaticWrite(UUID entry) {
      if (Boolean.TRUE
         .equals(
            this.db
               .queryForObject("SELECT EXISTS(SELECT 1 FROM experience_versions WHERE entry_id=? AND origin='AUTOMATIC')", Boolean.class, new Object[]{entry})
         )) {
         throw new IdentityException(409, "EXPERIENCE_AUTOMATIC_MANAGED");
      }
   }

   private void event(UUID actor, UUID tenant, UUID entry, UUID version, int revision, String action) {
      this.db
         .update(
            "INSERT INTO experience_events(id,entry_id,version_id,revision,action,actor_id) VALUES (?,?,?,?,?,?)",
            new Object[]{UUID.randomUUID(), entry, version, revision, action, actor}
         );
      this.audit.record(actor, tenant, "EXPERIENCE_" + action, entry, "SUCCESS");
   }

   @Deprecated(forRemoval = true)
   @Transactional
   public ExperienceService.Entry create(
      UUID actor, UUID tenant, UUID space, UUID key, ExperienceService.Content body, List<ExperienceService.Evidence> evidence
   ) {
      this.scope(actor, tenant, space, true);
      ExperienceService.Content c = this.normalize(body);
      List<ExperienceService.Evidence> refs = this.normalizeRefs(actor, tenant, c, evidence);
      String h = this.hash(tenant, space, c, refs);
      UUID prior = this.identities.priorRequest(actor, key, "EXPERIENCE_CREATE", h);
      if (prior != null) {
         UUID id = (UUID)this.db.queryForObject("SELECT entry_id FROM experience_versions WHERE id=?", UUID.class, new Object[]{prior});
         return this.get(actor, tenant, space, id, prior);
      } else {
         UUID id = UUID.randomUUID();
         this.db.update("INSERT INTO experience_entries(id,tenant_id,workspace_id,created_by) VALUES (?,?,?,?)", new Object[]{id, tenant, space, actor});
         UUID v = this.append(actor, id, 1, c, refs);
         this.event(actor, tenant, id, v, 1, "CREATED");
         this.identities.remember(actor, key, "EXPERIENCE_CREATE", h, v);
         return this.get(actor, tenant, space, id, v);
      }
   }

   @Deprecated(forRemoval = true)
   @Transactional
   public ExperienceService.Entry revise(
      UUID actor, UUID tenant, UUID space, UUID id, UUID key, int expected, ExperienceService.Content body, List<ExperienceService.Evidence> evidence
   ) {
      this.scope(actor, tenant, space, true);
      ExperienceService.Content c = this.normalize(body);
      List<ExperienceService.Evidence> refs = this.normalizeRefs(actor, tenant, c, evidence);
      String h = this.hash(tenant, space, id, expected, c, refs);
      UUID prior = this.identities.priorRequest(actor, key, "EXPERIENCE_REVISE", h);
      Map<String, Object> e = this.row(actor, tenant, space, id, true);
      if (prior != null) {
         return this.get(actor, tenant, space, id, prior);
      }

      this.forbidAutomaticWrite(id);
      if (this.n(e, "revision") != expected) {
         throw new IdentityException(409, "EXPERIENCE_STATE_CHANGED");
      }

      this.versionRow(
         actor,
         tenant,
         space,
         id,
         (UUID)this.db
            .queryForObject("SELECT id FROM experience_versions WHERE entry_id=? AND number=?", UUID.class, new Object[]{id, this.n(e, "latest_number")})
      );
      UUID v = this.append(actor, id, this.n(e, "latest_number") + 1, c, refs);
      this.db.update("UPDATE experience_entries SET latest_number=latest_number+1,revision=revision+1,updated_at=now() WHERE id=?", new Object[]{id});
      this.event(actor, tenant, id, v, expected + 1, "REVISED");
      this.identities.remember(actor, key, "EXPERIENCE_REVISE", h, v);
      return this.get(actor, tenant, space, id, v);
   }

   @Deprecated(forRemoval = true)
   @Transactional
   public ExperienceService.Entry publish(UUID actor, UUID tenant, UUID space, UUID id, UUID key, int expected, UUID version, boolean independentCopyConfirmed) {
      this.scope(actor, tenant, space, true);
      String h = this.hash(tenant, space, id, expected, version, independentCopyConfirmed);
      UUID prior = this.identities.priorRequest(actor, key, "EXPERIENCE_PUBLISH", h);
      Map<String, Object> e = this.row(actor, tenant, space, id, true);
      if (prior != null) {
         return this.get(actor, tenant, space, id, prior);
      }

      this.forbidAutomaticWrite(id);
      if (this.n(e, "revision") != expected) {
         throw new IdentityException(409, "EXPERIENCE_STATE_CHANGED");
      }

      Map<String, Object> v = this.versionRow(actor, tenant, space, id, version);
      this.requireEvidence(actor, tenant, this.refs(version));
      if ("INDEPENDENT_COPY".equals(v.get("access_mode")) && !independentCopyConfirmed) {
         throw new IdentityException(409, "EXPERIENCE_COPY_CONFIRMATION_REQUIRED");
      }

      this.db
         .update(
            "UPDATE experience_entries SET status='PUBLISHED',published_version=?,revision=revision+1,updated_at=now() WHERE id=?", new Object[]{version, id}
         );
      this.event(actor, tenant, id, version, expected + 1, "PUBLISHED");
      this.identities.remember(actor, key, "EXPERIENCE_PUBLISH", h, version);
      return this.get(actor, tenant, space, id, version);
   }

   @Transactional
   public ExperienceService.Entry withdraw(UUID actor, UUID tenant, UUID space, UUID id, UUID key, int expected) {
      this.scope(actor, tenant, space, true);
      String h = this.hash(tenant, space, id, expected);
      UUID prior = this.identities.priorRequest(actor, key, "EXPERIENCE_WITHDRAW", h);
      Map<String, Object> e = this.row(actor, tenant, space, id, true);
      if (prior != null) {
         return this.get(actor, tenant, space, id, prior);
      }

      if (this.n(e, "revision") != expected) {
         throw new IdentityException(409, "EXPERIENCE_STATE_CHANGED");
      }

      UUID v = (UUID)e.get("published_version");
      if (v == null) {
         throw new IdentityException(409, "EXPERIENCE_NOT_PUBLISHED");
      }

      this.db
         .update(
            "UPDATE experience_entries SET status='WITHDRAWN',published_version=NULL,automation_stopped=true,revision=revision+1,updated_at=now() WHERE id=?",
            new Object[]{id}
         );
      this.event(actor, tenant, id, v, expected + 1, "WITHDRAWN");
      this.identities.remember(actor, key, "EXPERIENCE_WITHDRAW", h, v);
      return this.get(actor, tenant, space, id, v);
   }

   @Transactional
   public ExperienceService.Availability stop(UUID actor, UUID tenant, UUID space, UUID id, UUID key, int expected, UUID version) {
      this.scope(actor, tenant, space, true);
      String h = this.hash(tenant, space, id, expected, version);
      UUID prior = this.identities.priorRequest(actor, key, "EXPERIENCE_STOP", h);
      Map<String, Object> e = this.row(actor, tenant, space, id, true);
      if (prior != null) {
         return new ExperienceService.Availability(id, prior, expected + 1, "WITHDRAWN");
      } else if (this.n(e, "revision") == expected && "PUBLISHED".equals(e.get("status")) && version.equals(e.get("published_version"))) {
         this.versionRow(actor, tenant, space, id, version);
         this.db
            .update(
               "UPDATE experience_entries SET status='WITHDRAWN',published_version=NULL,automation_stopped=true,revision=revision+1,updated_at=now() WHERE id=?",
               new Object[]{id}
            );
         this.event(actor, tenant, id, version, expected + 1, "WITHDRAWN");
         this.identities.remember(actor, key, "EXPERIENCE_STOP", h, version);
         return new ExperienceService.Availability(id, version, expected + 1, "WITHDRAWN");
      } else {
         throw new IdentityException(409, "EXPERIENCE_STATE_CHANGED");
      }
   }

   private UUID lastPublished(UUID entry) {
      List<UUID> ids = this.db
         .queryForList(
            "SELECT version_id FROM experience_events WHERE entry_id=? AND action='PUBLISHED' ORDER BY revision DESC,created_at DESC LIMIT 1",
            UUID.class,
            new Object[]{entry}
         );
      return ids.isEmpty() ? null : ids.getFirst();
   }

   private boolean restoreSourcesAvailable(UUID version) {
      return Boolean.TRUE
         .equals(
            this.db
               .queryForObject(
                  "SELECT NOT EXISTS(SELECT 1 FROM experience_automatic_sources s WHERE s.version_id=? AND NOT experience_intake_available(s.source_id)) AND NOT EXISTS(SELECT 1 FROM experience_automatic_dependencies d JOIN experience_versions v ON v.id=d.dependency_version JOIN experience_entries e ON e.id=v.entry_id WHERE d.version_id=? AND (v.scrubbed OR (e.automation_stopped AND e.id<>(SELECT entry_id FROM experience_versions WHERE id=?)) OR NOT object_is_active('EXPERIENCE_VERSION',v.id)))",
                  Boolean.class,
                  new Object[]{version, version, version}
               )
         );
   }

   @Transactional
   public ExperienceService.Entry restore(UUID actor, UUID tenant, UUID space, UUID id, UUID key, int expected, UUID version) {
      this.scope(actor, tenant, space, true);
      this.db.queryForList("SELECT id FROM tenants WHERE id=? FOR SHARE", new Object[]{tenant});
      String h = this.hash(tenant, space, id, expected, version);
      UUID prior = this.identities.priorRequest(actor, key, "EXPERIENCE_RESTORE", h);
      this.versionRow(actor, tenant, space, id, version);
      this.db
         .queryForList(
            "SELECT i.id FROM experience_intake_sources i JOIN experience_automatic_sources s ON s.source_id=i.id WHERE s.version_id=? ORDER BY i.id FOR SHARE OF i",
            new Object[]{version}
         );
      this.db.queryForList("SELECT id FROM experience_versions WHERE id=? FOR SHARE", new Object[]{version});
      Map<String, Object> e = this.row(actor, tenant, space, id, true);
      if (prior != null) {
         return this.get(actor, tenant, space, id, prior);
      }

      if (this.n(e, "revision") == expected && "WITHDRAWN".equals(e.get("status")) && version.equals(this.lastPublished(id))) {
         this.versionRow(actor, tenant, space, id, version);
         if (!this.restoreSourcesAvailable(version)) {
            throw new IdentityException(409, "EXPERIENCE_EVIDENCE_UNAVAILABLE");
         }

         this.db
            .update(
               "UPDATE experience_entries SET status='PUBLISHED',published_version=?,automation_stopped=false,revision=revision+1,updated_at=now() WHERE id=?",
               new Object[]{version, id}
            );
         this.db
            .update(
               "INSERT INTO experience_events(id,entry_id,version_id,revision,action,actor_id) VALUES (?,?,?,?,'PUBLISHED',?)",
               new Object[]{UUID.randomUUID(), id, version, expected + 1, actor}
            );
         this.audit.record(actor, tenant, "EXPERIENCE_RESTORED", id, "SUCCESS");
         this.identities.remember(actor, key, "EXPERIENCE_RESTORE", h, version);
         return this.get(actor, tenant, space, id, version);
      } else {
         throw new IdentityException(409, "EXPERIENCE_STATE_CHANGED");
      }
   }

   @Transactional
   public ExperienceService.Events events(UUID actor, UUID tenant, UUID space, UUID id, int offset, int limit) {
      this.paging(offset, limit);
      this.row(actor, tenant, space, id, true);
      List<ExperienceService.Event> rows = this.db
         .query(
            "SELECT id,revision,version_id,action,actor_id,created_at FROM experience_events WHERE entry_id=? ORDER BY revision DESC,id LIMIT ? OFFSET ?",
            (r, n) -> new ExperienceService.Event(
               r.getObject(1, UUID.class), r.getInt(2), r.getObject(3, UUID.class), r.getString(4), r.getObject(5, UUID.class), r.getTimestamp(6).toInstant()
            ),
            new Object[]{id, limit + 1, offset}
         );
      return new ExperienceService.Events(rows.stream().limit(limit).toList(), rows.size() > limit);
   }

   private ExperienceService.Use projectUse(Map<String, Object> r) {
      return new ExperienceService.Use(
         (UUID)r.get("id"),
         (UUID)r.get("entry_id"),
         (UUID)r.get("version_id"),
         (UUID)r.get("task_id"),
         (String)r.get("context_key"),
         (String)r.get("decision"),
         (Boolean)r.get("adopted"),
         (String)r.get("conditions"),
         (String)r.get("adjustments"),
         this.time(r.get("created_at"))
      );
   }

   private void requireUseTask(UUID actor, UUID tenant, Object task) {
      if (task != null) {
         List<UUID> spaces = this.db
            .queryForList("SELECT workspace_id FROM conversation_tasks WHERE tenant_id=? AND id=?", UUID.class, new Object[]{tenant, task});
         if (spaces.isEmpty() || !this.evidenceAllowed(actor, tenant, new ExperienceService.Evidence("TASK", (UUID)task, spaces.getFirst()))) {
            throw new IdentityException(404, "EXPERIENCE_EVIDENCE_UNAVAILABLE");
         }
      }
   }

   private ExperienceService.Use use(UUID actor, UUID tenant, UUID space, UUID entry, UUID use) {
      this.row(actor, tenant, space, entry, false);
      List<Map<String, Object>> rows = this.db
         .queryForList("SELECT * FROM experience_uses WHERE id=? AND entry_id=? AND actor_id=?", new Object[]{use, entry, actor});
      if (rows.isEmpty()) {
         throw this.missing();
      }

      Map<String, Object> r = rows.getFirst();
      this.requireUseTask(actor, tenant, r.get("task_id"));
      this.versionRow(actor, tenant, space, entry, (UUID)r.get("version_id"));
      return this.projectUse(r);
   }

   @Transactional
   public ExperienceService.Use recordUse(UUID actor, UUID tenant, UUID space, UUID entry, UUID key, ExperienceService.UseInput input) {
      this.scope(actor, tenant, space, false);
      if (input != null
         && input.versionId() != null
         && input.decision() != null
         && Set.of("DIRECT", "ADAPTED", "UNKNOWN", "NOT_APPLICABLE").contains(input.decision())
         && (!input.adopted() || Set.of("DIRECT", "ADAPTED").contains(input.decision()))) {
         ExperienceService.UseInput b = new ExperienceService.UseInput(
            input.versionId(),
            input.taskId(),
            this.text(input.contextKey(), 100, true),
            input.decision(),
            input.adopted(),
            this.text(input.conditions(), 2000, true),
            this.text(input.adjustments(), 2000, false)
         );
         if (b.taskId() != null) {
            List<UUID> ts = this.db
               .queryForList("SELECT workspace_id FROM conversation_tasks WHERE tenant_id=? AND id=?", UUID.class, new Object[]{tenant, b.taskId()});
            if (ts.isEmpty() || !this.evidenceAllowed(actor, tenant, new ExperienceService.Evidence("TASK", b.taskId(), ts.getFirst()))) {
               throw new IdentityException(404, "EXPERIENCE_EVIDENCE_UNAVAILABLE");
            }
         }

         String h = this.hash(tenant, space, entry, b);
         UUID prior = this.identities.priorRequest(actor, key, "EXPERIENCE_USE", h);
         this.row(actor, tenant, space, entry, false);
         Map<String, Object> e = (Map<String, Object>)this.db
            .queryForList("SELECT * FROM experience_entries WHERE id=? FOR UPDATE", new Object[]{entry})
            .getFirst();
         if (prior != null) {
            return this.use(actor, tenant, space, entry, prior);
         }

         if ("PUBLISHED".equals(e.get("status")) && b.versionId().equals(e.get("published_version"))) {
            this.versionRow(actor, tenant, space, entry, b.versionId());
            if (Boolean.TRUE
               .equals(
                  this.db
                     .queryForObject(
                        "SELECT EXISTS(SELECT 1 FROM experience_uses WHERE actor_id=? AND version_id=? AND (context_key=? OR (?::uuid IS NOT NULL AND task_id=?)))",
                        Boolean.class,
                        new Object[]{actor, b.versionId(), b.contextKey(), b.taskId(), b.taskId()}
                     )
               )) {
               throw new IdentityException(409, "EXPERIENCE_USE_EXISTS");
            }

            UUID id = UUID.randomUUID();
            this.db
               .update(
                  "INSERT INTO experience_uses(id,entry_id,version_id,actor_id,task_id,context_key,decision,adopted,conditions,adjustments) VALUES (?,?,?,?,?,?,?,?,?,?)",
                  new Object[]{id, entry, b.versionId(), actor, b.taskId(), b.contextKey(), b.decision(), b.adopted(), b.conditions(), b.adjustments()}
               );
            this.identities.remember(actor, key, "EXPERIENCE_USE", h, id);
            this.audit.record(actor, tenant, "EXPERIENCE_USE", entry, "SUCCESS");
            return this.use(actor, tenant, space, entry, id);
         } else {
            throw new IdentityException(409, "EXPERIENCE_NOT_CURRENT");
         }
      } else {
         throw IdentityException.invalid();
      }
   }

   @Transactional
   public ExperienceService.Uses uses(UUID actor, UUID tenant, UUID space, UUID entry, int offset, int limit) {
      this.paging(offset, limit);
      this.row(actor, tenant, space, entry, false);
      List<Map<String, Object>> rows = this.db
         .queryForList(
            "WITH principal AS (SELECT ?::uuid actor) SELECT u.* FROM experience_uses u JOIN experience_versions v ON v.id=u.version_id JOIN experience_entries e ON e.id=u.entry_id CROSS JOIN principal p WHERE u.entry_id=? AND u.actor_id=? AND (u.task_id IS NULL OR EXISTS(SELECT 1 FROM conversation_tasks ut JOIN workspaces uw ON uw.id=ut.workspace_id LEFT JOIN workspace_members ug ON ug.tenant_id=ut.tenant_id AND ug.workspace_id=uw.id AND ug.account_id=headquarters_permission_actor(p.actor,uw.tenant_id) WHERE ut.id=u.task_id AND ut.tenant_id=e.tenant_id AND ut.requested_by=p.actor AND EXISTS(SELECT 1 FROM readable_source_tasks rt WHERE rt.id=ut.id) AND ((uw.kind='PERSONAL' AND uw.owner_id=headquarters_permission_actor(p.actor,uw.tenant_id)) OR (uw.kind='SHARED' AND ug.account_id IS NOT NULL)))) AND (object_is_active('EXPERIENCE_VERSION',v.id) AND NOT v.scrubbed AND ((v.access_mode='INDEPENDENT_COPY' AND NOT library_experience_permissions_enabled(e.tenant_id,v.id)) OR NOT EXISTS (SELECT 1 FROM experience_evidence r WHERE r.version_id=v.id AND NOT (\nEXISTS(SELECT 1 FROM workspaces w LEFT JOIN workspace_members g ON g.workspace_id=w.id AND g.tenant_id=w.tenant_id AND g.account_id=headquarters_permission_actor(p.actor,w.tenant_id)\nWHERE w.id=r.source_workspace_id AND w.tenant_id=e.tenant_id AND ((w.kind='PERSONAL' AND w.owner_id=headquarters_permission_actor(p.actor,w.tenant_id)) OR (w.kind='SHARED' AND g.account_id IS NOT NULL))\nAND ((r.kind='MATERIAL_VERSION' AND EXISTS(SELECT 1 FROM material_versions mv JOIN active_materials am ON am.id=mv.material_id WHERE mv.id=r.material_version_id AND mv.tenant_id=e.tenant_id AND mv.workspace_id=w.id AND (library_mask(p.actor,e.tenant_id,'MATERIAL',am.id)&1)=1))\nOR (r.kind='TASK' AND EXISTS(SELECT 1 FROM conversation_tasks t JOIN conversations c ON c.id=t.conversation_id WHERE t.id=r.task_id AND t.tenant_id=e.tenant_id AND t.workspace_id=w.id AND c.owner_id=headquarters_permission_actor(p.actor,e.tenant_id) AND EXISTS(SELECT 1 FROM readable_source_tasks rt WHERE rt.id=t.id)))))))\n)) ORDER BY u.created_at DESC,u.id LIMIT ? OFFSET ?",
            new Object[]{actor, entry, actor, limit + 1, offset}
         );
      return new ExperienceService.Uses(rows.stream().limit(limit).map(this::projectUse).toList(), rows.size() > limit);
   }

   private ExperienceService.Feedback feedback(UUID id) {
      return (ExperienceService.Feedback)this.db
         .queryForObject(
            "SELECT * FROM experience_feedback WHERE id=?",
            (r, n) -> new ExperienceService.Feedback(
               r.getObject("id", UUID.class),
               r.getObject("use_id", UUID.class),
               r.getString("result"),
               r.getString("note"),
               r.getTimestamp("created_at").toInstant()
            ),
            new Object[]{id}
         );
   }

   @Transactional
   public ExperienceService.Feedback feedback(UUID actor, UUID tenant, UUID space, UUID entry, UUID use, UUID key, String result, String note) {
      this.use(actor, tenant, space, entry, use);
      if (result != null && Set.of("UNKNOWN", "COMPLETED", "FAILED", "CORRECTED").contains(result)) {
         note = this.text(note, 2000, true);
         String h = this.hash(tenant, space, entry, use, result, note);
         UUID prior = this.identities.priorRequest(actor, key, "EXPERIENCE_FEEDBACK", h);
         if (prior != null) {
            return this.feedback(prior);
         }

         UUID id = UUID.randomUUID();
         this.db.update("INSERT INTO experience_feedback(id,use_id,result,note) VALUES (?,?,?,?)", new Object[]{id, use, result, note});
         this.identities.remember(actor, key, "EXPERIENCE_FEEDBACK", h, id);
         return this.feedback(id);
      } else {
         throw IdentityException.invalid();
      }
   }

   @Transactional
   public ExperienceService.Feedbacks feedbacks(UUID actor, UUID tenant, UUID space, UUID entry, UUID use, int offset, int limit) {
      this.paging(offset, limit);
      this.use(actor, tenant, space, entry, use);
      List<UUID> ids = this.db
         .queryForList(
            "SELECT id FROM experience_feedback WHERE use_id=? ORDER BY created_at DESC,id LIMIT ? OFFSET ?", UUID.class, new Object[]{use, limit + 1, offset}
         );
      return new ExperienceService.Feedbacks(ids.stream().limit(limit).map(this::feedback).toList(), ids.size() > limit);
   }

   public record Availability(UUID entryId, UUID versionId, int revision, String status) {
   }

   public record Content(
      String kind,
      String title,
      String summary,
      String body,
      List<String> tags,
      String applicable,
      String excluded,
      String dependencies,
      String basis,
      String accessMode
   ) {
   }

   public record Entry(
      UUID id,
      UUID tenantId,
      UUID workspaceId,
      int revision,
      String status,
      int latestNumber,
      UUID publishedVersion,
      boolean canMaintain,
      ExperienceService.Version version,
      boolean canRestore
   ) {
   }

   public record Event(UUID id, int revision, UUID versionId, String action, UUID actorId, Instant createdAt) {
   }

   public record Events(List<ExperienceService.Event> items, boolean hasMore) {
   }

   public record Evidence(String kind, UUID referenceId, UUID workspaceId) {
   }

   public record Feedback(UUID id, UUID useId, String result, String note, Instant createdAt) {
   }

   public record Feedbacks(List<ExperienceService.Feedback> items, boolean hasMore) {
   }

   public record Page(List<ExperienceService.Summary> items, boolean hasMore, boolean canMaintain, String indexStatus) {
   }

   public record Summary(
      UUID id,
      UUID versionId,
      int number,
      int revision,
      String status,
      String title,
      String summary,
      List<String> tags,
      String applicable,
      String excluded,
      String origin,
      String evaluation
   ) {
   }

   public record Use(
      UUID id,
      UUID entryId,
      UUID versionId,
      UUID taskId,
      String contextKey,
      String decision,
      boolean adopted,
      String conditions,
      String adjustments,
      Instant createdAt
   ) {
   }

   public record UseInput(UUID versionId, UUID taskId, String contextKey, String decision, boolean adopted, String conditions, String adjustments) {
   }

   public record Uses(List<ExperienceService.Use> items, boolean hasMore) {
   }

   public record Version(
      UUID id,
      int number,
      int schemaVersion,
      ExperienceService.Content content,
      List<ExperienceService.Evidence> evidence,
      String origin,
      String evaluation,
      UUID createdBy,
      Instant createdAt
   ) {
   }

   public record Versions(List<ExperienceService.Version> items, boolean hasMore) {
   }
}
