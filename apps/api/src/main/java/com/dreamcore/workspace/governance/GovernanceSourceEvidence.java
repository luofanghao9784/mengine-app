package com.dreamcore.workspace.governance;

import com.dreamcore.workspace.identity.IdentityException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import tools.jackson.databind.json.JsonMapper;

public final class GovernanceSourceEvidence {
   private static final long MAX_BYTES = 16000000L;

   private GovernanceSourceEvidence() {
   }

   public static List<Map<String, Object>> read(String configured, UUID tenant, String table, String section) {
      return read(configured, tenant, null, table, section, true);
   }

   /** Dataset identity is authoritative across connectors; a display name is only a legacy fallback. */
   public static List<Map<String, Object>> read(String configured, UUID tenant, UUID dataset, String table, String section, boolean uniqueLegacyName) {
      if (configured != null && !configured.isBlank()) {
         if (tenant != null && table != null && Set.of("entries", "schema").contains(section)) {
            try {
               Path original = Path.of(configured).toAbsolutePath();
               Path scoped = original.resolveSibling("tenants").resolve(tenant + ".json");
               boolean hasScoped = Files.exists(scoped, LinkOption.NOFOLLOW_LINKS);
               Path selected = hasScoped ? scoped : original;
               if (Files.isRegularFile(selected, LinkOption.NOFOLLOW_LINKS) && Files.size(selected) <= 16000000L) {
                  Map<String, Object> document = (Map<String, Object>)new JsonMapper().readValue(Files.readString(selected), Map.class);
                  if (tenant.toString().equals(document.get("tenantId"))) {
                     if (document.getOrDefault(section, List.of()) instanceof List<?> list) {
                        ArrayList result = new ArrayList();

                        for (Object entry : list) {
                           if (!(entry instanceof Map<?, ?> map)) {
                              throw new IllegalStateException("Invalid evidence entry");
                           }

                           if (map.containsKey("datasetId")
                              ? dataset != null && dataset.toString().equals(map.get("datasetId"))
                              : uniqueLegacyName && table.equals(map.get("table"))) {
                              result.add(map);
                           }
                        }

                        return List.copyOf(result);
                     } else {
                        throw new IllegalStateException("Invalid evidence section");
                     }
                  } else if (hasScoped) {
                     throw new IllegalStateException("Tenant mismatch");
                  } else {
                     return List.of();
                  }
               } else {
                  throw new IllegalStateException("Invalid evidence file");
               }
            } catch (Exception error) {
               throw new IdentityException(503, "GOVERNANCE_EVIDENCE_UNAVAILABLE");
            }
         } else {
            throw new IdentityException(503, "GOVERNANCE_EVIDENCE_UNAVAILABLE");
         }
      } else {
         return List.of();
      }
   }
}
