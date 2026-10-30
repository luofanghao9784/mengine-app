package com.dreamcore.workspace.capability.adapter;

import com.dreamcore.workspace.capability.registry.CapabilityCatalogPort;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Reads only the grants of the tenant resolved from the customer session. */
@Component
public class GrantCatalogAdapter implements CapabilityCatalogPort {
    private final JdbcTemplate db;

    public GrantCatalogAdapter(JdbcTemplate db) {
        this.db = db;
    }

    @Override public List<EnterpriseFunction> listOpenedCapabilities(UUID tenantId) {
        Objects.requireNonNull(tenantId);
        return db.queryForList(
                "SELECT enterprise_function FROM qo_capability_tenant_grant WHERE tenant_id = ?",
                String.class, tenantId).stream()
                .flatMap(code -> Arrays.stream(EnterpriseFunction.values())
                        .filter(function -> function.code().equals(code)))
                .toList();
    }
}
