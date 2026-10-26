package com.dreamcore.workspace.collection;

import com.dreamcore.workspace.governance.GovernanceSourceEvidence;
import com.dreamcore.workspace.identity.IdentityService;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.json.JsonMapper;

/** Collector definitions are checked against their payload and scope, without receiver-side approval pins. */
@Service
public class CollectionSourceContracts {
    private final JdbcTemplate db;
    private final JsonMapper json = new JsonMapper();
    @Value("${dreamcore.governance.source-evidence:}") private String evidencePath = "";
    public CollectionSourceContracts(JdbcTemplate db) { this.db = db; }

    private List<Map<String,Object>> approved(String configured, UUID tenant, UUID dataset, String section) {
        var row = db.queryForMap("SELECT name FROM business_datasets WHERE tenant_id=? AND id=?", tenant, dataset);
        String name = row.get("name").toString();
        boolean unique = db.queryForObject("SELECT count(*) FROM business_datasets WHERE tenant_id=? AND name=? AND status='ACTIVE' AND NOT scrubbed", Integer.class, tenant, name) == 1;
        return GovernanceSourceEvidence.read(configured, tenant, dataset, name, section, unique);
    }
    public static List<Map<String,Object>> rules(List<Map<String,Object>> schema) {
        return schema.stream().filter(i -> !Set.of("source-contract", "export-validation").contains(i.getOrDefault("kind", ""))).toList();
    }
    private Map<String,Object> body(CollectionAdapter.SourceContract contract) {
        return json.readValue(contract.definitionJson(), Map.class);
    }
    /** Missing definitions remain legacy-compatible; strict business preflight separately requires them. */
    public static boolean valid(CollectionAdapter.SourceContract c, UUID tenant, UUID dataset, List<String> columns,
            String scopeHash, List<Map<String,Object>> pins, List<Map<String,Object>> entries, List<Map<String,Object>> schema) {
        if (c == null) return true;
        try {
            if (!"1.0".equals(c.contractVersion()) || !tenant.equals(c.tenantId()) || !dataset.equals(c.datasetId())
                    || c.definitionVersion() < 1 || c.definitionJson() == null || c.definitionJson().length() > 262144
                    || !IdentityService.hash(c.definitionJson()).equals(c.definitionSha256())) return false;
            var body = new JsonMapper().readValue(c.definitionJson(), Map.class);
            // Identity, bytes, columns and scope remain mandatory. Business checks run independently.
            return body.keySet().equals(Set.of("columns", "scopeHash", "entries", "schema"))
                && columns.equals(body.get("columns")) && scopeHash != null && scopeHash.equals(body.get("scopeHash"))
                && body.get("entries") instanceof List<?> receivedEntries && receivedEntries.stream().allMatch(e -> e instanceof Map<?,?>)
                && body.get("schema") instanceof List<?> receivedRules && receivedRules.stream().allMatch(r -> r instanceof Map<?,?>);
        } catch (RuntimeException malformed) { return false; }
    }
    public boolean valid(UUID tenant, CollectionAdapter.Snapshot snapshot, List<String> columns) {
        return valid(snapshot.sourceContract(), tenant, snapshot.datasetId(), columns,
            snapshot.exportReceipt() == null ? null : snapshot.exportReceipt().scopeHash(), List.of(), List.of(), List.of());
    }

    private CollectionAdapter.SourceContract received(UUID tenant, UUID dataset, UUID snapshot) {
        var rows = db.queryForList("SELECT source_contract::text FROM collection_snapshot_receipts WHERE tenant_id=? AND dataset_id=? AND snapshot_id=? AND source_contract IS NOT NULL", String.class, tenant, dataset, snapshot);
        return rows.isEmpty() ? null : json.readValue(rows.getFirst(), CollectionAdapter.SourceContract.class);
    }
    public List<Map<String,Object>> section(String configured, UUID tenant, UUID dataset, UUID snapshot, String section) {
        var received = received(tenant, dataset, snapshot);
        if (received != null) return (List<Map<String,Object>>)body(received).get(section);
        return approved(configured, tenant, dataset, section).stream().filter(i -> !"source-contract".equals(i.get("kind"))).toList();
    }
    public Map<String,Object> check(String configured, UUID tenant, UUID dataset, UUID snapshot, List<?> columns) {
        var received = received(tenant, dataset, snapshot);
        if (received == null) return Map.of("state", "NOT_CONFIGURED");
        var scopes = db.queryForList("SELECT receipt->>'scopeHash' FROM collection_snapshot_receipts WHERE tenant_id=? AND dataset_id=? AND snapshot_id=?", String.class, tenant, dataset, snapshot);
        boolean ok = valid(received, tenant, dataset, (List<String>)columns, scopes.isEmpty() ? null : scopes.getFirst(), List.of(), List.of(), List.of());
        return Map.of("state", ok ? "CHECKED" : "MISMATCH", "definitionVersion", received.definitionVersion(), "definitionSha256", received.definitionSha256());
    }
}
