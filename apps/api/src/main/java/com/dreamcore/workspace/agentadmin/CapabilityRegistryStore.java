package com.dreamcore.workspace.agentadmin;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** 平台目录登记与只读查询；唯一键冲突不覆盖已有登记。 */
@Repository
public class CapabilityRegistryStore {
    private final JdbcTemplate db;

    public CapabilityRegistryStore(JdbcTemplate db) {
        this.db = db;
    }

    public List<Map<String, String>> listCapabilities() {
        return db.query("SELECT capability_id, name, kind, enterprise_function FROM qo_capability ORDER BY capability_id",
                (row, index) -> {
                    Map<String, String> capability = new LinkedHashMap<>();
                    capability.put("capabilityId", row.getString("capability_id"));
                    capability.put("name", row.getString("name"));
                    String kind = row.getString("kind");
                    String enterpriseFunction = row.getString("enterprise_function");
                    if (kind != null) capability.put("kind", kind);
                    if (enterpriseFunction != null) capability.put("enterpriseFunction", enterpriseFunction);
                    return capability;
                });
    }

    public boolean insert(String capabilityId, String name, String kind, String enterpriseFunction) {
        return db.update("""
                INSERT INTO qo_capability(capability_id, name, kind, enterprise_function)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (capability_id) DO NOTHING
                """, capabilityId, name, kind, enterpriseFunction) == 1;
    }
}
