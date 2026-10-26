package com.dreamcore.workspace.collection;

import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;

@Component
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class SourceContractPublicationWorker {
    private final JdbcTemplate db;
    private final SourceContractPublicationService service;
    private final Set<UUID> tenants=new HashSet<>();
    public SourceContractPublicationWorker(JdbcTemplate db,SourceContractPublicationService service,
            @Value("${dreamcore.collection.business-preflight-tenants:}") String configured) {
        this.db=db;this.service=service;
        for(String v:configured.split(",")) if(!v.isBlank()) tenants.add(UUID.fromString(v.trim()));
    }
    @Scheduled(fixedDelay=30000,initialDelay=15000)
    public void tick() {
        for(UUID tenant:tenants) {
            var owners=db.queryForList("SELECT owner_id FROM tenant_governance WHERE tenant_id=?",UUID.class,tenant);
            if(owners.isEmpty()) continue;
            for(UUID dataset:db.queryForList("SELECT id FROM business_datasets WHERE tenant_id=? AND status='ACTIVE' AND NOT scrubbed AND current_snapshot IS NOT NULL ORDER BY id LIMIT 1000",UUID.class,tenant)) {
                try { service.reconcile(owners.getFirst(),tenant,dataset); }
                catch(RuntimeException failure) {
                    // Never expose source content; a failed validation cannot publish a release.
                    org.slf4j.LoggerFactory.getLogger(getClass()).warn("Approved source publication deferred: tenant={} dataset={} error={}",tenant,dataset,failure.getClass().getSimpleName());
                }
            }
        }
    }
}
