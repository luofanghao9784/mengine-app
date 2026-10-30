package com.dreamcore.workspace.capability.adapter;

import com.dreamcore.workspace.capability.registry.CapabilityCatalogPort;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** No production enablement source is connected in CT-039. Never infer it from registration. */
@Component
public class EmptyCapabilityCatalogAdapter implements CapabilityCatalogPort {
    @Override public List<EnterpriseFunction> listOpenedCapabilities(UUID tenantId) {
        Objects.requireNonNull(tenantId);
        return List.of();
    }
}
