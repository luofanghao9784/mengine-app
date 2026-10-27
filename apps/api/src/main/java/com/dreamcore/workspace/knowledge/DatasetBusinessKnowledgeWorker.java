package com.dreamcore.workspace.knowledge;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
@Component
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
public class DatasetBusinessKnowledgeWorker {
 private final JdbcTemplate db;private final DatasetBusinessKnowledgeService service;private final Set<UUID> tenants=new HashSet<>();
 public DatasetBusinessKnowledgeWorker(JdbcTemplate db,DatasetBusinessKnowledgeService service,@Value("${dreamcore.knowledge.insight-tenants:}")String configured){this.db=db;this.service=service;for(String s:configured.split(","))if(!s.isBlank())tenants.add(UUID.fromString(s.trim()));}
 @Scheduled(fixedDelayString="${dreamcore.knowledge.insight-poll-ms:60000}",initialDelayString="${dreamcore.knowledge.insight-initial-delay-ms:25000}")
 public void tick(){for(UUID tenant:tenants){var owners=db.queryForList("SELECT owner_id FROM tenant_governance WHERE tenant_id=?",UUID.class,tenant);if(owners.isEmpty())continue;try{service.start(owners.getFirst(),tenant);service.scheduled(tenant);}catch(com.dreamcore.workspace.identity.IdentityException waiting){service.waiting(tenant,waiting.code);}catch(RuntimeException failed){service.failed(tenant);}}}
}
