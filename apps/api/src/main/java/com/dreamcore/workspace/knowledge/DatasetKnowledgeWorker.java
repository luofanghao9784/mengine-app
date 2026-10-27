package com.dreamcore.workspace.knowledge;

import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;

@Component
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class DatasetKnowledgeWorker {
    private final JdbcTemplate db;
    private final DatasetKnowledgeService service;
    private final Set<UUID> tenants;
    public DatasetKnowledgeWorker(JdbcTemplate db, DatasetKnowledgeService service,
            @Value("${dreamcore.knowledge.automatic-tenants:}") String configured) {
        this.db=db; this.service=service;
        tenants=new HashSet<>();
        for(String value:configured.split(",")) if(!value.isBlank()) tenants.add(UUID.fromString(value.trim()));
    }
    @Scheduled(fixedDelayString="${dreamcore.knowledge.poll-ms:30000}",initialDelayString="${dreamcore.knowledge.initial-delay-ms:15000}")
    public void tick() {
        for(UUID tenant:tenants) {
            var owners=db.queryForList("SELECT owner_id FROM tenant_governance WHERE tenant_id=?",UUID.class,tenant);
            if(owners.isEmpty()) continue;
            for(UUID dataset:db.queryForList("SELECT id FROM business_datasets WHERE tenant_id=? ORDER BY id LIMIT 1000",UUID.class,tenant)) {
                try { if(!service.due(tenant,dataset))continue; service.reconcile(owners.getFirst(),tenant,dataset); }
                catch(RuntimeException failed) {
                    service.failed(tenant,dataset);
                    db.update("UPDATE dataset_knowledge_publications SET state='STALE',reason='REVALIDATION_FAILED',checked_at=now() WHERE tenant_id=? AND dataset_id=? AND state<>'STALE'",tenant,dataset);
                }
            }
        }
    }
}
