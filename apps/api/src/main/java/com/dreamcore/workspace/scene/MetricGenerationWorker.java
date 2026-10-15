package com.dreamcore.workspace.scene;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
@Component
@org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication(type=org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type.SERVLET)
@org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(name="dreamcore.metrics.auto-generation.enabled",havingValue="true",matchIfMissing=true)
public class MetricGenerationWorker {
 private final JdbcTemplate db;private final MetricDraftGenerator generator;
 public MetricGenerationWorker(JdbcTemplate db,MetricDraftGenerator generator){this.db=db;this.generator=generator;}
 @Scheduled(fixedDelayString="${dreamcore.metrics.auto-generation.delay-ms:300000}",initialDelayString="${dreamcore.metrics.auto-generation.initial-delay-ms:120000}")
 public void tick(){for(var b:db.queryForList("SELECT b.tenant_id,b.maintainer_id FROM scene_bindings b JOIN tenants t ON t.id=b.tenant_id LEFT JOIN metric_generation_settings s ON s.tenant_id=b.tenant_id WHERE t.status='ACTIVE' AND b.governance_valid_until>now() AND coalesce(s.enabled,true)"))try{generator.generate((UUID)b.get("maintainer_id"),(UUID)b.get("tenant_id"),false);}catch(RuntimeException e){db.update("INSERT INTO metric_generation_settings(tenant_id,checked_at,error_code) VALUES(?,now(),'GENERATION_FAILED') ON CONFLICT(tenant_id) DO UPDATE SET checked_at=now(),error_code='GENERATION_FAILED'",b.get("tenant_id"));}}
}
