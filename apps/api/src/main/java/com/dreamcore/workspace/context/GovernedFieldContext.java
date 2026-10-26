package com.dreamcore.workspace.context;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Advisory view of the newest published native governance release for one dataset.
 *
 * <p>Read-only and never authoritative: it only tells the model what a column was confirmed to mean in conversations and briefings.
 * It must not change calculation rules, block a column, or fail a task. Missing, stale-shaped or
 * unparsable releases degrade to an explicit "not governed" marker.
 */
final class GovernedFieldContext {
    private static final Logger log = LoggerFactory.getLogger(GovernedFieldContext.class);
    private static final JsonMapper JSON = new JsonMapper();
    private static final int MEANING_LIMIT = 240;
    /** Keeps the advisory block well inside the engine's 57KB tool-result budget. */
    private static final int BLOCK_LIMIT = 3000;

    private static final String GOVERNED_USAGE =
        "人工发布后确认的字段口径，仅用于解读，不改变计算规则。status=SOURCE_DOCUMENTED 表示已核对；"
            + "UNKNOWN 表示口径未确认，不得据列名推断金额、单位或业务状态，也不得因此拒绝计算。"
            + "记录粒度、主键与唯一性同样须有来源依据；不要把一行自动解释成一张账单、一次交易或一个客户。按源字段计算后保留这些限制。";
    private static final String UNGOVERNED_USAGE =
        "该数据集尚未发布治理口径；字段含义与单位以部署定义为准，不得据列名推断金额或业务状态。";

    private GovernedFieldContext() {}

    /** Latest release visible to this actor that covers the dataset, or an explicit not-governed marker. */
    static Map<String, Object> load(JdbcTemplate db, UUID tenant, UUID actor, UUID dataset, List<String> visibleColumns) {
        return read(db, tenant, actor, dataset, visibleColumns, null);
    }

    static Map<String, Object> loadCurrent(JdbcTemplate db, UUID tenant, UUID actor, UUID dataset, List<String> visibleColumns, UUID release) {
        return release == null ? ungoverned() : read(db, tenant, actor, dataset, visibleColumns, release);
    }

    private static Map<String, Object> read(JdbcTemplate db, UUID tenant, UUID actor, UUID dataset, List<String> visibleColumns, UUID release) {
        if (db == null || tenant == null || actor == null || dataset == null || visibleColumns == null || visibleColumns.isEmpty()) {
            return ungoverned();
        }
        try {
            List<Map<String, Object>> rows = db.queryForList(
                """
                SELECT r.package::text AS package,r.created_at
                FROM native_governance_releases r
                WHERE r.tenant_id=? AND r.recipient_id=headquarters_permission_actor(?,?) AND (?::uuid IS NULL OR r.id=?)
                  AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.package->'items') i WHERE i->>'datasetId'=?)
                ORDER BY r.created_at DESC,r.id DESC LIMIT 1
                """,
                tenant, actor, tenant, release, release, dataset.toString());
            if (rows.isEmpty()) return ungoverned();
            JsonNode items = JSON.readTree((String) rows.getFirst().get("package")).path("items");
            List<Map<String, Object>> fields = new ArrayList<>();
            int used = 0;
            for (JsonNode item : items) {
                if (!dataset.toString().equals(item.path("datasetId").asText())) continue;
                for (JsonNode field : item.path("fields")) {
                    String column = field.path("column").asText("");
                    String meaning = field.path("meaning").asText("").strip();
                    if (column.isEmpty() || meaning.isEmpty() || !visibleColumns.contains(column)) continue;
                    Map<String, Object> entry = map(
                        "column", column,
                        "meaning", truncate(meaning),
                        "unit", truncate(field.path("unit").asText("").strip()),
                        "status", "UNKNOWN".equals(field.path("status").asText("")) ? "UNKNOWN" : "SOURCE_DOCUMENTED");
                    used += column.length() + String.valueOf(entry.get("meaning")).length() + String.valueOf(entry.get("unit")).length();
                    if (used > BLOCK_LIMIT) break;
                    fields.add(entry);
                }
                break;
            }
            if (fields.isEmpty()) return ungoverned();
            return map(
                "authority", false,
                "source", "NATIVE_GOVERNANCE_RELEASE",
                "releasedAt", ((Timestamp) rows.getFirst().get("created_at")).toInstant(),
                "usage", GOVERNED_USAGE,
                "fields", fields);
        } catch (RuntimeException e) {
            // A release that cannot be read is not a reason to fail a briefing: fall back to deployment definitions.
            log.warn("Governance field context unavailable dataset={} cause={}", dataset, e.getClass().getSimpleName());
            return ungoverned();
        }
    }

    private static Map<String, Object> ungoverned() {
        return map("authority", false, "source", "NONE", "usage", UNGOVERNED_USAGE);
    }

    private static String truncate(String value) {
        return value.length() <= MEANING_LIMIT ? value : value.substring(0, MEANING_LIMIT - 1) + "…";
    }

    private static Map<String, Object> map(Object... values) {
        var result = new LinkedHashMap<String, Object>();
        for (int i = 0; i < values.length; i += 2) result.put((String) values[i], values[i + 1]);
        return result;
    }
}
