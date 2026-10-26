package com.dreamcore.workspace.collection;

import com.dreamcore.workspace.governance.GovernanceSourceEvidence;
import com.dreamcore.workspace.identity.IdentityService;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.json.JsonMapper;

/** Transport never authorizes business facts: deployment pins both the version and exact definition bytes. */
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
    /** Kept pure for adversarial protocol tests. Null remains compatible only with unconfigured datasets. */
    public static boolean valid(CollectionAdapter.SourceContract c, UUID tenant, UUID dataset, List<String> columns,
            String scopeHash, List<Map<String,Object>> pins, List<Map<String,Object>> entries, List<Map<String,Object>> schema) {
        if (c == null) return pins.isEmpty();
        try {
            if (pins.size() != 1 || !"1.0".equals(c.contractVersion()) || !tenant.equals(c.tenantId()) || !dataset.equals(c.datasetId())
                    || c.definitionVersion() < 1 || c.definitionJson() == null || c.definitionJson().length() > 262144
                    || !IdentityService.hash(c.definitionJson()).equals(c.definitionSha256())) return false;
            var pin = pins.getFirst();
            if (!(pin.get("definitionVersion") instanceof Number version) || version.intValue() != c.definitionVersion()
                    || !c.definitionSha256().equals(pin.get("definitionSha256"))) return false;
            var body = new JsonMapper().readValue(c.definitionJson(), Map.class);
            // The installed semantic evidence must agree too: plans and field explanations cannot drift independently.
            return body.keySet().equals(Set.of("columns", "scopeHash", "entries", "schema"))
                && columns.equals(body.get("columns")) && scopeHash != null && scopeHash.equals(body.get("scopeHash"))
                && entries.equals(body.get("entries")) && rules(schema).equals(body.get("schema"));
        } catch (RuntimeException malformed) { return false; }
    }
    public boolean valid(UUID tenant, CollectionAdapter.Snapshot snapshot, List<String> columns) {
        var schema = approved(evidencePath, tenant, snapshot.datasetId(), "schema");
        var pins = schema.stream().filter(i -> "source-contract".equals(i.get("kind"))).toList();
        return valid(snapshot.sourceContract(), tenant, snapshot.datasetId(), columns,
            snapshot.exportReceipt() == null ? null : snapshot.exportReceipt().scopeHash(), pins,
            approved(evidencePath, tenant, snapshot.datasetId(), "entries"), schema);
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
        var schema = approved(configured, tenant, dataset, "schema");
        var pins = schema.stream().filter(i -> "source-contract".equals(i.get("kind"))).toList();
        var received = received(tenant, dataset, snapshot);
        if (received == null) return Map.of("state", pins.isEmpty() ? "NOT_CONFIGURED" : "NOT_RECEIVED");
        var scopes = db.queryForList("SELECT receipt->>'scopeHash' FROM collection_snapshot_receipts WHERE tenant_id=? AND dataset_id=? AND snapshot_id=?", String.class, tenant, dataset, snapshot);
        boolean ok = valid(received, tenant, dataset, (List<String>)columns, scopes.isEmpty() ? null : scopes.getFirst(), pins, approved(configured, tenant, dataset, "entries"), schema);
        return Map.of("state", ok ? "CHECKED" : "MISMATCH", "definitionVersion", received.definitionVersion(), "definitionSha256", received.definitionSha256());
    }
}
