package com.dreamcore.workspace.agentadmin;

import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/** 只写企业开通表；冲突后回读，绝不覆盖已有指向与时间。 */
@Repository
public class CapabilityTenantGrantStore {
    private final JdbcTemplate db;

    public CapabilityTenantGrantStore(JdbcTemplate db) { this.db = db; }

    @Transactional
    public Result grant(UUID tenantId, String capabilityId, String enterpriseFunction) {
        if (db.queryForList("SELECT id FROM tenants WHERE id=? FOR KEY SHARE", UUID.class, tenantId).isEmpty()) {
            return new Result(404, "TENANT_NOT_FOUND", "没有这个企业，不能开通", null);
        }
        var catalog = db.queryForList("SELECT enterprise_function FROM qo_capability WHERE capability_id=? FOR SHARE", capabilityId);
        if (catalog.isEmpty()) {
            return new Result(404, "CAPABILITY_NOT_FOUND", "还没有这项登记，请先登记再开通", null);
        }
        if (!enterpriseFunction.equals(catalog.getFirst().get("enterprise_function"))) {
            return new Result(400, "INVALID_REQUEST", "请按要求填写开通内容", null);
        }
        int inserted = db.update("""
                INSERT INTO qo_capability_tenant_grant(tenant_id, enterprise_function, capability_id)
                VALUES (?, ?, ?) ON CONFLICT (tenant_id, enterprise_function) DO NOTHING
                """, tenantId, enterpriseFunction, capabilityId);
        Grant row = db.queryForObject("""
                SELECT tenant_id, capability_id, enterprise_function, granted_at
                FROM qo_capability_tenant_grant WHERE tenant_id=? AND enterprise_function=?
                """, (rs, n) -> new Grant(rs.getObject("tenant_id", UUID.class), rs.getString("capability_id"),
                rs.getString("enterprise_function"), rs.getTimestamp("granted_at").toInstant().toString()), tenantId, enterpriseFunction);
        if (row == null) throw new IllegalStateException("开通结果未能读回");
        if (!capabilityId.equals(row.capabilityId())) {
            return new Result(409, "GRANT_ALREADY_EXISTS", "已经开通过了，不能改成另一项", null);
        }
        return new Result(inserted == 1 ? 201 : 200, null, null, row);
    }

    public record Grant(UUID tenantId, String capabilityId, String enterpriseFunction, String grantedAt) {}
    public record Result(int status, String code, String message, Grant row) {}
}
