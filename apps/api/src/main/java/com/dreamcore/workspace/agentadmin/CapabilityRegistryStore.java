package com.dreamcore.workspace.agentadmin;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** 平台目录最小写入；唯一键冲突不覆盖已有登记。 */
@Repository
public class CapabilityRegistryStore {
    private final JdbcTemplate db;

    public CapabilityRegistryStore(JdbcTemplate db) {
        this.db = db;
    }

    public boolean insert(String capabilityId, String name, String kind, String enterpriseFunction) {
        return db.update("""
                INSERT INTO qo_capability(capability_id, name, kind, enterprise_function)
                VALUES (?, ?, ?, ?)
                ON CONFLICT (capability_id) DO NOTHING
                """, capabilityId, name, kind, enterpriseFunction) == 1;
    }
}
