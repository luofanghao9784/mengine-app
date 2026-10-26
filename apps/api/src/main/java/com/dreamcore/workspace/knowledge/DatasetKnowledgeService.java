package com.dreamcore.workspace.knowledge;

import com.dreamcore.workspace.collection.NativeGovernanceDeployment;
import com.dreamcore.workspace.governance.GovernanceModelService;
import com.dreamcore.workspace.identity.IdentityException;
import com.dreamcore.workspace.identity.IdentityService;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Evidence-preserving compilation, not model inference or a grant of source access. */
@Service
public class DatasetKnowledgeService {
    private final JdbcTemplate db;
    private final NativeGovernanceDeployment releases;
    private final GovernanceModelService governance;
    private final IdentityService identities;
    private final JsonMapper json = new JsonMapper();

    public DatasetKnowledgeService(JdbcTemplate db, NativeGovernanceDeployment releases,
            GovernanceModelService governance, IdentityService identities) {
        this.db=db; this.releases=releases; this.governance=governance; this.identities=identities;
    }

    public record Article(UUID id, UUID datasetId, String title, String content, UUID releaseId) {}

    private void stale(UUID tenant, UUID dataset, String reason) {
        db.update("UPDATE dataset_knowledge_publications SET state='STALE',reason=?,checked_at=now() WHERE tenant_id=? AND dataset_id=? AND state<>'STALE'",reason,tenant,dataset);
    }

    @Transactional
    public void reconcile(UUID actor, UUID tenant, UUID dataset) {
        identities.member(actor,tenant,false);
        if(!Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM tenant_governance WHERE tenant_id=? AND owner_id=?)",Boolean.class,tenant,actor)))
            throw new IdentityException(403,"DATASET_KNOWLEDGE_PUBLISH_FORBIDDEN");
        // Serialize concurrent workers; lock the current snapshot through validation/publication.
        var rows=db.queryForList("SELECT name,current_snapshot FROM business_datasets WHERE id=? AND tenant_id=? AND status='ACTIVE' AND NOT scrubbed FOR UPDATE",dataset,tenant);
        if(rows.isEmpty()) { stale(tenant,dataset,"SOURCE_UNAVAILABLE"); return; }
        var current=releases.currentFor(actor,tenant,dataset);
        if(current.isEmpty()) { stale(tenant,dataset,"SOURCE_GOVERNANCE_REQUIRED"); return; }
        var release=current.getFirst();
        if(release.fields().isEmpty() || release.fields().stream().anyMatch(f -> "UNKNOWN".equals(f.status()) || f.meaning().isBlank())) {
            stale(tenant,dataset,"SOURCE_FIELDS_UNCONFIRMED"); return;
        }
        var readiness=governance.analysisReadiness(actor,tenant,dataset);
        if(!readiness.ready()) { stale(tenant,dataset,readiness.reason()); return; }
        String title=rows.getFirst().get("name")+" · 已确认业务口径";
        StringBuilder content=new StringBuilder("以下口径来自当前已发布的数据治理结果，按已声明的来源范围使用。\n\n");
        for(var field:release.fields()) {
            content.append(field.column()).append("：").append(field.meaning());
            if(!field.unit().isBlank()) content.append("；单位：").append(field.unit());
            content.append("。\n依据：").append(field.evidence()).append("\n\n");
        }
        content.append("使用边界：本文说明字段口径，不代表实际到账、利润或其他未声明的业务事实。具体记录与统计结论仍须引用获权数据快照和计算结果。来源、口径或权限变化后重新核验。");
        String document=json.writeValueAsString(new TreeMap<>(Map.of("version",1,"title",title,"content",content.toString(),
                "datasetId",dataset,"releaseId",release.releaseId(),"fields",release.fields(),"generator","VERIFIED_DEFINITION_COMPILER")));
        String hash=IdentityService.hash(document);
        db.update("UPDATE dataset_knowledge_publications SET state='STALE',reason='SOURCE_VERSION_CHANGED',checked_at=now() WHERE tenant_id=? AND dataset_id=? AND release_id<>? AND state<>'STALE'",tenant,dataset,release.releaseId());
        db.update("INSERT INTO dataset_knowledge_publications(id,tenant_id,dataset_id,release_id,source_snapshot_id,document,content_hash,state) VALUES (?,?,?,?,?,?::jsonb,?,'DRAFT') ON CONFLICT(tenant_id,dataset_id,release_id) DO NOTHING",UUID.randomUUID(),tenant,dataset,release.releaseId(),rows.getFirst().get("current_snapshot"),document,hash);
        // Existing immutable draft must exactly match recompilation; never overwrite an old body.
        int count=db.update("UPDATE dataset_knowledge_publications SET state='PUBLISHED',reason=NULL,checked_at=now(),published_at=coalesce(published_at,now()) WHERE tenant_id=? AND dataset_id=? AND release_id=? AND content_hash=? AND document=?::jsonb",tenant,dataset,release.releaseId(),hash,document);
        if(count!=1) throw new IdentityException(409,"DATASET_KNOWLEDGE_DRAFT_CONFLICT");
    }

    /** Access and current evidence are checked on every read, even before the worker notices changes. */
    @Transactional
    public List<Article> current(UUID actor, UUID tenant) {
        identities.member(actor,tenant,false);
        var result=new ArrayList<Article>();
        for(var row:db.queryForList("SELECT id,dataset_id,release_id,document,content_hash FROM dataset_knowledge_publications WHERE tenant_id=? AND state='PUBLISHED' ORDER BY published_at DESC LIMIT 1000",tenant)) {
            UUID dataset=(UUID)row.get("dataset_id"), release=(UUID)row.get("release_id");
            try {
                var sources=releases.currentFor(actor,tenant,dataset);
                if(sources.stream().noneMatch(s -> s.releaseId().equals(release)) || !governance.analysisReadiness(actor,tenant,dataset).ready()) continue;
                JsonNode doc=json.readTree(row.get("document").toString());
                // JSONB reorders keys, so compare structured fields against the immutable release.
                var source=sources.stream().filter(s -> s.releaseId().equals(release)).findFirst().orElseThrow();
                if(!doc.path("fields").equals(json.valueToTree(source.fields()))) continue;
                result.add(new Article((UUID)row.get("id"),dataset,doc.path("title").asText(),doc.path("content").asText(),release));
            } catch(IdentityException unavailable) { /* Do not expose content from revoked or stale sources. */ }
        }
        return result;
    }
}
