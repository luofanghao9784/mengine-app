package com.dreamcore.workspace.governance;

import com.dreamcore.workspace.identity.IdentityService;
import java.util.*;
import tools.jackson.databind.json.JsonMapper;

/** Recheck deployment receipt against this exact snapshot. Export keys are not database constraints. */
public final class ExportSnapshotChecks {
    private ExportSnapshotChecks() {}

    public static Map<String,Object> check(UUID snapshot, List<?> columns, List<?> rows, List<Map<String,Object>> evidence) {
        var receipts = evidence.stream().filter(e -> "export-validation".equals(e.get("kind"))).toList();
        if (receipts.isEmpty()) return Map.of("state", "NOT_PROVIDED");
        for (var receipt : receipts) {
            if (!snapshot.toString().equals(receipt.get("snapshotId"))) continue;
            String hash = IdentityService.hash(new JsonMapper().writeValueAsString(rows));
            if (!hash.equals(receipt.get("rowsSha256")) || !columns.equals(receipt.get("columns"))
                    || !(receipt.get("rowCount") instanceof Number count) || count.longValue() != rows.size())
                return Map.of("state", "MISMATCH", "scope", "导出接收依据与当前快照不一致");
            var names = receipt.get("candidateKeyColumns") instanceof List<?> keys ? keys : List.of();
            if (names.isEmpty() || new HashSet<>(names).size() != names.size() || !columns.containsAll(names))
                return Map.of("state", "MISMATCH", "scope", "采集候选键不在当前列范围内");
            long missing = 0, duplicates = 0;
            var seen = new HashSet<List<Object>>();
            for (Object value : rows) {
                var row = (List<?>)value;
                var key = new ArrayList<Object>();
                for (Object name : names) key.add(row.get(columns.indexOf(name)));
                if (key.stream().anyMatch(v -> v == null || v.toString().isBlank())) missing++;
                if (!seen.add(key)) duplicates++;
            }
            var result = new LinkedHashMap<String,Object>();
            result.put("state", missing == 0 && duplicates == 0 ? "CHECKED" : "VIOLATIONS");
            result.put("snapshotId", snapshot); result.put("rowsSha256", hash);
            result.put("rowCount", rows.size()); result.put("columnCount", columns.size());
            result.put("candidateKeyColumns", names); result.put("missingKeys", missing); result.put("duplicateKeys", duplicates);
            result.put("scope", "当前完整快照与部署导出回执逐值摘要一致；已重验采集候选键，未声明源数据库主键、到账、币种或财务正确性");
            return result;
        }
        return Map.of("state", "STALE", "scope", "导出接收依据属于其他快照，未采用旧检查结论");
    }
}
